// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The rule under test: an account with an enrolled second factor is signed in
// by no one-time code or sign-in link alone; a code or link door asks for the
// second factor, as password sign-in does. An account with no enrolled factor
// signs in at those doors exactly as before.
//
// Real better-auth pipeline throughout: requests go in as `Request` objects
// through `AuthManager.handleRequest`, the codes and links are the ones the
// running plugins minted and handed to the SMS and email services, and every
// "is this a credential?" question is asked at `GET /get-session` — the cookie
// the response set, the `set-auth-token` header, and any `token` in the body,
// each on its own. A challenge that left any of them resolving would be a
// session by another name.
//
// The doors, each driven by one `door` helper below:
//   - `/phone-number/verify`  — the SMS one-time code;
//   - `/magic-link/verify`    — the emailed sign-in link (JSON lane, and the
//                               `callbackURL` redirect lane on its own case);
//   - `/verify-email`         — the emailed verification link, with
//                               `emailVerification.autoSignInAfterVerification`.

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { AuthManager } from './auth-manager';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';
import { inviteForAudienceGate } from './audience-gate-test-support';
import {
  PASSWORD_SIGN_IN_PATH,
  SECOND_FACTOR_CODE_AND_LINK_DOOR_PATHS,
  isCodeOrLinkDoorSignIn,
  requireSecondFactorAtCodeAndLinkDoors,
} from './second-factor-code-and-link-doors';
// Vendor modules paid at module load, never inside a clocked case.
import 'better-auth';
import 'better-auth/api';
import 'better-auth/plugins';
import 'better-auth/plugins/bearer';
import 'better-auth/plugins/two-factor';
import 'better-auth/plugins/phone-number';
import 'better-auth/plugins/magic-link';
import '@better-auth/core/context';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-second-factor';
const ORIGIN = 'http://localhost:3000';
const BASE = `${ORIGIN}/api/v1/auth`;
const ENROLLED_EMAIL = 'enrolled@example.com';
const ENROLLED_PHONE = '+15550142';
const PLAIN_EMAIL = 'plain@example.com';
const PLAIN_PHONE = '+15550143';

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

function totp(secret: Buffer): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', secret).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

/** A response's Set-Cookie values as one request Cookie header (expired ones dropped). */
const cookieHeader = (res: Response): string =>
  (res.headers.getSetCookie?.() ?? [])
    .filter((c) => !/max-age=0/i.test(c))
    .map((c) => c.split(';')[0])
    .join('; ');

const cookieValue = (res: Response, suffix: string): string | undefined =>
  (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .find((pair) => pair.split('=')[0].endsWith(suffix))
    ?.split('=')
    .slice(1)
    .join('=');

type Rig = Awaited<ReturnType<typeof arrange>>;

const arrange = async (options: { twoFactor?: boolean } = {}) => {
  const twoFactor = options.twoFactor ?? true;
  const engine: any = createMemoryEngine();
  const texts: { to: string; body: string }[] = [];
  const mails: any[] = [];
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    plugins: { twoFactor, phoneNumber: true, magicLink: true },
    emailVerification: { autoSignInAfterVerification: true },
    smsService: {
      async send(input: any) {
        texts.push({ to: String(input?.to ?? ''), body: String(input?.body ?? input?.text ?? '') });
        return { id: 'sms_test', status: 'sent' };
      },
      isConfigured: () => true,
    },
    emailService: {
      async sendTemplate(input: any) {
        mails.push(input);
        return { id: 'mail_test', status: 'sent' };
      },
      async send(input: any) {
        mails.push(input);
        return { id: 'mail_test', status: 'sent' };
      },
      isConfigured: () => true,
    },
  } as any);

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    manager.handleRequest(
      new Request(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
        body: JSON.stringify(body ?? {}),
      }),
    );
  const get = (url: string, headers: Record<string, string> = {}) =>
    manager.handleRequest(
      new Request(url.startsWith('http') ? url : `${BASE}${url}`, { method: 'GET', headers: { origin: ORIGIN, ...headers } }),
    );

  const userRow = (email: string) => {
    const row = ((engine.tables.get('sys_user') ?? []) as any[]).find((r) => r.email === email);
    if (!row) throw new Error(`no sys_user row for ${email}`);
    return row;
  };

  const signUp = async (email: string, phone: string) => {
    const invitationId = await inviteForAudienceGate(manager, email);
    const res = await post('/sign-up/email', { email, password: PASSWORD, name: email.split('@')[0], invitationId });
    expect(res.status, `sign-up/email: ${await res.clone().text()}`).toBe(200);
    // Staged directly in the engine double, which runs no hooks: a verified
    // phone and a verified address, the state of an account in ordinary use.
    // (A sign-in link for an UNVERIFIED address also revokes the account's
    // other sessions on its own; verified, the session-row count before and
    // after a door measures only what the door issued.)
    const row = userRow(email);
    row.phone_number = phone;
    row.phone_number_verified = true;
    row.email_verified = true;
    return { cookie: cookieHeader(res), userId: String(row.id) };
  };

  // The PLAIN account, which never enrolls a second factor.
  const plain = await signUp(PLAIN_EMAIL, PLAIN_PHONE);

  // The ENROLLED account: TOTP enabled and confirmed.
  const enrolled = await signUp(ENROLLED_EMAIL, ENROLLED_PHONE);
  let secret: Buffer = Buffer.alloc(0);
  let backupCodes: string[] = [];
  let enrolledCookie = enrolled.cookie;
  if (twoFactor) {
    const enabled = await post('/two-factor/enable', { password: PASSWORD }, { cookie: enrolled.cookie });
    expect(enabled.status, `two-factor/enable: ${await enabled.clone().text()}`).toBe(200);
    const body = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
    backupCodes = body.backupCodes;
    secret = base32Decode(
      String(new URL(body.totpURI.replace('otpauth://', 'https://')).searchParams.get('secret')),
    );
    const confirmed = await post('/two-factor/verify-totp', { code: totp(secret) }, { cookie: enrolled.cookie });
    expect(confirmed.status, `verify-totp (enrolment): ${await confirmed.clone().text()}`).toBe(200);
    enrolledCookie = cookieHeader(confirmed);
    expect(userRow(ENROLLED_EMAIL).two_factor_enabled, 'the account is enrolled').toBeTruthy();
  }

  /**
   * Who `GET /get-session` says these headers are — the user id, or `null`.
   * Asked over HTTP, as a client asks it.
   */
  const whoIs = async (headers: Record<string, string>): Promise<string | null> => {
    const res = await get('/get-session', headers);
    if (res.status !== 200) return null;
    const text = await res.text();
    if (!text) return null;
    const body = JSON.parse(text) as { user?: { id?: unknown } } | null;
    return typeof body?.user?.id === 'string' ? body.user.id : null;
  };

  const sessionRowsOf = (userId: string) =>
    ((engine.tables.get('sys_session') ?? []) as any[]).filter((r) => String(r.user_id ?? r.userId) === userId).length;

  return {
    engine,
    manager,
    post,
    get,
    texts,
    mails,
    userRow,
    whoIs,
    sessionRowsOf,
    secret,
    backupCodes,
    enrolledId: enrolled.userId,
    enrolledCookie,
    plainId: plain.userId,
  };
};

// ── The doors ─────────────────────────────────────────────────────────────

interface Door {
  path: string;
  /** Drive the door for one of the two accounts; `cookie` rides on the door call itself. */
  pass(rig: Rig, who: 'enrolled' | 'plain', cookie?: string): Promise<Response>;
}

const accountOf = (who: 'enrolled' | 'plain') =>
  who === 'enrolled' ? { email: ENROLLED_EMAIL, phone: ENROLLED_PHONE } : { email: PLAIN_EMAIL, phone: PLAIN_PHONE };

const smsCode = async (rig: Rig, phone: string): Promise<string> => {
  const sent = await rig.post('/phone-number/send-otp', { phoneNumber: phone });
  expect(sent.status, `send-otp: ${await sent.clone().text()}`).toBe(200);
  const code = rig.texts.at(-1)?.body.match(/\b(\d{6})\b/)?.[1];
  expect(code, 'the SMS carried a code').toBeTruthy();
  return code!;
};

/** The emailed sign-in link for `email`, as the mail carried it. */
const magicLinkUrl = async (rig: Rig, email: string, callbackURL?: string): Promise<URL> => {
  const before = rig.mails.length;
  const sent = await rig.post('/sign-in/magic-link', { email, ...(callbackURL ? { callbackURL } : {}) });
  expect(sent.status, `sign-in/magic-link: ${await sent.clone().text()}`).toBe(200);
  const mail = rig.mails.slice(before).find((m) => m?.data?.magicLinkUrl);
  expect(mail, 'the sign-in link was mailed').toBeDefined();
  return new URL(String(mail.data.magicLinkUrl));
};

/** A fresh email-verification link for `email`, its account set back to unverified. */
const verifyEmailUrl = async (rig: Rig, email: string, callbackURL?: string): Promise<string> => {
  rig.userRow(email).email_verified = false;
  const { createEmailVerificationToken } = await import('better-auth/api');
  const token = await createEmailVerificationToken(SECRET, email);
  return `/verify-email?token=${token}${callbackURL ? `&callbackURL=${encodeURIComponent(callbackURL)}` : ''}`;
};

const PHONE_CODE: Door = {
  path: '/phone-number/verify',
  async pass(rig, who, cookie) {
    const { phone } = accountOf(who);
    const code = await smsCode(rig, phone);
    return rig.post('/phone-number/verify', { phoneNumber: phone, code }, cookie ? { cookie } : {});
  },
};

const MAGIC_LINK: Door = {
  path: '/magic-link/verify',
  async pass(rig, who, cookie) {
    const url = await magicLinkUrl(rig, accountOf(who).email);
    // The JSON lane: the link without its `callbackURL`. The redirect lane has
    // its own case below.
    url.searchParams.delete('callbackURL');
    return rig.get(url.toString(), cookie ? { cookie } : {});
  },
};

const VERIFY_EMAIL: Door = {
  path: '/verify-email',
  async pass(rig, who, cookie) {
    return rig.get(await verifyEmailUrl(rig, accountOf(who).email), cookie ? { cookie } : {});
  },
};

const DOORS: Door[] = [PHONE_CODE, MAGIC_LINK, VERIFY_EMAIL];

/** Every credential a response hands a client, each asked alone at `/get-session`. */
const credentialsIn = async (res: Response) => {
  const text = await res.clone().text();
  let bodyToken: string | null = null;
  try {
    const parsed = JSON.parse(text) as { token?: unknown } | null;
    bodyToken = typeof parsed?.token === 'string' ? parsed.token : null;
  } catch {
    /* not JSON */
  }
  return {
    cookie: cookieHeader(res),
    headerToken: res.headers.get('set-auth-token'),
    bodyToken,
  };
};

const expectNoUsableCredential = async (rig: Rig, res: Response) => {
  const { cookie, headerToken, bodyToken } = await credentialsIn(res);
  expect(await rig.whoIs({ cookie }), 'the response cookie resolves to nobody').toBeNull();
  if (headerToken) expect(await rig.whoIs({ authorization: `Bearer ${headerToken}` }), 'set-auth-token resolves to nobody').toBeNull();
  if (bodyToken) expect(await rig.whoIs({ authorization: `Bearer ${bodyToken}` }), 'the body token resolves to nobody').toBeNull();
};

const expectChallenge = async (res: Response) => {
  expect(res.status, await res.clone().text()).toBe(200);
  const body = (await res.clone().json()) as { twoFactorRedirect?: unknown; twoFactorMethods?: unknown };
  expect(body.twoFactorRedirect).toBe(true);
  expect(body.twoFactorMethods).toEqual(['totp']);
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const scrypt = memoizeScrypt();
afterAll(scrypt.restore);

// ───────────────────────────────────────────────────────────────────────────
describe.each(DOORS.map((door) => [door.path, door] as const))(
  'a code or link door asks an enrolled account for its second factor: %s',
  (_path, door) => {
    it('an enrolled account gets the challenge, and no usable credential', async () => {
      const rig = await arrange();
      const rowsBefore = rig.sessionRowsOf(rig.enrolledId);

      const res = await door.pass(rig, 'enrolled');

      await expectChallenge(res);
      await expectNoUsableCredential(rig, res);
      expect(rig.sessionRowsOf(rig.enrolledId), 'no session row was left behind').toBe(rowsBefore);
    }, 60_000);

    it('completing TOTP after the challenge yields the session', async () => {
      const rig = await arrange();
      const challenged = await door.pass(rig, 'enrolled');
      await expectChallenge(challenged);

      const verified = await rig.post('/two-factor/verify-totp', { code: totp(rig.secret) }, { cookie: cookieHeader(challenged) });
      expect(verified.status, await verified.clone().text()).toBe(200);
      expect(await rig.whoIs({ cookie: cookieHeader(verified) })).toBe(rig.enrolledId);
    }, 60_000);

    it('a backup code also completes the challenge', async () => {
      const rig = await arrange();
      const challenged = await door.pass(rig, 'enrolled');
      await expectChallenge(challenged);

      const verified = await rig.post(
        '/two-factor/verify-backup-code',
        { code: rig.backupCodes[0] },
        { cookie: cookieHeader(challenged) },
      );
      expect(verified.status, await verified.clone().text()).toBe(200);
      expect(await rig.whoIs({ cookie: cookieHeader(verified) })).toBe(rig.enrolledId);
    }, 60_000);

    it('a valid trust-device cookie skips the challenge and is rotated, as on the password door', async () => {
      const rig = await arrange();
      // Trust this device the way the password door does: complete a
      // challenge with `trustDevice: true`.
      const challenged = await rig.post(PASSWORD_SIGN_IN_PATH, { email: ENROLLED_EMAIL, password: PASSWORD });
      await expectChallenge(challenged);
      const trusted = await rig.post(
        '/two-factor/verify-totp',
        { code: totp(rig.secret), trustDevice: true },
        { cookie: cookieHeader(challenged) },
      );
      expect(trusted.status, await trusted.clone().text()).toBe(200);
      const trustCookie = cookieValue(trusted, 'trust_device');
      expect(trustCookie, 'verify-totp set a trust-device cookie').toBeTruthy();
      const trustPair = `${cookieHeader(trusted).split('; ').find((p) => p.split('=')[0].endsWith('trust_device'))}`;

      const res = await door.pass(rig, 'enrolled', trustPair);

      expect(res.status, await res.clone().text()).toBe(200);
      expect(((await res.clone().json()) as any).twoFactorRedirect).toBeUndefined();
      expect(await rig.whoIs({ cookie: cookieHeader(res) })).toBe(rig.enrolledId);
      const rotated = cookieValue(res, 'trust_device');
      expect(rotated, 'the trust-device cookie was rotated').toBeTruthy();
      expect(rotated).not.toBe(trustCookie);
    }, 60_000);

    it('CONTROL: an account with no enrolled factor is signed in as before', async () => {
      const rig = await arrange();
      const rowsBefore = rig.sessionRowsOf(rig.plainId);

      const res = await door.pass(rig, 'plain');

      expect(res.status, await res.clone().text()).toBe(200);
      expect(((await res.clone().json()) as any).twoFactorRedirect).toBeUndefined();
      expect(await rig.whoIs({ cookie: cookieHeader(res) })).toBe(rig.plainId);
      const headerToken = res.headers.get('set-auth-token');
      expect(headerToken, 'a bearer client still gets its token').toBeTruthy();
      expect(await rig.whoIs({ authorization: `Bearer ${headerToken}` })).toBe(rig.plainId);
      expect(rig.sessionRowsOf(rig.plainId), 'the door issued its session').toBe(rowsBefore + 1);
    }, 60_000);
  },
);

// ───────────────────────────────────────────────────────────────────────────
describe('a sign-in link asks for the second factor on its redirect lane too', () => {
  it('magic link with callbackURL: an enrolled account gets no session', async () => {
    const rig = await arrange();
    const url = await magicLinkUrl(rig, ENROLLED_EMAIL, '/console/home');
    expect(url.searchParams.get('callbackURL')).toBe('/console/home');
    const rowsBefore = rig.sessionRowsOf(rig.enrolledId);

    const res = await rig.get(url.toString());

    await expectNoUsableCredential(rig, res);
    expect(rig.sessionRowsOf(rig.enrolledId)).toBe(rowsBefore);
    expect(cookieValue(res, 'two_factor'), 'the pending second-factor cookie is set').toBeTruthy();
  }, 60_000);

  it('verify-email with callbackURL: an enrolled account gets no session', async () => {
    const rig = await arrange();
    const rowsBefore = rig.sessionRowsOf(rig.enrolledId);

    const res = await rig.get(await verifyEmailUrl(rig, ENROLLED_EMAIL, '/console/home'));

    await expectNoUsableCredential(rig, res);
    expect(rig.sessionRowsOf(rig.enrolledId)).toBe(rowsBefore);
    expect(cookieValue(res, 'two_factor'), 'the pending second-factor cookie is set').toBeTruthy();
  }, 60_000);

  it('CONTROL: magic link with callbackURL still signs in an account with no enrolled factor', async () => {
    const rig = await arrange();
    const res = await rig.get((await magicLinkUrl(rig, PLAIN_EMAIL, '/console/home')).toString());
    expect(res.status).toBe(302);
    expect(await rig.whoIs({ cookie: cookieHeader(res) })).toBe(rig.plainId);
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
describe('a door call that issues no new session is not a sign-in', () => {
  it('updatePhoneNumber for a signed-in enrolled account: not challenged, and the session is kept', async () => {
    const rig = await arrange();
    const newPhone = '+15550199';
    const code = await smsCode(rig, newPhone);
    const rowsBefore = rig.sessionRowsOf(rig.enrolledId);

    const res = await rig.post(
      '/phone-number/verify',
      { phoneNumber: newPhone, code, updatePhoneNumber: true },
      { cookie: rig.enrolledCookie },
    );

    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.clone().json()) as any).twoFactorRedirect).toBeUndefined();
    expect(await rig.whoIs({ cookie: rig.enrolledCookie }), 'the caller keeps the session it held').toBe(rig.enrolledId);
    expect(rig.sessionRowsOf(rig.enrolledId)).toBe(rowsBefore);
    expect(rig.userRow(ENROLLED_EMAIL).phone_number).toBe(newPhone);
  }, 60_000);

  it('disableSession: no session and no challenge', async () => {
    const rig = await arrange();
    const code = await smsCode(rig, ENROLLED_PHONE);
    const rowsBefore = rig.sessionRowsOf(rig.enrolledId);

    const res = await rig.post('/phone-number/verify', { phoneNumber: ENROLLED_PHONE, code, disableSession: true });

    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.clone().json()) as any;
    expect(body.twoFactorRedirect).toBeUndefined();
    expect(body.token).toBeNull();
    await expectNoUsableCredential(rig, res);
    expect(rig.sessionRowsOf(rig.enrolledId)).toBe(rowsBefore);
  }, 60_000);

  it('verify-email for an enrolled account already signed in keeps that session', async () => {
    const rig = await arrange();
    const rowsBefore = rig.sessionRowsOf(rig.enrolledId);

    const res = await rig.get(await verifyEmailUrl(rig, ENROLLED_EMAIL), { cookie: rig.enrolledCookie });

    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.clone().json()) as any).twoFactorRedirect).toBeUndefined();
    expect(await rig.whoIs({ cookie: rig.enrolledCookie })).toBe(rig.enrolledId);
    expect(rig.sessionRowsOf(rig.enrolledId)).toBe(rowsBefore);
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
describe('CONTROL: the password doors are unchanged', () => {
  it('password sign-in by email: an enrolled account gets the challenge', async () => {
    const rig = await arrange();
    const res = await rig.post(PASSWORD_SIGN_IN_PATH, { email: ENROLLED_EMAIL, password: PASSWORD });
    await expectChallenge(res);
    await expectNoUsableCredential(rig, res);
  }, 60_000);

  it('password sign-in by phone: an enrolled account gets the challenge', async () => {
    const rig = await arrange();
    const res = await rig.post('/sign-in/phone-number', { phoneNumber: ENROLLED_PHONE, password: PASSWORD });
    await expectChallenge(res);
    await expectNoUsableCredential(rig, res);
  }, 60_000);

  it('password sign-in: an account with no enrolled factor is signed in', async () => {
    const rig = await arrange();
    const res = await rig.post(PASSWORD_SIGN_IN_PATH, { email: PLAIN_EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(await rig.whoIs({ cookie: cookieHeader(res) })).toBe(rig.plainId);
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
describe('the composition', () => {
  it('builds with two-factor off and phone on, and the SMS code signs in', async () => {
    const rig = await arrange({ twoFactor: false });
    const res = await PHONE_CODE.pass(rig, 'enrolled');
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await rig.whoIs({ cookie: cookieHeader(res) })).toBe(rig.enrolledId);
  }, 60_000);

  it('the two-factor plugin carries one extra after-hook, reusing the password door challenge by reference', async () => {
    const { twoFactor } = await import('better-auth/plugins/two-factor');
    const vendor: any = twoFactor({});
    const before = [...vendor.hooks.after];
    const extended: any = requireSecondFactorAtCodeAndLinkDoors(vendor);
    expect(extended).toBe(vendor);
    expect(extended.hooks.after).toHaveLength(before.length + 1);
    const added = extended.hooks.after.at(-1);
    const passwordChallenge = before.find((h: any) => h.matcher({ path: PASSWORD_SIGN_IN_PATH }));
    expect(added.handler).toBe(passwordChallenge.handler);
    for (const path of SECOND_FACTOR_CODE_AND_LINK_DOOR_PATHS) {
      expect(added.matcher({ path, context: { newSession: { session: { token: 'issued' } }, session: null } })).toBe(true);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('vendor drift fails the build closed', () => {
  it('throws when the plugin exposes no after-hook that accepts password sign-in', () => {
    expect(() => requireSecondFactorAtCodeAndLinkDoors({ id: 'two-factor', hooks: { after: [] } })).toThrow(
      /no after-hook that accepts password sign-in/,
    );
    expect(() => requireSecondFactorAtCodeAndLinkDoors({ id: 'two-factor' })).toThrow(
      /no after-hook that accepts password sign-in/,
    );
    expect(() =>
      requireSecondFactorAtCodeAndLinkDoors({
        id: 'two-factor',
        hooks: { after: [{ matcher: (c: any) => c.path === '/sign-in/username', handler: () => undefined }] },
      }),
    ).toThrow(/no after-hook that accepts password sign-in/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the door matcher', () => {
  const issued = { session: { token: 'issued-token' } };
  it('asks on a fixed door that issued a new session', () => {
    for (const path of SECOND_FACTOR_CODE_AND_LINK_DOOR_PATHS) {
      expect(isCodeOrLinkDoorSignIn({ path, context: { newSession: issued, session: null } })).toBe(true);
      expect(isCodeOrLinkDoorSignIn({ path, context: { newSession: issued, session: { session: { token: 'other' } } } })).toBe(true);
    }
  });
  it('does not ask when no session was issued, or the caller already held it', () => {
    for (const path of SECOND_FACTOR_CODE_AND_LINK_DOOR_PATHS) {
      expect(isCodeOrLinkDoorSignIn({ path, context: { newSession: null, session: null } })).toBe(false);
      expect(isCodeOrLinkDoorSignIn({ path, context: { newSession: issued, session: issued } })).toBe(false);
    }
  });
  it('does not ask on any other path', () => {
    for (const path of [PASSWORD_SIGN_IN_PATH, '/sign-in/phone-number', '/get-session', '/update-user']) {
      expect(isCodeOrLinkDoorSignIn({ path, context: { newSession: issued, session: null } })).toBe(false);
    }
  });
});
