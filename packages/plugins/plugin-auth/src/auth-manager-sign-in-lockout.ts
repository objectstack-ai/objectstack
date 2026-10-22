// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25224 cut 2] The sign-in lockout path of `AuthManager` (ADR-0069 D2) —
 * the locked-account gate before the credential check, the failure counter
 * and lock stamp after it, the `login_failed` row of a refused attempt, the
 * account a sign-in identifier resolves to, the second factor's lockout
 * projection — and the last-login stamp the same after-hook writes (D7),
 * moved out of `auth-manager.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `AuthManager` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same reads and writes, the same refusal with
 * the same code, the same audit rows, failing open exactly where they did.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning) and `auth-manager-actor-guards.ts`
 * follows, applied per method. The class keeps every method — the published
 * `dist/*.d.ts` lists each one's name, docblock and position — and each body
 * is one literal of exactly the {@link SignInLockoutHost} members that method
 * reads, plus a `.call`. The methods are no longer `async`: each returns the
 * moved function's own promise, so a caller awaits the same promise the body
 * settles, with no extra wrapper. A method is handed over as a closure that
 * calls it on the manager at call time, so a test double or spy set on the
 * manager is still the one the body reaches — `findSignInAccount` and
 * `resolveSignInAccountId` included, which bodies here ask through the
 * manager rather than calling the function here directly.
 *
 * The one field, `config`, goes as a GETTER: the class reassigns it after
 * construction (`setBaseUrl` and `applyConfigPatch`), and the bodies read it
 * after an `await`, so a value copied when the method was called could part
 * from the field the body used to read.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { AuthManager } from './auth-manager.js';
import type { IDataEngine } from '@objectstack/core';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import {
  accountLockedEventFor,
  emitAuthSessionAuditEvent,
  refusalCodeOf,
  signInClientFingerprint,
  signInFailureEventFor,
  SIGN_IN_EMAIL_PATH,
} from './auth-session-audit.js';

/**
 * The `AuthManager` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header for
 * why `config` is a getter.
 */
export interface SignInLockoutHost {
  readonly config: AuthManager['config'];
  findSignInAccount: AuthManager['findSignInAccount'];
  getDataEngine: AuthManager['getDataEngine'];
  logDurabilityDegradation: AuthManager['logDurabilityDegradation'];
  resolveSignInAccountId: AuthManager['resolveSignInAccountId'];
}

/** The body of `AuthManager#assertAccountNotLocked`; the method's docblock there is its contract. */
export async function assertAccountNotLocked(this: Pick<SignInLockoutHost, 'config' | 'findSignInAccount' | 'getDataEngine'>, email: string, ctx?: unknown): Promise<void> {
  const threshold = Number(this.config.lockoutThreshold) || 0;
  if (threshold <= 0) return;
  const engine = this.getDataEngine();
  if (!engine) return;
  let locked = false;
  let lockedUserId: string | undefined;
  try {
    const u = await this.findSignInAccount(engine, email, ['locked_until']);
    const lu = u?.locked_until as string | number | Date | null | undefined;
    locked = !!(lu && new Date(lu).getTime() > Date.now());
    if (locked && u) lockedUserId = u.id;
  } catch {
    return; // fail-open
  }
  if (locked) {
    if (ctx !== undefined && lockedUserId) {
      await emitAuthSessionAuditEvent(
        this.config.getAuditSink?.(),
        signInFailureEventFor(lockedUserId, {
          path: SIGN_IN_EMAIL_PATH,
          reason: 'ACCOUNT_LOCKED',
          fingerprint: signInClientFingerprint(ctx),
        }),
      );
    }
    const { APIError } = await import('better-auth/api');
    throw new APIError('FORBIDDEN', {
      message:
        'This account is temporarily locked after too many failed sign-in ' +
        'attempts. Try again later or ask an administrator to unlock it.',
      code: 'ACCOUNT_LOCKED',
    });
  }
}

/** The body of `AuthManager#recordSignInOutcome`; the method's docblock there is its contract. */
export async function recordSignInOutcome(
  this: Pick<SignInLockoutHost, 'config' | 'findSignInAccount' | 'getDataEngine' | 'logDurabilityDegradation'>,
  email: string,
  success: boolean,
): Promise<{ userId: string; lockedUntil: Date; threshold: number } | undefined> {
  const threshold = Number(this.config.lockoutThreshold) || 0;
  if (threshold <= 0) return undefined;
  const engine = this.getDataEngine();
  if (!engine) return undefined;
  try {
    const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
    const u = await this.findSignInAccount(engine, email, ['failed_login_count', 'locked_until']);
    if (!u) return undefined;
    if (success) {
      if ((Number(u.failed_login_count) || 0) !== 0 || u.locked_until) {
        await engine.update(
          'sys_user',
          { id: u.id, failed_login_count: 0, locked_until: null },
          { context: SYSTEM_CTX } as any,
        );
      }
      return undefined;
    }
    const next = (Number(u.failed_login_count) || 0) + 1;
    const patch: Record<string, unknown> = { id: u.id, failed_login_count: next };
    let lockedUntil: Date | undefined;
    if (next >= threshold) {
      const mins = Number(this.config.lockoutDurationMinutes) || 15;
      lockedUntil = new Date(Date.now() + mins * 60_000);
      patch.locked_until = lockedUntil;
    }
    await engine.update('sys_user', patch, { context: SYSTEM_CTX } as any);
    return lockedUntil ? { userId: u.id, lockedUntil, threshold } : undefined;
  } catch (e) {
    // Never break the auth response. [#12981] But lockout accounting that
    // silently stops accounting is brute-force protection that is OFF.
    this.logDurabilityDegradation(
      'AuthManager: the sign-in lockout counter was NOT written — the auth response is '
        + 'unaffected, so nothing looks broken. This attempt was not counted, which means '
        + 'consecutive failures do not accumulate and the account is never locked: '
        + '`lockoutThreshold` (ADR-0069 D2) is configured and, for this identity, not enforced. '
        + 'A brute-force run against this account meets no limit while this persists, and the '
        + 'only notice is this line. Remedy: make the sys_user update land — check the write '
        + 'permission on `failed_login_count` / `locked_until` and driver connectivity.',
      e,
      { object: 'sys_user', threshold, success },
    );
    return undefined;
  }
}

/** The body of `AuthManager#auditRefusedSignIn`; the method's docblock there is its contract. */
export async function auditRefusedSignIn(
  this: Pick<SignInLockoutHost, 'config' | 'resolveSignInAccountId'>,
  ctx: any,
  email: string,
  lockStamped: { userId: string; lockedUntil: Date; threshold: number } | undefined,
): Promise<void> {
  const sink = this.config.getAuditSink?.();
  if (!sink) return;
  const userId = lockStamped?.userId ?? (await this.resolveSignInAccountId(email));
  if (!userId) return;
  const fingerprint = signInClientFingerprint(ctx);
  await emitAuthSessionAuditEvent(
    sink,
    signInFailureEventFor(userId, {
      path: SIGN_IN_EMAIL_PATH,
      reason: refusalCodeOf(ctx?.context?.returned),
      fingerprint,
    }),
  );
  if (lockStamped) {
    await emitAuthSessionAuditEvent(
      sink,
      accountLockedEventFor(lockStamped.userId, {
        path: SIGN_IN_EMAIL_PATH,
        lockedUntil: lockStamped.lockedUntil,
        threshold: lockStamped.threshold,
        fingerprint,
      }),
    );
  }
}

/** The body of `AuthManager#resolveSignInAccountId`; the method's docblock there is its contract. */
export async function resolveSignInAccountId(this: Pick<SignInLockoutHost, 'findSignInAccount' | 'getDataEngine' | 'logDurabilityDegradation'>, email: string): Promise<string | undefined> {
  const engine = this.getDataEngine();
  if (!engine) return undefined;
  try {
    return (await this.findSignInAccount(engine, email, []))?.id;
  } catch (e) {
    // The refusal stands either way; what is lost is its ledger row.
    this.logDurabilityDegradation(
      'AuthManager: a refused sign-in was NOT recorded in sys_audit_log — the account it named '
        + 'could not be resolved, so its `login_failed` row was not written. The refusal itself was '
        + 'answered normally, so nothing looks broken, and the Auth preset of Setup → Audit Log is '
        + 'missing this attempt. Remedy: make the sys_user read land — check driver connectivity.',
      e,
      { object: 'sys_user', action: 'login_failed' },
    );
    return undefined;
  }
}

/** The body of `AuthManager#findSignInAccount`; the method's docblock there is its contract. */
export async function findSignInAccount(
  engine: IDataEngine,
  email: string,
  fields: readonly string[],
): Promise<({ id: string } & Record<string, unknown>) | undefined> {
  const query: EngineQueryOptions = {
    where: { email: email.toLowerCase() },
    fields: ['id', ...fields],
    context: { isSystem: true, positions: [], permissions: [] },
  };
  const row = await engine.findOne('sys_user', query);
  return row && typeof row.id === 'string' && row.id
    ? (row as { id: string } & Record<string, unknown>)
    : undefined;
}

/** The body of `AuthManager#resolveTwoFactorAccountLockout`; the method's docblock there is its contract. */
export function resolveTwoFactorAccountLockout(this: Pick<SignInLockoutHost, 'config'>): { enabled: boolean; maxFailedAttempts: number; durationSeconds: number } | undefined {
  const threshold = Number(this.config.lockoutThreshold) || 0;
  if (threshold <= 0) return undefined;
  const minutes = Number(this.config.lockoutDurationMinutes) || 15;
  return {
    enabled: true,
    maxFailedAttempts: threshold,
    durationSeconds: minutes * 60,
  };
}

/** The body of `AuthManager#stampLastLogin`; the method's docblock there is its contract. */
export async function stampLastLogin(this: Pick<SignInLockoutHost, 'getDataEngine' | 'logDurabilityDegradation'>, userId: string, ip: string | undefined): Promise<void> {
  const engine = this.getDataEngine();
  if (!engine || !userId) return;
  try {
    const SYSTEM_CTX = { isSystem: true, attributedUserId: userId, positions: [], permissions: [] };
    const patch: Record<string, unknown> = { id: userId, last_login_at: new Date() };
    // Cap to the column width (IPv6 textual max 45) — a malformed/oversized
    // forwarded header must not blow up the write.
    if (ip) patch.last_login_ip = ip.slice(0, 45);
    await engine.update('sys_user', patch, { context: SYSTEM_CTX } as any);
  } catch (e) {
    // Never break the auth response. [#12981] But this write is the ONLY
    // trace the sign-in leaves in the compliance ledger.
    this.logDurabilityDegradation(
      'AuthManager: the last-login stamp was NOT written — the sign-in succeeded and the user '
        + 'holds a valid session, so nothing looks wrong. `last_login_at` / `last_login_ip` keep '
        + 'their previous values, and because this update is what plugin-audit turns into the '
        + 'change-trail row, this sign-in leaves NO trace in the compliance ledger at '
        + 'all: "when did this account last sign in, and from where" now answers with a stale '
        + 'row, and a login from a new address is exactly what that trail is read for. Remedy: '
        + 'make the sys_user update land; the next sign-in that lands re-stamps it, but this one '
        + 'is not recoverable.',
      e,
      { object: 'sys_user', fields: ['last_login_at', 'last_login_ip'] },
    );
  }
}
