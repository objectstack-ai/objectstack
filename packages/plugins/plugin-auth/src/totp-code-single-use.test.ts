// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The rule under test: a TOTP code the two-factor plugin accepts is accepted
// once. Any later presentation of it is refused, on another sign-in challenge,
// from another client and on the session lane; so is a code from a time step at
// or before the last accepted one; and the refusal is the answer a wrong code
// gets. A code from a later step is accepted.
//
// Real stack throughout: `AuthManager` over `ObjectQL` + `@objectstack/driver-sql`
// on better-sqlite3 `:memory:`, requests in as `Request` objects through
// `AuthManager.handleRequest`, the secret the vendor handed out in its otpauth://
// URI, and the codes computed here from that secret by an RFC 6238 generator of
// this file's own. A real store is the point: the single use rests on the
// store refusing a second row under one primary key.
//
// The clock is pinned (`Date` only; timers stay real) one second into a time
// step, and moved a whole step forward where a case needs a later step, so no
// case depends on where in a 30-second step it happens to run.

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';
import {
  NEVER_ACCEPTED_TOTP_CODE,
  TOTP_ACCEPTANCE_WINDOW,
  TOTP_VERIFY_PATH,
  TWO_FACTOR_PLUGIN_ID,
  acceptEachTotpCodeOnce,
  hotp,
  matchedTotpStep,
  spentTotpStepIdentifier,
} from './totp-code-single-use.js';
// Vendor modules paid at module load, never inside a clocked case.
import 'better-auth';
import 'better-auth/api';
import 'better-auth/crypto';
import 'better-auth/plugins';
import 'better-auth/plugins/bearer';
import 'better-auth/plugins/two-factor';
import '@better-auth/core/context';

const SECRET = 'test-secret-at-least-32-chars-long-totp-once';
const PASSWORD = 'S3cure!Passw0rd-totp-once';
const ORIGIN = 'http://localhost:3000';
const BASE = `${ORIGIN}/api/v1/auth`;
const EMAIL = 'totp-once@example.com';
const PERIOD_MS = 30_000;

// ── RFC 6238 TOTP (the vendor defaults: SHA-1, 6 digits, 30 s) ────────────
function base32Decode(input: string): Buffer {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
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

/** The 6-digit TOTP of `secret` for time step `step`. */
function totpAt(secret: Buffer, step: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', secret).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

/** A 6-digit code equal to no code of `secret` in the steps around `step`. */
function wrongCodeAt(secret: Buffer, step: number): string {
  const live = new Set([-2, -1, 0, 1, 2].map((d) => totpAt(secret, step + d)));
  for (let n = 0; ; n++) {
    const candidate = String(n).padStart(6, '0');
    if (!live.has(candidate)) return candidate;
  }
}

// ── The clock ─────────────────────────────────────────────────────────────
/** A time step comfortably in the future of the real clock, so no real step boundary is near. */
const FIRST_STEP = Math.floor(Date.now() / PERIOD_MS) + 10;
/** Move the clock to one second into time step `step`. */
const atStep = (step: number) => vi.setSystemTime(step * PERIOD_MS + 1_000);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  atStep(FIRST_STEP);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const scrypt = memoizeScrypt();
afterAll(scrypt.restore);

const engines: ObjectQL[] = [];
afterAll(async () => {
  while (engines.length) {
    try {
      await engines.pop()!.destroy();
    } catch {
      /* noop */
    }
  }
});

// ── The arrangement ───────────────────────────────────────────────────────
const cookieHeader = (res: Response): string =>
  (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

/** Whether the response installs a session cookie with a value. */
const setsSession = (res: Response): boolean =>
  (res.headers.getSetCookie?.() ?? []).some((c) => /session_token=[^;]+/.test(c.split(';')[0]));

/**
 * A user with TOTP enrolled and confirmed on the session lane with the code of
 * {@link FIRST_STEP}, on a fresh real store.
 */
const arrangeEnrolled = async () => {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const object of authIdentityObjects) engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  await engine.syncSchemas();

  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    plugins: { twoFactor: true },
  } as any);

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    manager.handleRequest(
      new Request(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
        body: JSON.stringify(body ?? {}),
      }),
    );

  /** Rows of `object` as the SQL driver stores them, below every read mask. */
  const rows = async (object: string): Promise<Record<string, unknown>[]> => {
    const driver = (
      engine as unknown as { getDriver(o: string): { find(o: string, q: unknown): Promise<unknown> } }
    ).getDriver(object);
    const found = await driver.find(object, { where: {} });
    return (Array.isArray(found) ? found : [found]).filter(Boolean) as Record<string, unknown>[];
  };

  const signedUp = await post('/sign-up/email', { email: EMAIL, password: PASSWORD, name: 'Totp Once' });
  expect(signedUp.status, `sign-up/email: ${await signedUp.clone().text()}`).toBe(200);
  const signUpCookie = cookieHeader(signedUp);
  const userId = String((await rows('sys_user')).find((r) => r.email === EMAIL)?.id);

  const enabled = await post('/two-factor/enable', { password: PASSWORD }, { cookie: signUpCookie });
  expect(enabled.status, `two-factor/enable: ${await enabled.clone().text()}`).toBe(200);
  const { totpURI } = (await enabled.json()) as { totpURI: string };
  const secret = base32Decode(String(new URL(totpURI.replace('otpauth://', 'https://')).searchParams.get('secret')));

  const confirmed = await post(TOTP_VERIFY_PATH, { code: totpAt(secret, FIRST_STEP) }, { cookie: signUpCookie });
  expect(confirmed.status, `verify-totp (enrolment): ${await confirmed.clone().text()}`).toBe(200);
  const sessionCookie = cookieHeader(confirmed);

  /** A password sign-in that stops at the two-factor challenge; its cookie is the challenge. */
  const challenge = async (): Promise<string> => {
    const res = await post('/sign-in/email', { email: EMAIL, password: PASSWORD });
    expect(res.status, `sign-in/email: ${await res.clone().text()}`).toBe(200);
    expect(((await res.clone().json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
    return cookieHeader(res);
  };

  const verify = (cookie: string, code: string) => post(TOTP_VERIFY_PATH, { code }, { cookie });

  const sessionCount = async () => (await rows('sys_session')).filter((r) => String(r.user_id) === userId).length;

  const failedVerificationCount = async () =>
    Number((await rows('sys_two_factor')).find((r) => String(r.user_id) === userId)?.failed_verification_count ?? 0);

  return { manager, post, rows, userId, secret, sessionCookie, challenge, verify, sessionCount, failedVerificationCount };
};

/** The status and error body a refusal answers with. */
const answerOf = async (res: Response) => ({
  status: res.status,
  body: (await res.clone().json()) as { code?: string; message?: string },
});

// ── At the door ───────────────────────────────────────────────────────────
describe('a TOTP code is accepted once, at /two-factor/verify-totp', () => {
  it('a code accepted at one sign-in challenge is refused at another client’s challenge', async () => {
    const rig = await arrangeEnrolled();
    atStep(FIRST_STEP + 1);
    const code = totpAt(rig.secret, FIRST_STEP + 1);

    const first = await rig.verify(await rig.challenge(), code);
    expect(first.status, `first presentation: ${await first.clone().text()}`).toBe(200);
    expect(setsSession(first)).toBe(true);

    const sessionsBefore = await rig.sessionCount();
    const second = await rig.verify(await rig.challenge(), code);
    const answer = await answerOf(second);
    expect(answer.status).toBe(401);
    expect(answer.body.code).toBe('INVALID_CODE');
    expect(setsSession(second), 'a refused presentation installs no session').toBe(false);
    expect(await rig.sessionCount(), 'a refused presentation mints no session row').toBe(sessionsBefore);
  });

  it('a code spent confirming the enrolment is refused at the sign-in challenge', async () => {
    const rig = await arrangeEnrolled();

    const res = await rig.verify(await rig.challenge(), totpAt(rig.secret, FIRST_STEP));
    const answer = await answerOf(res);
    expect(answer.status).toBe(401);
    expect(answer.body.code).toBe('INVALID_CODE');
    expect(setsSession(res)).toBe(false);
  });

  it('a code accepted on the session lane is refused on the session lane again', async () => {
    const rig = await arrangeEnrolled();
    atStep(FIRST_STEP + 1);
    const code = totpAt(rig.secret, FIRST_STEP + 1);

    const first = await rig.verify(rig.sessionCookie, code);
    expect(first.status, `first presentation: ${await first.clone().text()}`).toBe(200);

    const second = await rig.verify(rig.sessionCookie, code);
    const answer = await answerOf(second);
    expect(answer.status).toBe(401);
    expect(answer.body.code).toBe('INVALID_CODE');
  });

  it('a code from a step before the last accepted step is refused', async () => {
    const rig = await arrangeEnrolled();
    atStep(FIRST_STEP + 1);

    // The next step's code is inside the verifier's window and is accepted first.
    const later = await rig.verify(await rig.challenge(), totpAt(rig.secret, FIRST_STEP + 2));
    expect(later.status, `later step: ${await later.clone().text()}`).toBe(200);

    // The current step's code was never presented, and its step is before the accepted one.
    const earlier = await rig.verify(await rig.challenge(), totpAt(rig.secret, FIRST_STEP + 1));
    const answer = await answerOf(earlier);
    expect(answer.status).toBe(401);
    expect(answer.body.code).toBe('INVALID_CODE');
    expect(setsSession(earlier)).toBe(false);
  });

  it('a code from a later step is accepted, at the challenge that refused a spent code', async () => {
    const rig = await arrangeEnrolled();
    atStep(FIRST_STEP + 1);
    const spent = totpAt(rig.secret, FIRST_STEP + 1);
    expect((await rig.verify(await rig.challenge(), spent)).status).toBe(200);

    const pending = await rig.challenge();
    expect((await rig.verify(pending, spent)).status).toBe(401);

    atStep(FIRST_STEP + 2);
    const fresh = await rig.verify(pending, totpAt(rig.secret, FIRST_STEP + 2));
    expect(fresh.status, `fresh code: ${await fresh.clone().text()}`).toBe(200);
    expect(setsSession(fresh)).toBe(true);
  });

  it('a spent code gets the answer, and the failure count, a wrong code gets', async () => {
    const rig = await arrangeEnrolled();
    atStep(FIRST_STEP + 1);
    const spent = totpAt(rig.secret, FIRST_STEP + 1);
    expect((await rig.verify(await rig.challenge(), spent)).status).toBe(200);

    const countBefore = await rig.failedVerificationCount();
    const wrong = await answerOf(await rig.verify(await rig.challenge(), wrongCodeAt(rig.secret, FIRST_STEP + 1)));
    const countAfterWrong = await rig.failedVerificationCount();
    const replayed = await answerOf(await rig.verify(await rig.challenge(), spent));
    const countAfterReplay = await rig.failedVerificationCount();

    expect(replayed).toEqual(wrong);
    expect(countAfterWrong).toBe(countBefore + 1);
    expect(countAfterReplay).toBe(countAfterWrong + 1);
  });

  it('two presentations of one code that arrive together admit exactly one', async () => {
    const rig = await arrangeEnrolled();
    atStep(FIRST_STEP + 1);
    const code = totpAt(rig.secret, FIRST_STEP + 1);
    const [a, b] = [await rig.challenge(), await rig.challenge()];

    const statuses = (await Promise.all([rig.verify(a, code), rig.verify(b, code)])).map((r) => r.status);
    expect(statuses.sort()).toEqual([200, 401]);
  });

  it('the vendor accepts no step outside the window whose steps are reserved', async () => {
    // The reservation covers `current ± TOTP_ACCEPTANCE_WINDOW`. A vendor whose
    // verifier accepted a wider window would accept codes this guard never
    // records, so the window is pinned at the door.
    const rig = await arrangeEnrolled();
    // Far enough past the enrolment that neither probe is a spent step.
    const now = FIRST_STEP + 3;
    atStep(now);
    for (const step of [now - TOTP_ACCEPTANCE_WINDOW - 1, now + TOTP_ACCEPTANCE_WINDOW + 1]) {
      const res = await rig.verify(await rig.challenge(), totpAt(rig.secret, step));
      expect(res.status, `step ${step - now} from now`).toBe(401);
    }
  });
});

// ── The seams ─────────────────────────────────────────────────────────────
describe('a TOTP code is accepted once — the seams', () => {
  it('HOTP equals the RFC 4226 Appendix D test values', () => {
    const rfcSecret = '12345678901234567890';
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expect(expected.map((_, counter) => hotp(rfcSecret, counter, 6))).toEqual(expected);
  });

  it('the matched step is the newest step of the window whose code is presented', () => {
    const secret = 'abcdefghijklmnopqrstuvwxyz012345';
    const current = 1_000;
    for (const step of [current - 1, current, current + 1]) {
      expect(matchedTotpStep(secret, hotp(secret, step, 6), { current, window: 1, digits: 6 })).toBe(step);
    }
    expect(matchedTotpStep(secret, hotp(secret, current + 2, 6), { current, window: 1, digits: 6 })).toBeUndefined();
    expect(matchedTotpStep(secret, NEVER_ACCEPTED_TOTP_CODE, { current, window: 1, digits: 6 })).toBeUndefined();
  });

  it('a step is reserved per user and per secret', () => {
    const a = spentTotpStepIdentifier('user_a', 'secret-one', 7);
    expect(spentTotpStepIdentifier('user_a', 'secret-one', 7)).toBe(a);
    expect(spentTotpStepIdentifier('user_b', 'secret-one', 7)).not.toBe(a);
    expect(spentTotpStepIdentifier('user_a', 'secret-two', 7)).not.toBe(a);
    expect(spentTotpStepIdentifier('user_a', 'secret-one', 8)).not.toBe(a);
    expect(a).not.toContain('secret-one');
  });

  it('the build refuses a two-factor plugin whose routes do not include /two-factor/verify-totp', async () => {
    const drifted = { id: TWO_FACTOR_PLUGIN_ID, endpoints: { verifyTOTP: { path: '/two-factor/verify-code' } } };
    await expect(acceptEachTotpCodeOnce([drifted])).rejects.toThrow(/none at \/two-factor\/verify-totp/);
  });

  it('one before-hook is appended to the two-factor plugin, matched on the door, once', async () => {
    const plugin: any = { id: TWO_FACTOR_PLUGIN_ID, endpoints: { verifyTOTP: { path: TOTP_VERIFY_PATH } }, hooks: { after: [] } };
    const other: any = { id: 'bearer', hooks: { before: [] } };
    const list = [other, plugin];
    expect(await acceptEachTotpCodeOnce(list)).toBe(list);
    await acceptEachTotpCodeOnce(list);
    expect(plugin.hooks.before).toHaveLength(1);
    expect(plugin.hooks.after).toEqual([]);
    expect(other.hooks.before).toEqual([]);
    const [entry] = plugin.hooks.before;
    expect(entry.matcher({ path: TOTP_VERIFY_PATH })).toBe(true);
    expect(entry.matcher({ path: '/two-factor/verify-otp' })).toBe(false);
    expect(entry.matcher({ path: '/two-factor/verify-backup-code' })).toBe(false);
  });

  it('a two-factor plugin that serves no route takes no code and gets no hook', async () => {
    const plugin: any = { id: TWO_FACTOR_PLUGIN_ID, hooks: { after: [] } };
    expect(await acceptEachTotpCodeOnce([plugin])).toEqual([plugin]);
    expect(plugin.hooks.before).toBeUndefined();
  });

  it('a list with no two-factor plugin is handed back untouched', async () => {
    const other: any = { id: 'bearer', hooks: { before: [] } };
    const list = [other];
    expect(await acceptEachTotpCodeOnce(list)).toBe(list);
    expect(other.hooks.before).toEqual([]);
  });
});
