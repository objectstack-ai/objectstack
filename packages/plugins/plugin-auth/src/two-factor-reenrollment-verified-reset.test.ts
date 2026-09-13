// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #10700 — a second `/two-factor/enable` on an already-confirmed account
// rewrote the TOTP secret on the account's one `sys_two_factor` row and
// INHERITED `verified` from the enrollment before it.
//
// The shape of the defect dictates the shape of these tests, twice over.
//
// ① `verified` is a FLAG, and a suite that asserts only the flag is the exact
//    mistake that produced the defect: the flag is not the control, it is the
//    INPUT to the control. Every pin below that names the flag is paired with
//    the question the runtime actually asks — what does the next sign-in
//    challenge accept? — and the pair is asserted in the same test.
//
// ② The endpoint answered 200 before the fix and answers 200 after it. So a
//    test asserting "enable still works", or "a totpURI came back", or "the
//    secret changed" would have been GREEN against the bug. Nothing here ends
//    at a status on `/two-factor/enable`.
//
// And because the fix is a REFUSAL, the still-works legs are load-bearing: an
// implementation that simply refused every `enable` would satisfy a
// one-directional suite while breaking every enrollment shipping today. Three
// legs here fail against such an implementation — a first enrollment completes
// end to end, a legitimate rotation completes end to end, and the backup codes
// the enable response issues still complete a sign-in.
//
// ## [#17440] What the better-auth 1.7.3 lift moved
//
// 1.7.3 added the same gate one layer up, in `dist/plugins/two-factor`:
// `/two-factor/enable` now throws `TOTP_ALREADY_ENABLED` when a two-factor row
// exists with `verified !== false`. So point ② above is no longer true of a
// CONFIRMED account — the endpoint refuses instead of answering 200 — and the
// inheritance defect cannot be reproduced through this route at all.
//
// Two consequences, both pinned below rather than assumed:
//
//   • the re-enrollment legs now assert the UPSTREAM refusal envelope, plus
//     the property behind it (nothing was rotated behind the refusal), and the
//     #10700 inertness assertion moves to the unconfirmed path, which is the
//     one upstream's gate still admits;
//   • ⭐ upstream's gate READS `verified` — the exact field #10700 was about —
//     so `two-factor-reenrollment-verified-reset.ts` is what keeps that gate's
//     input truthful. ⛔ It is not dead code superseded by the vendor.
//
// The rotation still-works leg moved with it: rotation now goes
// `/two-factor/disable` → `enable` → confirm.
//
// Real better-auth pipeline throughout, following
// `two-factor-rotated-token-echo.test.ts`: requests go in as `Request` objects
// through `AuthManager.handleRequest`, the secrets are the ones better-auth
// minted, and "who does this resolve to" is asked through
// `auth.api.getSession` — the same seam
// `runtime/src/security/resolve-session-principal.ts` calls.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { AuthManager } from './auth-manager';
// The SAME in-memory engine the #8243 and #10701 harnesses drive. A third fake
// would be a third looseness risk and a new `check:engine-double-contract`
// ledger entry, for no added fidelity.
import { createMemoryEngine } from './impersonation-bearer-rotation.test';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-10700';
const EMAIL = 'reenroller@example.com';
const BASE = 'http://localhost:3000/api/v1/auth';

// ── RFC 6238 TOTP ──────────────────────────────────────────────────────────
// Hand-rolled for the reason `two-factor-rotated-token-echo.test.ts` gives:
// `@better-auth/utils/otp` is a transitive dependency and taking a direct
// dependency on it to generate six digits would tie this suite to an internal
// package's resolution. better-auth's defaults are the RFC's (SHA-1, 6 digits,
// 30s).

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

const cookieHeader = (res: Response): string =>
  (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

const makeManager = (engine: any) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    plugins: { twoFactor: true },
  } as any);

const post = (
  manager: AuthManager,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  manager.handleRequest(
    new Request(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
    }),
  );

const userIdFor = (engine: any, email: string): string => {
  const row = ((engine.tables.get('sys_user') ?? []) as any[]).find((r) => r.email === email);
  if (!row) throw new Error(`no sys_user row for ${email}`);
  return String(row.id);
};

/** The account's one `sys_two_factor` row, straight out of the engine. */
const enrolmentRow = (engine: any, userId: string): any => {
  const rows = ((engine.tables.get('sys_two_factor') ?? []) as any[]).filter(
    (r) => String(r.user_id) === userId,
  );
  // `sys_two_factor` declares `user_id` unique. If that ever stops holding,
  // every "the stored secret" assertion below is reading an arbitrary row, so
  // it is checked rather than assumed.
  expect(rows.length, 'sys_two_factor is meant to hold exactly one row per user').toBe(1);
  return rows[0];
};

/**
 * Assert `verified` at BOTH spellings that matter, because they are not the
 * same value and only one of them decides anything.
 *
 * better-auth's challenge gate compares STRICTLY against `false`
 * (`totp/index.mjs`, and the post-sign-in hook that populates
 * `twoFactorMethods`). What it compares is the value its own adapter hands
 * back — and this repo's adapter declares `supportsBooleans: false`
 * (`objectql-adapter.ts`), so better-auth stores the column as 0/1 and
 * converts it back to a boolean on read. Measured, not assumed: reading the
 * engine table directly returns `0` where the gate sees `false`.
 *
 * So the load-bearing assertion is the adapter-side one; the column-side one
 * is pinned beside it so a driver change that started handing the raw integer
 * to a strict `=== false` could not slip through green.
 */
const expectVerified = async (
  manager: AuthManager,
  engine: any,
  userId: string,
  expected: boolean,
  why: string,
): Promise<void> => {
  const auth: any = await manager.getAuthInstance();
  const context = await auth.$context;
  const asTheGateSeesIt = await context.adapter.findOne({
    model: 'twoFactor',
    where: [{ field: 'userId', value: userId }],
  });
  expect(asTheGateSeesIt, 'better-auth cannot read back the enrolment row').toBeTruthy();
  expect(asTheGateSeesIt.verified, why).toBe(expected);
  expect(enrolmentRow(engine, userId).verified, `${why} (stored column)`).toBe(expected ? 1 : 0);
};

const principalFor = async (
  manager: AuthManager,
  headers: Record<string, string>,
): Promise<string | null> => {
  const auth: any = await manager.getAuthInstance();
  const session = await auth.api.getSession({ headers: new Headers(headers) }).catch(() => null);
  const id = session?.user?.id ?? session?.session?.userId;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

/** The base32 secret better-auth just handed out, decoded. */
const secretFromEnableResponse = async (res: Response): Promise<Buffer> => {
  const { totpURI } = (await res.clone().json()) as { totpURI: string };
  const uriSecret = new URL(totpURI.replace('otpauth://', 'https://')).searchParams.get('secret');
  expect(uriSecret, 'no secret in the otpauth URI').toBeTruthy();
  return base32Decode(String(uriSecret));
};

/**
 * A password sign-in that stops at the 2FA challenge.
 *
 * Returns the challenge cookie AND the methods the challenge offered — the
 * second is half the answer to "what does the challenge accept", and it is
 * derived from the same flag on the same row.
 */
const beginChallenge = async (manager: AuthManager) => {
  const res = await post(manager, '/sign-in/email', { email: EMAIL, password: PASSWORD });
  expect(res.status, `sign-in: ${await res.clone().text()}`).toBe(200);
  const body = (await res.clone().json()) as { twoFactorRedirect?: boolean; twoFactorMethods?: string[] };
  expect(
    body.twoFactorRedirect,
    'sign-in did not stop at the 2FA challenge — every assertion after this would be measuring the session lane',
  ).toBe(true);
  const cookie = cookieHeader(res);
  expect(cookie, 'sign-in returned no two-factor cookie').toBeTruthy();
  return { cookie, methods: body.twoFactorMethods ?? [] };
};

/** ADR-0112: a refusal is a `code` AND a `status`, never a status alone. */
const refusal = async (res: Response): Promise<{ status: number; code: unknown }> => {
  const body = await res.clone().json().catch(() => ({}) as any);
  return { status: res.status, code: (body as any)?.code ?? (body as any)?.error?.code };
};

/**
 * A brand-new account that has completed a FIRST enrollment end to end, and
 * whose confirmed secret is proven to complete a sign-in challenge.
 *
 * Both halves are load-bearing. The completion is the still-works leg for
 * first-time enrollment; the proven challenge is the positive control without
 * which "the challenge refuses the re-enrolled secret" could not be told apart
 * from "this harness never completes a challenge at all".
 */
const arrangeConfirmedEnrolment = async () => {
  const engine = createMemoryEngine();
  const manager = makeManager(engine);

  const signedUp = await post(manager, '/sign-up/email', {
    email: EMAIL,
    password: PASSWORD,
    name: 'Re-enrolling User',
  });
  expect(signedUp.status, `sign-up: ${await signedUp.clone().text()}`).toBe(200);
  const userId = userIdFor(engine, EMAIL);

  const enabled = await post(
    manager,
    '/two-factor/enable',
    { password: PASSWORD },
    { cookie: cookieHeader(signedUp) },
  );
  expect(enabled.status, `two-factor/enable (first): ${await enabled.clone().text()}`).toBe(200);
  const firstSecret = await secretFromEnableResponse(enabled);

  // A first enrollment is INERT until confirmed — better-auth's own posture,
  // and the behaviour re-enrollment was skipping.
  await expectVerified(manager, engine, userId, false, 'a fresh enrollment must not read as confirmed');

  const confirmed = await post(
    manager,
    '/two-factor/verify-totp',
    { code: totp(firstSecret) },
    { cookie: cookieHeader(signedUp) },
  );
  expect(confirmed.status, `verify-totp (first enrolment): ${await confirmed.clone().text()}`).toBe(200);
  await expectVerified(manager, engine, userId, true, 'confirming must flip the flag');

  // verify-totp rotates the session on the first-enrolment lane (#10701), so
  // the live cookie is the one IT installed, not the sign-up one.
  const sessionCookie = cookieHeader(confirmed);
  expect(sessionCookie, 'verify-totp installed no session cookie').toContain('session_token=');
  expect(await principalFor(manager, { cookie: sessionCookie })).toBe(userId);

  return { engine, manager, userId, firstSecret, sessionCookie };
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// ───────────────────────────────────────────────────────────────────────────
describe('#10700 — first enrollment still completes (the still-works floor)', () => {
  it('enable → confirm → the challenge accepts the confirmed secret and signs the user in', async () => {
    const { manager, userId, firstSecret } = await arrangeConfirmedEnrolment();

    const { cookie, methods } = await beginChallenge(manager);
    expect(methods, 'the challenge must offer totp for a confirmed enrollment').toContain('totp');

    const completed = await post(manager, '/two-factor/verify-totp', { code: totp(firstSecret) }, { cookie });
    expect(completed.status, `verify-totp (challenge): ${await completed.clone().text()}`).toBe(200);
    // Ends at the principal, not at the status: a 200 that installs nobody's
    // session is exactly what a broken challenge looks like.
    expect(await principalFor(manager, { cookie: cookieHeader(completed) })).toBe(userId);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#10700 — the inheritance path is now REFUSED at the route (better-auth 1.7.3)', () => {
  /**
   * [#17440] What changed under the family lift, and why this is a stronger
   * pin rather than a weaker one.
   *
   * better-auth 1.7.3 added the gate #10700 was about, one layer above ours
   * (`dist/plugins/two-factor/index.mjs`):
   *
   *   if (existingTwoFactor && existingTwoFactor.verified !== false)
   *     throw APIError.from("BAD_REQUEST", TOTP_ALREADY_ENABLED);
   *
   * So a second `/two-factor/enable` on a CONFIRMED account no longer reaches
   * the handler that rewrote the secret — the inheritance defect cannot be
   * reproduced through this route at all. 1.7.2 had no such code
   * (`TOTP_ALREADY_ENABLED` appears in 0 files there and 5 in 1.7.3, measured
   * against a control code present in both).
   *
   * ⭐ That gate READS `verified`, which is precisely the field #10700 was
   * about. Our data-layer reset (`two-factor-reenrollment-verified-reset.ts`)
   * is therefore not dead code superseded by upstream — it is what keeps the
   * input to upstream's new gate truthful. ⛔ Do not delete it as unreachable.
   */
  it('a re-enroll on a confirmed account is refused, and nothing is rotated behind the refusal', async () => {
    const { engine, manager, userId, firstSecret, sessionCookie } = await arrangeConfirmedEnrolment();

    const reenrolled = await post(
      manager,
      '/two-factor/enable',
      { password: PASSWORD },
      { cookie: sessionCookie },
    );
    // ADR-0112: code AND status, never a status alone.
    expect(await refusal(reenrolled)).toEqual({ status: 400, code: 'TOTP_ALREADY_ENABLED' });

    // The refusal is not a partial write: the flag still describes the stored
    // secret, and the stored secret is still the confirmed one.
    await expectVerified(manager, engine, userId, true, 'a refused re-enroll must not clear the flag');

    const { cookie, methods } = await beginChallenge(manager);
    expect(methods, 'the confirmed factor is still offered').toContain('totp');
    const completed = await post(manager, '/two-factor/verify-totp', { code: totp(firstSecret) }, { cookie });
    expect(completed.status, `verify-totp (original secret after a refused re-enroll): ${await completed.clone().text()}`).toBe(200);
    expect(
      await principalFor(manager, { cookie: cookieHeader(completed) }),
      'the original confirmed secret still signs the user in',
    ).toBe(userId);
  });

  /**
   * The complement, and the reason the refusal above is a gate rather than a
   * blanket ban: an UNCONFIRMED enrollment is still re-enrollable
   * (`verified !== false` is the condition), and on that path the #10700
   * property is asserted exactly as before — a secret nobody confirmed is
   * inert at the challenge.
   */
  it('an UNCONFIRMED enrollment can still be re-enrolled, and the new secret stays inert', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);

    const signedUp = await post(manager, '/sign-up/email', {
      email: EMAIL,
      password: PASSWORD,
      name: 'Re-enrolling User',
    });
    expect(signedUp.status, `sign-up: ${await signedUp.clone().text()}`).toBe(200);
    const userId = userIdFor(engine, EMAIL);

    const first = await post(manager, '/two-factor/enable', { password: PASSWORD }, { cookie: cookieHeader(signedUp) });
    expect(first.status, `two-factor/enable (first): ${await first.clone().text()}`).toBe(200);
    const firstSecret = await secretFromEnableResponse(first);
    await expectVerified(manager, engine, userId, false, 'a fresh enrollment must not read as confirmed');

    // Allowed: `verified === false`, so upstream's gate does not fire.
    const second = await post(manager, '/two-factor/enable', { password: PASSWORD }, { cookie: cookieHeader(signedUp) });
    expect(second.status, `two-factor/enable (re-enroll, unconfirmed): ${await second.clone().text()}`).toBe(200);
    const secondSecret = await secretFromEnableResponse(second);
    expect(
      secondSecret.equals(firstSecret),
      'the premise: re-enrolling hands out a DIFFERENT secret',
    ).toBe(false);

    await expectVerified(manager, engine, userId, false, 'and it still reads as unconfirmed');

    // What the RUNTIME does with it — the half the flag alone cannot show.
    // An unconfirmed factor gates nothing, so a sign-in does not stop at a
    // challenge at all: there is no live factor to challenge with.
    const signedIn = await post(manager, '/sign-in/email', { email: EMAIL, password: PASSWORD });
    expect(signedIn.status, `sign-in: ${await signedIn.clone().text()}`).toBe(200);
    const body = (await signedIn.clone().json()) as { twoFactorRedirect?: boolean };
    expect(
      body.twoFactorRedirect,
      'an unconfirmed factor must not gate sign-in — it is inert, not half-live',
    ).not.toBe(true);

    // And the re-enrollment really REPLACED the stored secret rather than
    // adding a second live one — the half a flag assertion cannot show. The
    // superseded secret no longer confirms; the current one does.
    const sessionForConfirm = cookieHeader(signedIn);
    const withOldSecret = await post(
      manager,
      '/two-factor/verify-totp',
      { code: totp(firstSecret) },
      { cookie: sessionForConfirm },
    );
    expect(await refusal(withOldSecret)).toEqual({ status: 401, code: 'INVALID_CODE' });
    await expectVerified(manager, engine, userId, false, 'a refused confirmation must not flip the flag');

    const withNewSecret = await post(
      manager,
      '/two-factor/verify-totp',
      { code: totp(secondSecret) },
      { cookie: sessionForConfirm },
    );
    expect(withNewSecret.status, `verify-totp (current secret): ${await withNewSecret.clone().text()}`).toBe(200);
    await expectVerified(manager, engine, userId, true, 'the CURRENT secret is the one that confirms');
  });
});

// ───────────────────────────────────────────────────────────────────────────
/**
 * The still-works floor for ROTATION. [#17440] Rotation now goes through
 * `/two-factor/disable` first, because 1.7.3 refuses `enable` on a confirmed
 * factor — so this leg moved rather than disappeared. It stays load-bearing
 * for the same reason it always was: an implementation that simply refused
 * every re-enrollment would satisfy the refusal pins above while breaking
 * every legitimate secret rotation.
 */
describe('#10700 — a legitimate rotation still completes, end to end', () => {
  it('disable → enable → confirm makes the NEW secret live and the old one dead', async () => {
    const { engine, manager, userId, firstSecret, sessionCookie } = await arrangeConfirmedEnrolment();

    const disabled = await post(manager, '/two-factor/disable', { password: PASSWORD }, { cookie: sessionCookie });
    expect(disabled.status, `two-factor/disable: ${await disabled.clone().text()}`).toBe(200);

    // `disable` ends the session it was called with (better-auth deletes it on
    // the way out), so the rotation continues under the cookie IT installed —
    // reusing the stale one answers 401 and would read as "rotation is broken".
    const rotatingCookie = cookieHeader(disabled) || sessionCookie;
    expect(rotatingCookie, 'disable installed no usable session cookie').toContain('session_token=');

    const reenrolled = await post(manager, '/two-factor/enable', { password: PASSWORD }, { cookie: rotatingCookie });
    expect(reenrolled.status, `two-factor/enable (after disable): ${await reenrolled.clone().text()}`).toBe(200);
    const secondSecret = await secretFromEnableResponse(reenrolled);
    expect(secondSecret.equals(firstSecret), 'rotation hands out a DIFFERENT secret').toBe(false);

    // The backup codes this response issues are the recovery floor — the same
    // floor the old re-enrollment window pinned, on the path that still exists.
    const { backupCodes } = (await reenrolled.clone().json()) as { backupCodes: string[] };
    expect(Array.isArray(backupCodes) && backupCodes.length > 0, 'rotation must issue backup codes').toBe(true);

    const confirmed = await post(manager, '/two-factor/verify-totp', { code: totp(secondSecret) }, { cookie: rotatingCookie });
    expect(confirmed.status, `verify-totp (rotation confirmation): ${await confirmed.clone().text()}`).toBe(200);
    await expectVerified(manager, engine, userId, true, 'confirming a rotation must flip the flag back');

    const { cookie, methods } = await beginChallenge(manager);
    expect(methods).toContain('totp');
    const completed = await post(manager, '/two-factor/verify-totp', { code: totp(secondSecret) }, { cookie });
    expect(completed.status, `verify-totp (challenge, rotated secret): ${await completed.clone().text()}`).toBe(200);
    expect(await principalFor(manager, { cookie: cookieHeader(completed) })).toBe(userId);

    // And the rotation is real: the superseded secret is not a second live
    // credential. Without this, "the rotation works" would be satisfiable by
    // an implementation that never rotated anything.
    const stale = await beginChallenge(manager);
    const withOldSecret = await post(manager, '/two-factor/verify-totp', { code: totp(firstSecret) }, { cookie: stale.cookie });
    expect(await refusal(withOldSecret)).toEqual({ status: 401, code: 'INVALID_CODE' });
    expect(await principalFor(manager, { cookie: cookieHeader(withOldSecret) })).toBeNull();

    // The recovery floor, driven: the codes THIS rotation handed over complete
    // a sign-in.
    const recovery = await beginChallenge(manager);
    const rescued = await post(manager, '/two-factor/verify-backup-code', { code: backupCodes[0] }, { cookie: recovery.cookie });
    expect(rescued.status, `verify-backup-code: ${await rescued.clone().text()}`).toBe(200);
    expect(
      await principalFor(manager, { cookie: cookieHeader(rescued) }),
      'the backup code issued by the rotation must sign the user in',
    ).toBe(userId);
  });
});
