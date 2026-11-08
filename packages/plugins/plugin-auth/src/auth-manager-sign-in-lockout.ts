// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25224 cut 2] The sign-in lockout path of `AuthManager` (ADR-0069 D2) —
 * the lock gate that stamps each attempt before its credential is checked,
 * the settlement of that stamp once the check has answered, the clear a
 * completed password reset makes, the `login_failed` row of a refused attempt,
 * the account a sign-in identifier resolves to, the second factor's lockout
 * projection — and the last-login stamp the same after-hook writes (D7),
 * moved out of `auth-manager.ts` whole.
 *
 * Each function below is the body of the `AuthManager` method of the same
 * name. The lockout's three answers [#28381]:
 *
 *  - a locked account is refused with the answer a wrong password gets, unless
 *    the deployment opted into the explicit `403 ACCOUNT_LOCKED`
 *    (`lockoutRefusal: 'explicit'`); how the refusal is made, and why it is
 *    made by the endpoint's own credential check, is `sign-in-lockout-refusal.ts`;
 *  - every attempt is stamped as a failure BEFORE its credential is checked,
 *    in one compare-and-set write ({@link admitSignInAttempt}), and the stamp
 *    is settled after: cleared by a success, handed back by a refusal that
 *    came after the credential passed, kept by any other refusal
 *    ({@link settleSignInAttempt}) — so attempts that arrive together cannot
 *    all be checked before the lock lands;
 *  - a completed password reset clears the counter and the lock
 *    ({@link clearSignInLockout}).
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
import { canonicalClientAddress } from './client-address-canonical.js';
import { readRequestClientAddress } from './request-client-address.js';
import {
  readSignInAttempt,
  recordSignInAttempt,
  type SignInAttempt,
  type SignInLockStamp,
} from './sign-in-lockout-refusal.js';

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

/** The context every lockout read and write runs under: the system's, attributed to nobody. */
const LOCKOUT_SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

/**
 * How many compare-and-set rounds an admitted attempt tries before it is
 * refused as contended. Each lost round means another attempt on the same
 * account landed its own reservation first, so a round is lost at most once
 * per concurrent attempt; past this many, the account is under a burst and the
 * attempt is refused as a locked one is (`admitSignInAttempt`).
 */
const RESERVATION_ROUNDS = 32;

/** Whether a stored `locked_until` is still in the future at `now` (epoch ms). */
function lockHolds(lockedUntil: unknown, now: number): boolean {
  if (lockedUntil === null || lockedUntil === undefined || lockedUntil === '') return false;
  const at = new Date(lockedUntil as string | number | Date).getTime();
  return Number.isFinite(at) && at > now;
}

/** Whether a stored datetime names the same instant as `at` (drivers return a `Date` or ISO text). */
function sameInstant(stored: unknown, at: Date): boolean {
  if (stored === null || stored === undefined || stored === '') return false;
  return new Date(stored as string | number | Date).getTime() === at.getTime();
}

/**
 * The compare-and-set write on an account's counter that reserving an attempt
 * and handing one back share: `patch` lands only while `failed_login_count`
 * still holds `expected`. `multi: true` because the by-id path binds only the
 * primary key and would drop the rest of the predicate (the shape
 * `db-queue-adapter.ts` gives for its own compare-and-set writes). Resolves
 * whether it landed; an engine that reports no count is read as landed.
 */
async function writeCounterIfUnchanged(
  engine: IDataEngine,
  userId: string,
  expected: unknown,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const result: unknown = await engine.update('sys_user', patch, {
    where: { id: userId, failed_login_count: expected },
    multi: true,
    context: LOCKOUT_SYSTEM_CTX,
  } as any);
  return typeof result === 'number' ? result > 0 : true;
}

/** Read an account's lockout state by id: the read handing a reservation back and a completed reset share. */
async function readLockoutRow(engine: IDataEngine, userId: string): Promise<Record<string, any> | null> {
  const query: EngineQueryOptions = {
    where: { id: userId },
    fields: ['id', 'failed_login_count', 'locked_until'],
    context: LOCKOUT_SYSTEM_CTX,
  };
  return engine.findOne('sys_user', query);
}

/** Zero an account's counter and lift its lock: the write a successful sign-in and a completed reset share. */
async function writeLockoutCleared(engine: IDataEngine, userId: string): Promise<void> {
  await engine.update(
    'sys_user',
    { id: userId, failed_login_count: 0, locked_until: null },
    { context: LOCKOUT_SYSTEM_CTX } as any,
  );
}

/**
 * Stamp one sign-in attempt as a failure before its credential is checked: the
 * counter moves by one in a compare-and-set write on the value just read, and a
 * write that lands on a stale read lands nothing, so the attempt reads again.
 * Two attempts can therefore never reserve the same count, and the attempt
 * whose reservation reaches the threshold stamps the lock in that same write —
 * every attempt after it reads the lock and is refused, however many arrived
 * together.
 *
 * An account whose lock holds is counted too (its lock is never moved), in one
 * round: the write is what an admitted attempt pays, so the two cost the same,
 * and losing that round to a concurrent attempt changes nothing about the
 * refusal. Resolves to `undefined` when the identifier names no account.
 * Throws what the engine throws.
 */
async function reserveSignInAttempt(
  engine: IDataEngine,
  findAccount: SignInLockoutHost['findSignInAccount'],
  email: string,
  threshold: number,
  durationMinutes: number,
): Promise<SignInAttempt | undefined> {
  const identifier = email.toLowerCase();
  let last: { id: string; priorCount: unknown; priorLockedUntil: unknown } | undefined;
  for (let round = 0; round < RESERVATION_ROUNDS; round++) {
    const row = await findAccount(engine, email, ['failed_login_count', 'locked_until']);
    if (!row) return undefined;
    const now = Date.now();
    const priorCount = row.failed_login_count ?? null;
    const priorLockedUntil = row.locked_until ?? null;
    last = { id: row.id, priorCount, priorLockedUntil };
    const locked = lockHolds(priorLockedUntil, now);
    const reservedCount = (Number(priorCount) || 0) + 1;
    const patch: Record<string, unknown> = { failed_login_count: reservedCount };
    let lockStamped: SignInLockStamp | undefined;
    if (!locked && reservedCount >= threshold) {
      const lockedUntil = new Date(now + durationMinutes * 60_000);
      patch.locked_until = lockedUntil;
      lockStamped = { userId: row.id, lockedUntil, threshold };
    }
    const landed = await writeCounterIfUnchanged(engine, row.id, priorCount, patch);
    if (locked) {
      return { identifier, userId: row.id, verdict: 'locked', priorCount, reservedCount: landed ? reservedCount : Number(priorCount) || 0, priorLockedUntil };
    }
    if (landed) {
      return {
        identifier,
        userId: row.id,
        verdict: 'admitted',
        priorCount,
        reservedCount,
        priorLockedUntil,
        ...(lockStamped ? { lockStamped } : {}),
      };
    }
  }
  // Every round lost to another attempt on this account: refused as a locked
  // account is, and uncounted.
  return last
    ? { identifier, userId: last.id, verdict: 'locked', priorCount: last.priorCount, reservedCount: Number(last.priorCount) || 0, priorLockedUntil: last.priorLockedUntil }
    : undefined;
}

/** The body of `AuthManager#admitSignInAttempt`; the method's docblock there is its contract. */
export async function admitSignInAttempt(
  this: Pick<SignInLockoutHost, 'config' | 'findSignInAccount' | 'getDataEngine' | 'logDurabilityDegradation'>,
  email: string,
  ctx?: any,
): Promise<void> {
  const threshold = Number(this.config.lockoutThreshold) || 0;
  const engine = threshold > 0 ? this.getDataEngine() : undefined;
  if (!engine) {
    // Whatever an earlier call in this request recorded, this attempt has no verdict.
    await recordSignInAttempt(undefined);
    return;
  }
  let attempt: SignInAttempt | undefined;
  try {
    attempt = await reserveSignInAttempt(
      engine,
      this.findSignInAccount,
      email,
      threshold,
      Number(this.config.lockoutDurationMinutes) || 15,
    );
  } catch (e) {
    // Fail OPEN: an infra hiccup must never block every login. [#12981] But
    // lockout accounting that silently stops accounting is brute-force
    // protection that is OFF.
    this.logDurabilityDegradation(
      'AuthManager: the sign-in lockout counter was NOT written — the auth response is '
        + 'unaffected, so nothing looks broken. This attempt was not counted, which means '
        + 'consecutive failures do not accumulate and the account is never locked: '
        + '`lockoutThreshold` (ADR-0069 D2) is configured and, for this identity, not enforced. '
        + 'A brute-force run against this account meets no limit while this persists, and the '
        + 'only notice is this line. Remedy: make the sys_user read and update land — check the '
        + 'write permission on `failed_login_count` / `locked_until` and driver connectivity.',
      e,
      { object: 'sys_user', threshold },
    );
    await recordSignInAttempt(undefined);
    return;
  }
  const carried = await recordSignInAttempt(attempt);
  if (attempt?.verdict !== 'locked') return;

  // The refusal is a refused sign-in of the account it names, so — given the
  // endpoint context — it writes that account's `login_failed` row, with the
  // lock as its reason, whichever answer the caller is given.
  if (ctx !== undefined) {
    await emitAuthSessionAuditEvent(
      this.config.getAuditSink?.(),
      signInFailureEventFor(attempt.userId, {
        path: SIGN_IN_EMAIL_PATH,
        reason: 'ACCOUNT_LOCKED',
        fingerprint: signInClientFingerprint(ctx, await readRequestClientAddress()),
      }),
    );
  }
  const explicit = this.config.lockoutRefusal === 'explicit';
  // The endpoint's own credential check refuses it, with the answer a wrong
  // password gets (`sign-in-lockout-refusal.ts`).
  if (carried && !explicit) return;
  if (!carried && !explicit) {
    // better-auth opens a request state for every endpoint call, so a call
    // with none ran outside its pipeline: the verdict cannot reach the
    // credential check, and the lock must not yield to a correct password. It
    // is refused here with the explicit answer, and that is said, because the
    // uniform answer this deployment chose is not the one it gets.
    this.logDurabilityDegradation(
      'AuthManager: a sign-in for a locked account ran with no request state, so the lock '
        + 'refused it with 403 ACCOUNT_LOCKED instead of the wrong-password answer '
        + '`lockoutRefusal: \'uniform\'` gives (ADR-0069 D2). That answer tells the caller the '
        + 'account exists. Remedy: reach /sign-in/email through the better-auth handler or an '
        + '`auth.api` call, both of which open a request state.',
      new Error('no request state is open'),
      { object: 'sys_user', threshold },
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

/** How a `/sign-in/email` ended, as the after-hook judged it. */
export type SignInOutcome =
  /** A session was issued. */
  | 'succeeded'
  /** The password passed and a policy then refused the sign-in (`refusedAfterTheCredential`). */
  | 'refused-after-credential'
  /** Any other refusal: a wrong password above all. */
  | 'refused';

/** What settling one attempt hands the account events. */
export interface SignInSettlement {
  /**
   * The gate refused this attempt because the account's lock held. Its
   * `login_failed` row is already written ({@link admitSignInAttempt}).
   */
  readonly refusedByLock: boolean;
  /** The account the gate resolved for this attempt, when it resolved one. */
  readonly userId?: string;
  /** The lock this attempt stamped, when it was refused and stamped one. */
  readonly lockStamped?: SignInLockStamp;
}

/** The body of `AuthManager#settleSignInAttempt`; the method's docblock there is its contract. */
export async function settleSignInAttempt(
  this: Pick<SignInLockoutHost, 'config' | 'findSignInAccount' | 'getDataEngine' | 'logDurabilityDegradation'>,
  email: string,
  outcome: SignInOutcome,
): Promise<SignInSettlement> {
  const recorded = await readSignInAttempt();
  // A verdict recorded for another identifier belongs to another call.
  const attempt = recorded && recorded.identifier === email.toLowerCase() ? recorded : undefined;
  if (attempt?.verdict === 'locked') return { refusedByLock: true, userId: attempt.userId };
  const settled: SignInSettlement = { refusedByLock: false, ...(attempt ? { userId: attempt.userId } : {}) };
  const threshold = Number(this.config.lockoutThreshold) || 0;
  if (threshold <= 0) return settled;
  const engine = this.getDataEngine();
  if (!engine) return settled;

  if (outcome === 'refused') {
    // The failure was counted, and any lock stamped, when the attempt was admitted.
    return attempt?.lockStamped ? { ...settled, lockStamped: attempt.lockStamped } : settled;
  }

  if (outcome === 'succeeded') {
    try {
      const u = await this.findSignInAccount(engine, email, ['failed_login_count', 'locked_until']);
      if (u && ((Number(u.failed_login_count) || 0) !== 0 || u.locked_until)) await writeLockoutCleared(engine, u.id);
    } catch (e) {
      this.logDurabilityDegradation(
        'AuthManager: a successful sign-in did NOT clear the sign-in lockout counter — the user '
          + 'holds a valid session, so nothing looks wrong. `failed_login_count` keeps the failures '
          + 'before this sign-in, so fewer further failures than `lockoutThreshold` (ADR-0069 D2) '
          + 'now lock the account. Remedy: make the sys_user read and update land; the next '
          + 'successful sign-in clears it.',
        e,
        { object: 'sys_user', threshold, outcome },
      );
    }
    return settled;
  }

  // The password passed and a policy refused the sign-in: this attempt neither
  // counts nor clears, so the reservation it was admitted with is handed back.
  if (attempt) await releaseReservation.call(this, engine, attempt, threshold);
  return settled;
}

/**
 * Hand back one admitted attempt's reservation: the counter down by one, and
 * the lock that reservation stamped lifted while the count stays below the
 * threshold. A compare-and-set on the counter, for the reason
 * {@link reserveSignInAttempt} gives; a counter already at zero (a success or
 * an administrator's unlock came first) is left alone. Never throws.
 */
async function releaseReservation(
  this: Pick<SignInLockoutHost, 'logDurabilityDegradation'>,
  engine: IDataEngine,
  attempt: SignInAttempt,
  threshold: number,
): Promise<void> {
  try {
    for (let round = 0; round < RESERVATION_ROUNDS; round++) {
      const row = await readLockoutRow(engine, attempt.userId);
      if (!row) return;
      const current = Number(row.failed_login_count) || 0;
      if (current <= 0) return;
      const patch: Record<string, unknown> = { failed_login_count: current - 1 };
      if (
        attempt.lockStamped
        && current - 1 < threshold
        && sameInstant(row.locked_until, attempt.lockStamped.lockedUntil)
      ) {
        patch.locked_until = attempt.priorLockedUntil ?? null;
      }
      if (await writeCounterIfUnchanged(engine, attempt.userId, row.failed_login_count ?? null, patch)) return;
    }
  } catch (e) {
    this.logDurabilityDegradation(
      'AuthManager: a sign-in whose password passed and that a policy then refused did NOT hand '
        + 'back its lockout reservation — the refusal was answered normally, so nothing looks '
        + 'broken. `failed_login_count` keeps one failure this attempt did not earn, so the account '
        + 'locks one wrong password sooner than `lockoutThreshold` (ADR-0069 D2) says. Remedy: make '
        + 'the sys_user read and update land; a successful sign-in clears the counter.',
      e,
      { object: 'sys_user', threshold },
    );
  }
}

/** The body of `AuthManager#clearSignInLockout`; the method's docblock there is its contract. */
export async function clearSignInLockout(
  this: Pick<SignInLockoutHost, 'getDataEngine' | 'logDurabilityDegradation'>,
  userId: string,
): Promise<void> {
  const engine = this.getDataEngine();
  if (!engine || !userId) return;
  try {
    const row = await readLockoutRow(engine, userId);
    if (!row || ((Number(row.failed_login_count) || 0) === 0 && !row.locked_until)) return;
    await writeLockoutCleared(engine, userId);
  } catch (e) {
    // The new password is already written and the reset answers success.
    this.logDurabilityDegradation(
      'AuthManager: a completed password reset did NOT clear the sign-in lockout — the reset '
        + 'answered success and the new password is set, so nothing looks wrong. '
        + '`failed_login_count` / `locked_until` are untouched, so an account locked before the '
        + 'reset stays locked and refuses the new password until the lock runs out (ADR-0069 D2). '
        + 'Remedy: make the sys_user read and update land, or clear it with the Unlock action.',
      e,
      { object: 'sys_user', userId },
    );
  }
}

/** The body of `AuthManager#auditRefusedSignIn`; the method's docblock there is its contract. */
export async function auditRefusedSignIn(
  this: Pick<SignInLockoutHost, 'config' | 'resolveSignInAccountId'>,
  ctx: any,
  email: string,
  settlement: SignInSettlement,
): Promise<void> {
  const sink = this.config.getAuditSink?.();
  if (!sink) return;
  const lockStamped = settlement.lockStamped;
  const userId = lockStamped?.userId ?? settlement.userId ?? (await this.resolveSignInAccountId(email));
  if (!userId) return;
  const fingerprint = signInClientFingerprint(ctx, await readRequestClientAddress());
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
    // [#26638] In the RFC 5952 text the session row stores for the same
    // sign-in (`client-address-canonical.ts`). Cap to the column width (IPv6
    // textual max 45) — a malformed/oversized forwarded header must not blow
    // up the write.
    if (ip) patch.last_login_ip = canonicalClientAddress(ip).slice(0, 45);
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
