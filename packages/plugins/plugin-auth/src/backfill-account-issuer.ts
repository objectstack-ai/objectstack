// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createLocalAccountIssuer, createOAuthAccountIssuer } from '@better-auth/core/db';

/**
 * backfillAccountIssuer — stamp `sys_account.issuer` on rows written before
 * better-auth 1.7.
 *
 * 1.7 restructured account identity: what used to be `account.accountId` is now
 * `account.providerAccountId`, and every account carries a REQUIRED `issuer`
 * naming the authority that vouched for that id. Sign-in resolves accounts with
 * `findAccountByKey({ issuer, providerAccountId })`, so a row whose `issuer` is
 * NULL is invisible to better-auth — the user's password or social link simply
 * stops resolving. This helper closes that gap at boot, once, in place.
 *
 * What an issuer looks like is not ours to invent — better-auth mints it:
 *   - password accounts       → `local:credential`
 *   - social providers        → `local:oauth:<providerId>` (the built-in
 *     providers declare no issuer of their own, so better-auth synthesizes
 *     exactly this)
 *   - federated OIDC / SAML   → the IdP's real `iss`, which for registered SSO
 *     providers this environment already stores on `sys_sso_provider.issuer`
 *
 * Rows whose issuer cannot be DERIVED are deliberately left alone rather than
 * stamped with a guess: a wrong issuer is indistinguishable from a missing one
 * at sign-in, and it also occupies the (provider_id, account_id) unique slot
 * that the correct row needs. They are reported instead, with the provider ids
 * an operator needs to resolve them.
 *
 * Idempotent: it only ever touches rows with no issuer, so re-running it after
 * a partial pass (or on every boot) converges and then does nothing.
 */

interface BackfillLogger {
  info: (message: string, meta?: Record<string, any>) => void;
  warn: (message: string, meta?: Record<string, any>) => void;
}

export interface BackfillAccountIssuerOptions {
  logger?: BackfillLogger;
  /**
   * Provider ids wired as better-auth `socialProviders` (google, github, …).
   * Their accounts carry the synthetic `local:oauth:<id>` issuer.
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
  /** Rows found with no issuer. */
  scanned: number;
  /** Rows stamped with a derived issuer. */
  stamped: number;
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
  const result: BackfillAccountIssuerResult = { scanned: 0, stamped: 0, unresolved: [] };
  if (!ql || typeof ql.find !== 'function' || typeof ql.update !== 'function') return result;

  // A driver that stores "no value" as '' rather than NULL is just as invisible
  // to better-auth, so both shapes are collected.
  const rows = [
    ...(await tryFind(ql, 'sys_account', { issuer: null }, limit)),
    ...(await tryFind(ql, 'sys_account', { issuer: '' }, limit)),
  ];
  const pending = rows.filter((r) => r?.id && !r.issuer);
  result.scanned = pending.length;
  if (pending.length === 0) return result;

  const social = new Set(options.socialProviderIds ?? []);
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
    if (social.has(providerId)) return oauthIssuerFor(providerId);
    return undefined;
  };

  const unresolved = new Map<string, number>();
  for (const row of pending) {
    const providerId = typeof row.provider_id === 'string' ? row.provider_id : '';
    const issuer = providerId ? resolve(providerId) : undefined;
    if (!issuer) {
      unresolved.set(providerId || '(none)', (unresolved.get(providerId || '(none)') ?? 0) + 1);
      continue;
    }
    try {
      await ql.update('sys_account', { id: row.id, issuer }, { context: SYSTEM_CTX });
      result.stamped++;
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
  if (result.unresolved.length > 0) {
    logger?.warn(
      '[auth] some sys_account rows have no issuer and none could be derived — better-auth 1.7 cannot resolve them, so those users cannot sign in through that provider until the row is stamped with the IdP\'s issuer (its OIDC `iss`) or removed so a fresh login can re-link',
      { providers: result.unresolved },
    );
  }

  return result;
}
