// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #10701 — `/two-factor/verify-totp` echoed a session token it had just
// DELETED, and presenting that token destroyed the caller's valid cookie.
//
// The shape of the defect dictates the shape of these tests. The endpoint
// answered 200, rotated the session cookie correctly, and emitted a correct
// `set-auth-token` — all of it right — and then echoed the PRE-rotation token
// in the JSON body. So a test asserting "verify-totp returns 200", or "a
// `token` came back", or "the response set a session cookie" would have been
// GREEN against the bug.
//
// Every assertion below therefore ends at the same question the runtime asks:
// WHICH PRINCIPAL does the next request resolve to, when the client presents
// the credential this response handed it? And the three cases from the card
// are measured side by side in ONE arrangement, because the finding is not
// "the bearer is useless" — it is that a useless bearer DESTROYS an otherwise
// valid cookie session.
//
// Real better-auth pipeline throughout (the precedent set by
// `impersonation-bearer-rotation.test.ts`): requests go in as `Request`
// objects through `AuthManager.handleRequest`, the tokens are the ones
// better-auth minted, and the resolution path is the real one. Where a test
// wants the seam the data routes actually use, it asks
// `auth.api.getSession({ headers })` — literally what
// `runtime/src/security/resolve-session-principal.ts` calls.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { AuthManager } from './auth-manager';
// The SAME in-memory engine the #8243 harness drives, deliberately: a second
// fake would be a second looseness risk and a new `check:engine-double-contract`
// ledger entry, for no added fidelity.
import { createMemoryEngine } from './impersonation-bearer-rotation.test';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-10701';
const BASE = 'http://localhost:3000/api/v1/auth';

// ── RFC 6238 TOTP ──────────────────────────────────────────────────────────
// Hand-rolled rather than imported, for the reason the #3624 dogfood harness
// gives: `@better-auth/utils/otp` is a transitive dependency, and taking a
// direct dependency on it to generate six digits would tie this suite to an
// internal package's resolution. better-auth's defaults are the RFC's
// (SHA-1, 6 digits, 30s), asserted by `enable`'s own otpauth:// URI below.

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
const cookieHeader = (res: Response): string =>
  (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

const makeManager = (engine: any) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    plugins: { twoFactor: true },
  } as any);

const post = (manager: AuthManager, path: string, body: unknown, headers: Record<string, string> = {}) =>
  manager.handleRequest(
    new Request(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
    }),
  );

const sessionRows = (engine: any) => (engine.tables.get('sys_session') ?? []) as any[];
const userIdFor = (engine: any, email: string): string => {
  const row = ((engine.tables.get('sys_user') ?? []) as any[]).find((r) => r.email === email);
  if (!row) throw new Error(`no sys_user row for ${email}`);
  return String(row.id);
};

/**
 * WHO does this set of request headers resolve to, asked through the exact
 * seam the framework's data routes use.
 *
 * `null` for anonymous. Never a status code — better-auth answers a dead
 * session with a 200 and a JSON `null`, so a status assertion is blind here.
 * That is precisely how this defect read in the field: `get-session` came back
 * 200 and EMPTY.
 */
const principalFor = async (
  manager: AuthManager,
  headers: Record<string, string>,
): Promise<string | null> => {
  const auth: any = await manager.getAuthInstance();
  const session = await auth.api.getSession({ headers: new Headers(headers) }).catch(() => null);
  const id = session?.user?.id ?? session?.session?.userId;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

/**
 * A real protected 2FA route, driven with the given credentials. `get-session`
 * alone is not enough evidence: it answers 200 for anonymous. This is the
 * route the card names, and it is the one that tells 200 from 401.
 */
const getTotpUri = (manager: AuthManager, headers: Record<string, string>) =>
  post(manager, '/two-factor/get-totp-uri', { password: PASSWORD }, headers);

const EMAIL = 'enroller@example.com';

/**
 * A signed-in user who has just completed TOTP ENROLMENT — the lane the QA run
 * surfaced, and the lane on which the vendor rotates the session mid-request.
 *
 * Returns everything the three cases need: the token the response echoed, the
 * cookie it installed, and the token the caller was holding BEFORE enrolment
 * (the value that used to be echoed, kept so the pins can name it exactly).
 */
const arrangeCompletedEnrolment = async () => {
  const engine = createMemoryEngine();
  const manager = makeManager(engine);

  const signedUp = await post(manager, '/sign-up/email', {
    email: EMAIL,
    password: PASSWORD,
    name: 'Enrolling User',
  });
  expect(signedUp.status).toBe(200);
  const preEnrolmentCookie = cookieHeader(signedUp);
  const preEnrolmentToken = String(((await signedUp.json()) as any).token);
  const userId = userIdFor(engine, EMAIL);

  // The premise: before enrolling, the echoed token IS an accepted bearer.
  // Without this, a green suite could never tell "we fixed the echo" from
  // "the bearer seam never worked here".
  expect(await principalFor(manager, { authorization: `Bearer ${preEnrolmentToken}` })).toBe(userId);

  const enabled = await post(manager, '/two-factor/enable', { password: PASSWORD }, { cookie: preEnrolmentCookie });
  expect(enabled.status, `two-factor/enable: ${await enabled.clone().text()}`).toBe(200);
  const { totpURI } = (await enabled.json()) as { totpURI: string };
  const uriSecret = new URL(totpURI.replace('otpauth://', 'https://')).searchParams.get('secret');
  expect(uriSecret, 'no secret in the otpauth URI').toBeTruthy();
  const secret = base32Decode(String(uriSecret));

  const verified = await post(manager, '/two-factor/verify-totp', { code: totp(secret) }, { cookie: preEnrolmentCookie });
  expect(verified.status, `verify-totp (enrolment): ${await verified.clone().text()}`).toBe(200);

  const echoedToken = String(((await verified.clone().json()) as any).token);
  const rotatedCookie = cookieHeader(verified);
  expect(rotatedCookie, 'verify-totp installed no session cookie').toContain('session_token=');

  return { engine, manager, userId, secret, preEnrolmentToken, echoedToken, rotatedCookie };
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// ───────────────────────────────────────────────────────────────────────────
describe('#10701 — the three cases from the card, one arrangement', () => {
  it('the echoed token, the cookie, and the two together all resolve to the user', async () => {
    const { manager, userId, echoedToken, rotatedCookie } = await arrangeCompletedEnrolment();

    const bearerOnly = { authorization: `Bearer ${echoedToken}` };
    const cookieOnly = { cookie: rotatedCookie };
    const both = { ...cookieOnly, ...bearerOnly };

    // ① the client can keep authenticating with what the response handed it.
    //    Against the unfixed route this was `null`.
    expect(await principalFor(manager, bearerOnly)).toBe(userId);

    // ② the arm that was already right stays right.
    expect(await principalFor(manager, cookieOnly)).toBe(userId);

    // ⭐ THE POINT OF THE CARD. Against the unfixed route this was `null`: the
    //    dead bearer overwrote a perfectly valid cookie and dropped the
    //    request to anonymous. A fix that only made the bearer work in
    //    isolation would not be enough — real clients send both.
    expect(await principalFor(manager, both)).toBe(userId);
  }, 60_000);

  it('the same three cases on a real protected route, not just `get-session`', async () => {
    // `get-session` answers 200 for anonymous, so status codes there prove
    // nothing. `get-totp-uri` is the route the card names, and against the
    // unfixed endpoint it answered 401 for both bearer cases.
    const { manager, echoedToken, rotatedCookie } = await arrangeCompletedEnrolment();

    expect((await getTotpUri(manager, { authorization: `Bearer ${echoedToken}` })).status).toBe(200);
    expect((await getTotpUri(manager, { cookie: rotatedCookie })).status).toBe(200);
    expect(
      (await getTotpUri(manager, { cookie: rotatedCookie, authorization: `Bearer ${echoedToken}` })).status,
    ).toBe(200);
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
describe('#10701 — the echoed token is the LIVE session, named exactly', () => {
  it('it is the rotated session row, and not the deleted pre-enrolment one', async () => {
    // Corroborates the resolution assertions at the storage layer, and pins
    // the exact wrong value: asserting only "the echo changed" would be
    // satisfied by echoing any other string.
    const { engine, userId, preEnrolmentToken, echoedToken } = await arrangeCompletedEnrolment();

    const live = sessionRows(engine).filter((r) => String(r.userId ?? r.user_id) === userId);
    expect(live.map((r) => String(r.token))).toContain(echoedToken);

    expect(echoedToken).not.toBe(preEnrolmentToken);
    expect(sessionRows(engine).map((r) => String(r.token))).not.toContain(preEnrolmentToken);
  }, 60_000);

  it('it matches the session the response installed in its own cookie', async () => {
    // The credential is READ BACK out of the response rather than minted, so
    // this equality is the whole safety argument: the fix cannot hand a caller
    // a session the request did not already grant it.
    const { echoedToken, rotatedCookie } = await arrangeCompletedEnrolment();

    const cookieValue = /session_token=([^;]+)/.exec(rotatedCookie)?.[1];
    expect(cookieValue, 'no session cookie to compare against').toBeTruthy();
    expect(decodeURIComponent(String(cookieValue)).split('.')[0]).toBe(echoedToken);
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
describe('#10701 — nothing was loosened', () => {
  // Direction (b) from the card — the resolver falling back to the cookie when
  // the bearer is unusable — was ruled OUT of scope precisely because it stops
  // an invalid credential from failing loud. These two pins are what would go
  // red if someone later implemented it, so they are the guard on that ruling,
  // not decoration.

  it('anonymous is still refused', async () => {
    // Pinning only the success direction goes green on a loosened
    // implementation that authenticates everybody.
    const { manager } = await arrangeCompletedEnrolment();

    expect(await principalFor(manager, {})).toBeNull();
    expect((await getTotpUri(manager, {})).status).toBe(401);
  }, 60_000);

  it('a bogus bearer still overrides a valid cookie and still fails loud', async () => {
    // Bearer-over-cookie precedence is better-auth's, and this card does NOT
    // change it. An invalid credential must keep failing closed even when the
    // request also carries a good cookie.
    const { manager, userId, rotatedCookie } = await arrangeCompletedEnrolment();

    const bogus = { authorization: 'Bearer not-a-real-session-token' };
    expect(await principalFor(manager, { cookie: rotatedCookie })).toBe(userId);
    expect(await principalFor(manager, { cookie: rotatedCookie, ...bogus })).toBeNull();
    expect((await getTotpUri(manager, { cookie: rotatedCookie, ...bogus })).status).toBe(401);
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
describe('#10701 — the sign-in-challenge lane is untouched', () => {
  it('completing a 2FA SIGN-IN still echoes a token that authenticates', async () => {
    // The lane where the vendor mints the session it echoes: the two already
    // agreed, so the repair is a no-op here. Pinned because "fix the broken
    // lane" must not become "rewrite every lane".
    const { manager, userId, secret, rotatedCookie } = await arrangeCompletedEnrolment();

    // A fresh sign-in now stops at the 2FA challenge instead of returning a
    // session — that is what having enrolled means.
    const challenged = await post(manager, '/sign-in/email', { email: EMAIL, password: PASSWORD });
    expect(challenged.status).toBe(200);
    expect((await challenged.clone().json()) as any).toMatchObject({ twoFactorRedirect: true });

    const completed = await post(
      manager,
      '/two-factor/verify-totp',
      { code: totp(secret) },
      { cookie: cookieHeader(challenged) },
    );
    expect(completed.status, `verify-totp (sign-in): ${await completed.clone().text()}`).toBe(200);

    const signInToken = String(((await completed.clone().json()) as any).token);
    expect(await principalFor(manager, { authorization: `Bearer ${signInToken}` })).toBe(userId);
    expect((await getTotpUri(manager, { authorization: `Bearer ${signInToken}` })).status).toBe(200);

    // And the enrolment session is a different, still-independent session.
    expect(signInToken).not.toBe(rotatedCookie);
  }, 60_000);
});
