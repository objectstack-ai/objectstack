// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Per-provider Enterprise SSO sign-in options: IdP-initiated sign-in (SAML and
 * OIDC) and just-in-time provisioning under `invite_only`.
 *
 * Maintainer ruling A on the Enterprise SSO operator knobs (record 6718355623):
 * each option is a toggle on the SSO provider, OFF by default, and every change
 * is audited. IdP-initiated sign-in exposes what `@better-auth/sso` already
 * implements; ⛔ no sign-in mechanism of our own.
 *
 * ## Where the toggles live
 *
 * Two `ssoProvider` additional fields, declared to the vendor through
 * `sso({ schema: { ssoProvider: { additionalFields } } })`
 * ({@link SSO_PROVIDER_SIGN_IN_FIELDS}): `allowIdpInitiated` and `allowJit`.
 * The vendor's own `/sso/register` and `/sso/update-provider` accept them
 * (typed: a non-boolean answers 400), so the writers are exactly the ones that
 * write a provider today — the platform-admin registration gate and the
 * provider-access check of update-provider, held callers refused. The adapter's
 * camelCase → snake_case rule lands them on `sys_sso_provider.allow_idp_initiated`
 * and `sys_sso_provider.allow_jit`; each field is `trackHistory`, so a change
 * writes the compliance ledger row and a field-level activity line like any
 * other tracked write.
 *
 * ## How each option reaches the vendor (measured on `@better-auth/sso` 1.7.12)
 *
 * - **OIDC.** The vendor reads `provider.oidcConfig.allowIdpInitiated` off the
 *   provider row (`bounceIfIdpInitiated`): a callback with a `code` and no
 *   `state` restarts the flow with a fresh state instead of answering
 *   `state_not_found`. The register and update schemas strip that member from
 *   a request body, so the column is the only place it can be authored:
 *   {@link applyIdpInitiatedToOidcConfigOnRead} writes the column's value into
 *   the blob every read hands the vendor, and
 *   {@link stripIdpInitiatedFromOidcConfigOnWrite} keeps it out of the stored
 *   blob (the update-provider merge would otherwise write the injected value
 *   back, a second copy nothing reads).
 * - **SAML.** The vendor reads ONE plugin-wide `saml.allowIdpInitiated`
 *   (`validateInResponseTo`): a Response with no `InResponseTo` is refused
 *   `unsolicited_response` unless it is true. It reads the option at request
 *   time off the options object it was constructed with, so plugin-auth hands
 *   it {@link ssoSamlOptions}, whose `allowIdpInitiated` answers the value
 *   {@link runWithSamlIdpInitiated} put in scope for this ACS request — the
 *   provider row's column, read before the vendor runs. No scope (a server-side
 *   call, any other path) answers false.
 * - **JIT under `invite_only`.** Not a vendor option: the audience gate
 *   (`audience-posture.ts`) reads `allowJit` for a creation whose source is an
 *   SSO provider ({@link isSsoProviderSource}).
 *
 * Unreadable provider row ⇒ every option reads OFF (fail closed): a sign-in
 * the store cannot vouch for is refused, never widened.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { SSO_OIDC_CONFIG_FIELD, SSO_PROVIDER_OBJECT } from './sso-client-secret.js';

/** `sys_sso_provider` column for the IdP-initiated sign-in toggle. */
export const SSO_ALLOW_IDP_INITIATED_FIELD = 'allow_idp_initiated';
/** `sys_sso_provider` column for the JIT-provisioning toggle. */
export const SSO_ALLOW_JIT_FIELD = 'allow_jit';

/** `sys_sso_provider` column for the OIDC userinfo opt-out (claims from the ID token only). */
export const SSO_SKIP_USER_INFO_FIELD = 'skip_user_info';

/** The member `@better-auth/sso` reads off a parsed OIDC config. */
const OIDC_IDP_INITIATED_KEY = 'allowIdpInitiated';

/** The OIDC config member whose presence makes the vendor read claims from userinfo instead of the ID token. */
const OIDC_USER_INFO_ENDPOINT_KEY = 'userInfoEndpoint';

/**
 * Where a userinfo-opted-out provider's stored `userInfoEndpoint` rides while
 * the vendor holds the config: out of the vendor's sight, and back in the
 * stored blob on the next write (see {@link applyUserInfoOptOutOnRead}).
 */
const OIDC_PARKED_USER_INFO_ENDPOINT_KEY = 'osParkedUserInfoEndpoint';

/**
 * The vendor `additionalFields` declaration. Every one defaults OFF; every one
 * is accepted from the register and update-provider bodies (`input: true`) and
 * returned by the vendor's provider reads.
 *
 * `skipUserInfo` is the OIDC userinfo opt-out: the provider's claims come from
 * the verified ID token only. `@better-auth/sso` reads every claim (the email,
 * the name, `mapping.extraFields`) from the userinfo response ALONE whenever
 * the provider has a `userInfoEndpoint`, and offers no seam before it refuses
 * a sign-in for a missing email (`missing_user_info`). Microsoft Entra ID's
 * userinfo (on Microsoft Graph) carries neither `preferred_username` nor
 * `upn`, so a user without a mailbox could not sign in whatever the email
 * mapping named; with `skipUserInfo` the mapping reads the ID token, which
 * carries both.
 */
export const SSO_PROVIDER_SIGN_IN_FIELDS = {
  allowIdpInitiated: { type: 'boolean', required: false, defaultValue: false, input: true },
  allowJit: { type: 'boolean', required: false, defaultValue: false, input: true },
  skipUserInfo: { type: 'boolean', required: false, defaultValue: false, input: true },
} as const;

/** One provider's sign-in options, as the store answers them. */
export interface SsoProviderSignInOptions {
  allowIdpInitiated: boolean;
  allowJit: boolean;
}

const ALL_OFF: SsoProviderSignInOptions = { allowIdpInitiated: false, allowJit: false };

/**
 * A toggle column read below better-auth: the adapter runs with
 * `supportsBooleans: false`, so better-auth stores a boolean as `1` / `0` and
 * converts it back only on its own reads (the same carrier
 * `auth-manager-password-session-policy.ts` reads `two_factor_enabled` in).
 * Anything else, missing included, is OFF.
 */
function storedOn(value: unknown): boolean {
  return value === true || value === 1;
}

/** The engine surface {@link readSsoProviderSignInOptions} needs. */
export interface SsoProviderReader {
  find(object: string, query: Record<string, unknown>): Promise<unknown[]>;
}

/**
 * Read one provider's options by its `provider_id`, through `reader` (the
 * caller hands a system-context reader). No row, a failed read, or a column
 * that does not read ON ⇒ OFF.
 */
export async function readSsoProviderSignInOptions(
  reader: SsoProviderReader | undefined,
  providerId: string,
): Promise<SsoProviderSignInOptions> {
  if (!reader || typeof reader.find !== 'function' || !providerId) return ALL_OFF;
  try {
    const rows = await reader.find(SSO_PROVIDER_OBJECT, { where: { provider_id: providerId }, limit: 1 });
    const row = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
    if (!row || row.provider_id !== providerId) return ALL_OFF;
    return {
      allowIdpInitiated: storedOn(row[SSO_ALLOW_IDP_INITIATED_FIELD]),
      allowJit: storedOn(row[SSO_ALLOW_JIT_FIELD]),
    };
  } catch {
    return ALL_OFF;
  }
}

/**
 * Whether a user creation came through an `@better-auth/sso` provider, from
 * the vendor's `validateUserInfo` source (`{ method: 'sso-oidc' | 'sso-saml',
 * sso: { providerId } }`).
 */
export function isSsoProviderSource(source: unknown): boolean {
  const method = (source as { method?: unknown } | undefined)?.method;
  return method === 'sso-oidc' || method === 'sso-saml';
}

/**
 * The provider id an SSO-provider source names, or `''` when it names none
 * (the vendor always sends one; a source without it reads no provider row, so
 * every option reads OFF).
 */
export function ssoProviderIdOfSource(source: unknown): string {
  if (!isSsoProviderSource(source)) return '';
  const providerId = (source as { sso?: { providerId?: unknown } }).sso?.providerId;
  return typeof providerId === 'string' ? providerId : '';
}

// ── OIDC: the column, carried in the blob the vendor reads ──────────────────

/** Parse the `oidc_config` carrier (JSON string or object); `null` if unusable. */
function parseBlob(value: unknown): { config: Record<string, unknown>; wasString: boolean } | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { config: value as Record<string, unknown>, wasString: false };
  }
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return { config: parsed as Record<string, unknown>, wasString: true };
  } catch {
    return null;
  }
}

const serialize = (parsed: { config: Record<string, unknown>; wasString: boolean }): unknown =>
  parsed.wasString ? JSON.stringify(parsed.config) : parsed.config;

/**
 * READ half: set the OIDC blob's `allowIdpInitiated` to the provider row's
 * `allow_idp_initiated` column, in place. Any value already in the blob is
 * overwritten, so the column is the one source. A row of another object, or
 * with no usable OIDC blob (a SAML provider), is left alone.
 */
export function applyIdpInitiatedToOidcConfigOnRead(objectName: string, row: unknown): void {
  if (objectName !== SSO_PROVIDER_OBJECT || !row || typeof row !== 'object') return;
  const record = row as Record<string, unknown>;
  const parsed = parseBlob(record[SSO_OIDC_CONFIG_FIELD]);
  if (!parsed) return;
  parsed.config[OIDC_IDP_INITIATED_KEY] = storedOn(record[SSO_ALLOW_IDP_INITIATED_FIELD]);
  record[SSO_OIDC_CONFIG_FIELD] = serialize(parsed);
}

/**
 * WRITE half: drop `allowIdpInitiated` from an OIDC blob being written, in
 * place. The column decides; a copy in the blob is never stored.
 */
export function stripIdpInitiatedFromOidcConfigOnWrite(objectName: string, row: unknown): void {
  if (objectName !== SSO_PROVIDER_OBJECT || !row || typeof row !== 'object') return;
  const record = row as Record<string, unknown>;
  if (!(SSO_OIDC_CONFIG_FIELD in record)) return;
  const parsed = parseBlob(record[SSO_OIDC_CONFIG_FIELD]);
  if (!parsed || !(OIDC_IDP_INITIATED_KEY in parsed.config)) return;
  delete parsed.config[OIDC_IDP_INITIATED_KEY];
  record[SSO_OIDC_CONFIG_FIELD] = serialize(parsed);
}

// ── OIDC: the userinfo opt-out, carried in the blob the vendor reads ────────

/**
 * READ half of the userinfo opt-out: for a provider row whose
 * `skip_user_info` column reads ON, the blob handed to the vendor carries no
 * `userInfoEndpoint`, so its callback reads every claim from the verified ID
 * token (its own `else if (verifiedIdToken)` arm). The stored endpoint is not
 * dropped: it rides in the blob under a parked member the vendor does not
 * read, so a vendor write of this config (update-provider merges the config it
 * read) hands it back, and {@link restoreUserInfoEndpointOnWrite} puts it
 * back in place before the row is stored. Column OFF (the default), or a row
 * with no usable OIDC blob: left alone.
 */
export function applyUserInfoOptOutOnRead(objectName: string, row: unknown): void {
  if (objectName !== SSO_PROVIDER_OBJECT || !row || typeof row !== 'object') return;
  const record = row as Record<string, unknown>;
  if (!storedOn(record[SSO_SKIP_USER_INFO_FIELD])) return;
  const parsed = parseBlob(record[SSO_OIDC_CONFIG_FIELD]);
  if (!parsed) return;
  const endpoint = parsed.config[OIDC_USER_INFO_ENDPOINT_KEY];
  if (endpoint === undefined) return;
  delete parsed.config[OIDC_USER_INFO_ENDPOINT_KEY];
  parsed.config[OIDC_PARKED_USER_INFO_ENDPOINT_KEY] = endpoint;
  record[SSO_OIDC_CONFIG_FIELD] = serialize(parsed);
}

/**
 * WRITE half: a parked `userInfoEndpoint` goes back in place in an OIDC blob
 * being written, unless the write names a `userInfoEndpoint` of its own (an
 * update that sets one explicitly wins). The parked member is never stored.
 */
export function restoreUserInfoEndpointOnWrite(objectName: string, row: unknown): void {
  if (objectName !== SSO_PROVIDER_OBJECT || !row || typeof row !== 'object') return;
  const record = row as Record<string, unknown>;
  if (!(SSO_OIDC_CONFIG_FIELD in record)) return;
  const parsed = parseBlob(record[SSO_OIDC_CONFIG_FIELD]);
  if (!parsed || !(OIDC_PARKED_USER_INFO_ENDPOINT_KEY in parsed.config)) return;
  const parked = parsed.config[OIDC_PARKED_USER_INFO_ENDPOINT_KEY];
  delete parsed.config[OIDC_PARKED_USER_INFO_ENDPOINT_KEY];
  if (parsed.config[OIDC_USER_INFO_ENDPOINT_KEY] === undefined && parked !== undefined) {
    parsed.config[OIDC_USER_INFO_ENDPOINT_KEY] = parked;
  }
  record[SSO_OIDC_CONFIG_FIELD] = serialize(parsed);
}

// ── SAML: the vendor's one option, answered per ACS request ─────────────────

const samlIdpInitiatedScope = new AsyncLocalStorage<{ allow: boolean }>();

/**
 * The `saml` options handed to `sso()`. `allowIdpInitiated` is a getter: the
 * vendor reads it while it validates a Response, inside the request's scope.
 */
export function ssoSamlOptions(): { readonly allowIdpInitiated: boolean } {
  return Object.defineProperty({} as { readonly allowIdpInitiated: boolean }, 'allowIdpInitiated', {
    enumerable: true,
    get: () => samlIdpInitiatedScope.getStore()?.allow === true,
  });
}

/** Run one SAML ACS request with its provider's IdP-initiated toggle in scope. */
export function runWithSamlIdpInitiated<T>(allow: boolean, run: () => Promise<T>): Promise<T> {
  return samlIdpInitiatedScope.run({ allow: allow === true }, run);
}
