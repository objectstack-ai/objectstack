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
 * Unlike the posture refusal (ruling item 4, "the refusal is not a
 * revocation"), this IS a revocation: a revoked key stays revoked after the
 * password change, and the owner mints a replacement.
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

/**
 * The reason an administrator's forced reset records: `sys_session.revoke_reason`
 * on each session it ends, and `sys_api_key.revoked_reason` on each key it
 * revokes. One value, both tables.
 */
export const FORCED_RESET_REVOKE_REASON = 'admin_password_reset';

/** How many rows of one kind this revocation will consider for one user. */
const DEFAULT_MAX_ROW_SCAN = 500;

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** The slice of the data engine this module uses. */
export interface ForcedResetRevocationEngine {
  find?(object: string, query?: unknown, opts?: unknown): Promise<unknown>;
  update(object: string, doc: Record<string, unknown>, opts?: unknown): Promise<unknown>;
}

/** What the revocation did. Counts are rows really written. */
export interface ForcedResetRevocationOutcome {
  /** Sessions revoked. */
  sessions: number;
  /** API keys revoked. */
  apiKeys: number;
  /** Rows the revocation meant to write and could not (read or write refused). */
  failed: number;
  /**
   * `true` only when every live session and every unrevoked key the user had
   * was revoked. `false` whenever a read or a write did not land, or the
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

function isLiveSession(row: Record<string, any>, now: number): boolean {
  if (row.revoked_at) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) return false;
  return true;
}

/**
 * Revoke every live session and every unrevoked API key of `userId`. Never
 * throws; the outcome says what landed.
 */
export async function revokeSessionsAndApiKeys(
  engine: ForcedResetRevocationEngine | undefined,
  userId: string,
  opts: { logger?: { warn(msg: string): void }; maxRowScan?: number } = {},
): Promise<ForcedResetRevocationOutcome> {
  const outcome: ForcedResetRevocationOutcome = { sessions: 0, apiKeys: 0, failed: 0, complete: false };
  if (!engine || typeof engine.find !== 'function' || !userId) {
    opts.logger?.warn(
      '[AuthPlugin] forced reset: the user\'s sessions and API keys were NOT revoked — the data '
        + 'engine offers no read surface, so they could not be found. The password reset itself landed. '
        + 'Remedy: wire the ObjectQL engine into the auth plugin.',
    );
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
        { where: { user_id: userId, revoked: false }, fields: ['id'], limit: maxScan + 1 },
        { context: SYSTEM_CTX },
      ),
    );
    if (keys.length > maxScan) incomplete = true;
    for (const row of keys.slice(0, maxScan)) {
      if (!row.id) continue;
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

  outcome.complete = !incomplete && outcome.failed === 0;
  if (!outcome.complete) {
    opts.logger?.warn(
      `[AuthPlugin] forced reset for user ${userId}: revocation INCOMPLETE — ${outcome.sessions} session(s) `
        + `and ${outcome.apiKeys} API key(s) revoked, ${outcome.failed} write(s) refused`
        + (incomplete ? ', and a read did not finish or more rows exist than were scanned' : '')
        + '. The password reset itself landed; credentials that were not revoked still work. '
        + 'Remedy: revoke the remaining sessions and keys by hand, and check write access on '
        + 'sys_session / sys_api_key.',
    );
  }
  return outcome;
}
