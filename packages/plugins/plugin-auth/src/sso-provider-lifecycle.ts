// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The SSO provider lifecycle: what deleting an identity provider does to the
 * people and grants that depend on it, and the one provider an email domain is
 * routed to.
 *
 * ## Deleting a provider
 *
 * `@better-auth/sso`'s `/sso/delete-provider` (1.7.12) deletes the provider row
 * and, in the same transaction, every `account` row of that provider: each user
 * who signed in through it is unlinked. Delete stays possible, because an
 * administrator retiring an identity provider must be able to (server seat 2's
 * ruling on #32085). What changes is that nobody deletes it blind:
 *
 *   - **before**, the confirmation reads {@link readSsoProviderDeleteImpact}
 *     through `GET /admin/sso/delete-impact` (the delete action's preflight):
 *     how many users the delete unlinks, how many of them have no other sign-in
 *     method linked (no password, no other provider), and the group mappings
 *     and projected grants that go with it;
 *   - **on the door itself**, the global before-hook counts the same, after the
 *     sign-in method floor and before the vendor's first write
 *     ({@link stageSsoProviderDeleteImpact}), so every caller of the vendor
 *     route is counted, not only the console. A count that cannot be read
 *     refuses the delete `503`: the answer names what was unlinked, and an
 *     unlink cannot be taken back;
 *   - **after** a delete the vendor answered `success`, the after-hook removes
 *     what the provider left behind ({@link removeSsoProviderDependents}): its
 *     `sys_idp_group_mapping` rows (`source_kind: 'sso'`, `source_id` = the
 *     provider id) and the `sys_user_permission_set` grants whose `reason` is
 *     exactly the provider's projection marker (`ssoGroupProjectionReason`),
 *     never a grant by permission-set name, so a grant made by hand or by SCIM
 *     is never touched; then it adds the counts to the answer
 *     ({@link settleSsoProviderDelete}).
 *
 * A delete the vendor refuses (`403` not the provider's manager, `404` no such
 * provider) runs no cleanup and gets no counts: the counts are only ever
 * handed to a caller the vendor admitted.
 *
 * ## One domain, one provider
 *
 * Sign-in routes an email address to a provider by its domain. Measured on
 * `@better-auth/sso` 1.7.12 (`/sign-in/sso`), in two steps:
 *
 *   1. the provider whose whole stored `domain` value equals the address's
 *      domain (a plain equality read, so `eng.acme.com` alone, not
 *      `eng.acme.com, foo.com` and not `https://eng.acme.com`);
 *   2. else the first provider of an unordered `findMany` whose
 *      comma-separated list holds the domain or a parent of it
 *      (`domainMatches`: equal, or ends with `.` + entry). No sort is asked,
 *      so "first" is the store's row order, which no contract fixes.
 *
 * So a second provider would not be reached by address in two shapes, and
 * the before-hook refuses both on `/sso/register` (and on a domain edit on
 * `/sso/update-provider`) with `409 RESOURCE_CONFLICT` naming the holder
 * ({@link findSsoDomainClaim}). (An IdP-initiated SAML sign-in reaches a
 * provider through its own ACS URL, without address routing; the refusal is
 * about the address route.)
 *
 *   - **exact:** both list the same domain entry;
 *   - **parent:** one lists a subdomain (`eng.acme.com`) and the other its
 *     parent (`acme.com`), and the subdomain's provider does not win step 1,
 *     because its `domain` is a list or another spelling of the entry. Step 2
 *     then matches both, and the row order picks. This is judged in both
 *     registration orders: a parent added beside a listed subdomain is
 *     refused too, since the order the store answers in is not the order of
 *     registration.
 *
 * Accepted: a provider whose whole `domain` is exactly `eng.acme.com` beside
 * one for `acme.com`, either way round. Step 1 sends `eng.acme.com` to the
 * subdomain's provider, and the parent is routed its other subdomains. (A
 * deeper name such as `x.eng.acme.com` matches both lists at step 2; that is
 * the ruled-accepted configuration, left as it is.)
 *
 * Routing is not admission. With domain verification on, a provider creates
 * an account only for an address at a domain it lists and has verified,
 * compared exactly: a subdomain the provider is routed but does not list
 * itself gets no new account through it (`sso-account-at-proven-domain.ts`).
 *
 * Every entry is compared as one spelling: the bare lower-case ASCII host,
 * with an internationalised name in its punycode form (`bücher.de` and
 * `xn--bcher-kva.de` are one domain) and a trailing root dot dropped
 * (`acme.com.` is `acme.com`, as the vendor's own parse reads it). Every
 * provider row is read and parsed the same way; no raw substring of the
 * stored value narrows the read, since the stored spelling is whatever the
 * author typed.
 *
 * Not closed here: the check is a read before the vendor's insert, not one
 * atomic act with it, so two registers racing for one domain can both pass.
 * The store offers no constraint that holds the rule (a unique `domain`
 * column sees whole values, not entries, parents or spellings), and the
 * vendor's register runs in no transaction this adapter opens.
 */

import { domainToUnicode } from 'node:url';
import type { IDataEngine } from '@objectstack/core';
import { withSystemContext } from './objectql-adapter.js';
import {
  IDP_GROUP_MAPPING_OBJECT,
  SSO_MAPPING_SOURCE_KIND,
  ssoGroupProjectionReason,
} from './scim-group-projection.js';
import { SSO_PROVIDER_OBJECT } from './sso-client-secret.js';

/** The better-auth endpoints whose bodies carry a provider's `domain`. */
export const SSO_PROVIDER_REGISTER_PATH = '/sso/register';
export const SSO_PROVIDER_UPDATE_PATH = '/sso/update-provider';

const ACCOUNT_OBJECT = 'sys_account';
const GRANT_OBJECT = 'sys_user_permission_set';

const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function registered(engine: IDataEngine, object: string): boolean {
  const getSchema = (engine as unknown as { getSchema?: (name: string) => unknown }).getSchema;
  return typeof getSchema !== 'function' || Boolean(getSchema.call(engine, object));
}

// ── Domains ─────────────────────────────────────────────────────────────────

/**
 * One domain entry as a bare lower-case ASCII host: `https://Acme.com/x`,
 * `acme.com:443` and `acme.com.` are all `acme.com`, and `bücher.de` is
 * `xn--bcher-kva.de` (the URL parser's punycode form).
 */
function bareDomain(entry: string): string {
  const trimmed = entry.trim();
  if (!trimmed) return '';
  let host: string;
  try {
    host = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname.toLowerCase();
  } catch {
    host = trimmed.toLowerCase();
  }
  return withoutTrailingDots(host);
}

/**
 * `host` without its trailing dots, found by one backward index scan and cut
 * by one `slice`. The value is request-controlled, so no pattern runs on it:
 * a trailing-run pattern such as `/\.+$/` backtracks from every start position
 * of a dot run that does not end the string (quadratic, `js/polynomial-redos`;
 * `register-sso-provider.ts` `bareHostname` is regex-free for the same input).
 */
function withoutTrailingDots(host: string): string {
  let end = host.length;
  while (end > 0 && host.charCodeAt(end - 1) === 0x2e) end -= 1;
  return end === host.length ? host : host.slice(0, end);
}

/**
 * The longest `domain` value a provider row holds: `sys_sso_provider.domain`
 * declares `maxLength: 255`, and the write seam refuses a longer value. A
 * request over it could never be saved, so it is refused before anything
 * parses it.
 */
export const SSO_DOMAIN_VALUE_MAX = 255;

/**
 * The longest one entry may be: a host name is at most 253 characters
 * (RFC 1035's 255-octet wire form, less its leading length octet and the root
 * label's), not counting one trailing root dot. An entry is measured as typed,
 * trimmed, so a scheme or a path around a host counts toward it.
 */
export const SSO_DOMAIN_ENTRY_MAX = 253;

/** The refusal of a `domain` too long to be a list of hosts; thrown as better-auth's `APIError`. */
export interface SsoDomainTooLongRefusal {
  status: 'BAD_REQUEST';
  code: 'VALIDATION_FAILED';
  message: string;
  field: 'domain';
  /** The `VALIDATION_FAILED` per-field detail plugin-auth's other length refusals carry. */
  fields: [{ field: 'domain'; code: 'max_length'; message: string }];
}

function tooLong(message: string): SsoDomainTooLongRefusal {
  return { status: 'BAD_REQUEST', code: 'VALIDATION_FAILED', field: 'domain', message, fields: [{ field: 'domain', code: 'max_length', message }] };
}

/**
 * The refusal for a requested `domain` value longer than a provider row holds
 * ({@link SSO_DOMAIN_VALUE_MAX}) or with an entry longer than a host name
 * ({@link SSO_DOMAIN_ENTRY_MAX}), or `undefined`. It reads lengths only: the
 * whole value's first, so no entry is cut out of a value over the bound, and
 * nothing is parsed as a host. Asked before {@link providerDomains}.
 */
export function ssoDomainTooLong(domain: unknown): SsoDomainTooLongRefusal | undefined {
  if (typeof domain !== 'string') return undefined;
  if (domain.length > SSO_DOMAIN_VALUE_MAX) {
    return tooLong(
      `The SSO provider domain is ${domain.length} characters long; a provider's domain holds at most `
        + `${SSO_DOMAIN_VALUE_MAX} (its comma-separated email domains together). Nothing was saved.`,
    );
  }
  for (const entry of domain.split(',')) {
    const trimmed = entry.trim();
    const length = trimmed.endsWith('.') ? trimmed.length - 1 : trimmed.length;
    if (length > SSO_DOMAIN_ENTRY_MAX) {
      return tooLong(
        `An SSO provider domain entry is ${length} characters long; an email domain is a host name of at most `
          + `${SSO_DOMAIN_ENTRY_MAX} characters. Nothing was saved.`,
      );
    }
  }
  return undefined;
}

/**
 * The email domains a provider's `domain` value serves: its comma-separated
 * entries, each as a bare lower-case ASCII host, blanks dropped, each once.
 */
export function providerDomains(domain: unknown): string[] {
  if (typeof domain !== 'string') return [];
  return [...new Set(domain.split(',').map(bareDomain).filter(Boolean))];
}

/**
 * Whether a provider whose stored `domain` is `value` wins the vendor's exact
 * step for `entry` (step 1 in the module comment): only when the whole value
 * is that entry, spelled as the bare lower-case ASCII host. Compared as the
 * vendor's step 1 compares, by plain equality on the value as stored: the
 * vendor stores `domain` as typed, so `' eng.acme.com '` does not win it.
 */
function winsExactStep(value: unknown, entry: string): boolean {
  return typeof value === 'string' && value === entry;
}

/** `child` is a proper subdomain of `parent`: the vendor's "ends with `.` + entry". */
function isSubdomainOf(child: string, parent: string): boolean {
  return child.endsWith(`.${parent}`);
}

/**
 * A domain another provider already serves.
 *
 *   - `exact`: the holder lists `domain` itself.
 *   - `parent`: the request lists `domain` but does not win the exact step
 *     for it, and the holder lists its parent `entry`.
 *   - `child`: the holder lists `domain` but does not win the exact step for
 *     it, and the request lists its parent `entry`.
 */
export interface SsoDomainClaim {
  providerId: string;
  domain: string;
  kind: 'exact' | 'parent' | 'child';
  /** The parent entry that matches `domain` as well (`parent`, `child`). */
  entry?: string;
}

/**
 * The first provider other than `exceptProviderId` whose `domain` collides
 * with the requested `domain` value, or `undefined`; an exact collision is
 * found before a parent one. Every provider row is read and compared on its
 * parsed entries ({@link providerDomains}). A raw substring of the stored
 * value cannot narrow the read: the stored spelling (Unicode or punycode, a
 * URL, a parent) need not contain the requested one.
 */
export async function findSsoDomainClaim(
  engine: IDataEngine,
  domain: unknown,
  exceptProviderId?: string,
): Promise<SsoDomainClaim | undefined> {
  const requested = providerDomains(domain);
  if (requested.length === 0) return undefined;
  const reader: IDataEngine = withSystemContext(engine);
  const others = rowsOf(await reader.find(SSO_PROVIDER_OBJECT, { fields: ['provider_id', 'domain'] } as never))
    .map((row) => ({ providerId: text(row.provider_id), value: row.domain, entries: providerDomains(row.domain) }))
    .filter((row) => row.providerId && row.providerId !== exceptProviderId);

  for (const wanted of requested) {
    const holder = others.find((row) => row.entries.includes(wanted));
    if (holder) return { providerId: holder.providerId, domain: wanted, kind: 'exact' };
  }
  for (const wanted of requested) {
    for (const row of others) {
      const parent = winsExactStep(domain, wanted) ? undefined : row.entries.find((held) => isSubdomainOf(wanted, held));
      if (parent) return { providerId: row.providerId, domain: wanted, kind: 'parent', entry: parent };
      const child = row.entries.find((held) => isSubdomainOf(held, wanted) && !winsExactStep(row.value, held));
      if (child) return { providerId: row.providerId, domain: child, kind: 'child', entry: wanted };
    }
  }
  return undefined;
}

/** `'xn--bcher-kva.de' (bücher.de)`: the compared ASCII form, and the Unicode one when it differs. */
function spelled(domain: string): string {
  const unicode = domainToUnicode(domain);
  return unicode && unicode !== domain ? `'${domain}' (${unicode})` : `'${domain}'`;
}

/** The refusal of a register or a domain edit onto a domain another provider serves; thrown as better-auth's `APIError`. */
export interface SsoDomainClaimedRefusal {
  status: 'CONFLICT';
  code: 'RESOURCE_CONFLICT';
  message: string;
  field: 'domain';
  /** The provider that serves the domain; named only to a caller who may read every provider. */
  heldBy?: string;
}

/**
 * The sentence that says why `claim` collides, and what to do instead. Without
 * `nameHolder` it names only what the request itself holds: the requested
 * entry, or (`parent`) a parent of it, which the caller's own domain spells.
 * A `child` claim's domain is the other provider's listed subdomain, which the
 * request does not hold, so it is not named then.
 */
function claimSentence(claim: SsoDomainClaim, holder: string, nameHolder: boolean): string {
  const domain = spelled(claim.domain);
  if (claim.kind === 'child' && !nameHolder) {
    const parent = spelled(claim.entry ?? '');
    return `A subdomain of the email domain ${parent} is served by ${holder} as one entry of a list, or in another spelling than its whole domain. Adding ${parent} `
      + 'here would leave both providers matching that subdomain, with the store row order picking one, so it would '
      + `not be reliably reached by address. Leave ${parent} off this provider, or ask a platform administrator to give `
      + 'that subdomain a provider whose only domain entry it is.';
  }
  if (claim.kind === 'parent') {
    return `The email domain ${domain} is already served by ${holder} through its entry '${claim.entry}'. `
      + `Sign-in sends ${domain} to its own provider first only when that provider's whole domain is exactly ${domain}; `
      + 'as one entry of a list, or in another spelling, both providers match it and the store row order picks one, '
      + `so this provider would not be reliably reached by address. Register ${domain} as a provider's only domain `
      + `entry, or edit '${claim.entry}' off the provider that serves it.`;
  }
  if (claim.kind === 'child') {
    return `The email domain ${domain} is served by ${holder} as one entry of a list, or in another spelling than its whole domain. Adding its parent '${claim.entry}' `
      + `here would leave both providers matching ${domain}, with the store row order picking one, so ${domain} `
      + `would not be reliably reached by address. Give ${domain} a provider whose only domain entry it is, or leave `
      + `'${claim.entry}' off this provider.`;
  }
  return `The email domain ${domain} is already served by ${holder}. Sign-in routes an address to one provider `
    + `by its domain, so a second provider for ${domain} would not be reached by address. `
    + `Register it under its own domain entry (a subdomain such as 'sso.${claim.domain}' is accepted as a provider's only entry), `
    + `edit ${domain} off the provider that serves it, or delete that provider first.`;
}

/**
 * The located `409` for `claim`. `nameHolder` is false for a caller who is not
 * a platform administrator: such a caller learns only that a domain the
 * request names (or a subdomain of it) is served, which `/sign-in/sso` already
 * answers anyone for a name they supply, and not by which row, nor which
 * subdomain another provider lists.
 */
export function ssoDomainClaimedRefusal(claim: SsoDomainClaim, nameHolder: boolean): SsoDomainClaimedRefusal {
  const holder = nameHolder ? `SSO provider '${claim.providerId}'` : 'another SSO provider';
  return {
    status: 'CONFLICT',
    code: 'RESOURCE_CONFLICT',
    field: 'domain',
    message: claimSentence(claim, holder, nameHolder),
    ...(nameHolder ? { heldBy: claim.providerId } : {}),
  };
}

// ── Deleting a provider ─────────────────────────────────────────────────────

/** What deleting one provider removes, counted before the vendor writes anything. */
export interface SsoProviderDeleteImpact {
  providerId: string;
  /** Users with an account linked through the provider: the vendor's delete unlinks each one. */
  linkedUsers: number;
  /** Of those, the users with no other sign-in method linked: no password and no other provider account. */
  usersWithoutOtherSignIn: number;
  /** The provider's `sys_idp_group_mapping` rows. */
  groupMappings: number;
  /** The grants the provider's sign-ins projected (`reason` = its projection marker). */
  projectedGrants: number;
}

/** Count what deleting `providerId` removes. Throws when a read fails: the caller decides what an unreadable count means. */
export async function readSsoProviderDeleteImpact(engine: IDataEngine, providerId: string): Promise<SsoProviderDeleteImpact> {
  const reader: IDataEngine = withSystemContext(engine);
  const linked = new Set<string>();
  if (registered(engine, ACCOUNT_OBJECT)) {
    for (const row of rowsOf(await reader.find(ACCOUNT_OBJECT, { where: { provider_id: providerId }, fields: ['user_id'] } as never))) {
      const userId = text(row.user_id);
      if (userId) linked.add(userId);
    }
  }
  const withOther = new Set<string>();
  if (linked.size > 0) {
    const accounts = rowsOf(
      await reader.find(ACCOUNT_OBJECT, { where: { user_id: { $in: [...linked] } }, fields: ['user_id', 'provider_id'] } as never),
    );
    for (const row of accounts) {
      if (text(row.provider_id) !== providerId) withOther.add(text(row.user_id));
    }
  }
  const groupMappings = registered(engine, IDP_GROUP_MAPPING_OBJECT)
    ? rowsOf(
      await reader.find(IDP_GROUP_MAPPING_OBJECT, { where: { source_kind: SSO_MAPPING_SOURCE_KIND, source_id: providerId }, fields: ['id'] } as never),
    ).length
    : 0;
  const projectedGrants = registered(engine, GRANT_OBJECT)
    ? rowsOf(await reader.find(GRANT_OBJECT, { where: { reason: ssoGroupProjectionReason(providerId) }, fields: ['id'] } as never)).length
    : 0;
  return {
    providerId,
    linkedUsers: linked.size,
    usersWithoutOtherSignIn: [...linked].filter((id) => !withOther.has(id)).length,
    groupMappings,
    projectedGrants,
  };
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** The unlink half of the sentence: how many users, and how many of them have no other sign-in method linked. */
function unlinkSentence(impact: SsoProviderDeleteImpact, done: boolean): string {
  const head = `Deleting SSO provider '${impact.providerId}' ${done ? 'unlinked' : 'unlinks'} ${plural(impact.linkedUsers, 'user')} from it`;
  if (impact.linkedUsers === 0) return `${head}.`;
  const n = impact.usersWithoutOtherSignIn;
  return `${head}; ${n} of them ${done ? 'had' : n === 1 ? 'has' : 'have'} no other sign-in method linked (no password, no other provider).`;
}

/** One English sentence naming what a delete removes (or removed); the counts themselves ride beside it. */
export function ssoProviderDeleteSummary(impact: SsoProviderDeleteImpact, done: boolean): string {
  return `${unlinkSentence(impact, done)} ${done ? 'It removed' : 'It also removes'} ${plural(impact.groupMappings, 'IdP group mapping')} `
    + `and the ${plural(impact.projectedGrants, 'permission-set grant')} they gave.`;
}

/** Where the before-hook leaves the count for the after-hook, on the request's better-auth context. */
export const SSO_PROVIDER_DELETE_IMPACT_STASH = '__osSsoProviderDeleteImpact';

/** The `503` a delete gets when its count cannot be read; thrown as better-auth's `APIError`. */
export interface SsoProviderDeleteImpactUnreadable {
  status: 'SERVICE_UNAVAILABLE';
  code: 'SERVICE_UNAVAILABLE';
  message: string;
}

/**
 * The before-hook half: count what deleting `providerId` removes and leave it
 * on `ctx.context` for {@link settleSsoProviderDelete}. With no data engine
 * there is nothing to count and nothing to clean, and nothing is staged. A
 * failed read is answered with the refusal to throw: the delete is not run.
 */
export async function stageSsoProviderDeleteImpact(
  ctx: any,
  engine: IDataEngine | undefined,
  providerId: string,
): Promise<SsoProviderDeleteImpactUnreadable | undefined> {
  if (!engine || !ctx?.context) return undefined;
  try {
    ctx.context[SSO_PROVIDER_DELETE_IMPACT_STASH] = await readSsoProviderDeleteImpact(engine, providerId);
    return undefined;
  } catch {
    return {
      status: 'SERVICE_UNAVAILABLE',
      code: 'SERVICE_UNAVAILABLE',
      message:
        `SSO provider '${providerId}' was not deleted: the users linked to it could not be counted, and deleting it `
        + 'unlinks every one of them. Nothing was changed; try again.',
    };
  }
}

/** What the after-hook removed. */
export interface SsoProviderDependentsRemoved {
  removedGroupMappings: number;
  removedGrants: number;
}

/**
 * Remove what a deleted provider leaves behind: its group mapping rows, and
 * the grants whose `reason` is exactly its projection marker. Each grant is
 * deleted with its own organization as the write's tenant, as the sign-in
 * that projected it wrote it. Throws on the first failed write.
 */
export async function removeSsoProviderDependents(engine: IDataEngine, providerId: string): Promise<SsoProviderDependentsRemoved> {
  const reader: IDataEngine = withSystemContext(engine);
  const writer: IDataEngine = withSystemContext(engine);
  let removedGrants = 0;
  if (registered(engine, GRANT_OBJECT)) {
    const grants = rowsOf(
      await reader.find(GRANT_OBJECT, { where: { reason: ssoGroupProjectionReason(providerId) }, fields: ['id', 'organization_id'] } as never),
    );
    for (const grant of grants) {
      const tenantId = text(grant.organization_id) || undefined;
      await writer.delete(GRANT_OBJECT, { where: { id: text(grant.id) }, context: { isSystem: true, tenantId } });
      removedGrants++;
    }
  }
  let removedGroupMappings = 0;
  if (registered(engine, IDP_GROUP_MAPPING_OBJECT)) {
    const mappings = rowsOf(
      await reader.find(IDP_GROUP_MAPPING_OBJECT, { where: { source_kind: SSO_MAPPING_SOURCE_KIND, source_id: providerId }, fields: ['id'] } as never),
    );
    for (const mapping of mappings) {
      await writer.delete(IDP_GROUP_MAPPING_OBJECT, { where: { id: text(mapping.id) } });
      removedGroupMappings++;
    }
  }
  return { removedGroupMappings, removedGrants };
}

/** The answer a successful delete carries under `data`. */
export interface SsoProviderDeleteAnswer {
  providerId: string;
  unlinkedUsers: number;
  usersWithoutOtherSignIn: number;
  removedGroupMappings: number;
  removedGrants: number;
  /** False when removing the mappings and grants failed: they are still there. */
  dependentsRemoved: boolean;
  message: string;
}

function isVendorError(returned: unknown): boolean {
  return returned instanceof Error || (Boolean(returned) && typeof returned === 'object' && 'statusCode' in (returned as object));
}

/**
 * The after-hook half, on `/sso/delete-provider` only: when the before-hook
 * staged a count and the vendor answered `{ success: true }`, remove the
 * provider's dependents and add `data` (the counts and one sentence) to that
 * answer, in place. A refused delete, or one nothing was staged for, is left
 * as the vendor answered it.
 *
 * A failed removal is delivered in the answer (`dependentsRemoved: false`,
 * the sentence says what is left) and said once at `error`: the provider is
 * gone, its grants are not, and nothing else would show it.
 */
export async function settleSsoProviderDelete(
  ctx: any,
  engine: IDataEngine | undefined,
  logError: (message: string) => void,
): Promise<void> {
  const impact = ctx?.context?.[SSO_PROVIDER_DELETE_IMPACT_STASH] as SsoProviderDeleteImpact | undefined;
  if (ctx?.context) delete ctx.context[SSO_PROVIDER_DELETE_IMPACT_STASH];
  if (!impact || !engine) return;
  const returned = ctx?.context?.returned;
  if (!returned || typeof returned !== 'object' || Array.isArray(returned) || isVendorError(returned)) return;
  if ((returned as { success?: unknown }).success !== true) return;

  let removed: SsoProviderDependentsRemoved = { removedGroupMappings: 0, removedGrants: 0 };
  let dependentsRemoved = true;
  let failure = '';
  try {
    removed = await removeSsoProviderDependents(engine, impact.providerId);
  } catch (error) {
    dependentsRemoved = false;
    failure = (error as Error)?.message ?? String(error);
    logError(
      `[auth] SSO provider '${impact.providerId}' was DELETED, but removing its IdP group mappings and the permission-set `
        + 'grants they projected FAILED; they are still in place. '
        + `Remedy: delete the sys_user_permission_set rows whose reason is "${ssoGroupProjectionReason(impact.providerId)}" `
        + `and the sys_idp_group_mapping rows of source_id '${impact.providerId}' (POST /admin/scim/delete-group-mapping). Cause: ${failure}`,
    );
  }
  const done: SsoProviderDeleteImpact = {
    ...impact,
    groupMappings: removed.removedGroupMappings,
    projectedGrants: removed.removedGrants,
  };
  const message = dependentsRemoved
    ? ssoProviderDeleteSummary(done, true)
    : `${unlinkSentence(impact, true)} Its ${plural(impact.groupMappings, 'IdP group mapping')} and `
      + `${plural(impact.projectedGrants, 'projected grant')} could NOT be removed and are still in place: ${failure}`;
  const data: SsoProviderDeleteAnswer = {
    providerId: impact.providerId,
    unlinkedUsers: impact.linkedUsers,
    usersWithoutOtherSignIn: impact.usersWithoutOtherSignIn,
    removedGroupMappings: removed.removedGroupMappings,
    removedGrants: removed.removedGrants,
    dependentsRemoved,
    message,
  };
  (returned as Record<string, unknown>).data = data;
}
