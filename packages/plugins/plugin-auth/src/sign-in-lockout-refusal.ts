// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 D2 — a locked account answers a password sign-in exactly as a wrong
 * password does, and the lock gate's verdict reaches the hooks that settle it.
 *
 * ## The rule
 *
 * A `/sign-in/email` for an account whose lock holds is refused, the correct
 * password included, and the refusal is the one a wrong password gets: the
 * same status, the same body and the same work done before answering. Only an
 * account that exists can be locked, so any answer that differs — a code of its
 * own, an answer sooner than a password check takes — tells the caller the
 * account exists. A deployment that wants the explicit `403 ACCOUNT_LOCKED`
 * opts in with `lockoutRefusal: 'explicit'` (`AuthManagerOptions`), and is then
 * told what it chose to tell.
 *
 * ## How the refusal is made
 *
 * Not by answering from the gate. The gate (the global before-hook, before
 * better-auth runs) only records its verdict; the endpoint then runs exactly as
 * it runs for any account, and its own credential check is what refuses: the
 * password verifier better-auth is handed ({@link withLockoutRefusal}) runs the
 * real verification and then answers "no match" while the current request's
 * verdict is `locked`. So every answer the endpoint gives for a locked account
 * — its input refusals, its lookup, the one verification, the refusal itself —
 * is the answer it gives an unlocked account for the same request, because it
 * is the same code. Nothing here mirrors the vendor's order of checks, so
 * nothing here drifts from it.
 *
 * ## The carrier
 *
 * A {@link defineRequestState} slot, for the reason `request-client-address.ts`
 * gives: better-auth runs every endpoint call — the router's and an
 * `auth.api.*` call alike — inside a request state (`toAuthEndpoints` opens one
 * when none is open), and it is the one per-request store `auth-manager.ts`
 * polyfills on WebContainer. The same slot hands the after-hook the attempt the
 * gate admitted, so the counter is settled against the reservation the gate
 * made (`auth-manager-sign-in-lockout.ts`), and a locked refusal is neither
 * counted twice nor cleared.
 */

import { defineRequestState } from '@better-auth/core/context';

/** The lock one attempt's reservation stamped: the account, the expiry and the threshold. */
export interface SignInLockStamp {
  readonly userId: string;
  readonly lockedUntil: Date;
  readonly threshold: number;
}

/**
 * What the lock gate decided for one `/sign-in/email` attempt.
 *
 * Every attempt on an account is stamped as a failure before its credential is
 * checked (`auth-manager-sign-in-lockout.ts`, `admitSignInAttempt`): the
 * counter moves from {@link priorCount} to {@link reservedCount} in one
 * compare-and-set write, which is what keeps concurrent attempts from all
 * passing a gate that has not yet seen each other's failures.
 */
export interface SignInAttempt {
  /**
   * The lower-cased identifier the attempt carried, held in memory for the
   * request only so the after-hook settles the verdict of its own call; never
   * recorded.
   */
  readonly identifier: string;
  /** The account the sign-in names (the credential check's own resolution). */
  readonly userId: string;
  /**
   * `locked` — the account's lock held when the attempt arrived: it is refused
   * whatever the password. `admitted` — the credential check decides.
   */
  readonly verdict: 'locked' | 'admitted';
  /** `failed_login_count` exactly as read before this attempt's reservation. */
  readonly priorCount: unknown;
  /** The counter value this attempt's reservation wrote. */
  readonly reservedCount: number;
  /** `locked_until` exactly as read before this attempt's reservation. */
  readonly priorLockedUntil: unknown;
  /** The lock this attempt's reservation stamped, when it reached the threshold. */
  readonly lockStamped?: SignInLockStamp;
}

const signInAttemptState = defineRequestState<SignInAttempt | undefined>(() => undefined);

/**
 * Record the gate's verdict for the request that is running (`undefined`: this
 * attempt has none, whatever an earlier call recorded). `false` when no request
 * state is open, which the gate treats as "the verifier cannot carry the
 * refusal" and refuses by itself instead.
 */
export async function recordSignInAttempt(attempt: SignInAttempt | undefined): Promise<boolean> {
  try {
    await signInAttemptState.set(attempt);
    return true;
  } catch {
    return false;
  }
}

/** The verdict the gate recorded for the request that is running, if any. Never throws. */
export async function readSignInAttempt(): Promise<SignInAttempt | undefined> {
  try {
    return await signInAttemptState.get();
  } catch {
    return undefined;
  }
}

/** better-auth's `emailAndPassword.password` pair. */
export interface PasswordHasher {
  hash: (password: string) => Promise<string>;
  verify: (args: { hash: string; password: string }) => Promise<boolean>;
}

/**
 * The password pair handed to better-auth: `hasher` (the WebContainer one, see
 * `auth-manager-password-hasher.ts`) or better-auth's own defaults when there is
 * none, with one change. `verify` always runs the real verification, and then
 * answers `false` while the current request carries a `locked` verdict, so the
 * endpoint refuses a locked account by its own wrong-password path. Outside
 * such a request it answers exactly what the underlying verifier answers.
 */
export async function withLockoutRefusal(hasher: PasswordHasher | undefined): Promise<PasswordHasher> {
  const base: PasswordHasher = hasher ?? await (async () => {
    const { hashPassword, verifyPassword } = await import('better-auth/crypto');
    return { hash: hashPassword, verify: verifyPassword };
  })();
  return {
    hash: (password) => base.hash(password),
    verify: async (args) => {
      // The verification runs first and in full, whatever the verdict: the
      // refusal costs what a wrong password costs.
      const verified = await base.verify(args);
      if (!verified) return false;
      return (await readSignInAttempt())?.verdict !== 'locked';
    },
  };
}
