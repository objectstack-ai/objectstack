// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * better-auth 1.7's 2FA account lockout, end to end (#3624 follow-up).
 *
 * #3624 was found on the org-create path, but the same dependency bump added
 * `twoFactor.failedVerificationCount` / `lockedUntil` — the account-level
 * lockout budget better-auth guard-increments on every wrong code (NIST SP
 * 800-63B §5.2.2). `sys_two_factor` provisioned neither column and
 * `AUTH_TWO_FACTOR_SCHEMA` mapped neither, so the WRONG-CODE path wrote to
 * columns that did not exist: entering a bad 2FA code 500'd instead of being
 * counted, and the lockout never engaged. Nothing caught it because this path
 * had no test at all — the columns were added blind alongside the team fix.
 *
 * So this pins the behavior, not just the schema:
 *
 *  1. a wrong code is COUNTED (the counter advances in the database), and
 *  2. a correct code RESETS the count — so the budget tracks *consecutive*
 *     failures, which is the whole point of a lockout counter.
 *
 * ## Why the sign-in cookie, not a bearer token
 *
 * better-auth only runs the lockout bookkeeping when `isSignIn` is true —
 * i.e. when `/two-factor/verify-totp` is reached through the mid-sign-in
 * two-factor cookie, with NO active session. The same endpoint called with a
 * live session (the enrollment-confirmation path) deliberately skips
 * `assertTwoFactorNotLocked` / `recordTwoFactorFailure`. A bearer-token test
 * would therefore pass while the lockout path stayed completely unexercised —
 * exactly the blind spot that let the missing columns through. Hence the
 * cookie plumbing below: it is what makes this test test anything.
 *
 * ## Why it runs under an explicit operator policy (#3690)
 *
 * The budget used to be better-auth's own default (10 failures / 15 minutes),
 * asserted as a literal here. That made this file blind to #3690: the auth
 * manager passed no `accountLockout` at all, so the second factor ignored the
 * operator's `lockout_threshold` entirely — and a test pinned to the default
 * value could not tell "configured to 10" from "configuration ignored".
 *
 * So the stack is patched to a policy that is DIFFERENT from every default
 * below, and every assertion derives from it. If the wiring is ever dropped,
 * the counts and the lock duration snap back to better-auth's defaults and
 * these assertions fail — which is the point.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { assertArmed, authSettingArmed } from './armed.js';

const SYS = { context: { isSystem: true } };
const ADMIN_PASSWORD = 'admin123';

// [#3690] The operator policy this file runs under. Both values are chosen to
// differ from better-auth's defaults (10 attempts / 15 minutes) so an assertion
// cannot pass by accident if the settings stop reaching the plugin.
//
// 7 is also deliberately ABOVE the plugin's hardcoded per-challenge cap of 5
// (`beginAttempt(5)`, not reachable by any option), so spending the budget
// still has to cross a challenge boundary — the account-level counter is the
// one backed by the columns under test.
const LOCKOUT_THRESHOLD = 7;
const LOCKOUT_DURATION_MINUTES = 40;
/** better-auth's per-two-factor-cookie cap. Hardcoded upstream, not configurable. */
const MAX_PER_CHALLENGE = 5;

// ── RFC 6238 TOTP ──────────────────────────────────────────────────────────
// Hand-rolled rather than imported: `@better-auth/utils/otp` is a transitive
// dependency, and adding it as a direct one to generate six digits would tie
// this test to an internal package's resolution. better-auth's defaults are
// the RFC's (SHA-1, 6 digits, 30s), asserted by `enable`'s own otpauth:// URI.

function base32Decode(input: string): Buffer {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The 6-digit TOTP for `secret` at the current 30-second step. */
function totp(secret: Buffer): string {
  const counter = Math.floor(Date.now() / 30_000);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

/** Collect a response's Set-Cookie values into a single request Cookie header. */
function cookieHeader(res: Response): string {
  const jar = res.headers.getSetCookie?.() ?? [];
  return jar.map((c) => c.split(';')[0]).join('; ');
}

describe('#3624 follow-up: better-auth 2FA lockout counts wrong codes', () => {
  let stack: VerifyStack;
  let ql: any;
  let priorTwoFactor: string | undefined;
  let secret: Buffer;
  let adminEmail: string;
  let adminUserId: string;

  beforeAll(async () => {
    // The two-factor plugin is opt-in (`twoFactor: … ?? false`), resolved once
    // when the auth manager is constructed — so this must precede bootStack.
    priorTwoFactor = process.env.OS_AUTH_TWO_FACTOR;
    process.env.OS_AUTH_TWO_FACTOR = 'true';

    stack = await bootStack(showcaseStack, {});
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    // [#3690] Apply the operator policy the same way the settings service does
    // — `applyConfigPatch` nulls the cached better-auth instance, so the next
    // request rebuilds with the new `accountLockout`. Going through this seam
    // (rather than constructing the manager by hand) is what proves a Setup-UI
    // change actually reaches the second factor.
    const auth = await stack.kernel.getServiceAsync<any>('auth');
    auth.applyConfigPatch({
      lockoutThreshold: LOCKOUT_THRESHOLD,
      lockoutDurationMinutes: LOCKOUT_DURATION_MINUTES,
    });

    // [#8074] Read the policy back off the live manager. `lockoutThreshold: 0`
    // is the default and it disables lockout entirely (`recordFailedLogin`
    // returns early on `Number(threshold) || 0`), so a patch that silently did
    // not land would leave every "the account locks" assertion below measuring
    // an account that can never lock — green, and meaningless.
    await assertArmed([
      authSettingArmed({
        stack,
        setting: 'lockoutThreshold',
        armed: (v) => Number(v) === LOCKOUT_THRESHOLD,
        control: 'the #3690 account-lockout policy the second factor must honour',
        disarmedBy:
          '`lockoutThreshold` defaults to 0, which disables lockout outright — the counter ' +
          'never trips and no code path under test runs. Arm it through `applyConfigPatch`.',
      }),
      authSettingArmed({
        stack,
        setting: 'lockoutDurationMinutes',
        armed: (v) => Number(v) === LOCKOUT_DURATION_MINUTES,
        control: 'the lockout window this file asserts `locked_until` against',
        disarmedBy:
          'an unset duration makes the stamped window whatever the default is, so the ' +
          'assertion on `locked_until` would be measuring a number nobody chose.',
      }),
    ]);

    const token = await stack.signIn();
    const me = await (await stack.apiAs(token, 'GET', '/auth/get-session')).json() as any;
    adminEmail = me?.user?.email;
    adminUserId = String(me?.user?.id ?? '');
    expect(adminEmail, 'could not resolve the seeded admin email').toBeTruthy();
    expect(adminUserId, 'could not resolve the seeded admin id').toBeTruthy();

    // Enrol. `enable` returns the otpauth:// URI carrying the base32 secret;
    // the stored copy is symmetrically encrypted, so this is the only place
    // the plaintext is available.
    const enabled = await stack.apiAs(token, 'POST', '/auth/two-factor/enable', {
      password: ADMIN_PASSWORD,
    });
    expect(enabled.status, `two-factor/enable: ${await enabled.clone().text()}`).toBe(200);
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const uriSecret = new URL(totpURI.replace('otpauth://', 'https://')).searchParams.get('secret');
    expect(uriSecret, 'no secret in the otpauth URI').toBeTruthy();
    secret = base32Decode(uriSecret as string);

    // better-auth enrols with `verified: false`, and the sign-in path refuses
    // an unverified enrolment (TOTP_NOT_ENABLED) before it ever reaches the
    // lockout bookkeeping. Confirm it through the SESSION path first — this
    // call is `isSignIn: false`, so it deliberately touches no counter.
    const confirmed = await stack.apiAs(token, 'POST', '/auth/two-factor/verify-totp', {
      code: totp(secret),
    });
    expect(confirmed.status, `verify-totp (enrolment): ${await confirmed.clone().text()}`).toBe(200);
  }, 120_000);

  afterAll(async () => {
    if (priorTwoFactor === undefined) delete process.env.OS_AUTH_TWO_FACTOR;
    else process.env.OS_AUTH_TWO_FACTOR = priorTwoFactor;
    await stack?.stop?.();
  });

  /** The live lockout state better-auth keeps for the admin's enrolment. */
  async function lockoutState(): Promise<{ count: number; lockedUntil: unknown }> {
    const users = await ql.find('sys_user', { where: { email: adminEmail }, limit: 1 }, SYS);
    const rows = await ql.find(
      'sys_two_factor',
      { where: { user_id: String(users[0]?.id) }, limit: 1 },
      SYS,
    );
    const row = rows[0] ?? {};
    return { count: Number(row.failed_verification_count ?? 0), lockedUntil: row.locked_until ?? null };
  }

  /** Password sign-in that stops at the 2FA challenge; returns its cookie. */
  async function beginChallenge(): Promise<string> {
    const res = await stack.api('/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: ADMIN_PASSWORD }),
    });
    expect(res.status, `sign-in: ${await res.clone().text()}`).toBe(200);
    const body = (await res.json()) as { twoFactorRedirect?: boolean };
    expect(
      body.twoFactorRedirect,
      'sign-in did not stop at the 2FA challenge — the rest of this test would silently run on the session path',
    ).toBe(true);
    const cookie = cookieHeader(res);
    expect(cookie, 'sign-in returned no two-factor cookie').toBeTruthy();
    return cookie;
  }

  function verifyWithCookie(cookie: string, code: string): Promise<Response> {
    return stack.api('/auth/two-factor/verify-totp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ code }),
    });
  }

  it('counts each wrong code against the account budget', async () => {
    const before = await lockoutState();
    const cookie = await beginChallenge();

    const first = await verifyWithCookie(cookie, '000000');
    expect(first.status, 'a wrong code must be rejected, not accepted').toBeGreaterThanOrEqual(400);
    // The 500 this file exists for: before the columns were provisioned, the
    // guarded increment blew up on the way out instead of returning a clean
    // rejection.
    expect(first.status, `wrong code produced a server error: ${await first.clone().text()}`).toBeLessThan(500);

    const afterFirst = await lockoutState();
    expect(
      afterFirst.count,
      'failed_verification_count did not advance — the wrong code was never counted',
    ).toBe(before.count + 1);

    const second = await verifyWithCookie(cookie, '111111');
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(second.status).toBeLessThan(500);

    const afterSecond = await lockoutState();
    expect(afterSecond.count).toBe(before.count + 2);
  });

  it('resets the count when a correct code lands', async () => {
    // Carries the non-zero count left by the previous test — asserting the
    // reset from a clean 0 would prove nothing.
    const before = await lockoutState();
    expect(before.count, 'precondition: a non-zero failure count to clear').toBeGreaterThan(0);

    const cookie = await beginChallenge();
    const ok = await verifyWithCookie(cookie, totp(secret));
    expect(ok.status, `verify-totp (correct code): ${await ok.clone().text()}`).toBe(200);

    const after = await lockoutState();
    expect(
      after.count,
      'a successful verification must clear the budget — otherwise it counts non-consecutive failures and locks out a legitimate user',
    ).toBe(0);
    expect(after.lockedUntil ?? null).toBeNull();
  });

  it('locks the account once the operator-configured budget is spent, and refuses even a correct code', async () => {
    // Two budgets stack here, and the test has to respect both. better-auth
    // allows MAX_PER_CHALLENGE verifications per two-factor cookie
    // (hardcoded), and MAX_FAILURES consecutive failures per ACCOUNT
    // (`accountLockout.maxFailedAttempts`). Only the second one touches the
    // columns under test, so reaching it takes a fresh challenge every
    // MAX_PER_CHALLENGE tries.
    //
    // MAX_FAILURES is the operator's threshold, not better-auth's default —
    // #3690. Were the config dropped, the account would still be unlocked at
    // failure 7 and the assertion below would fail on a null `locked_until`.
    const MAX_FAILURES = LOCKOUT_THRESHOLD;

    expect((await lockoutState()).count, 'precondition: a clean budget').toBe(0);

    let failures = 0;
    while (failures < MAX_FAILURES) {
      const cookie = await beginChallenge();
      for (let i = 0; i < MAX_PER_CHALLENGE && failures < MAX_FAILURES; i++) {
        const res = await verifyWithCookie(cookie, '000000');
        expect(res.status, `wrong code #${failures + 1} produced a server error`).toBeLessThan(500);
        failures++;
        expect(
          (await lockoutState()).count,
          `the counter must advance on every failure (after #${failures})`,
        ).toBe(failures);
      }
    }

    const locked = await lockoutState();
    expect(
      locked.lockedUntil ?? null,
      `budget spent (${MAX_FAILURES} failures) but locked_until was never stamped`,
    ).not.toBeNull();

    // The lock lasts the operator's duration, not better-auth's 15 minutes.
    // `lockoutDurationMinutes` (minutes) is projected onto the plugin's
    // `durationSeconds` — the units differ on the two sides, so this is where a
    // ×60 that went missing would show up. The window is wide enough for the
    // several seconds of guessing above, and far too narrow to admit 15.
    const lockedForMs = new Date(String(locked.lockedUntil)).getTime() - Date.now();
    expect(lockedForMs).toBeGreaterThan((LOCKOUT_DURATION_MINUTES - 5) * 60_000);
    expect(lockedForMs).toBeLessThanOrEqual(LOCKOUT_DURATION_MINUTES * 60_000);

    // The lock has to bite BEFORE the code is checked — otherwise it is not a
    // lockout, just a slower guess loop.
    const cookie = await beginChallenge();
    const rejected = await verifyWithCookie(cookie, totp(secret));
    expect(
      rejected.status,
      `a locked account must refuse even a valid code: ${await rejected.clone().text()}`,
    ).toBe(429);
  });

  it('lazily clears an expired lock on the next attempt', async () => {
    const before = await lockoutState();
    expect(before.lockedUntil ?? null, 'precondition: carries the lock from the previous test').not.toBeNull();

    // Expire the lock rather than waiting out `durationSeconds`. This is the
    // one place the test reaches past the API: there is no endpoint that ages
    // a lock.
    const users = await ql.find('sys_user', { where: { email: adminEmail }, limit: 1 }, SYS);
    const rows = await ql.find('sys_two_factor', { where: { user_id: String(users[0]?.id) }, limit: 1 }, SYS);
    await ql.update(
      'sys_two_factor',
      { id: rows[0].id, locked_until: new Date(Date.now() - 60_000).toISOString() },
      SYS,
    );

    // better-auth clears an expired lock through a GUARDED incrementOne —
    // `where locked_until <= now`, `set { failedVerificationCount: 0,
    // lockedUntil: null }`. That is the only place the adapter has to handle
    // `lte` against a datetime, so this covers the operator as much as the
    // columns: a driver that mishandled it would leave the user locked out
    // forever with no error anywhere.
    const cookie = await beginChallenge();
    const ok = await verifyWithCookie(cookie, totp(secret));
    expect(ok.status, `expired lock was not cleared: ${await ok.clone().text()}`).toBe(200);

    const after = await lockoutState();
    expect(after.lockedUntil ?? null, 'the expired lock must be cleared, not merely ignored').toBeNull();
    expect(after.count, 'clearing an expired lock must reset the failure budget too').toBe(0);
  });

  // [#3690] The admin escape hatch. `Unlock Account` used to clear only
  // `sys_user`, so a user locked at the SECOND factor had no way out but to
  // wait out the duration — tolerable while that lock needed 10 failures, much
  // less so now that an operator can set the threshold to 3.
  it('the admin unlock action releases a second-factor lock', async () => {
    // A session that survives the lock. The one minted in beforeAll does not:
    // completing enrolment rotates the session, so that bearer is stale by now.
    // Take a fresh one through the full two-factor sign-in BEFORE re-locking —
    // afterwards there is no way to obtain one, which is exactly why the admin
    // escape hatch has to exist.
    const bootstrap = await verifyWithCookie(await beginChallenge(), totp(secret));
    expect(bootstrap.status, `sign-in for the admin session: ${await bootstrap.clone().text()}`).toBe(200);
    const adminSession = ((await bootstrap.json()) as { token?: string }).token;
    expect(adminSession, 'two-factor sign-in returned no session token').toBeTruthy();

    // Re-lock: the previous test cleared everything.
    let failures = 0;
    while (failures < LOCKOUT_THRESHOLD) {
      const cookie = await beginChallenge();
      for (let i = 0; i < MAX_PER_CHALLENGE && failures < LOCKOUT_THRESHOLD; i++) {
        await verifyWithCookie(cookie, '000000');
        failures++;
      }
    }
    const locked = await lockoutState();
    expect(locked.lockedUntil ?? null, 'precondition: the account is locked again').not.toBeNull();
    expect(locked.count).toBe(LOCKOUT_THRESHOLD);

    // The lock gates VERIFICATION, not live sessions — so an already-signed-in
    // admin can still act, which is what makes the escape hatch reachable.
    const unlocked = await stack.apiAs(adminSession as string, 'POST', '/auth/admin/unlock-user', {
      userId: adminUserId,
    });
    expect(unlocked.status, `unlock-user: ${await unlocked.clone().text()}`).toBe(200);

    const cleared = await lockoutState();
    expect(cleared.lockedUntil ?? null, 'unlock must clear the second factor, not just the password stage').toBeNull();
    expect(cleared.count, 'unlock must reset the failure budget too — otherwise the next wrong code re-locks immediately').toBe(0);

    // And the user can actually sign in again, which is the point of unlocking.
    const cookie = await beginChallenge();
    const ok = await verifyWithCookie(cookie, totp(secret));
    expect(ok.status, `still locked out after unlock: ${await ok.clone().text()}`).toBe(200);
  });
});
