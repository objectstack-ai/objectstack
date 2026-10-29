// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25224 cut 3] The password, auth-gate and session policy of `AuthManager`
 * (ADR-0069) — the complexity rule (D1), the password-history ring and the
 * `password_changed_at` stamp (D3), the per-user gate posture and the two
 * caches that keep its cheap check honest, the administrator's unlock (D2),
 * and the idle, absolute and concurrent session limits (D4) — moved out of
 * `auth-manager.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `AuthManager` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same reads and writes, the same refusal with
 * the same code, the same revocations, failing open exactly where they did.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), `auth-manager-actor-guards.ts` and
 * `auth-manager-sign-in-lockout.ts` follow, applied per method. The class
 * keeps every method — the published `dist/*.d.ts` lists each one's name,
 * docblock and position — and each body is one literal of exactly the
 * {@link PasswordSessionPolicyHost} members that method reads, plus a
 * `.call`. The methods are no longer `async`: each returns the moved
 * function's own promise, so a caller awaits the same promise the body
 * settles, with no extra wrapper. A method is handed over as a closure that
 * calls it on the manager at call time, so a test double or spy set on the
 * manager is still the one the body reaches — `parseHashes` and the two
 * cache refreshes included, which bodies here ask through the manager rather
 * than calling the function here directly.
 *
 * `config` goes as a GETTER: the class reassigns it after construction
 * (`setBaseUrl` and `applyConfigPatch`), and the bodies read it after an
 * `await`, so a value copied when the method was called could part from the
 * field the body used to read. The four cache fields (`_orgMfaCache`,
 * `_orgMfaRefreshing`, `_mustChangeCache`, `_mustChangeRefreshing`) go as
 * a getter, and as a get/set pair where the body assigns them: the cache
 * refreshes write them from a background task that settles after the method
 * returned, and the class's `isAuthGateActive` and
 * `noteMustChangePasswordIssued` read and write the same fields, so every
 * read and every write lands on the manager's own field, never on a copy.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { AuthManager } from './auth-manager.js';
import type { AuthGate } from '@objectstack/core';
import { recoverInternalFieldsForSystemRead } from './internal-field-readback.js';

/**
 * The `AuthManager` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header for
 * why `config` and the four cache fields are accessors.
 */
export interface PasswordSessionPolicyHost {
  readonly config: AuthManager['config'];
  _mustChangeCache: AuthManager['_mustChangeCache'];
  _mustChangeRefreshing: AuthManager['_mustChangeRefreshing'];
  _orgMfaCache: AuthManager['_orgMfaCache'];
  _orgMfaRefreshing: AuthManager['_orgMfaRefreshing'];
  getDataEngine: AuthManager['getDataEngine'];
  logDurabilityDegradation: AuthManager['logDurabilityDegradation'];
  parseHashes: AuthManager['parseHashes'];
  refreshMustChangeCacheIfStale: AuthManager['refreshMustChangeCacheIfStale'];
  refreshOrgMfaCacheIfStale: AuthManager['refreshOrgMfaCacheIfStale'];
  resolveActor: AuthManager['resolveActor'];
}

/** The body of `AuthManager#assertPasswordComplexity`; the method's docblock there is its contract. */
export async function assertPasswordComplexity(this: Pick<PasswordSessionPolicyHost, 'config'>, password: string): Promise<void> {
  if (!this.config.passwordRequireComplexity) return;
  const min = Math.min(4, Math.max(1, Math.floor(Number(this.config.passwordMinClasses) || 3)));
  const classes =
    (/[a-z]/.test(password) ? 1 : 0) +
    (/[A-Z]/.test(password) ? 1 : 0) +
    (/[0-9]/.test(password) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(password) ? 1 : 0);
  if (classes < min) {
    const { APIError } = await import('better-auth/api');
    throw new APIError('BAD_REQUEST', {
      message:
        `Password must include at least ${min} of: uppercase, lowercase, ` +
        'digit, symbol.',
      code: 'PASSWORD_POLICY_VIOLATION',
    });
  }
}

/** The body of `AuthManager#refreshMustChangeCacheIfStale`; the method's docblock there is its contract. */
export function refreshMustChangeCacheIfStale(this: Pick<PasswordSessionPolicyHost, '_mustChangeCache' | '_mustChangeRefreshing' | 'getDataEngine'>): void {
  if (this._mustChangeRefreshing) return;
  if (Date.now() - this._mustChangeCache.at < 60_000) return;
  const engine = this.getDataEngine();
  if (!engine) return;
  this._mustChangeRefreshing = true;
  void (async () => {
    try {
      const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
      const n = await engine.count('sys_user', {
        where: { must_change_password: true }, context: SYSTEM_CTX,
      });
      this._mustChangeCache = { value: typeof n === 'number' && n > 0, at: Date.now() };
    } catch {
      // leave the prior value; try again after the TTL
    } finally {
      this._mustChangeRefreshing = false;
    }
  })();
}

/** The body of `AuthManager#refreshOrgMfaCacheIfStale`; the method's docblock there is its contract. */
export function refreshOrgMfaCacheIfStale(this: Pick<PasswordSessionPolicyHost, '_orgMfaCache' | '_orgMfaRefreshing' | 'config' | 'getDataEngine'>): void {
  if (this.config.mfaRequired === true) return;
  if (this._orgMfaRefreshing) return;
  if (Date.now() - this._orgMfaCache.at < 60_000) return;
  const engine = this.getDataEngine();
  if (!engine) return;
  this._orgMfaRefreshing = true;
  void (async () => {
    try {
      const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
      const n = await engine.count('sys_organization', {
        where: { require_mfa: true }, context: SYSTEM_CTX,
      });
      this._orgMfaCache = { value: typeof n === 'number' && n > 0, at: Date.now() };
    } catch {
      // leave the prior value; try again after the TTL
    } finally {
      this._orgMfaRefreshing = false;
    }
  })();
}

/** The body of `AuthManager#resolveUserAuthGates`; the method's docblock there is its contract. */
export async function resolveUserAuthGates(
  this: Pick<PasswordSessionPolicyHost, '_mustChangeCache' | '_orgMfaCache' | 'config' | 'getDataEngine' | 'refreshMustChangeCacheIfStale' | 'refreshOrgMfaCacheIfStale'>,
  userId: string,
  options: { organizationId?: string } = {},
): Promise<AuthGate[]> {
  // The two lazily-refreshed caches below are kept warm by `isAuthGateActive()`
  // on the session path; a key seam may ask without that probe running first,
  // so this computation refreshes them itself (each is a no-op inside its TTL).
  this.refreshOrgMfaCacheIfStale();
  this.refreshMustChangeCacheIfStale();
  const activeOrgId = options.organizationId;
  const expiryDays = Math.floor(Number(this.config.passwordExpiryDays) || 0);
  const mfaGlobal = this.config.mfaRequired === true;
  // Per-org tightening: an org may require MFA above the global floor.
  const orgMaybeRequires = !mfaGlobal && !!activeOrgId && this._orgMfaCache.value;
  // #2766 V1 — an admin-issued must-change-password flag activates the gate
  // even with every config feature off (per-user state, cached like org MFA).
  const mustChangeMaybe = this._mustChangeCache.value;
  if (expiryDays <= 0 && !mfaGlobal && !orgMaybeRequires && !mustChangeMaybe) {
    return []; // no gate feature active
  }
  const engine = this.getDataEngine();
  if (!engine || !userId) return [];
  const gates: AuthGate[] = [];
  try {
    const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
    const u = await engine.findOne('sys_user', {
      where: { id: userId },
      fields: ['password_changed_at', 'two_factor_enabled', 'mfa_required_at', 'must_change_password'],
      context: SYSTEM_CTX,
    });

    // Effective MFA requirement: global floor OR the active org's require_mfa.
    let mfaRequired = mfaGlobal;
    if (!mfaRequired && orgMaybeRequires) {
      const org = await engine.findOne('sys_organization', {
        where: { id: activeOrgId }, fields: ['require_mfa'], context: SYSTEM_CTX,
      });
      mfaRequired = org?.require_mfa === true || org?.require_mfa === 1;
    }

    // ── Admin-issued force change (#2766 V1) ──────────────────────────
    // [#23287, ruling C′ item 2] Its OWN code now, scope `credential`: it
    // used to reuse `PASSWORD_EXPIRED`, which made an administrator's reset
    // indistinguishable from natural expiry on the wire. The administrator's
    // act carries an explicit revocation switch instead
    // (`runAdminSetUserPassword`, `revokeSessionsAndKeys`).
    if (u?.must_change_password === true || u?.must_change_password === 1) {
      gates.push({
        code: 'PASSWORD_RESET_REQUIRED',
        message: 'You must change your password before continuing.',
      });
    }

    // ── Password expiry ───────────────────────────────────────────────
    if (expiryDays > 0) {
      const changed = u?.password_changed_at;
      // Null = never expires (existing accounts on upgrade) until next change.
      if (changed && Date.now() - new Date(changed).getTime() > expiryDays * 86_400_000) {
        gates.push({
          code: 'PASSWORD_EXPIRED',
          message: 'Your password has expired. Please change it to continue.',
        });
      }
    }

    // ── Enforced MFA ──────────────────────────────────────────────────
    // A user without TOTP enrolled is blocked once their grace window
    // elapses. The clock (`mfa_required_at`) starts the first time we see
    // them required-but-unenrolled (stamped lazily, best-effort).
    if (mfaRequired && !(u?.two_factor_enabled === true || u?.two_factor_enabled === 1)) {
      const graceDays = Math.max(0, Math.floor(Number(this.config.mfaGracePeriodDays ?? 7)));
      let requiredAt = u?.mfa_required_at;
      if (!requiredAt) {
        requiredAt = new Date();
        // Best-effort: start the grace clock; never block on the write.
        engine
          .update('sys_user', { id: userId, mfa_required_at: requiredAt }, { context: SYSTEM_CTX } as any)
          .catch(() => undefined);
      }
      const elapsedMs = Date.now() - new Date(requiredAt).getTime();
      if (elapsedMs > graceDays * 86_400_000) {
        gates.push({
          code: 'MFA_REQUIRED',
          message:
            'Multi-factor authentication is required. Please set up an authenticator app to continue.',
        });
      }
    }
  } catch {
    return []; // fail-open
  }
  return gates;
}

/** The body of `AuthManager#stampPasswordChangedAt`; the method's docblock there is its contract. */
export async function stampPasswordChangedAt(this: Pick<PasswordSessionPolicyHost, 'getDataEngine' | 'logDurabilityDegradation'>, userId: string): Promise<void> {
  const engine = this.getDataEngine();
  if (!engine || !userId) return;
  try {
    const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
    // #2766 V1 — a completed password change also satisfies any pending
    // admin-issued force-change flag, so clear it in the same write.
    await engine.update(
      'sys_user',
      { id: userId, password_changed_at: new Date(), must_change_password: false },
      { context: SYSTEM_CTX } as any,
    );
  } catch (e) {
    // Never break a valid password change — the new password IS set.
    // [#12981] But this write carries two live flags, not just an audit stamp.
    this.logDurabilityDegradation(
      'AuthManager: password_changed_at / must_change_password were NOT written after a '
        + 'successful password change — the new password works, so the user sees nothing wrong. '
        + 'Two things are now stale: any admin-issued force-change flag stays SET, so '
        + 'this user is told to change their password again on the next sign-in even though they '
        + 'just did; and the password-age policy (ADR-0069 D1) keeps reading the OLD timestamp, '
        + 'so a rotation deadline is computed from a password that no longer exists. Remedy: '
        + 'make the sys_user update land; the next successful change re-stamps both.',
      e,
      { object: 'sys_user', fields: ['password_changed_at', 'must_change_password'] },
    );
  }
}

/** The body of `AuthManager#parseHashes`; the method's docblock there is its contract. */
export function parseHashes(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((h): h is string => typeof h === 'string' && !!h) : [];
  } catch {
    return [];
  }
}

/** The body of `AuthManager#resolvePasswordChangeUserId`; the method's docblock there is its contract. */
export async function resolvePasswordChangeUserId(this: Pick<PasswordSessionPolicyHost, 'resolveActor'>, ctx: any): Promise<string | undefined> {
  if (ctx?.path === '/change-password') {
    return (await this.resolveActor(ctx))?.userId;
  }
  if (ctx?.path === '/reset-password') {
    const token = typeof ctx?.body?.token === 'string' ? ctx.body.token : '';
    if (!token) return undefined;
    try {
      const v: any = await ctx.context.internalAdapter.findVerificationValue(`reset-password:${token}`);
      const raw = v?.value;
      if (!raw) return undefined;
      if (typeof raw === 'string') {
        const t = raw.trim();
        if (t.startsWith('{') || t.startsWith('"')) {
          try {
            const o = JSON.parse(t);
            return (typeof o === 'string' ? o : o?.userId) ?? undefined;
          } catch {
            return t;
          }
        }
        return t;
      }
      return raw?.userId ?? undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * The refusal a forced password change answers when the new password is the
 * one the administrator issued. The code is `PASSWORD_REUSE` — the condition
 * IS reuse of the current password — and the message names the case the user
 * is in, which the history ring's generic message does not.
 */
export const FORCED_ROTATION_REUSE_MESSAGE =
  'Choose a new password that is different from your temporary password.';

/**
 * Is an administrator's forced password change (`sys_user.must_change_password`,
 * issued by the admin create-user, set-user-password and import-users doors)
 * outstanding for `userId`? Read as the system; the column is `readonly`, not
 * `internal`, so the row carries it. Fails open (false) on a lookup error, as
 * every read in `assertPasswordNotReused` does.
 */
async function isForcedRotationPending(engine: any, userId: string, context: unknown): Promise<boolean> {
  try {
    const u = await engine.findOne('sys_user', {
      where: { id: userId },
      fields: ['must_change_password'],
      context,
    });
    return u?.must_change_password === true || u?.must_change_password === 1;
  } catch {
    return false;
  }
}

/** The body of `AuthManager#assertPasswordNotReused`; the method's docblock there is its contract. */
export async function assertPasswordNotReused(
  this: Pick<PasswordSessionPolicyHost, 'config' | 'getDataEngine' | 'parseHashes'>,
  userId: string,
  candidate: string,
  verify?: (data: { password: string; hash: string }) => Promise<boolean>,
  currentPassword?: string,
): Promise<string | undefined> {
  const count = Math.floor(Number(this.config.passwordHistoryCount) || 0);
  if (typeof verify !== 'function') return undefined;
  const engine = this.getDataEngine();
  if (!engine) return undefined;
  const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
  // A forced change exists to move the user OFF a password the administrator
  // knows, so while it is outstanding the current password is refused as the
  // new one whatever `passwordHistoryCount` says (0, the default, included).
  // Every door that clears the flag (`stampPasswordChangedAt`, from the
  // after-hook on `/change-password` and `/reset-password`) passes through
  // here first.
  const forced = await isForcedRotationPending(engine, userId, SYSTEM_CTX);
  if (count <= 0 && !forced) return undefined;
  let account: any;
  try {
    account = await engine.findOne('sys_account', {
      where: { user_id: userId, provider_id: 'credential' },
      fields: ['id', 'password', 'previous_password_hashes'],
      context: SYSTEM_CTX,
    });
    // [commit d6e80b28b] Both columns are `internal: true`, so the engine's read path
    // omits them from the row above — with no `isSystem` carve-out and in
    // spite of the explicit projection (#7728's design). Recover them
    // through the privileged accessor, or `compareList` below is empty and
    // this control silently passes every reused password.
    await recoverInternalFieldsForSystemRead(
      engine as never,
      'sys_account',
      account,
      ['password', 'previous_password_hashes'],
    );
  } catch {
    return undefined; // fail-open on lookup error
  }
  if (!account?.id) return undefined;
  const currentHash = typeof account.password === 'string' ? account.password : '';
  const matches = async (password: string, hash: string) => {
    try { return await verify({ password, hash }); } catch { return false; }
  };
  // `/change-password` carries the caller's claim of the current password, and
  // better-auth confirms that claim only AFTER this hook. Every reuse refusal
  // below — the forced change's and the history ring's — is given only once
  // the current password is confirmed; an unconfirmed claim is left to the
  // endpoint's own refusal (`INVALID_PASSWORD`). `/reset-password` carries no
  // claim (`currentPassword` undefined): its token is the caller's authority.
  const claimHolds = currentPassword === undefined
    || (!!currentHash && await matches(currentPassword, currentHash));
  if (!claimHolds) return undefined;
  if (forced && currentHash && await matches(candidate, currentHash)) {
    const { APIError } = await import('better-auth/api');
    throw new APIError('BAD_REQUEST', {
      message: FORCED_ROTATION_REUSE_MESSAGE,
      code: 'PASSWORD_REUSE',
    });
  }
  if (count <= 0) return undefined;
  const compareList = [currentHash, ...this.parseHashes(account.previous_password_hashes)].filter(Boolean);
  for (const h of compareList) {
    if (await matches(candidate, h)) {
      const { APIError } = await import('better-auth/api');
      throw new APIError('BAD_REQUEST', {
        message: `For security you can't reuse one of your last ${count} passwords. Please choose a different one.`,
        code: 'PASSWORD_REUSE',
      });
    }
  }
  return currentHash;
}

/** The body of `AuthManager#recordPasswordHistory`; the method's docblock there is its contract. */
export async function recordPasswordHistory(this: Pick<PasswordSessionPolicyHost, 'config' | 'getDataEngine' | 'logDurabilityDegradation' | 'parseHashes'>, userId: string, oldHash: string): Promise<void> {
  const count = Math.floor(Number(this.config.passwordHistoryCount) || 0);
  if (count <= 0 || !oldHash) return;
  const engine = this.getDataEngine();
  if (!engine) return;
  try {
    const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
    const account = await engine.findOne('sys_account', {
      where: { user_id: userId, provider_id: 'credential' },
      fields: ['id', 'previous_password_hashes'],
      context: SYSTEM_CTX,
    });
    if (!account?.id) return;
    // [commit d6e80b28b] As above — the flagged column is omitted from the read, so
    // recover it before extending the ring. Without this the ring is rebuilt
    // from an empty history on every change and never grows past one entry.
    await recoverInternalFieldsForSystemRead(
      engine as never,
      'sys_account',
      account,
      ['previous_password_hashes'],
    );
    const prev = this.parseHashes(account.previous_password_hashes);
    const next = [oldHash, ...prev.filter((h) => h !== oldHash)].slice(0, count);
    await engine.update(
      'sys_account',
      { id: account.id, previous_password_hashes: JSON.stringify(next) },
      { context: SYSTEM_CTX } as any,
    );
  } catch (e) {
    // Never break a valid password change. [#12981] But a reuse ring that
    // silently stops growing is a security control that stops enforcing.
    this.logDurabilityDegradation(
      'AuthManager: the password-history ring was NOT extended after a successful password '
        + 'change — the change itself succeeded, so nothing looks wrong. The password just '
        + 'replaced was never recorded, so `passwordHistoryCount` (ADR-0069 D1) will NOT refuse '
        + 'it on the next change: the deployment advertises "you cannot reuse your last N '
        + 'passwords" and, for this identity, does not enforce it. Remedy: make the sys_account '
        + 'update land — check the write permission on `previous_password_hashes` and driver '
        + 'connectivity. The ring is rebuilt from stored history, so it recovers on the next '
        + 'change that lands; the passwords skipped in between stay reusable.',
      e,
      { object: 'sys_account', field: 'previous_password_hashes', ringSize: count },
    );
  }
}

/** The body of `AuthManager#unlockUser`; the method's docblock there is its contract. */
export async function unlockUser(this: Pick<PasswordSessionPolicyHost, 'getDataEngine' | 'logDurabilityDegradation'>, userId: string): Promise<boolean> {
  const engine = this.getDataEngine();
  if (!engine || !userId) return false;
  const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
  const u = await engine.findOne('sys_user', {
    where: { id: userId }, fields: ['id'], context: SYSTEM_CTX,
  });
  if (!u?.id) return false;
  await engine.update(
    'sys_user',
    { id: userId, failed_login_count: 0, locked_until: null },
    { context: SYSTEM_CTX } as any,
  );
  // Best-effort and deliberately after the primary write: a user with no
  // enrolment (or an environment where 2FA was never switched on) must still
  // get a successful unlock, and the password-stage clear is the part the
  // admin asked for.
  try {
    const enrolments = await engine.find('sys_two_factor', {
      where: { user_id: String(userId) }, fields: ['id'], context: SYSTEM_CTX,
    });
    for (const row of (enrolments ?? []) as Array<{ id?: string }>) {
      if (!row?.id) continue;
      await engine.update(
        'sys_two_factor',
        { id: row.id, failed_verification_count: 0, locked_until: null },
        { context: SYSTEM_CTX } as any,
      );
    }
  } catch (e) {
    // Never turn a successful password-stage unlock into a failure — this
    // method still returns true, because the password stage IS cleared.
    // [#12981] That `true` is exactly why the silence had to go: it is the
    // admin's whole answer, and it was covering a half-completed unlock.
    this.logDurabilityDegradation(
      'AuthManager: the SECOND-FACTOR half of an admin unlock was NOT cleared — the '
        + 'password-stage counters were reset and this unlock reports SUCCESS to the admin, so '
        + 'the console shows the account unlocked. `sys_two_factor.failed_verification_count` / '
        + '`locked_until` are untouched, so a user locked at the second factor stays locked and '
        + 'must wait out the duration with no admin escape hatch at all. Remedy: make the '
        + 'sys_two_factor update land, then run Unlock again; it is idempotent.',
      e,
      { object: 'sys_two_factor', userId },
    );
  }
  return true;
}

/**
 * [#25343] The `last_activity_at` heartbeat's throttle: at most one write per
 * session per minute, and — when no session limit is configured — at most one
 * `sys_session` read per session per minute as well.
 */
const SESSION_HEARTBEAT_INTERVAL_MS = 60_000;
/**
 * [#25343] The most sessions one {@link SessionHeartbeatMemo} remembers. An
 * entry is worth keeping for one {@link SESSION_HEARTBEAT_INTERVAL_MS} only,
 * so the cap is a bound on memory, not on correctness: an evicted session is
 * read once more, exactly as if the memo had expired.
 */
export const SESSION_HEARTBEAT_MEMO_MAX = 10_000;

/**
 * [#25343] Per-process, per-session memo of "this session's row was read less
 * than a minute ago", consulted only when neither the idle nor the absolute
 * limit is configured (ADR-0069 D4). There the read exists only to feed the
 * heartbeat, which writes at most once a minute, so a read inside that minute
 * cannot lead to a write and is skipped. With a limit on, every request still
 * reads: enforcement needs the row's current state, and the memo is not asked.
 *
 * Bounded least-recently-noted: a `Map` keeps insertion order, `note` moves
 * the session to the end, and the oldest entry — the stalest — is dropped
 * past {@link SESSION_HEARTBEAT_MEMO_MAX}.
 */
class SessionHeartbeatMemo {
  private readonly readAt = new Map<string, number>();

  isFresh(sessionId: string, now: number): boolean {
    const at = this.readAt.get(sessionId);
    return at !== undefined && now - at <= SESSION_HEARTBEAT_INTERVAL_MS;
  }

  note(sessionId: string, now: number): void {
    this.readAt.delete(sessionId);
    this.readAt.set(sessionId, now);
    if (this.readAt.size > SESSION_HEARTBEAT_MEMO_MAX) {
      const oldest = this.readAt.keys().next().value;
      if (oldest !== undefined) this.readAt.delete(oldest);
    }
  }
}

/**
 * [#25343] One memo per data engine, held weakly: in a running process that
 * is the one engine the manager is wired to (so the memo is per-process), and
 * a second engine — another manager, a test double — never answers from the
 * first one's memo.
 */
const sessionHeartbeatMemos = new WeakMap<object, SessionHeartbeatMemo>();

function sessionHeartbeatMemoFor(engine: object): SessionHeartbeatMemo {
  let memo = sessionHeartbeatMemos.get(engine);
  if (!memo) {
    memo = new SessionHeartbeatMemo();
    sessionHeartbeatMemos.set(engine, memo);
  }
  return memo;
}

/** The body of `AuthManager#enforceSessionControls`; the method's docblock there is its contract. */
export async function enforceSessionControls(this: Pick<PasswordSessionPolicyHost, 'config' | 'getDataEngine' | 'logDurabilityDegradation'>, sessionId: string | undefined, createdAtHint: unknown): Promise<void> {
  const idleMin = Math.floor(Number(this.config.sessionIdleTimeoutMinutes) || 0);
  const absHrs = Math.floor(Number(this.config.sessionAbsoluteMaxHours) || 0);
  // [#25343] Both limits off no longer returns here: `last_activity_at` is
  // "the last request on this session" on every deployment, not only where an
  // idle timeout reads it (ruling 6358844136, letter A). What both-off buys
  // instead is the memo below, so the added read is throttled like the write.
  const limitsOff = idleMin <= 0 && absHrs <= 0;
  const engine = this.getDataEngine();
  if (!engine || !sessionId) return;
  const memo = limitsOff ? sessionHeartbeatMemoFor(engine) : undefined;
  if (memo?.isFresh(sessionId, Date.now())) return;
  try {
    const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
    const srow = await engine.findOne('sys_session', {
      where: { id: sessionId },
      fields: ['id', 'created_at', 'last_activity_at', 'revoked_at'],
      context: SYSTEM_CTX,
    });
    const now = Date.now();
    memo?.note(sessionId, now);
    if (!srow?.id || srow.revoked_at) return;
    let reason: string | undefined;
    if (absHrs > 0) {
      const created = srow.created_at ?? createdAtHint;
      if (created && now - new Date(created as any).getTime() > absHrs * 3_600_000) reason = 'absolute_max';
    }
    if (!reason && idleMin > 0) {
      const last = srow.last_activity_at ?? srow.created_at ?? createdAtHint;
      if (last && now - new Date(last as any).getTime() > idleMin * 60_000) reason = 'idle_timeout';
    }
    if (reason) {
      // [#12981] The per-call `.catch` stays — a revocation must not turn the
      // request it rides on into a 500 — but it no longer swallows. This is
      // the sharpest write in the file: a refused revocation leaves a session
      // that IS over its limit fully live.
      await engine.update(
        'sys_session',
        { id: sessionId, expires_at: new Date(now - 1000), revoked_at: new Date(now), revoke_reason: reason },
        { context: SYSTEM_CTX } as any,
      ).catch((e: unknown) => this.logDurabilityDegradation(
        'AuthManager: a session that exceeded its configured limit was NOT revoked — the '
          + 'revocation write was refused and the request continues normally, so nothing looks '
          + 'wrong. The session row is unchanged, so better-auth will keep answering with it: '
          + 'the idle / absolute session limits (ADR-0069 D4) are configured and, for this '
          + 'session, not enforced. Remedy: make the sys_session update land — check the write '
          + 'permission on `expires_at` / `revoked_at` / `revoke_reason`. Enforcement is '
          + 're-attempted on this session\'s next request, so it recovers once the write can '
          + 'land; until then the session stays usable.',
        e,
        { object: 'sys_session', sessionId, reason },
      ));
      return;
    }
    // [#25343] The heartbeat runs on every deployment, idle timeout or not.
    const la = srow.last_activity_at ? new Date(srow.last_activity_at as any).getTime() : 0;
    if (now - la > SESSION_HEARTBEAT_INTERVAL_MS) {
      await engine.update('sys_session', { id: sessionId, last_activity_at: new Date(now) }, { context: SYSTEM_CTX } as any)
        .catch((e: unknown) => this.logDurabilityDegradation(
          'AuthManager: the session activity heartbeat was NOT written — the request '
            + 'succeeds and the session stays live, so nothing looks wrong. '
            + '`last_activity_at` keeps its older value, so the idle-timeout clock (ADR-0069 '
            + 'D4) keeps measuring from that older instant and this session will be revoked '
            + 'as idle EARLIER than the configured window — an active user signed out '
            + 'mid-session for no visible reason. Remedy: make the sys_session update land; '
            + 'the heartbeat retries on the next request past the one-minute throttle.',
          e,
          { object: 'sys_session', sessionId, field: 'last_activity_at' },
        ));
    }
  } catch (e) {
    // Never break a request. [#12981] But a control that silently stops
    // running is a control the operator still believes is on.
    this.logDurabilityDegradation(
      limitsOff
        // [#25343] With no limit configured the read feeds only the heartbeat,
        // so that is what was lost — saying "limits not evaluated" would name
        // a control this deployment never turned on.
        ? 'AuthManager: the session activity heartbeat did not run — the request succeeds, so '
          + 'nothing looks wrong. `last_activity_at` was not advanced for this session, so the '
          + 'Sessions list shows an older Last Activity than the session really has. Remedy: '
          + 'this is the LOOKUP half failing (the sys_session read), so check driver '
          + 'connectivity and read permission on sys_session; the heartbeat re-runs on the '
          + 'next request.'
        : 'AuthManager: the per-request session controls did not run to completion — the request '
          + 'succeeds, so nothing looks wrong. Idle and absolute session limits (ADR-0069 D4) '
          + 'were not evaluated for this session, so a session past its limit is neither revoked '
          + 'nor reported by the branch above. Remedy: this is the LOOKUP half failing (the '
          + 'sys_session read), so check driver connectivity and read permission on sys_session; '
          + 'the controls re-run on the next request.',
      e,
      { object: 'sys_session', sessionId, idleMinutes: idleMin, absoluteHours: absHrs },
    );
  }
}

/** The body of `AuthManager#enforceConcurrentCap`; the method's docblock there is its contract. */
export async function enforceConcurrentCap(this: Pick<PasswordSessionPolicyHost, 'config' | 'getDataEngine' | 'logDurabilityDegradation'>, userId: string): Promise<void> {
  const cap = Math.floor(Number(this.config.maxConcurrentSessions) || 0);
  if (cap <= 0 || !userId) return;
  const engine = this.getDataEngine();
  if (!engine) return;
  try {
    const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
    const rows = await engine.find('sys_session', {
      where: { user_id: userId },
      fields: ['id', 'created_at', 'expires_at', 'revoked_at'],
      limit: 200,
      context: SYSTEM_CTX,
    });
    const now = Date.now();
    const live = (Array.isArray(rows) ? rows : [])
      .filter((sn: any) => !sn.revoked_at && (!sn.expires_at || new Date(sn.expires_at).getTime() > now))
      .sort((a: any, b: any) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
    for (const sn of live.slice(cap)) {
      // [#12981] Per-session `.catch` so one refused revocation does not
      // abandon the rest of the sweep — but it reports instead of swallowing.
      await engine.update(
        'sys_session',
        { id: sn.id, expires_at: new Date(now - 1000), revoked_at: new Date(now), revoke_reason: 'concurrent_cap' },
        { context: SYSTEM_CTX } as any,
      ).catch((e: unknown) => this.logDurabilityDegradation(
        'AuthManager: a session over the concurrent-session cap was NOT revoked — the sign-in '
          + 'that triggered the sweep succeeded, so nothing looks wrong. This older session '
          + 'stays live, so the account holds MORE simultaneous sessions than '
          + '`maxConcurrentSessions` (ADR-0069 D4) allows: the cap is configured and, for this '
          + 'session, not enforced. Remedy: make the sys_session update land; the sweep re-runs '
          + 'on this user\'s next sign-in and will try this row again.',
        e,
        { object: 'sys_session', sessionId: sn.id, cap, userId },
      ));
    }
  } catch (e) {
    // Never break a successful sign-in. [#12981] But a cap that silently
    // stops sweeping is a cap the operator still believes is on.
    this.logDurabilityDegradation(
      'AuthManager: the concurrent-session cap sweep did not run — the sign-in succeeded, so '
        + 'nothing looks wrong. Sessions beyond `maxConcurrentSessions` (ADR-0069 D4) were '
        + 'neither enumerated nor revoked, so the account can hold unbounded simultaneous '
        + 'sessions while this persists. Remedy: this is the sys_session LOOKUP half failing, '
        + 'so check driver connectivity and read permission on sys_session; the sweep re-runs '
        + 'on the next sign-in.',
      e,
      { object: 'sys_session', userId, cap },
    );
  }
}
