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
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYS = { context: { isSystem: true } };
const ADMIN_PASSWORD = 'admin123';

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

  beforeAll(async () => {
    // The two-factor plugin is opt-in (`twoFactor: … ?? false`), resolved once
    // when the auth manager is constructed — so this must precede bootStack.
    priorTwoFactor = process.env.OS_AUTH_TWO_FACTOR;
    process.env.OS_AUTH_TWO_FACTOR = 'true';

    stack = await bootStack(showcaseStack, {});
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    const token = await stack.signIn();
    const me = await (await stack.apiAs(token, 'GET', '/auth/get-session')).json() as any;
    adminEmail = me?.user?.email;
    expect(adminEmail, 'could not resolve the seeded admin email').toBeTruthy();

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
});
