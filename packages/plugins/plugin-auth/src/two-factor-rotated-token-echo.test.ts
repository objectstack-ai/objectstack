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
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager';
import { authIdentityObjects } from './manifest.js';
import {
  echoInstalledSessionToken,
  ROTATING_TWO_FACTOR_VERIFY_PATHS,
} from './two-factor-rotated-token-echo.js';
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

/**
 * [#16535] A backend to drive the arrangement against, plus the way to read the
 * `sys_user` row it stores — read AT REST, below better-auth's adapter and below
 * the echo being measured.
 *
 * The read is part of the harness rather than a helper on the side because the
 * #16535 assertion is an EQUALITY between the echo and the row: a reader that
 * went through the same seam the fix reads would certify the fix against itself.
 */
type EnrolmentBackend = {
  engine: any;
  /** The stored `sys_user` row, in the column spelling that backend stores. */
  readUserRow: (email: string) => Promise<Record<string, unknown>>;
  /** `sys_user.two_factor_enabled` as it stands in storage, however spelled. */
  readTwoFactorEnabled: (email: string) => Promise<unknown>;
};

/** The in-memory engine leg — the one every #10701 pin already drives. */
const memoryBackend = (): EnrolmentBackend => {
  const engine = createMemoryEngine();
  const read = async (email: string): Promise<Record<string, unknown>> => {
    const row = ((engine.tables.get('sys_user') ?? []) as any[]).find((r) => r.email === email);
    if (!row) throw new Error(`no sys_user row for ${email}`);
    return row as Record<string, unknown>;
  };
  return {
    engine,
    readUserRow: read,
    readTwoFactorEnabled: async (email) => (await read(email)).two_factor_enabled,
  };
};

/**
 * [#16535] The real-driver leg — `ObjectQL` over `@objectstack/driver-sql` on
 * better-sqlite3 `:memory:`, the backend `credential-at-rest-posture.test.ts`
 * already uses. The card measured the defect twice for a reason: a test that
 * never reaches an adapter cannot tell "the echo tracks the row" from "the echo
 * happens to say true".
 */
const engines: ObjectQL[] = [];
const sqlBackend = async (): Promise<EnrolmentBackend> => {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }),
    true,
  );
  await engine.init();
  for (const object of authIdentityObjects) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();

  // Read at DRIVER level — below ObjectQL's read mask and below better-auth's
  // adapter, which is the seam the fix under test reads through.
  const read = async (email: string): Promise<Record<string, unknown>> => {
    const driver = (
      engine as unknown as { getDriver(o: string): { find(o: string, q: unknown): Promise<unknown> } }
    ).getDriver('sys_user');
    const found = await driver.find('sys_user', { where: {} });
    const rows = (Array.isArray(found) ? found : [found]).filter(Boolean) as Record<string, unknown>[];
    const row = rows.find((r) => r.email === email);
    if (!row) throw new Error(`no sys_user row for ${email}`);
    return row;
  };
  return {
    engine,
    readUserRow: read,
    readTwoFactorEnabled: async (email) => (await read(email)).two_factor_enabled,
  };
};

/**
 * [#16535] The after-hook's own inputs, spelled out — the seam-level harness
 * for the coverage and failure-posture cases the real pipeline cannot reach
 * (`/two-factor/verify-otp` has no OTP transport configured here) or cannot
 * reach deterministically (an adapter that throws).
 */
const fakeRotatingCtx = (
  path: string,
  returned: unknown,
  findUserById: (id: string) => Promise<unknown>,
) => {
  const headers = new Headers();
  headers.append('set-cookie', 'session_token=installed-token.sig; Path=/; HttpOnly');
  return {
    path,
    context: {
      returned,
      responseHeaders: headers,
      authCookies: { sessionToken: { name: 'session_token' } },
      internalAdapter: { findUserById },
      options: {},
    },
  };
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
 *
 * [#16535] Also returns the whole `verify-totp` body (its `user` member is the
 * second stale echo), the backup codes `enable` minted (the negative control
 * needs one), and the backend, so a pin can read the row the echo describes.
 */
const arrangeCompletedEnrolment = async (
  backend: EnrolmentBackend = memoryBackend(),
  /**
   * [#16535] Runs after `enable` and immediately before the rotating
   * `verify-totp` — the only window in which the condition-④ pin can poison the
   * seam the repair reads without also breaking the request under measurement.
   */
  beforeVerify?: (manager: AuthManager) => Promise<void>,
) => {
  const { engine } = backend;
  const manager = makeManager(engine);

  const signedUp = await post(manager, '/sign-up/email', {
    email: EMAIL,
    password: PASSWORD,
    name: 'Enrolling User',
  });
  expect(signedUp.status, `sign-up/email: ${await signedUp.clone().text()}`).toBe(200);
  const preEnrolmentCookie = cookieHeader(signedUp);
  const preEnrolmentToken = String(((await signedUp.json()) as any).token);
  const userId = String((await backend.readUserRow(EMAIL)).id);

  // The premise: before enrolling, the echoed token IS an accepted bearer.
  // Without this, a green suite could never tell "we fixed the echo" from
  // "the bearer seam never worked here".
  expect(await principalFor(manager, { authorization: `Bearer ${preEnrolmentToken}` })).toBe(userId);

  const enabled = await post(manager, '/two-factor/enable', { password: PASSWORD }, { cookie: preEnrolmentCookie });
  expect(enabled.status, `two-factor/enable: ${await enabled.clone().text()}`).toBe(200);
  const { totpURI, backupCodes } = (await enabled.json()) as {
    totpURI: string;
    backupCodes: string[];
  };
  const uriSecret = new URL(totpURI.replace('otpauth://', 'https://')).searchParams.get('secret');
  expect(uriSecret, 'no secret in the otpauth URI').toBeTruthy();
  const secret = base32Decode(String(uriSecret));

  await beforeVerify?.(manager);

  const verified = await post(manager, '/two-factor/verify-totp', { code: totp(secret) }, { cookie: preEnrolmentCookie });
  expect(verified.status, `verify-totp (enrolment): ${await verified.clone().text()}`).toBe(200);

  const body = (await verified.clone().json()) as { token: unknown; user: Record<string, unknown> };
  const echoedToken = String(body.token);
  const echoedUser = body.user;
  const rotatedCookie = cookieHeader(verified);
  expect(rotatedCookie, 'verify-totp installed no session cookie').toContain('session_token=');

  return {
    engine,
    backend,
    manager,
    userId,
    secret,
    backupCodes,
    preEnrolmentCookie,
    preEnrolmentToken,
    echoedToken,
    echoedUser,
    rotatedCookie,
  };
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    const e = engines.pop();
    try {
      await (e as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

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

// ═══════════════════════════════════════════════════════════════════════════
// #16535 — the SAME stale closure, the OTHER member of the same body.
//
// `valid(ctx)` echoes `{ token, user }` out of the session it resolved at
// ENTRY. #10701 repaired `token`; `user` still comes from the pre-rotation
// snapshot, so a successful enrolment answers `twoFactorEnabled: false` to the
// very caller who just switched it on.
//
// What makes these pins non-vacuous — and what would make them worthless:
//
//   • The assertion is an EQUALITY WITH THE STORED ROW, never `toBe(true)`.
//     A literal `true` passes just as well when the echo has stopped tracking
//     the row altogether (the vendor hard-coding it, a blanket `user.x = true`
//     in the hook), which is the very failure mode this card is about.
//   • The row is read AT REST — the memory engine's own table, and at DRIVER
//     level under `SqlDriver` — not through better-auth's adapter, which is the
//     seam the fix itself reads. Reading the row the fix's own way would make
//     the equality certify the fix against itself.
//   • `verify-backup-code` is a NEGATIVE CONTROL, not decoration. It does not
//     rotate and it echoes the live row correctly TODAY. An unconditional
//     re-read would "fix" the broken lane and leave this one just as green —
//     so it is measured on both sides of the same enrolment.
//   • The failure posture is measured by making the row read THROW, not by
//     reading the code: a repair that turns a completed verification into a
//     500 is a worse defect than the stale flag it set out to fix.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `sys_user.two_factor_enabled` AS STORED, as a truth value the echo can be
 * compared against.
 *
 * The normalisation is on the ROW side only, and only across spellings of the
 * same boolean (SQLite stores `1`/`0`, the memory engine `true`/`false`); the
 * echo is never normalised, and no literal is ever substituted for the row. If
 * the row said "off", every caller below would demand the echo say "off" too —
 * which is the difference between pinning the row and pinning `true`. The
 * seam-level pin `follows the row DOWN as well as up` measures that directly.
 */
const storedTwoFactorEnabled = async (backend: EnrolmentBackend): Promise<boolean> => {
  const stored = await backend.readTwoFactorEnabled(EMAIL);
  expect(
    stored === true || stored === false || stored === 1 || stored === 0,
    `sys_user.two_factor_enabled is not a boolean at rest: ${String(stored)}`,
  ).toBe(true);
  return stored === true || stored === 1;
};

/**
 * The premise the card's differential rests on, asserted as a fact about
 * STORAGE and never about the echo: the flag really did flip during the
 * request. Without it, `echo === row` is satisfiable by "both are false" —
 * which is precisely the defect.
 */
const expectRowSaysEnabled = async (backend: EnrolmentBackend): Promise<boolean> => {
  const value = await storedTwoFactorEnabled(backend);
  expect(value, 'the enrolment never wrote the flag — the differential is gone').toBe(true);
  return value;
};

// ───────────────────────────────────────────────────────────────────────────
describe('#16535 — the echoed `user` describes the row, on the in-memory engine', () => {
  it('condition ①: `user.twoFactorEnabled` equals the value stored for that row', async () => {
    const { backend, echoedUser } = await arrangeCompletedEnrolment();

    // The premise, stated as a fact about STORAGE, never about the echo: the
    // flag really did flip during this request. Without it the equality below
    // is satisfiable by "both are false", which is the bug.
    const rowValue = await expectRowSaysEnabled(backend);

    expect(
      echoedUser.twoFactorEnabled,
      'verify-totp echoed the PRE-rotation user snapshot',
    ).toBe(rowValue);
  }, 60_000);

  it('condition ③ (negative control): `verify-backup-code` still echoes the live row', async () => {
    // The lane that does NOT rotate. It was right before this card and must be
    // right after it — an unconditional re-read is indistinguishable from the
    // targeted fix on `verify-totp` alone, and only shows itself here.
    const { manager, backend, backupCodes, rotatedCookie } = await arrangeCompletedEnrolment();
    const rowValue = await expectRowSaysEnabled(backend);

    expect(Array.isArray(backupCodes) && backupCodes.length > 0, 'enable minted no backup codes').toBe(true);
    const consumed = await post(
      manager,
      '/two-factor/verify-backup-code',
      { code: backupCodes[0] },
      { cookie: rotatedCookie },
    );
    expect(consumed.status, `verify-backup-code: ${await consumed.clone().text()}`).toBe(200);

    const body = (await consumed.clone().json()) as { user: Record<string, unknown> };
    expect(body.user.twoFactorEnabled, 'the non-rotating lane stopped echoing the live row').toBe(rowValue);

    // …and it is still the SAME body shape the vendor writes: this lane is not
    // supposed to be touched by the repair at all.
    expect(body.user.id).toBe((await backend.readUserRow(EMAIL)).id);
  }, 60_000);

  it('the repaired `user` is the vendor shape, not a widened one', async () => {
    // The repair re-serialises with better-auth's own `parseUserOutput`, so it
    // cannot leak a column the vendor's own echo hides. Measured against the
    // lane the repair does NOT touch: the two bodies must carry the same key
    // set, or the "repair" has changed the published payload shape.
    const { manager, backupCodes, rotatedCookie, echoedUser } = await arrangeCompletedEnrolment();

    const consumed = await post(
      manager,
      '/two-factor/verify-backup-code',
      { code: backupCodes[0] },
      { cookie: rotatedCookie },
    );
    expect(consumed.status).toBe(200);
    const untouched = ((await consumed.clone().json()) as any).user as Record<string, unknown>;

    expect(Object.keys(echoedUser).sort()).toEqual(Object.keys(untouched).sort());

    // Shape is more than a key set. The repaired members come from a row read,
    // and a row read is where a boolean becomes `1` — which would silently
    // change the WIRE TYPE of `AuthWireUser.emailVerified` while every key-set
    // assertion stayed green. So each member's type is compared against the
    // lane the repair does not touch.
    for (const key of Object.keys(untouched)) {
      expect(
        typeof echoedUser[key],
        `\`user.${key}\` changed wire type: ${JSON.stringify(echoedUser[key])} vs ${JSON.stringify(untouched[key])}`,
      ).toBe(typeof untouched[key]);
    }

    // The one thing that is deliberately NOT hidden: no credential material
    // rides along on either lane.
    for (const forbidden of ['password', 'twoFactorSecret', 'backupCodes']) {
      expect(Object.keys(echoedUser)).not.toContain(forbidden);
    }
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
describe('#16535 — condition ②: every rotating path in the table is covered', () => {
  // `/two-factor/verify-otp` travels the byte-identical rotate-then-`valid(ctx)`
  // block (`otp/index.mjs`) and is already in the table the `token` repair keys
  // on. It cannot be driven end-to-end here — the manager builds `twoFactor()`
  // with no OTP transport, exactly as the file header records — so this is
  // measured where the coverage decision actually lives: the hook, driven over
  // EVERY entry of the table. A third rotating path added later is covered by
  // this pin the day it is added to the table.
  it.each([...ROTATING_TWO_FACTOR_VERIFY_PATHS])('repairs `user` on %s', async (path) => {
    const fresh = { id: 'user_1', email: EMAIL, twoFactorEnabled: true };
    const returned: any = {
      token: 'stale-token',
      user: { id: 'user_1', email: EMAIL, twoFactorEnabled: false },
    };
    const ctx = fakeRotatingCtx(path, returned, async () => fresh);

    await echoInstalledSessionToken(ctx);

    expect(returned.token).toBe('installed-token');
    expect(returned.user.twoFactorEnabled).toBe(true);
  });

  it('leaves a path OUTSIDE the table alone, `user` included', async () => {
    // `/two-factor/verify-backup-code` does not rotate and is in neither list.
    // This is the seam-level twin of the end-to-end negative control above.
    const returned: any = {
      token: 'stale-token',
      user: { id: 'user_1', email: EMAIL, twoFactorEnabled: false },
    };
    const ctx = fakeRotatingCtx('/two-factor/verify-backup-code', returned, async () => ({
      id: 'user_1',
      email: EMAIL,
      twoFactorEnabled: true,
    }));

    await echoInstalledSessionToken(ctx);

    expect(returned.token).toBe('stale-token');
    expect(returned.user.twoFactorEnabled).toBe(false);
  });

  it('leaves `user` alone when no session was rotated', async () => {
    // The sign-in-challenge lane: the installed token IS the echoed one, so the
    // predicate is false and nothing — token or user — is rewritten.
    const returned: any = {
      token: 'installed-token',
      user: { id: 'user_1', email: EMAIL, twoFactorEnabled: false },
    };
    let reads = 0;
    const ctx = fakeRotatingCtx('/two-factor/verify-totp', returned, async () => {
      reads += 1;
      return { id: 'user_1', email: EMAIL, twoFactorEnabled: true };
    });

    await echoInstalledSessionToken(ctx);

    expect(returned.user.twoFactorEnabled).toBe(false);
    expect(reads, 'the row was read on a lane that installed no new session').toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#16535 — the two narrowings the repair is built on', () => {
  // Neither is decoration: ablating the key-set ceiling reddens exactly ONE pin
  // in this file — the widening one — while condition ① and both
  // `verify-backup-code` controls stay green. That single pin is the whole
  // difference between this repair and a blanket "re-read the row and forward
  // it", which is why it is measured at the seam rather than only end to end
  // (the fixture rows happen to carry no surplus column, so the end-to-end
  // parity pins cannot see it).

  it('follows the row DOWN as well as up — the echo tracks the row, not a literal', async () => {
    // The assertion condition ① forbids is `toBe(true)`: it passes just as well
    // when the echo has stopped describing the row at all. This is the direct
    // measurement of the property `true` cannot distinguish — the row says OFF
    // and the echo must say OFF, on the very lane the repair rewrites.
    const returned: any = {
      token: 'stale-token',
      user: { id: 'user_1', email: EMAIL, twoFactorEnabled: true },
    };
    const ctx = fakeRotatingCtx('/two-factor/verify-totp', returned, async () => ({
      id: 'user_1',
      email: EMAIL,
      twoFactorEnabled: false,
    }));

    await echoInstalledSessionToken(ctx);

    expect(returned.user.twoFactorEnabled).toBe(false);
  });

  it('never substitutes a different principal into the response', async () => {
    // The row is re-read BY THE ID THE RESPONSE ALREADY PUBLISHED. An adapter
    // that answers with some other row is a bug, not an opportunity: the echo
    // must stay as the vendor wrote it rather than start describing a stranger.
    const returned: any = {
      token: 'stale-token',
      user: { id: 'user_1', email: EMAIL, twoFactorEnabled: false },
    };
    const ctx = fakeRotatingCtx('/two-factor/verify-totp', returned, async () => ({
      id: 'someone_else',
      email: 'intruder@example.com',
      twoFactorEnabled: true,
    }));

    await echoInstalledSessionToken(ctx);

    expect(returned.user.id).toBe('user_1');
    expect(returned.user.email).toBe(EMAIL);
    expect(returned.user.twoFactorEnabled).toBe(false);
  });

  it('never widens the echoed payload with columns the vendor did not publish', async () => {
    // better-auth's own output filter is a DENY-list, so forwarding a raw row
    // would put every column it happens to carry on the wire. The echoed key
    // set is the ceiling.
    const returned: any = {
      token: 'stale-token',
      user: { id: 'user_1', email: EMAIL, twoFactorEnabled: false },
    };
    const ctx = fakeRotatingCtx('/two-factor/verify-totp', returned, async () => ({
      id: 'user_1',
      email: EMAIL,
      twoFactorEnabled: true,
      two_factor_secret: 'JBSWY3DPEHPK3PXP',
      internalRiskScore: 42,
    }));

    await echoInstalledSessionToken(ctx);

    expect(returned.user.twoFactorEnabled).toBe(true);
    expect(Object.keys(returned.user).sort()).toEqual(['email', 'id', 'twoFactorEnabled']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#16535 — condition ④: the failure posture is inherited', () => {
  it('a row read that THROWS leaves the old echo and never fails the verification', async () => {
    // Measured through the REAL pipeline, because the claim is about the
    // RESPONSE, not about the helper: the verification already succeeded, the
    // caller's rotated cookie is valid, and a hook that cannot tidy the body
    // must not convert that into a failure.
    //
    // `findUserById` is the seam the repair reads and — on the signed-in lane —
    // the ONLY thing that reads it, so poisoning it isolates the repair from
    // the request it is measuring. (`verifyTwoFactor`'s signed-in branch
    // resolves through `findSession`; `findUserById` is the sign-in-challenge
    // branch's.)
    const arranged = await arrangeCompletedEnrolment(memoryBackend(), async (manager) => {
      const auth = (await manager.getAuthInstance()) as any;
      const authContext: any = await auth.$context;
      authContext.internalAdapter.findUserById = async () => {
        throw new Error('adapter is down');
      };
    });

    // The arrangement itself asserts the 200 and the installed cookie — i.e.
    // the verification was NOT turned into a failure.
    const rowValue = await expectRowSaysEnabled(arranged.backend);
    expect(rowValue).toBe(true);

    // The #10701 repair, which runs FIRST, is not lost with the #16535 one…
    expect(arranged.echoedToken).not.toBe(arranged.preEnrolmentToken);
    expect(
      decodeURIComponent(String(/session_token=([^;]+)/.exec(arranged.rotatedCookie)?.[1])).split('.')[0],
    ).toBe(arranged.echoedToken);

    // …and `user` degrades to the vendor's own echo — the pre-flip snapshot —
    // rather than to a 500 or to a missing member.
    expect(arranged.echoedUser, 'the user member was dropped rather than left alone').toBeTruthy();
    expect(arranged.echoedUser.id).toBe(arranged.userId);
    expect(
      arranged.echoedUser.twoFactorEnabled,
      'degraded to something other than the vendor echo',
    ).toBe(false);
  }, 60_000);

  it('a row read that throws still leaves the #10701 token repair in place', async () => {
    // The two repairs are independent: #16535 must not be able to undo #10701.
    const returned: any = {
      token: 'stale-token',
      user: { id: 'user_1', email: EMAIL, twoFactorEnabled: false },
    };
    const ctx = fakeRotatingCtx('/two-factor/verify-totp', returned, async () => {
      throw new Error('adapter is down');
    });

    await expect(echoInstalledSessionToken(ctx)).resolves.toBeUndefined();

    expect(returned.token, 'the token repair was lost with the user repair').toBe('installed-token');
    expect(returned.user.twoFactorEnabled).toBe(false);
  });

  it('a row that cannot be found leaves the vendor echo untouched', async () => {
    const returned: any = {
      token: 'stale-token',
      user: { id: 'user_1', email: EMAIL, twoFactorEnabled: false },
    };
    const ctx = fakeRotatingCtx('/two-factor/verify-totp', returned, async () => null);

    await echoInstalledSessionToken(ctx);

    expect(returned.token).toBe('installed-token');
    expect(returned.user.twoFactorEnabled).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#16535 — the same measurement on a real SqlDriver', () => {
  it('condition ①, at driver level: the echo equals the stored column', async () => {
    // The card measured this twice for a reason: a test that never reaches an
    // adapter cannot tell "the echo tracks the row" from "the echo happens to
    // say true". Here the row is read through the SQL driver itself, below
    // ObjectQL's read mask and below better-auth's adapter.
    const backend = await sqlBackend();
    const { echoedUser, backend: used } = await arrangeCompletedEnrolment(backend);

    const rowValue = await expectRowSaysEnabled(used);
    expect(echoedUser.twoFactorEnabled).toBe(rowValue);
  }, 120_000);

  it('condition ③, at driver level: `verify-backup-code` still echoes the live row', async () => {
    const backend = await sqlBackend();
    const { manager, backupCodes, rotatedCookie, backend: used } = await arrangeCompletedEnrolment(backend);
    const rowValue = await expectRowSaysEnabled(used);

    const consumed = await post(
      manager,
      '/two-factor/verify-backup-code',
      { code: backupCodes[0] },
      { cookie: rotatedCookie },
    );
    expect(consumed.status, `verify-backup-code: ${await consumed.clone().text()}`).toBe(200);
    expect(((await consumed.clone().json()) as any).user.twoFactorEnabled).toBe(rowValue);
  }, 120_000);

  it('the repaired `user` keeps the vendor wire shape AND its wire types on SQL', async () => {
    // This is the leg where a shape regression would actually appear: SQLite
    // stores booleans as `1`/`0`, so a repair that forwarded row values without
    // travelling the adapter's output transform would put a NUMBER where
    // `AuthWireUser.emailVerified` declares a boolean — invisible to any
    // assertion about `twoFactorEnabled` alone.
    const backend = await sqlBackend();
    const { manager, backupCodes, rotatedCookie, echoedUser } = await arrangeCompletedEnrolment(backend);

    const consumed = await post(
      manager,
      '/two-factor/verify-backup-code',
      { code: backupCodes[0] },
      { cookie: rotatedCookie },
    );
    expect(consumed.status).toBe(200);
    const untouched = ((await consumed.clone().json()) as any).user as Record<string, unknown>;

    expect(Object.keys(echoedUser).sort()).toEqual(Object.keys(untouched).sort());
    for (const key of Object.keys(untouched)) {
      expect(
        typeof echoedUser[key],
        `\`user.${key}\` changed wire type: ${JSON.stringify(echoedUser[key])} vs ${JSON.stringify(untouched[key])}`,
      ).toBe(typeof untouched[key]);
    }
    expect(typeof echoedUser.twoFactorEnabled, 'the repaired member is not a JSON boolean').toBe('boolean');
  }, 120_000);
});
