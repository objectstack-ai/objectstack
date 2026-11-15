// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0069 D2 — the rule under test: a locked account is refused on every
// door that ends in a session for that account, with the answer password
// sign-in gives under the deployment's `lockoutRefusal`. Every password door
// counts its refused attempts toward the lock and checks the lock before its
// credential, so its answer for a locked account is the same whichever
// password it is sent.
//
// Real better-auth pipeline throughout: requests go in as `Request` objects
// through `AuthManager.handleRequest`, the codes and links are the ones the
// running plugins minted and handed to the SMS and email services, the lock is
// the account's own `locked_until`, and "was a session issued" is read from the
// `sys_session` rows themselves.
//
// The reference answer is always measured, never restated: the answer
// `/sign-in/email` gives the same locked account in the same deployment.

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { AuthManager } from './auth-manager';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';
import { inviteForAudienceGate } from './audience-gate-test-support';
import type { AuthSessionAuditEventInput } from './auth-session-audit';
// Vendor modules paid at module load, never inside a clocked case.
import 'better-auth';
import 'better-auth/api';
import 'better-auth/plugins';
import 'better-auth/plugins/bearer';
import 'better-auth/plugins/two-factor';
import 'better-auth/plugins/phone-number';
import 'better-auth/plugins/magic-link';
import 'better-auth/plugins/admin';
import '@better-auth/core/context';
import '@better-auth/core/error';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-locked-doors';
const WRONG_PASSWORD = 'Wr0ng!Guess-Zebra-7731';
const ORIGIN = 'http://localhost:3000';
const BASE = `${ORIGIN}/api/v1/auth`;
const THRESHOLD = 3;
const PLAIN = { email: 'plain@example.com', phone: '+15550143' };
const ENROLLED = { email: 'enrolled@example.com', phone: '+15550142' };
const ADMIN = { email: 'admin@example.com', phone: '+15550144' };
const PS_ADMIN = 'ps_admin_full_access';

type Refusal = 'uniform' | 'explicit';

// ── RFC 6238 TOTP (the vendor defaults: SHA-1, 6 digits, 30 s) ────────────
function base32Decode(input: string): Buffer {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | ALPHABET.indexOf(char);
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

type Rig = Awaited<ReturnType<typeof arrange>>;

const arrange = async (lockoutRefusal: Refusal = 'uniform', options: { lockoutThreshold?: number } = {}) => {
  const engine: any = createMemoryEngine();
  const texts: { to: string; body: string }[] = [];
  const mails: any[] = [];
  const events: AuthSessionAuditEventInput[] = [];
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    lockoutThreshold: options.lockoutThreshold ?? THRESHOLD,
    lockoutDurationMinutes: 15,
    lockoutRefusal,
    plugins: { twoFactor: true, phoneNumber: true, magicLink: true, admin: true },
    emailVerification: { autoSignInAfterVerification: true },
    getAuditSink: () => ({
      recordAuthEvent: async (event: AuthSessionAuditEventInput) => {
        events.push(event);
      },
    }),
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

  const signUp = async ({ email, phone }: { email: string; phone: string }) => {
    const invitationId = await inviteForAudienceGate(manager, email);
    const res = await post('/sign-up/email', { email, password: PASSWORD, name: email.split('@')[0], invitationId });
    expect(res.status, `sign-up/email: ${await res.clone().text()}`).toBe(200);
    // A verified phone and address: an account in ordinary use.
    const row = userRow(email);
    row.phone_number = phone;
    row.phone_number_verified = true;
    row.email_verified = true;
    return { cookie: cookieHeader(res), userId: String(row.id) };
  };

  const plain = await signUp(PLAIN);
  const enrolled = await signUp(ENROLLED);
  const admin = await signUp(ADMIN);

  // The ENROLLED account: TOTP enabled and confirmed.
  const enabled = await post('/two-factor/enable', { password: PASSWORD }, { cookie: enrolled.cookie });
  expect(enabled.status, `two-factor/enable: ${await enabled.clone().text()}`).toBe(200);
  const { totpURI, backupCodes } = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
  const secret = base32Decode(String(new URL(totpURI.replace('otpauth://', 'https://')).searchParams.get('secret')));
  const confirmed = await post('/two-factor/verify-totp', { code: totp(secret) }, { cookie: enrolled.cookie });
  expect(confirmed.status, `verify-totp (enrolment): ${await confirmed.clone().text()}`).toBe(200);

  const sessionRows = (userId: string) =>
    ((engine.tables.get('sys_session') ?? []) as any[]).filter((r) => String(r.user_id ?? r.userId) === userId).length;

  /** Lock the account the way a run of wrong passwords leaves it. */
  const lock = (email: string, minutes = 10) => {
    const row = userRow(email);
    row.failed_login_count = THRESHOLD;
    row.locked_until = new Date(Date.now() + minutes * 60_000);
  };

  return {
    engine,
    manager,
    post,
    get,
    texts,
    mails,
    events,
    userRow,
    sessionRows,
    lock,
    secret,
    backupCodes,
    plainId: plain.userId,
    plainCookie: plain.cookie,
    enrolledId: enrolled.userId,
    adminId: admin.userId,
  };
};

/** The refusal's envelope: status, machine code and sentence. */
const answerOf = async (res: Response) => {
  const text = await res.clone().text();
  let body: { code?: unknown; message?: unknown } = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, code: body.code, message: body.message };
};

/** What `/sign-in/email` answers this locked account with the correct password: the reference. */
const passwordSignInAnswer = async (rig: Rig, email: string) =>
  answerOf(await rig.post('/sign-in/email', { email, password: PASSWORD }));

const EXPECTED_CODE: Record<Refusal, string> = {
  explicit: 'ACCOUNT_LOCKED',
  uniform: 'INVALID_EMAIL_OR_PASSWORD',
};
const EXPECTED_STATUS: Record<Refusal, number> = { explicit: 403, uniform: 401 };

// ── The code and link doors ───────────────────────────────────────────────

interface Door {
  path: string;
  label: string;
  pass(rig: Rig, who: { email: string; phone: string }): Promise<Response>;
}

const smsCode = async (rig: Rig, phone: string): Promise<string> => {
  const sent = await rig.post('/phone-number/send-otp', { phoneNumber: phone });
  expect(sent.status, `send-otp: ${await sent.clone().text()}`).toBe(200);
  const code = rig.texts.at(-1)?.body.match(/\b(\d{6})\b/)?.[1];
  expect(code, 'the SMS carried a code').toBeTruthy();
  return code!;
};

const magicLinkUrl = async (rig: Rig, email: string, callbackURL?: string): Promise<URL> => {
  const before = rig.mails.length;
  const sent = await rig.post('/sign-in/magic-link', { email, ...(callbackURL ? { callbackURL } : {}) });
  expect(sent.status, `sign-in/magic-link: ${await sent.clone().text()}`).toBe(200);
  const mail = rig.mails.slice(before).find((m) => m?.data?.magicLinkUrl);
  expect(mail, 'the sign-in link was mailed').toBeDefined();
  return new URL(String(mail.data.magicLinkUrl));
};

const DOORS: Door[] = [
  {
    path: '/phone-number/verify',
    label: 'the SMS one-time code',
    async pass(rig, who) {
      const code = await smsCode(rig, who.phone);
      return rig.post('/phone-number/verify', { phoneNumber: who.phone, code });
    },
  },
  {
    path: '/magic-link/verify',
    label: 'the emailed sign-in link, JSON lane',
    async pass(rig, who) {
      const url = await magicLinkUrl(rig, who.email);
      url.searchParams.delete('callbackURL');
      return rig.get(url.toString());
    },
  },
  {
    path: '/magic-link/verify',
    label: 'the emailed sign-in link, callbackURL lane',
    async pass(rig, who) {
      return rig.get((await magicLinkUrl(rig, who.email, '/after-sign-in')).toString());
    },
  },
  {
    path: '/verify-email',
    label: 'the verification link that signs the caller in',
    async pass(rig, who) {
      rig.userRow(who.email).email_verified = false;
      const { createEmailVerificationToken } = await import('better-auth/api');
      return rig.get(`/verify-email?token=${await createEmailVerificationToken(SECRET, who.email)}`);
    },
  },
];

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const scrypt = memoizeScrypt();
afterAll(scrypt.restore);

describe.each(['explicit', 'uniform'] as const)(
  'a locked account is refused on every door that ends in a session for it (lockoutRefusal: %s)',
  (refusal) => {
    it.each(DOORS.map((door) => [door.label, door] as const))(
      '%s: no session, and the answer password sign-in gives',
      async (_label, door) => {
        const rig = await arrange(refusal);
        rig.lock(PLAIN.email);
        const reference = await passwordSignInAnswer(rig, PLAIN.email);
        expect(reference.status).toBe(EXPECTED_STATUS[refusal]);
        expect(reference.code).toBe(EXPECTED_CODE[refusal]);
        const rowsBefore = rig.sessionRows(rig.plainId);

        const res = await door.pass(rig, PLAIN);

        expect(await answerOf(res)).toEqual(reference);
        expect(rig.sessionRows(rig.plainId), 'no session row was written').toBe(rowsBefore);
      },
      60_000,
    );

    it.each(DOORS.map((door) => [door.label, door] as const))(
      '%s: the refused attempt writes its login_failed row, as password sign-in does',
      async (_label, door) => {
        const rig = await arrange(refusal);
        rig.lock(PLAIN.email);

        await door.pass(rig, PLAIN);

        const rows = rig.events.filter((e: any) => e?.action === 'login_failed' && e.userId === rig.plainId);
        expect(rows.map((e: any) => e.context)).toEqual([{ endpoint: door.path, reason: 'ACCOUNT_LOCKED' }]);
      },
      60_000,
    );

    it('/two-factor/verify-totp: an enrolled account locked after its challenge gets no session', async () => {
      const rig = await arrange(refusal);
      const challenged = await rig.post('/sign-in/email', { email: ENROLLED.email, password: PASSWORD });
      expect(((await challenged.clone().json()) as any).twoFactorRedirect).toBe(true);
      rig.lock(ENROLLED.email);
      const reference = await passwordSignInAnswer(rig, ENROLLED.email);
      const rowsBefore = rig.sessionRows(rig.enrolledId);

      const res = await rig.post('/two-factor/verify-totp', { code: totp(rig.secret) }, { cookie: cookieHeader(challenged) });

      expect(await answerOf(res)).toEqual(reference);
      expect(rig.sessionRows(rig.enrolledId), 'no session row was written').toBe(rowsBefore);
    }, 60_000);

    it('/two-factor/verify-backup-code: an enrolled account locked after its challenge gets no session', async () => {
      const rig = await arrange(refusal);
      const challenged = await rig.post('/sign-in/email', { email: ENROLLED.email, password: PASSWORD });
      expect(((await challenged.clone().json()) as any).twoFactorRedirect).toBe(true);
      rig.lock(ENROLLED.email);
      const reference = await passwordSignInAnswer(rig, ENROLLED.email);
      const rowsBefore = rig.sessionRows(rig.enrolledId);

      const res = await rig.post('/two-factor/verify-backup-code', { code: rig.backupCodes[0] }, { cookie: cookieHeader(challenged) });

      expect(await answerOf(res)).toEqual(reference);
      expect(rig.sessionRows(rig.enrolledId), 'no session row was written').toBe(rowsBefore);
    }, 60_000);

    it('a code door gives an enrolled locked account no second-factor challenge, and no session', async () => {
      const rig = await arrange(refusal);
      rig.lock(ENROLLED.email);
      const reference = await passwordSignInAnswer(rig, ENROLLED.email);
      const rowsBefore = rig.sessionRows(rig.enrolledId);

      const res = await DOORS[0].pass(rig, ENROLLED);

      expect(await answerOf(res)).toEqual(reference);
      expect(rig.sessionRows(rig.enrolledId)).toBe(rowsBefore);
    }, 60_000);

    it('/sign-in/phone-number: a locked account gets one answer whatever the password, and no session', async () => {
      const rig = await arrange(refusal);
      rig.lock(PLAIN.email);
      const rowsBefore = rig.sessionRows(rig.plainId);

      const correct = await answerOf(await rig.post('/sign-in/phone-number', { phoneNumber: PLAIN.phone, password: PASSWORD }));
      const wrong = await answerOf(await rig.post('/sign-in/phone-number', { phoneNumber: PLAIN.phone, password: WRONG_PASSWORD }));

      expect(correct).toEqual(wrong);
      // `uniform` is that door's own wrong-password answer; `explicit` is the
      // `403 ACCOUNT_LOCKED` password sign-in gives.
      expect(correct.status).toBe(EXPECTED_STATUS[refusal]);
      expect(correct.code).toBe(refusal === 'explicit' ? 'ACCOUNT_LOCKED' : 'INVALID_PHONE_NUMBER_OR_PASSWORD');
      expect(rig.sessionRows(rig.plainId), 'no session row was written').toBe(rowsBefore);
      const rows = rig.events.filter((e: any) => e?.action === 'login_failed' && e.userId === rig.plainId);
      expect(rows.map((e: any) => e.context?.endpoint)).toEqual(['/sign-in/phone-number', '/sign-in/phone-number']);
    }, 60_000);

    it('CONTROL: password sign-in is unchanged — refused, one login_failed row, no session', async () => {
      const rig = await arrange(refusal);
      rig.lock(PLAIN.email);
      const rowsBefore = rig.sessionRows(rig.plainId);

      const answer = await passwordSignInAnswer(rig, PLAIN.email);

      expect(answer.status).toBe(EXPECTED_STATUS[refusal]);
      expect(answer.code).toBe(EXPECTED_CODE[refusal]);
      expect(rig.sessionRows(rig.plainId)).toBe(rowsBefore);
      const rows = rig.events.filter((e: any) => e?.action === 'login_failed' && e.userId === rig.plainId);
      expect(rows.map((e: any) => e.context)).toEqual([{ endpoint: '/sign-in/email', reason: 'ACCOUNT_LOCKED' }]);
    }, 60_000);
  },
);

describe('an unlocked account, and a lock that has run out, still sign in at every door', () => {
  it.each(DOORS.map((door) => [door.label, door] as const))('%s: an unlocked account gets its session', async (_label, door) => {
    const rig = await arrange();
    const rowsBefore = rig.sessionRows(rig.plainId);

    const res = await door.pass(rig, PLAIN);

    expect(res.status, await res.clone().text()).toBeLessThan(400);
    expect(rig.sessionRows(rig.plainId)).toBe(rowsBefore + 1);
  }, 60_000);

  it.each(DOORS.map((door) => [door.label, door] as const))('%s: an expired lock admits', async (_label, door) => {
    const rig = await arrange();
    rig.lock(PLAIN.email, -1);
    const rowsBefore = rig.sessionRows(rig.plainId);

    const res = await door.pass(rig, PLAIN);

    expect(res.status, await res.clone().text()).toBeLessThan(400);
    expect(rig.sessionRows(rig.plainId)).toBe(rowsBefore + 1);
  }, 60_000);

  it('with the lockout off, a stored lock is not read, as at /sign-in/email', async () => {
    const rig = await arrange('explicit', { lockoutThreshold: 0 });
    rig.lock(PLAIN.email);
    const rowsBefore = rig.sessionRows(rig.plainId);

    const res = await DOORS[0].pass(rig, PLAIN);

    expect(res.status, await res.clone().text()).toBe(200);
    expect(rig.sessionRows(rig.plainId)).toBe(rowsBefore + 1);
  }, 60_000);

  it('/sign-in/phone-number: an unlocked account signs in', async () => {
    const rig = await arrange();
    const res = await rig.post('/sign-in/phone-number', { phoneNumber: PLAIN.phone, password: PASSWORD });
    expect(res.status, await res.clone().text()).toBe(200);
  }, 60_000);

  it('CONTROL: the second-factor challenge is unchanged for an unlocked enrolled account', async () => {
    const rig = await arrange();
    const challenged = await DOORS[0].pass(rig, ENROLLED);
    expect(((await challenged.clone().json()) as any).twoFactorRedirect).toBe(true);

    const verified = await rig.post('/two-factor/verify-totp', { code: totp(rig.secret) }, { cookie: cookieHeader(challenged) });

    expect(verified.status, await verified.clone().text()).toBe(200);
  }, 60_000);
});

describe('every password door counts its refused attempts toward the lock', () => {
  it(`${THRESHOLD} wrong passwords at /sign-in/phone-number lock the account`, async () => {
    const rig = await arrange('explicit');
    for (let i = 0; i < THRESHOLD; i++) {
      const res = await rig.post('/sign-in/phone-number', { phoneNumber: PLAIN.phone, password: WRONG_PASSWORD });
      expect(res.status).toBe(401);
    }

    expect(rig.userRow(PLAIN.email).failed_login_count).toBe(THRESHOLD);
    expect(new Date(rig.userRow(PLAIN.email).locked_until).getTime()).toBeGreaterThan(Date.now());
    const after = await answerOf(await rig.post('/sign-in/phone-number', { phoneNumber: PLAIN.phone, password: PASSWORD }));
    expect(after.code).toBe('ACCOUNT_LOCKED');
    expect(rig.events.some((e: any) => e?.action === 'account_locked' && e.userId === rig.plainId && e.context?.endpoint === '/sign-in/phone-number')).toBe(true);
  }, 60_000);

  it('a correct password at /sign-in/phone-number resets the count, as at /sign-in/email', async () => {
    const rig = await arrange();
    for (let i = 0; i < THRESHOLD - 1; i++) {
      await rig.post('/sign-in/phone-number', { phoneNumber: PLAIN.phone, password: WRONG_PASSWORD });
    }
    expect(rig.userRow(PLAIN.email).failed_login_count).toBe(THRESHOLD - 1);

    const res = await rig.post('/sign-in/phone-number', { phoneNumber: PLAIN.phone, password: PASSWORD });

    expect(res.status, await res.clone().text()).toBe(200);
    expect(Number(rig.userRow(PLAIN.email).failed_login_count) || 0).toBe(0);
  }, 60_000);

  it('CONTROL: /sign-in/email counts and resets as before', async () => {
    const rig = await arrange('explicit');
    for (let i = 0; i < THRESHOLD - 1; i++) {
      await rig.post('/sign-in/email', { email: PLAIN.email, password: WRONG_PASSWORD });
    }
    expect(rig.userRow(PLAIN.email).failed_login_count).toBe(THRESHOLD - 1);
    expect((await rig.post('/sign-in/email', { email: PLAIN.email, password: PASSWORD })).status).toBe(200);
    expect(Number(rig.userRow(PLAIN.email).failed_login_count) || 0).toBe(0);

    for (let i = 0; i < THRESHOLD; i++) {
      await rig.post('/sign-in/email', { email: PLAIN.email, password: WRONG_PASSWORD });
    }
    expect(new Date(rig.userRow(PLAIN.email).locked_until).getTime()).toBeGreaterThan(Date.now());
  }, 60_000);
});

describe('CONTROL: administrative sessions for a locked account keep working', () => {
  /** Grant platform admin the ADR-0068 D2 way and sign the admin in; resolves its bearer. */
  const platformAdminBearer = async (rig: Rig): Promise<string> => {
    if (!(rig.engine.tables.get('sys_permission_set') ?? []).some((r: any) => r.id === PS_ADMIN)) {
      await rig.engine.insert('sys_permission_set', { id: PS_ADMIN, name: ADMIN_FULL_ACCESS });
    }
    let org = (rig.engine.tables.get('sys_organization') ?? []).find((r: any) => r.slug === 'default');
    if (!org) {
      await rig.engine.insert('sys_organization', { id: 'org_default', name: 'Default Organization', slug: 'default' });
      org = { id: 'org_default' };
    }
    await rig.engine.insert('sys_user_permission_set', {
      user_id: rig.adminId,
      permission_set_id: PS_ADMIN,
      permission_set: 'admin_full_access',
      organization_id: String(org.id),
    });
    const signedIn = await rig.post('/sign-in/email', { email: ADMIN.email, password: PASSWORD });
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);
    return String(signedIn.headers.get('set-auth-token'));
  };

  it('an administrator impersonates a locked account', async () => {
    const rig = await arrange('explicit');
    const bearer = await platformAdminBearer(rig);
    rig.lock(PLAIN.email);
    const rowsBefore = rig.sessionRows(rig.plainId);

    const res = await rig.post('/admin/impersonate-user', { userId: rig.plainId }, { authorization: `Bearer ${bearer}` });

    expect(res.status, await res.clone().text()).toBe(200);
    expect(rig.sessionRows(rig.plainId)).toBe(rowsBefore + 1);
  }, 60_000);

  it("a locked administrator's own session is still rotated when impersonating", async () => {
    const rig = await arrange('explicit');
    const bearer = await platformAdminBearer(rig);
    rig.lock(ADMIN.email);

    const res = await rig.post('/admin/impersonate-user', { userId: rig.plainId }, { authorization: `Bearer ${bearer}` });

    expect(res.status, await res.clone().text()).toBe(200);
  }, 60_000);

  it('a locked, signed-in account changes its password and ends its other sessions', async () => {
    const rig = await arrange('explicit');
    rig.lock(PLAIN.email);

    const res = await rig.post(
      '/change-password',
      { currentPassword: PASSWORD, newPassword: 'N3w!Passw0rd-locked-Q9', revokeOtherSessions: true },
      { cookie: rig.plainCookie },
    );

    expect(res.status, await res.clone().text()).toBe(200);
    expect(rig.sessionRows(rig.plainId)).toBe(1);
  }, 60_000);

  it('the in-process principal session is minted for a locked account', async () => {
    const rig = await arrange('explicit');
    rig.lock(PLAIN.email);

    const minted = await rig.manager.mintPrincipalSession({ userId: rig.plainId, principalKind: 'human' } as any, { ttlSeconds: 60 });

    expect(typeof minted.token).toBe('string');
  }, 60_000);
});
