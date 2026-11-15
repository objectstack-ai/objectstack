// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A SAML provider can key its accounts on a stable attribute of the person,
 * instead of the NameID.
 *
 * ## The rule
 *
 * A SAML account is the pair (provider, account key). `@better-auth/sso`
 * keys it on the assertion's NameID, which is not one value per person on
 * every IdP: Microsoft Entra ID sends the user principal name when the
 * sign-in starts from this platform's sign-in page (an email-format NameID
 * was asked for) and an opaque pairwise id when it starts from its own app
 * portal (its default persistent NameID). The same person then holds two
 * account keys, and whichever entry comes second does not reach the account
 * the first one made.
 *
 * So a SAML provider's account key is, in this order:
 *
 *  1. the attribute the administrator named (the Register SAML Provider
 *     form's `mapAccountKey`, stored as the provider's
 *     `mapping.extraFields.accountKey`, {@link SAML_ACCOUNT_KEY_EXTRA_FIELD});
 *  2. with none named, for a Microsoft Entra ID provider (its stored issuer's
 *     host is `sts.windows.net` or `login.microsoftonline.com`), Entra's
 *     object id claim, {@link ENTRA_OBJECT_ID_CLAIM}: one value per person
 *     in the tenant, whatever the NameID and whatever the email;
 *  3. otherwise, the NameID, as before.
 *
 * When the assertion does not carry the attribute of 1 or 2, the NameID keys
 * that sign-in, as before. The key is that provider's only: a sign-in through
 * another provider never reaches an account by it (the account's provider is
 * half of the pair), and linking across providers and to a password account
 * keeps its own rule (`implicit-account-linking.ts`). Account rows made
 * before this rule are not rewritten (maintainer ruling on the stable-key
 * card): an account keyed on a NameID is still found by the email a sign-in
 * resolves to, the way any account is.
 *
 * ## How it reaches the vendor (measured on `@better-auth/sso` 1.7.12)
 *
 * The vendor's SAML mapping has no member for the account key (its
 * `samlMappingSchema` is strict: `email`, `emailVerified`, `name`,
 * `firstName`, `lastName`, `extraFields`), and its ACS sets
 * `accountId: extract.nameID` after spreading `extraFields`, with no seam
 * between verifying the assertion and resolving the account. So:
 *
 *  1. Before the vendor runs, the ACS request's posted `SAMLResponse` is read
 *     for its one assertion's NameID and the value of the key attribute
 *     (`samlAssertionPreview`, `sso-saml-standard-claims.ts`), and both go in
 *     the request's SAML scope (`sso-sign-in-options.ts`). Only a value
 *     written as one plain text is read; anything else reads nothing, and the
 *     NameID keys that sign-in.
 *  2. The adapter, in that scope, rewrites the vendor's account lookups and
 *     account writes for this provider and that NameID to the key value
 *     ({@link samlAccountKeyWhere}, {@link samlAccountKeyOnCreate}): every
 *     one the ACS makes, so the account is found and made by the key.
 *  3. The value was read before the vendor verified the assertion, so it is
 *     confirmed against the vendor's verified attributes before anything is
 *     written or anyone is signed in: better-auth's `validateUserInfo` gate,
 *     which the vendor runs with those attributes before it creates a user,
 *     links an account, or signs in to one
 *     ({@link refuseSamlAccountKeyContradiction}). A value the verified
 *     assertion does not carry refuses the sign-in.
 *
 * A vendor upgrade that changes the ACS's account lookup leaves the NameID
 * keying the accounts; the end-to-end pins in
 * `sso-saml-refusal-landing.test.ts` go red on it.
 */

import { SystemObjectName } from '@objectstack/spec/system';
import { samlAccountKeyInScope, type SamlAccountKeyReading } from './sso-sign-in-options.js';
import type { SamlAssertionPreview } from './sso-saml-standard-claims.js';

/** Microsoft Entra ID's object id claim: one value per person in the tenant. */
export const ENTRA_OBJECT_ID_CLAIM = 'http://schemas.microsoft.com/identity/claims/objectidentifier';

/** The hosts of a Microsoft Entra ID SAML issuer. */
export const ENTRA_ISSUER_HOSTS: readonly string[] = ['sts.windows.net', 'login.microsoftonline.com'];

/** The `mapping.extraFields` member naming the attribute a SAML provider keys its accounts on. */
export const SAML_ACCOUNT_KEY_EXTRA_FIELD = 'accountKey';

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node => !!value && typeof value === 'object' && !Array.isArray(value);

const parseConfig = (value: unknown): Node | null => {
  if (isNode(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isNode(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** Whether `issuer` is a Microsoft Entra ID issuer: a URL whose host is one of {@link ENTRA_ISSUER_HOSTS}. */
export function isEntraIssuer(issuer: unknown): boolean {
  if (typeof issuer !== 'string') return false;
  try {
    return ENTRA_ISSUER_HOSTS.includes(new URL(issuer.trim()).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** The account-key attribute a stored SAML mapping names, or `null` when it names none. */
export function accountKeyAttributeOfMapping(mapping: unknown): string | null {
  const extra = isNode(mapping) ? mapping.extraFields : undefined;
  const attribute = isNode(extra) ? extra[SAML_ACCOUNT_KEY_EXTRA_FIELD] : undefined;
  return typeof attribute === 'string' && attribute.trim() !== '' ? attribute.trim() : null;
}

/**
 * `mapping` with its account-key attribute set to `attribute`, or removed when
 * `attribute` is blank. A copy: every other member, and every other
 * `extraFields` member, is kept as it was; an `extraFields` left empty is
 * dropped.
 */
export function mappingWithAccountKeyAttribute(mapping: unknown, attribute: string): Record<string, unknown> {
  const next: Record<string, unknown> = isNode(mapping) ? { ...mapping } : {};
  const extra: Record<string, unknown> = isNode(next.extraFields) ? { ...next.extraFields } : {};
  const named = attribute.trim();
  if (named) extra[SAML_ACCOUNT_KEY_EXTRA_FIELD] = named;
  else delete extra[SAML_ACCOUNT_KEY_EXTRA_FIELD];
  if (Object.keys(extra).length > 0) next.extraFields = extra;
  else delete next.extraFields;
  return next;
}

/**
 * The attribute a SAML provider keys its accounts on (the module header's
 * rule): the one its stored mapping names, else Entra's object id claim for an
 * Entra issuer, else `null` (the NameID). `null` for a provider with no SAML
 * configuration.
 */
export function samlAccountKeyAttributeOf(stored: { samlConfig?: unknown; issuer?: unknown } | null | undefined): string | null {
  const config = parseConfig(stored?.samlConfig);
  if (!config) return null;
  return accountKeyAttributeOfMapping(config.mapping) ?? (isEntraIssuer(stored?.issuer) ? ENTRA_OBJECT_ID_CLAIM : null);
}

/**
 * The account-key reading of a posted assertion: its NameID and the value of
 * `attribute`, when it carries both as plain text; `undefined` otherwise (the
 * NameID keys that sign-in).
 */
export function samlAccountKeyReadingOf(
  preview: SamlAssertionPreview | null,
  attribute: string | null,
): SamlAccountKeyReading | undefined {
  if (!preview || !attribute || !preview.nameId) return undefined;
  const value = preview.singleValueOf(attribute);
  return value ? { attribute, nameId: preview.nameId, value } : undefined;
}

// ── The adapter halves ──────────────────────────────────────────────────────

/** A better-auth adapter `where` entry, as the adapter is handed it. */
interface WhereEntry {
  field: string;
  value: unknown;
  operator?: string;
  connector?: string;
}

const ACCOUNT_ID_FIELDS = new Set(['account_id', 'accountId']);
const PROVIDER_ID_FIELDS = new Set(['provider_id', 'providerId']);

const isEquality = (entry: WhereEntry): boolean =>
  (entry.operator === undefined || entry.operator === 'eq') && (entry.connector === undefined || entry.connector === 'AND');

/** The reading in scope, when `objectName` is the account object. */
function readingFor(objectName: string): ReturnType<typeof samlAccountKeyInScope> {
  return objectName === SystemObjectName.ACCOUNT ? samlAccountKeyInScope() : undefined;
}

/**
 * READ half: an account read during the SAML ACS request of a provider that
 * keys on a stable attribute, for that provider and the NameID the posted
 * assertion carries, asks for the key value instead. Every other read, and
 * any read outside that scope, is returned as it was handed in.
 */
export function samlAccountKeyWhere<W extends WhereEntry>(objectName: string, where: W[]): W[] {
  const reading = readingFor(objectName);
  if (!reading || !Array.isArray(where) || !where.every(isEquality)) return where;
  const provider = where.find((entry) => PROVIDER_ID_FIELDS.has(entry.field));
  const account = where.find((entry) => ACCOUNT_ID_FIELDS.has(entry.field));
  if (provider?.value !== reading.providerId || account?.value !== reading.nameId) return where;
  return where.map((entry) => (entry === account ? { ...entry, value: reading.value } : entry));
}

/**
 * WRITE half: an account created during that request, for that provider and
 * that NameID, is created with the key value as its account id. Returns the
 * row to insert (a copy when it changes).
 */
export function samlAccountKeyOnCreate<R extends Record<string, unknown>>(objectName: string, row: R): R {
  const reading = readingFor(objectName);
  if (!reading || !isNode(row)) return row;
  const providerField = [...PROVIDER_ID_FIELDS].find((field) => field in row);
  const accountField = [...ACCOUNT_ID_FIELDS].find((field) => field in row);
  if (!providerField || !accountField) return row;
  if (row[providerField] !== reading.providerId || row[accountField] !== reading.nameId) return row;
  return { ...row, [accountField]: reading.value };
}

// ── The confirmation ────────────────────────────────────────────────────────

/** The refusal code of {@link refuseSamlAccountKeyContradiction}: the ledger's `INVALID_REQUEST` (ADR-0112). */
export const SAML_ACCOUNT_KEY_CONTRADICTION = 'INVALID_REQUEST';

/** The refusal's description: the rule, never a value. */
export const SAML_ACCOUNT_KEY_CONTRADICTION_DESCRIPTION =
  "The identity provider's signed assertion does not carry the account key this sign-in was read for. "
  + 'Nothing was created and nobody was signed in.';

/** The first value of an attribute as the vendor's verified extract holds it (one string, or a list). */
function firstValue(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first.trim() : null;
}

/**
 * The confirmation, at better-auth's `validateUserInfo` gate: a SAML sign-in
 * whose account key was read from the posted assertion
 * ({@link samlAccountKeyReadingOf}) goes on only when the vendor's VERIFIED
 * attributes (`source.sso.profile`) carry that same value; otherwise it is
 * refused `INVALID_REQUEST`, before any user, account or session is written.
 * Any other call is not judged here.
 */
export function refuseSamlAccountKeyContradiction(
  data: unknown,
  logger?: { warn?: (message: string, meta?: Record<string, unknown>) => void },
): { error: string; errorDescription: string } | undefined {
  const source = isNode(data) && isNode(data.source) ? data.source : undefined;
  if (source?.method !== 'sso-saml') return undefined;
  const sso = isNode(source.sso) ? source.sso : undefined;
  const reading = samlAccountKeyInScope();
  if (!reading || sso?.providerId !== reading.providerId) return undefined;
  const profile = isNode(sso.profile) ? sso.profile : {};
  if (firstValue(profile[reading.attribute]) === reading.value) return undefined;
  logger?.warn?.('[auth] SAML sign-in refused: the verified assertion does not carry the account key it was read for', {
    providerId: reading.providerId,
    protocol: 'saml',
    attribute: reading.attribute,
  });
  return { error: SAML_ACCOUNT_KEY_CONTRADICTION, errorDescription: SAML_ACCOUNT_KEY_CONTRADICTION_DESCRIPTION };
}
