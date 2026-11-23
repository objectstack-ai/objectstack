// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Leaving development mode retires what the development seed issued.
 *
 * ## The rule
 *
 * When a deployment leaves development mode, nothing the development seed
 * issued keeps acting for an account that carries the development seed stamp.
 * At every boot outside development mode, before the server serves a request,
 * the platform retires those accounts' sessions, API keys and tokens. A
 * retired credential answers exactly as a revoked one does, and an
 * operator-set credential is untouched. There is no switch: development mode
 * is `NODE_ENV=development` ({@link isDevelopmentMode}), the clause the seed
 * and the refusals in `dev-seed-credential.ts` are gated on.
 *
 * The refusals there stop the seed's accounts from opening anything new
 * outside development mode. This is the other half: what such an account was
 * issued while the server was in development mode (a session, an API key it
 * minted, an app it authorized) would otherwise keep working.
 *
 * ## Which accounts
 *
 * A stamped account whose seed credential is still in force: its stored
 * password hash is still the one the seed stored ({@link
 * isDevSeedCredentialInForce}). An account whose password was set since then
 * holds a credential the seed did not issue and is not touched: the
 * operator's reset (`os user set-password`, which also clears the stamp), an
 * administrator's set-user-password and the account's own reset or change
 * each write a new salted hash, and the stamp stops matching. An account the
 * seed never stamped is never read.
 *
 * ## What is retired, per account
 *
 * The revocation the operator's reset performs, without setting a password
 * (`forced-reset-revocation.ts` {@link revokeSessionsAndApiKeys}):
 *
 * - every live session: tombstoned in place (`revoked_at`, `revoke_reason`, a
 *   past `expires_at`, ADR-0069 D4), so its next request is unauthenticated,
 *   as after any other revocation;
 * - every API key the key-admission seam would admit: `revoked: true`, so its
 *   next call is refused `API_KEY_REVOKED`. Both carry the reason the
 *   operator's reset records (`admin_password_reset`), so a retired key is
 *   restored only by a platform administrator;
 * - every app authorized to the account (consents, refresh and stored access
 *   tokens) and every device sign-in approved for it, where those plugins are
 *   mounted, read through better-auth's own adapter as the administrator's
 *   forced reset reads them;
 * - every sign-in account linked to it other than its password, every OAuth
 *   application it registered (disabled) and every SCIM credential it minted
 *   (revoked);
 * - every outstanding password-reset token of the account
 *   (`credential-change-ends-reset-tokens.ts` {@link
 *   endOutstandingResetTokens}), rows and cache entries;
 * - with a host `secondaryStorage` holding the sessions of record (no
 *   `sys_session` row is written then), the account's sessions there, through
 *   better-auth's own `deleteUserSessions`, and read back to prove it.
 *
 * ## What is left
 *
 * - The password credential and the stamp. The refusals keep answering for
 *   them, and the way out stays the operator's reset.
 * - A sign-in link or one-time code (`sys_verification`): it only opens a
 *   session, which `session.create.before` refuses for such an account.
 * - A one-time token: it hands over a session, which is retired above.
 * - The single sign-on providers it registered and its second factor, which
 *   every reset keeps.
 *
 * ## When, and how it fails
 *
 * On `kernel:ready`, which settles before `kernel:listening` opens the socket.
 * A database with no stamped account costs one indexed read. It is idempotent:
 * an account retired at one boot cannot open a new session or mint a key
 * before the next, so the next finds nothing to end.
 *
 * It fails closed, as the refusals do (a read that fails answers `503` there):
 * a read or a write that did not land throws, and the boot fails with a
 * sentence naming the accounts and the remedy, rather than serving while a
 * development seed credential may still act. Only an engine with no read
 * surface (mock mode) or a user table that was never created holds no stamped
 * account, and reads as none.
 */

import { SystemObjectName } from '@objectstack/spec/system';
import { isMissingTableError } from '@objectstack/types';
import {
  DEV_SEED_CREDENTIAL_FIELD,
  OPERATOR_PASSWORD_RESET_COMMAND,
  isDevSeedCredentialInForce,
  isDevelopmentMode,
} from './dev-seed-credential.js';
import { revokeSessionsAndApiKeys, type ForcedResetRevocationOutcome } from './forced-reset-revocation.js';
import { endOutstandingResetTokens } from './credential-change-ends-reset-tokens.js';
import type { MountedOAuthGrants } from './password-reset-ends-added-access.js';
import type { InternalFieldResolvingEngine } from './internal-field-readback.js';

/** The slice of the data engine the retirement reads and writes through. */
export interface DevSeedRetirementEngine {
  find(object: string, query?: unknown, opts?: unknown): Promise<unknown>;
  findOne?(object: string, query?: unknown, opts?: unknown): Promise<unknown>;
  update(object: string, doc: Record<string, unknown>, opts?: unknown): Promise<unknown>;
  delete?(object: string, options?: unknown): Promise<unknown>;
  insert?(object: string, data: Record<string, unknown>, opts?: unknown): Promise<unknown>;
  getSchema?(object: string): unknown;
}

/** The slice of better-auth's context the retirement uses. */
export interface DevSeedRetirementAuthContext {
  adapter?: unknown;
  getPlugin?(pluginId: string): unknown;
  secondaryStorage?: { delete(key: string): unknown } | null;
  options?: { session?: { storeSessionInDatabase?: boolean } };
  internalAdapter?: {
    listSessions(userId: string): Promise<unknown[]>;
    deleteUserSessions(userId: string): Promise<unknown>;
  };
}

/** What the retirement ended for one account. */
export interface RetiredDevSeedAccount {
  userId: string;
  sessions: number;
  /** Sessions ended in a host `secondaryStorage` that holds them. */
  cachedSessions: number;
  apiKeys: number;
  signInAccounts: number;
  authorizedApps: number;
  ownedApps: number;
  scimCredentials: number;
}

/** What one boot's retirement did. */
export type DevSeedRetirementOutcome =
  | { mode: 'development' }
  | { mode: 'production'; stampedAccounts: number; retired: RetiredDevSeedAccount[] };

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** How many stamped accounts one read considers. */
const STAMPED_PAGE = 200;

function rowsOf(result: unknown): Array<Record<string, any>> {
  if (Array.isArray(result)) return result as Array<Record<string, any>>;
  const value = (result as { value?: unknown } | null)?.value;
  return Array.isArray(value) ? (value as Array<Record<string, any>>) : [];
}

/** The ids of every stamped account: one indexed read per page. */
async function stampedAccountIds(engine: DevSeedRetirementEngine): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += STAMPED_PAGE) {
    let page: Array<Record<string, any>>;
    try {
      page = rowsOf(
        await engine.find(
          SystemObjectName.USER,
          {
            where: { [DEV_SEED_CREDENTIAL_FIELD]: { $null: false } },
            fields: ['id'],
            orderBy: [{ field: 'id', order: 'asc' }],
            limit: STAMPED_PAGE,
            offset,
          },
          { context: SYSTEM_CTX },
        ),
      );
    } catch (error) {
      if (isMissingTableError(error, SystemObjectName.USER)) return ids;
      throw error;
    }
    for (const row of page) {
      if (typeof row?.id === 'string' && row.id) ids.push(row.id);
    }
    if (page.length < STAMPED_PAGE) return ids;
  }
}

/**
 * Sessions of record a host `secondaryStorage` holds for `userId`, ended
 * through better-auth's own `deleteUserSessions` and read back. With no such
 * store, or with sessions kept in `sys_session` (retired there), none.
 */
async function retireCachedSessions(authContext: DevSeedRetirementAuthContext | undefined, userId: string): Promise<number> {
  if (!authContext?.secondaryStorage || authContext.options?.session?.storeSessionInDatabase) return 0;
  const internal = authContext.internalAdapter;
  if (!internal || typeof internal.listSessions !== 'function' || typeof internal.deleteUserSessions !== 'function') {
    throw new Error('the secondary storage holds the sessions, and better-auth offers no way to end them');
  }
  const live = (await internal.listSessions(userId)).length;
  if (live === 0) return 0;
  await internal.deleteUserSessions(userId);
  // The vendor logs, and does not throw, a cache delete that fails.
  const left = (await internal.listSessions(userId)).length;
  if (left > 0) throw new Error(`${left} session(s) in the secondary storage could not be ended`);
  return live;
}

function incompleteRevocation(outcome: ForcedResetRevocationOutcome): string {
  return `${outcome.failed} write(s) did not land, or a read did not finish `
    + `(${outcome.sessions} session(s), ${outcome.apiKeys} API key(s) ended so far)`;
}

/**
 * Retire what the development seed issued to every stamped account still on
 * its seed password, on a server that is not in development mode. Throws when
 * any of it could not be retired (the module header says why).
 */
export async function retireDevSeedCredentials(host: {
  engine: DevSeedRetirementEngine | undefined;
  /** better-auth's context; read only when a stamped account is found. */
  authContext: () => Promise<DevSeedRetirementAuthContext | undefined>;
  logger?: { warn(message: string): void };
}): Promise<DevSeedRetirementOutcome> {
  if (isDevelopmentMode()) return { mode: 'development' };
  const engine = host.engine;
  if (!engine || typeof engine.find !== 'function' || typeof engine.update !== 'function') {
    return { mode: 'production', stampedAccounts: 0, retired: [] };
  }

  const stamped = await stampedAccountIds(engine);
  if (stamped.length === 0) return { mode: 'production', stampedAccounts: 0, retired: [] };

  const authContext = await host.authContext();
  const oauth: MountedOAuthGrants = {
    store: authContext?.adapter as MountedOAuthGrants['store'],
    mounted: (pluginId) => typeof authContext?.getPlugin === 'function' && Boolean(authContext.getPlugin(pluginId)),
  };
  const resetTokenEngine = {
    find: async (object: string, query: Record<string, unknown>) =>
      rowsOf(await engine.find(object, { ...query, context: SYSTEM_CTX })),
    findOne: async (object: string, query: Record<string, unknown>) =>
      engine.findOne
        ? engine.findOne(object, { ...query, context: SYSTEM_CTX })
        : (rowsOf(await engine.find(object, { ...query, limit: 1, context: SYSTEM_CTX }))[0] ?? null),
    delete: async (object: string, query: Record<string, unknown>) => {
      if (typeof engine.delete !== 'function') throw new Error('the data engine cannot delete');
      return engine.delete(object, { ...query, context: SYSTEM_CTX });
    },
  };

  const retired: RetiredDevSeedAccount[] = [];
  const failures: string[] = [];
  for (const userId of stamped) {
    try {
      if (!(await isDevSeedCredentialInForce(engine, userId))) continue;
    } catch (error) {
      failures.push(`user ${userId}: the account could not be read (${(error as Error)?.message ?? error})`);
      continue;
    }
    const reasons: string[] = [];
    const revocation = await revokeSessionsAndApiKeys(engine, userId, { oauth });
    if (!revocation.complete) reasons.push(incompleteRevocation(revocation));
    try {
      await endOutstandingResetTokens(resetTokenEngine, userId, {
        ...(authContext?.secondaryStorage ? { cache: authContext.secondaryStorage } : {}),
        internalFieldEngine: engine as unknown as InternalFieldResolvingEngine,
      });
    } catch (error) {
      reasons.push(`its password-reset tokens could not be ended (${(error as Error)?.message ?? error})`);
    }
    let cachedSessions = 0;
    try {
      cachedSessions = await retireCachedSessions(authContext, userId);
    } catch (error) {
      reasons.push(`${(error as Error)?.message ?? error}`);
    }
    if (reasons.length > 0) {
      failures.push(`user ${userId}: ${reasons.join('; ')}`);
      continue;
    }
    const account: RetiredDevSeedAccount = {
      userId,
      sessions: revocation.sessions,
      cachedSessions,
      apiKeys: revocation.apiKeys,
      signInAccounts: revocation.signInAccounts,
      authorizedApps: revocation.authorizedApps,
      ownedApps: revocation.ownedApps,
      scimCredentials: revocation.scimCredentials,
    };
    retired.push(account);
    const ended =
      account.sessions + account.cachedSessions + account.apiKeys + account.signInAccounts
      + account.authorizedApps + account.ownedApps + account.scimCredentials;
    if (ended > 0) {
      host.logger?.warn(
        `[auth] user ${userId} was created by the development seed and still has its seed password, so this server, `
          + `which is not in development mode, retired what it was issued: ${account.sessions + account.cachedSessions} `
          + `session(s), ${account.apiKeys} API key(s), ${account.signInAccounts} linked sign-in account(s), `
          + `${account.authorizedApps} authorized app(s), ${account.ownedApps} registered OAuth application(s) and `
          + `${account.scimCredentials} SCIM credential(s), with its password-reset tokens. The account signs in again `
          + `once an operator sets a new password with \`${OPERATOR_PASSWORD_RESET_COMMAND} <email>\`.`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      '[auth] the server did not start: it is not in development mode, and what the development seed issued to '
        + `${failures.length} account(s) still on the seed password could not all be retired, so it could keep `
        + `acting. ${failures.join('. ')}. Remedy: fix the database access the error names and start the server `
        + `again, or set a new password for each account with \`${OPERATOR_PASSWORD_RESET_COMMAND} <email>\` first.`,
    );
  }
  return { mode: 'production', stampedAccounts: stamped.length, retired };
}
