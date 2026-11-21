// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23287 — ruling C′ item 2] The administrator's forced password reset
 * carries an explicit "revoke the user's sessions and API keys" switch.
 *
 * ## Why an explicit revocation, and why it is not the posture gate
 *
 * The forced reset raises `PASSWORD_RESET_REQUIRED`, a `credential`-scope
 * posture (`AUTH_GATE_SCOPES`): it holds the user's password sign-in until
 * they change the password, and it does NOT hold their API keys. That is right
 * for a routine reset and wrong for the reset an administrator issues because
 * they suspect the account is compromised — a key that outlives that reset is
 * the hole the reset was meant to close. So the act itself carries the
 * revocation, as an explicit switch, rather than the posture gate silently
 * widening to every credential.
 *
 * ## What this module does
 *
 * - Every live `sys_session` row of the user is revoked through the existing
 *   mechanism (ADR-0069 D4, the shape `enforceSessionControls` and
 *   `membership-ended-session.ts` write): `expires_at` a second in the past,
 *   plus `revoked_at` / `revoke_reason` for the audit trail. better-auth's
 *   session read then answers `null` and the next request is unauthenticated.
 * - Every unrevoked `sys_api_key` row the user owns is revoked: `revoked: true`,
 *   the flag the key-admission seam (`resolveApiKeyAdmission`) filters on, so
 *   the very next call with the key resolves no principal. The same write
 *   stamps `revoked_reason: admin_password_reset`, the one place that reason
 *   is ever set: it is what tells the restore door
 *   (`api-key-restore-guard.ts`) that only a platform administrator may reopen
 *   the key, because the reset may answer a compromise and the owner's account
 *   is the one in question. A key already revoked before the reset is not
 *   written, so its reason (none) stays truthful.
 *
 * - Every sign-in account linked to the user other than its password
 *   (`sys_account` rows of a provider other than `credential`: a social,
 *   generic OAuth or single-sign-on link) is deleted, as a completed
 *   self-service reset deletes them (`password-reset-ends-added-access.ts`):
 *   a reset ends what the account added before it, and a link someone else
 *   added is a way in that would outlive the reset. The password row the
 *   reset just wrote is never touched.
 * - Every app authorized to the user and every device sign-in approved for it
 *   and not yet collected is ended, as a completed self-service reset ends
 *   them, through the same arm (`password-reset-ends-added-access.ts`
 *   {@link endOAuthGrants}): the user's stored consents, refresh tokens and
 *   stored access tokens where the OAuth provider is mounted, and its device
 *   codes where device authorization is mounted. The caller says where the
 *   grants are kept and which plugins are mounted (`opts.oauth`): the
 *   administrator's route hands better-auth's own storage adapter and plugin
 *   registry; the operator's reset, which runs with no auth server, hands the
 *   project database's stores ({@link storedOAuthGrants}). No `opts.oauth`,
 *   no grant is read.
 *
 * Unlike the posture refusal (ruling item 4, "the refusal is not a
 * revocation"), this IS a revocation: a revoked key stays revoked after the
 * password change, and the owner mints a replacement; an unlinked provider is
 * linked again by its owner; an app is authorized again by its owner.
 *
 * ## The outcome is the CALLER's, and it is never silent
 *
 * The password is already set when this runs, so a refused write must not turn
 * the reset into a failure. But an administrator who switched revocation on
 * believes the credentials are dead, so every write that did not land is
 * counted in the returned outcome (`complete: false`, `failed`), which the
 * endpoint returns in its response body — the requester is told. The warn line
 * is the operator's copy of the same fact.
 */

import { SystemObjectName } from '@objectstack/spec/system';
import { endOAuthGrants, type EndedOAuthGrants, type MountedOAuthGrants } from './password-reset-ends-added-access.js';

/**
 * The reason an administrator's forced reset records: `sys_session.revoke_reason`
 * on each session it ends, and `sys_api_key.revoked_reason` on each key it
 * revokes. One value, both tables.
 */
export const FORCED_RESET_REVOKE_REASON = 'admin_password_reset';

/** How many rows of one kind this revocation will consider for one user. */
const DEFAULT_MAX_ROW_SCAN = 500;

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** The provider id of the account's local password row, which the revocation never touches. */
const CREDENTIAL_PROVIDER_ID = 'credential';

/** The slice of the data engine this module uses. */
export interface ForcedResetRevocationEngine {
  find?(object: string, query?: unknown, opts?: unknown): Promise<unknown>;
  update(object: string, doc: Record<string, unknown>, opts?: unknown): Promise<unknown>;
  delete?(object: string, options?: unknown): Promise<unknown>;
}

/** What the revocation did. Counts are rows really written. */
export interface ForcedResetRevocationOutcome {
  /** Sessions revoked. */
  sessions: number;
  /** API keys revoked. */
  apiKeys: number;
  /** Linked sign-in accounts (any provider but `credential`) deleted. */
  signInAccounts: number;
  /**
   * Apps the user had authorized whose consent was deleted. Their refresh
   * tokens, stored access tokens and the user's approved device sign-ins are
   * ended with them; a grant that could not be ended counts in `failed`.
   */
  authorizedApps: number;
  /** Rows the revocation meant to write and could not (read or write refused). */
  failed: number;
  /**
   * `true` only when every live session, every unrevoked key, every linked
   * sign-in account and every OAuth grant the user had was ended. `false`
   * whenever a read or a write did not land, or the
   * engine offers no read surface at all — a revocation that cannot be
   * measured is never reported as complete.
   */
  complete: boolean;
}

function rowsOf(result: unknown): Array<Record<string, any>> {
  if (Array.isArray(result)) return result as Array<Record<string, any>>;
  const value = (result as { value?: unknown } | null)?.value;
  if (Array.isArray(value)) return value as Array<Record<string, any>>;
  const records = (result as { records?: unknown } | null)?.records;
  return Array.isArray(records) ? (records as Array<Record<string, any>>) : [];
}

/**
 * The self-service reset's own arm for the OAuth grants and device sign-ins;
 * it throws on a read or a delete that does not land, which the outcome
 * counts in `failed` instead. The apps whose consent was deleted before the
 * failure are counted all the same: the arm counts each row as it deletes it.
 */
async function endAuthorizedApps(
  outcome: ForcedResetRevocationOutcome,
  oauth: MountedOAuthGrants | undefined,
  userId: string,
): Promise<void> {
  const ended: EndedOAuthGrants = { authorizedApps: 0, oauthTokens: 0, deviceCodes: 0 };
  try {
    await endOAuthGrants(oauth, userId, ended);
  } catch {
    outcome.failed += 1;
  }
  outcome.authorizedApps = ended.authorizedApps;
}

function isLiveSession(row: Record<string, any>, now: number): boolean {
  if (row.revoked_at) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) return false;
  return true;
}

/**
 * Revoke every live session and every unrevoked API key of `userId`, and
 * unlink every sign-in account linked to it other than its password. Never
 * throws; the outcome says what landed.
 */
export async function revokeSessionsAndApiKeys(
  engine: ForcedResetRevocationEngine | undefined,
  userId: string,
  opts: { logger?: { warn(msg: string): void }; maxRowScan?: number; oauth?: MountedOAuthGrants } = {},
): Promise<ForcedResetRevocationOutcome> {
  const outcome: ForcedResetRevocationOutcome = {
    sessions: 0,
    apiKeys: 0,
    signInAccounts: 0,
    authorizedApps: 0,
    failed: 0,
    complete: false,
  };
  if (!engine || typeof engine.find !== 'function' || !userId) {
    opts.logger?.warn(
      '[AuthPlugin] forced reset: the user\'s sessions, API keys and linked sign-in accounts were NOT '
        + 'revoked — the data '
        + 'engine offers no read surface, so they could not be found. The password reset itself landed. '
        + 'Remedy: wire the ObjectQL engine into the auth plugin.',
    );
    // The grants live in their own store, which the caller handed: they are
    // ended all the same, and the outcome stays incomplete.
    if (userId) await endAuthorizedApps(outcome, opts.oauth, userId);
    return outcome;
  }
  const maxScan = opts.maxRowScan ?? DEFAULT_MAX_ROW_SCAN;
  const now = Date.now();
  let incomplete = false;

  // ── Sessions ────────────────────────────────────────────────────────────
  try {
    const sessions = rowsOf(
      await engine.find(
        SystemObjectName.SESSION,
        { where: { user_id: userId }, fields: ['id', 'expires_at', 'revoked_at'], limit: maxScan + 1 },
        { context: SYSTEM_CTX },
      ),
    );
    if (sessions.length > maxScan) incomplete = true;
    for (const row of sessions.slice(0, maxScan)) {
      if (!isLiveSession(row, now) || !row.id) continue;
      try {
        await engine.update(
          SystemObjectName.SESSION,
          {
            id: String(row.id),
            expires_at: new Date(now - 1000),
            revoked_at: new Date(now),
            revoke_reason: FORCED_RESET_REVOKE_REASON,
          },
          { context: SYSTEM_CTX },
        );
        outcome.sessions += 1;
      } catch {
        outcome.failed += 1;
      }
    }
  } catch {
    incomplete = true;
  }

  // ── API keys ────────────────────────────────────────────────────────────
  try {
    const keys = rowsOf(
      await engine.find(
        SystemObjectName.API_KEY,
        // Every key the admission seam would admit: a `revoked` flag that is
        // false or null (it refuses only `true`/`1`, and a null reads as live).
        { where: { user_id: userId, $or: [{ revoked: false }, { revoked: null }] }, fields: ['id', 'revoked'], limit: maxScan + 1 },
        { context: SYSTEM_CTX },
      ),
    );
    if (keys.length > maxScan) incomplete = true;
    for (const row of keys.slice(0, maxScan)) {
      if (!row.id || row.revoked === true || row.revoked === 1) continue;
      try {
        await engine.update(
          SystemObjectName.API_KEY,
          { id: String(row.id), revoked: true, revoked_reason: FORCED_RESET_REVOKE_REASON },
          { context: SYSTEM_CTX },
        );
        outcome.apiKeys += 1;
      } catch {
        outcome.failed += 1;
      }
    }
  } catch {
    incomplete = true;
  }

  // ── Linked sign-in accounts ─────────────────────────────────────────────
  try {
    const accounts = rowsOf(
      await engine.find(
        SystemObjectName.ACCOUNT,
        { where: { user_id: userId, provider_id: { $ne: CREDENTIAL_PROVIDER_ID } }, fields: ['id', 'provider_id'], limit: maxScan + 1 },
        { context: SYSTEM_CTX },
      ),
    );
    if (accounts.length > maxScan) incomplete = true;
    for (const row of accounts.slice(0, maxScan)) {
      if (row.provider_id === CREDENTIAL_PROVIDER_ID) continue;
      if (!row.id || typeof engine.delete !== 'function') {
        outcome.failed += 1;
        continue;
      }
      try {
        await engine.delete(SystemObjectName.ACCOUNT, { where: { id: String(row.id) }, context: SYSTEM_CTX });
        outcome.signInAccounts += 1;
      } catch {
        outcome.failed += 1;
      }
    }
  } catch {
    incomplete = true;
  }

  // ── Authorized apps and device sign-ins ────────────────────────────────
  await endAuthorizedApps(outcome, opts.oauth, userId);

  outcome.complete = !incomplete && outcome.failed === 0;
  if (!outcome.complete) {
    opts.logger?.warn(
      `[AuthPlugin] forced reset for user ${userId}: revocation INCOMPLETE — ${outcome.sessions} session(s) `
        + `and ${outcome.apiKeys} API key(s) revoked, ${outcome.signInAccounts} linked sign-in account(s) `
        + `unlinked, ${outcome.authorizedApps} authorized app(s) ended, ${outcome.failed} write(s) refused`
        + (incomplete ? ', and a read did not finish or more rows exist than were scanned' : '')
        + '. The password reset itself landed; credentials that were not revoked still work. '
        + 'Remedy: revoke the remaining sessions and keys, unlink the remaining sign-in accounts and '
        + 'withdraw the remaining authorized apps by hand, and check write access on sys_session / '
        + 'sys_api_key / sys_account / the OAuth and device stores.',
    );
  }
  return outcome;
}
