// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createLocalAccountIssuer, createOAuthAccountIssuer } from '@better-auth/core/db';

/**
 * backfillAccountIssuer — stamp `sys_account.issuer` on rows written before
 * better-auth 1.7.
 *
 * 1.7 restructured account identity: every account carries a REQUIRED `issuer`
 * naming the authority that vouched for that id. Sign-in resolves accounts with
 * `findAccountByKey({ issuer, accountId })`, so a row whose `issuer` is
 * NULL is invisible to better-auth — the user's password or social link simply
 * stops resolving. This helper closes that gap at boot, once, in place.
 *
 * What an issuer looks like is not ours to invent — better-auth mints it:
 *   - password accounts       → `local:credential`
 *   - social providers        → whatever the PROVIDER declares. A provider that
 *     names its own authority carries it (`google` →
 *     `https://accounts.google.com`, `apple` → `https://appleid.apple.com`);
 *     only a provider that declares none falls back to better-auth's synthetic
 *     `local:oauth:<providerId>`. This is the same either/or better-auth itself
 *     applies in `resolveOAuthAccountKey`, which is why the resolved providers
 *     are READ (`socialProviders`) rather than derived from their ids.
 *   - federated OIDC / SAML   → the IdP's real `iss`, which for registered SSO
 *     providers this environment already stores on `sys_sso_provider.issuer`
 *
 * Rows whose issuer cannot be DERIVED are deliberately left alone rather than
 * stamped with a guess: a wrong issuer is indistinguishable from a missing one
 * at sign-in, and it also occupies the (provider_id, account_id) unique slot
 * that the correct row needs. They are reported instead, with the provider ids
 * an operator needs to resolve them.
 *
 * That hazard is not hypothetical — it shipped. An earlier revision synthesized
 * `local:oauth:<id>` for EVERY social provider, so a Google link written before
 * the 1.7 upgrade was stamped `local:oauth:google` while sign-in looked it up
 * under `https://accounts.google.com`. The row was invisible, the callback fell
 * through to "link this provider", and the insert collided with that very row on
 * the `(provider_id, account_id)` unique index — surfacing to the user as
 * `?error=unable_to_link_account`. Correcting the derivation alone does not
 * repair a database already stamped that way, so the pass also RE-STAMPS rows
 * carrying the synthetic issuer for a provider that declares a real one.
 *
 * Idempotent: it only ever touches rows whose issuer is missing or provably
 * wrong, so re-running it after a partial pass (or on every boot) converges and
 * then does nothing.
 */

interface BackfillLogger {
  info: (message: string, meta?: Record<string, any>) => void;
  warn: (message: string, meta?: Record<string, any>) => void;
}

/**
 * The shape of a social provider better-auth has already INSTANTIATED
 * (`authContext.socialProviders`). `accountIssuer` is the authority the
 * provider names for itself: a string for the providers that have one, a
 * function of the OAuth response for the ones that read it per login
 * (Microsoft Entra takes the tenant's `iss` from the profile), and absent for
 * the providers that have none.
 */
export interface ResolvedSocialProvider {
  id: string;
  accountIssuer?: unknown;
}

export interface BackfillAccountIssuerOptions {
  logger?: BackfillLogger;
  /**
   * The social providers better-auth instantiated. PREFER this over
   * `socialProviderIds`: the issuer is read from the provider, so a provider
   * that names its own authority is stamped with it instead of the synthetic
   * fallback.
   */
  socialProviders?: readonly ResolvedSocialProvider[];
  /**
   * Provider ids wired as better-auth `socialProviders` (google, github, …),
   * for callers that cannot reach the resolved providers.
   *
   * Ids alone cannot say whether a provider declares an issuer, so this path
   * can only synthesize `local:oauth:<id>` — correct for the providers that
   * declare none, WRONG for the ones that do. Ids covered by `socialProviders`
   * are resolved from there; the rest are synthesized, as before.
   */
  socialProviderIds?: readonly string[];
  /**
   * providerId → issuer for `genericOAuth` providers that declare one in
   * config. Providers that only carry a `discoveryUrl` resolve their issuer at
   * runtime, so they are not derivable here and are reported instead.
   */
  oidcProviderIssuers?: Readonly<Record<string, string>>;
  /** Safety valve for very large tables; rows beyond it are left for the next boot. */
  limit?: number;
}

export interface BackfillAccountIssuerResult {
  /** Rows found whose issuer is missing or provably wrong. */
  scanned: number;
  /** Rows stamped with a derived issuer. */
  stamped: number;
  /**
   * Rows whose synthetic `local:oauth:<id>` issuer was corrected to the real
   * one their provider declares (counted in `scanned`, not in `stamped`).
   */
  repaired: number;
  /** Provider ids whose issuer could not be derived, with their row counts. */
  unresolved: Array<{ providerId: string; count: number }>;
}

const SYSTEM_CTX = { isSystem: true };

/** The issuer better-auth stamps on local email+password accounts. */
export const CREDENTIAL_ISSUER = createLocalAccountIssuer('credential');

/** The issuer better-auth synthesizes for an OAuth provider that declares none. */
export function oauthIssuerFor(providerId: string): string {
  return createOAuthAccountIssuer(providerId);
}

async function tryFind(ql: any, object: string, where: any, limit: number): Promise<any[]> {
  try {
    const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
    return Array.isArray(rows) ? rows : Array.isArray(rows?.records) ? rows.records : [];
  } catch {
    return [];
  }
}

export async function backfillAccountIssuer(
  ql: any,
  options: BackfillAccountIssuerOptions = {},
): Promise<BackfillAccountIssuerResult> {
  const limit = options.limit ?? 5000;
  const logger = options.logger;
  const result: BackfillAccountIssuerResult = { scanned: 0, stamped: 0, repaired: 0, unresolved: [] };
  if (!ql || typeof ql.find !== 'function' || typeof ql.update !== 'function') return result;

  // ── Which issuer each provider actually mints ────────────────────────────
  //
  // Read from the instantiated providers where they are available; a provider
  // whose `accountIssuer` is a FUNCTION reads the authority off each login's
  // OAuth response (Entra takes the tenant `iss` from the profile), so it is
  // not derivable at boot and is deliberately left to the unresolved report
  // rather than guessed.
  const socialIssuers = new Map<string, string>();
  const perLoginIssuers = new Set<string>();
  for (const provider of options.socialProviders ?? []) {
    const id = provider?.id;
    if (typeof id !== 'string' || !id) continue;
    const declared = provider.accountIssuer;
    if (typeof declared === 'function') perLoginIssuers.add(id);
    else if (typeof declared === 'string' && declared.trim()) socialIssuers.set(id, declared);
    else socialIssuers.set(id, oauthIssuerFor(id));
  }
  // Ids named without a resolved provider behind them keep the historical
  // synthetic fallback — see the `socialProviderIds` doc comment for why that
  // is a second best.
  for (const id of options.socialProviderIds ?? []) {
    if (!socialIssuers.has(id) && !perLoginIssuers.has(id)) socialIssuers.set(id, oauthIssuerFor(id));
  }

  const configuredIssuers = options.oidcProviderIssuers ?? {};

  // Registered SSO providers carry the IdP's real `iss` — the one issuer that
  // cannot be synthesized. Fetched once and indexed by provider id.
  const ssoIssuers = new Map<string, string>();
  for (const provider of await tryFind(ql, 'sys_sso_provider', {}, limit)) {
    const providerId = provider?.provider_id;
    const issuer = provider?.issuer;
    if (typeof providerId === 'string' && typeof issuer === 'string' && issuer) {
      ssoIssuers.set(providerId, issuer);
    }
  }

  const resolve = (providerId: string): string | undefined => {
    if (providerId === 'credential') return CREDENTIAL_ISSUER;
    if (ssoIssuers.has(providerId)) return ssoIssuers.get(providerId);
    if (configuredIssuers[providerId]) return configuredIssuers[providerId];
    if (socialIssuers.has(providerId)) return socialIssuers.get(providerId);
    return undefined;
  };

  // A driver that stores "no value" as '' rather than NULL is just as invisible
  // to better-auth, so both shapes are collected.
  const unstamped = [
    ...(await tryFind(ql, 'sys_account', { issuer: null }, limit)),
    ...(await tryFind(ql, 'sys_account', { issuer: '' }, limit)),
  ].filter((r) => r?.id && !r.issuer);

  // Rows an earlier pass stamped `local:oauth:<id>` for a provider that turns
  // out to name a real authority are exactly as unresolvable at sign-in as
  // unstamped ones, and they hold the unique slot the correct row needs. Only
  // this one wrong-by-construction value is rewritten: a row already carrying
  // the real issuer, or any other value, is left alone.
  const misstamped: any[] = [];
  for (const [providerId, realIssuer] of socialIssuers) {
    const synthetic = oauthIssuerFor(providerId);
    if (realIssuer === synthetic) continue;
    for (const row of await tryFind(
      ql,
      'sys_account',
      { provider_id: providerId, issuer: synthetic },
      limit,
    )) {
      if (row?.id && row.issuer === synthetic) misstamped.push(row);
    }
  }

  const pending = [...unstamped, ...misstamped];
  result.scanned = pending.length;
  if (pending.length === 0) return result;

  const unresolved = new Map<string, number>();
  for (const row of pending) {
    const providerId = typeof row.provider_id === 'string' ? row.provider_id : '';
    const issuer = providerId ? resolve(providerId) : undefined;
    if (!issuer) {
      unresolved.set(providerId || '(none)', (unresolved.get(providerId || '(none)') ?? 0) + 1);
      continue;
    }
    if (issuer === row.issuer) continue;
    // Read before the write: an engine is free to hand back (or patch in
    // place) the row it just updated, and this must classify the row as it
    // was, not as it became.
    const wasMisstamped = Boolean(row.issuer);
    try {
      await ql.update('sys_account', { id: row.id, issuer }, { context: SYSTEM_CTX });
      if (wasMisstamped) result.repaired++;
      else result.stamped++;
    } catch (e: any) {
      unresolved.set(providerId, (unresolved.get(providerId) ?? 0) + 1);
      logger?.warn('[auth] could not stamp sys_account.issuer', {
        accountId: row.id,
        providerId,
        error: e?.message ?? String(e),
      });
    }
  }

  result.unresolved = Array.from(unresolved, ([providerId, count]) => ({ providerId, count }));

  if (result.stamped > 0) {
    logger?.info(
      `[auth] stamped issuer on ${result.stamped} pre-1.7 sys_account row(s) — better-auth 1.7 resolves accounts by (issuer, account_id)`,
    );
  }
  if (result.repaired > 0) {
    logger?.info(
      `[auth] corrected the issuer on ${result.repaired} sys_account row(s) stamped with the synthetic local:oauth:<provider> value for a provider that declares its own — those links resolve at sign-in again`,
    );
  }
  if (result.unresolved.length > 0) {
    logger?.warn(
      '[auth] some sys_account rows have no issuer and none could be derived — better-auth 1.7 cannot resolve them, so those users cannot sign in through that provider until the row is stamped with the IdP\'s issuer (its OIDC `iss`) or removed so a fresh login can re-link',
      { providers: result.unresolved },
    );
  }

  return result;
}
