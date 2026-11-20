// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A credential change ends access issued before it
 * (`credential-change-ends-prior-access.ts`).
 *
 * Every door is driven through the real routes: a real `AuthManager` over a
 * real `ObjectQL` engine (better-sqlite3, this plugin's own manifest), behind
 * `AuthPlugin.registerAuthRoutes` mounted on a Hono app.
 *
 * Pinned:
 *  - an email-change link minted before a completed reset, a `/change-password`
 *    or an administrator's `/admin/set-user-password` answers what a link
 *    never issued answers (with and without a callback), the address does not
 *    move and no session is opened; a link minted after the change verifies;
 *  - a second-factor challenge opened before a reset answers what a challenge
 *    never opened answers; one opened after it completes;
 *  - a session a sign-in opens between a door's session revocation and its
 *    password write is ended by the door — the emailed reset, the texted
 *    reset, and `/change-password` asked to end the other sessions (the
 *    session it installs stands);
 *  - a password sign-in during which the account's password changes is
 *    refused with what a wrong password answers at that door (email and
 *    phone), and leaves no session;
 *  - the predicate and the clock: nothing is before a change that never
 *    happened, and the clock is the last write over the credential row.
 */

import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { AuthPlugin } from './auth-plugin.js';
import { firstPasswordRowId, issuedBeforeCredentialChange, readCredentialChangedAt } from './credential-change-ends-prior-access.js';
import { authIdentityObjects } from './manifest.js';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';
import { sqliteEnginePool } from './__tests__/sqlite-engine-pool.testkit';
// better-auth's first module load is paid here, at module load, not inside the
// first case (AGENTS.md, Build & Test: clocked windows measure behaviour).
import 'better-auth';
import 'better-auth/api';
import 'better-auth/plugins';
import 'better-auth/plugins/two-factor';

const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const SECRET = 'test-secret-at-least-32-chars-long-prior-access-ends';
const ADMIN_EMAIL = 'prior-access-admin@example.com';
const EMAIL = 'prior-access-user@example.com';
const NEW_ADDRESS = 'prior-access-moved@example.com';
const PHONE = '+15550188';
const FIRST = 'F1rst!Password-Prior';
const SECOND = 'S3cond!Password-Prior';
const SYS = { context: { isSystem: true } } as never;

const engines = sqliteEnginePool(async () => {
  const engine = new ObjectQL();
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  engine.registerDriver(driver, true);
  await engine.init();
  for (const object of authIdentityObjects) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  return { engine, driver };
});
afterEach(engines.release);
afterAll(engines.destroy);

const scrypt = memoizeScrypt();
afterAll(scrypt.restore);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const mockCtx = () =>
  ({
    registerService: vi.fn(),
    getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  }) as any;

/** Status and the error code, in either envelope the auth doors answer with. */
async function answer(res: Response): Promise<{ status: number; code?: string }> {
  const body = (await res.clone().json().catch(() => null)) as { code?: unknown; error?: { code?: unknown } } | null;
  const code = body?.error?.code ?? body?.code;
  return { status: res.status, ...(typeof code === 'string' ? { code } : {}) };
}

const cookieOf = (res: Response): string =>
  (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter(Boolean).join('; ');

/**
 * Whether a response hands its caller a session in its headers: a
 * `set-auth-token` header, or a session cookie set to a value (a cookie
 * cleared to empty hands out none).
 */
const handsOutSession = (res: Response): boolean =>
  res.headers.get('set-auth-token') !== null
  || (res.headers.getSetCookie?.() ?? []).some((c) => /session_(token|data)=[^;]+/.test(c.split(';')[0]));

// RFC 6238 TOTP, hand-rolled as `two-factor-reenrollment-verified-reset.test.ts` does.
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
    ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

/**
 * One deployment: an administrator (the first account) and the user under test
 * (signed up through an invitation, as `invite_only` admits a second account),
 * behind the real route mount, with mail and texts captured.
 */
async function stage(config: Record<string, unknown> = {}) {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const engine = await engines.take();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine as never,
    ...config,
    plugins: { admin: true, ...((config.plugins as Record<string, unknown>) ?? {}) },
  } as never);
  const mail: Array<{ template: string; to?: { address?: string }; data: Record<string, unknown> }> = [];
  manager.setEmailService({
    sendTemplate: async (input: any) => {
      mail.push(input);
      return { status: 'sent' };
    },
  } as never);
  const texts: Array<{ to: string; templateParams?: { code?: string } }> = [];
  manager.setSmsService({
    async send(input: { to: string; templateParams?: { code?: string } }) {
      texts.push(input);
      return { id: `sms${texts.length}`, status: 'sent' };
    },
    isConfigured: () => true,
  } as never);

  const app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as any).authManager = manager;
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);

  const fire = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(`${ORIGIN}${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
      body: JSON.stringify(body),
    });
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  const signUp = async (email: string, invited: boolean) => {
    const invitationId = invited ? await inviteForAudienceGate(engine, email) : undefined;
    const res = await fire('/sign-up/email', { email, password: FIRST, name: email, ...(invitationId ? { invitationId } : {}) });
    expect(res.status, `sign-up ${email}: ${await res.clone().text()}`).toBe(200);
  };
  await signUp(ADMIN_EMAIL, false);
  await signUp(EMAIL, true);

  const idOf = async (email: string) =>
    String(((await engine.find('sys_user', { where: { email }, limit: 1 }, SYS)) as Array<{ id: string }>)[0].id);
  await engine.update('sys_user', { id: await idOf(ADMIN_EMAIL), role: 'admin' }, SYS);
  const userId = await idOf(EMAIL);

  /** The bearer a password sign-in mints, the refusal's answer, and the challenge cookie when one is asked. */
  const signIn = async (email: string, password: string) => {
    const res = await fire('/sign-in/email', { email, password });
    const body = (await res.clone().json().catch(() => null)) as { twoFactorRedirect?: boolean } | null;
    return {
      ...(await answer(res)),
      bearer: res.headers.get('set-auth-token') ?? undefined,
      handsOutSession: handsOutSession(res),
      challenge: body?.twoFactorRedirect === true ? cookieOf(res) : undefined,
    };
  };

  /** The account a bearer signs in as now, or `null`. */
  const whoIs = async (token: string): Promise<string | null> => {
    const res = await app.request(`${ORIGIN}${BASE}/get-session`, { headers: { origin: ORIGIN, ...bearer(token) } });
    const body = (await res.json().catch(() => null)) as { user?: { id?: string } } | null;
    return body?.user?.id ?? null;
  };

  /** The sessions of the user that better-auth would still honour. */
  const liveSessions = async () => {
    const auth: any = await manager.getAuthContext();
    return (await auth.internalAdapter.listSessions(userId)) as Array<{ token: string }>;
  };

  const requestLink = async (): Promise<string> => {
    const before = mail.filter((m) => m.template === 'auth.password_reset').length;
    const res = await fire('/request-password-reset', { email: EMAIL, redirectTo: `${ORIGIN}/reset` });
    expect(res.status, await res.clone().text()).toBe(200);
    await vi.waitFor(() => expect(mail.filter((m) => m.template === 'auth.password_reset').length).toBe(before + 1));
    return String(mail.filter((m) => m.template === 'auth.password_reset')[before].data.token);
  };
  const reset = async (newPassword: string) => {
    const token = await requestLink();
    return answer(await fire('/reset-password', { token, newPassword }));
  };

  /** The email-change link `/change-email` mails to the new address. */
  const requestEmailChange = async (token: string, newEmail = NEW_ADDRESS): Promise<string> => {
    const toNew = () => mail.filter((m) => m.template === 'auth.verify_email' && m.to?.address === newEmail).length;
    const before = toNew();
    const res = await fire('/change-email', { newEmail, callbackURL: '/' }, bearer(token));
    expect(res.status, `change-email: ${await res.clone().text()}`).toBe(200);
    await vi.waitFor(() => expect(toNew()).toBe(before + 1));
    return String(mail.filter((m) => m.template === 'auth.verify_email' && m.to?.address === newEmail)[before].data.token);
  };

  /** What `GET /verify-email` answers a token: status, code, the redirect's error, and whether it opened a session. */
  const verifyEmail = async (token: string, callbackURL?: string) => {
    const query = `token=${encodeURIComponent(token)}${callbackURL ? `&callbackURL=${encodeURIComponent(callbackURL)}` : ''}`;
    const res = await app.request(`${ORIGIN}${BASE}/verify-email?${query}`, { method: 'GET', headers: { origin: ORIGIN } });
    const location = res.headers.get('location');
    return {
      ...(await answer(res)),
      redirectError: location ? new URL(location, ORIGIN).searchParams.get('error') : undefined,
      opensSession: /session_token=[^;]+/.test(res.headers.getSetCookie?.().join('\n') ?? ''),
    };
  };

  const emailOf = async () =>
    String(((await engine.findOne('sys_user', { where: { id: userId }, fields: ['email'], context: { isSystem: true } } as never)) as { email: string }).email);

  const admin = await signIn(ADMIN_EMAIL, FIRST);
  expect(admin.bearer, 'the administrator signs in on the bearer lane').toBeTruthy();

  /** The account's credential clock, read through the request store's own adapter. */
  const changedAt = async () => readCredentialChangedAt((await manager.getAuthContext()).internalAdapter as never, userId);

  /** Remove the account's local password: an account that signs in some other way. */
  const dropLocalPassword = async () => {
    const internal: any = (await manager.getAuthContext()).internalAdapter;
    const row = await internal.findCredentialAccount(userId);
    await internal.deleteAccount(row.id);
    expect(await internal.findCredentialAccount(userId)).toBeNull();
  };

  return {
    engine, manager, app, fire, bearer, signIn, whoIs, liveSessions, requestLink, reset, requestEmailChange,
    verifyEmail, emailOf, userId, texts, mail, changedAt, dropLocalPassword, adminBearer: admin.bearer!,
  };
}

/**
 * Move the wall clock two seconds on: past the window in which a credential
 * row's write is still its creation, and past the whole second a token minted
 * next carries as its `iat`.
 */
function advanceTheClock() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 2_000);
}

/** Turn on a TOTP second factor for the account `bearer` signs in as, and answer its secret. */
async function enrolTotp(s: Awaited<ReturnType<typeof stage>>, bearer: string): Promise<Buffer> {
  const enabled = await s.fire('/two-factor/enable', { password: FIRST }, s.bearer(bearer));
  expect(enabled.status, await enabled.clone().text()).toBe(200);
  const { totpURI } = (await enabled.json()) as { totpURI: string };
  const secret = base32Decode(String(new URL(totpURI.replace('otpauth://', 'https://')).searchParams.get('secret')));
  const confirmed = await s.fire('/two-factor/verify-totp', { code: totp(secret) }, s.bearer(bearer));
  expect(confirmed.status, await confirmed.clone().text()).toBe(200);
  return secret;
}

describe('an email-change link issued before a credential change answers what a link never issued answers', () => {
  it('after a completed reset: no session, the address stays; a link minted after the reset verifies', async () => {
    const s = await stage();
    const user = await s.signIn(EMAIL, FIRST);
    const before = await s.requestEmailChange(user.bearer!);
    const neverIssued = await s.verifyEmail('a-token-never-issued');
    expect(neverIssued).toMatchObject({ status: 401, code: 'INVALID_TOKEN', opensSession: false });

    advanceTheClock();
    expect(await s.reset(SECOND)).toEqual({ status: 200 });

    expect(await s.verifyEmail(before)).toEqual(neverIssued);
    expect(await s.emailOf()).toBe(EMAIL);
    expect(await s.liveSessions()).toEqual([]);

    // The control: a link minted after the reset verifies and moves the address.
    advanceTheClock();
    const again = await s.signIn(EMAIL, SECOND);
    const after = await s.requestEmailChange(again.bearer!);
    expect(await s.verifyEmail(after)).toMatchObject({ status: 200 });
    expect(await s.emailOf()).toBe(NEW_ADDRESS);
  }, 60_000);

  it('with a callback, it redirects with the error a link never issued redirects with', async () => {
    const s = await stage();
    const user = await s.signIn(EMAIL, FIRST);
    const before = await s.requestEmailChange(user.bearer!);
    const neverIssued = await s.verifyEmail('a-token-never-issued', '/settings');
    expect(neverIssued.redirectError).toBe('INVALID_TOKEN');

    advanceTheClock();
    expect(await s.reset(SECOND)).toEqual({ status: 200 });

    expect(await s.verifyEmail(before, '/settings')).toEqual(neverIssued);
    expect(await s.emailOf()).toBe(EMAIL);
  }, 60_000);

  it("after the user's own /change-password, sessions kept", async () => {
    const s = await stage();
    const user = await s.signIn(EMAIL, FIRST);
    const before = await s.requestEmailChange(user.bearer!);
    const neverIssued = await s.verifyEmail('a-token-never-issued');

    advanceTheClock();
    const changed = await s.fire('/change-password', { currentPassword: FIRST, newPassword: SECOND }, s.bearer(user.bearer!));
    expect(changed.status, await changed.clone().text()).toBe(200);

    expect(await s.verifyEmail(before)).toEqual(neverIssued);
    expect(await s.emailOf()).toBe(EMAIL);
  }, 60_000);

  it("after an administrator's /admin/set-user-password", async () => {
    const s = await stage();
    const user = await s.signIn(EMAIL, FIRST);
    const before = await s.requestEmailChange(user.bearer!);
    const neverIssued = await s.verifyEmail('a-token-never-issued');

    advanceTheClock();
    const set = await s.fire(
      '/admin/set-user-password',
      { userId: s.userId, newPassword: SECOND, mustChangePassword: false },
      s.bearer(s.adminBearer),
    );
    expect(set.status, await set.clone().text()).toBe(200);

    expect(await s.verifyEmail(before)).toEqual(neverIssued);
    expect(await s.emailOf()).toBe(EMAIL);
  }, 60_000);
});

describe('a second-factor challenge opened before a credential change answers what a challenge never opened answers', () => {
  it('after a completed reset; a challenge opened after it completes', async () => {
    const s = await stage({ plugins: { twoFactor: true } });
    const user = await s.signIn(EMAIL, FIRST);
    const enabled = await s.fire('/two-factor/enable', { password: FIRST }, s.bearer(user.bearer!));
    expect(enabled.status, await enabled.clone().text()).toBe(200);
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const secret = base32Decode(String(new URL(totpURI.replace('otpauth://', 'https://')).searchParams.get('secret')));
    const confirmed = await s.fire('/two-factor/verify-totp', { code: totp(secret) }, s.bearer(user.bearer!));
    expect(confirmed.status, await confirmed.clone().text()).toBe(200);

    const opened = await s.signIn(EMAIL, FIRST);
    expect(opened.challenge, 'the password sign-in stops at the challenge').toBeTruthy();
    const neverOpened = await answer(await s.fire('/two-factor/verify-totp', { code: totp(secret) }));

    advanceTheClock();
    expect(await s.reset(SECOND)).toEqual({ status: 200 });

    expect(await answer(await s.fire('/two-factor/verify-totp', { code: totp(secret) }, { cookie: opened.challenge! }))).toEqual(neverOpened);
    expect(await s.liveSessions()).toEqual([]);

    // The control: a challenge opened after the reset completes.
    const fresh = await s.signIn(EMAIL, SECOND);
    expect(fresh.challenge).toBeTruthy();
    const completed = await s.fire('/two-factor/verify-totp', { code: totp(secret) }, { cookie: fresh.challenge! });
    expect(completed.status, await completed.clone().text()).toBe(200);
  }, 60_000);
});

describe('a door that ends the sessions ends the ones opened before its password write lands', () => {
  /** Run `during` once, just before the next password write of the user reaches the store. */
  async function beforeThePasswordWrite(s: Awaited<ReturnType<typeof stage>>, verb: 'updatePassword' | 'updateAccount', during: () => Promise<void>) {
    const internal = (await s.manager.getAuthContext()).internalAdapter;
    const original = internal[verb].bind(internal);
    let ran = false;
    vi.spyOn(internal, verb).mockImplementation(async (...args: unknown[]) => {
      if (!ran) {
        ran = true;
        await during();
      }
      return original(...args);
    });
  }

  it('the emailed reset', async () => {
    const s = await stage();
    let opened: string | undefined;
    await beforeThePasswordWrite(s, 'updatePassword', async () => {
      opened = (await s.signIn(EMAIL, FIRST)).bearer;
    });

    expect(await s.reset(SECOND)).toEqual({ status: 200 });

    expect(opened, 'a sign-in ran before the password write').toBeTruthy();
    expect(await s.whoIs(opened!)).toBeNull();
    expect(await s.liveSessions()).toEqual([]);
  }, 60_000);

  it('the texted reset', async () => {
    const s = await stage({ plugins: { phoneNumber: true }, phoneOtp: { cooldownSeconds: 0 } });
    await s.engine.update('sys_user', { id: s.userId, phone_number: PHONE, phone_number_verified: true }, SYS);
    const sent = await s.fire('/phone-number/request-password-reset', { phoneNumber: PHONE });
    expect(sent.status, await sent.clone().text()).toBe(200);
    await vi.waitFor(() => expect(s.texts.length).toBe(1));
    const otp = String(s.texts[0].templateParams?.code ?? '');
    let opened: string | undefined;
    await beforeThePasswordWrite(s, 'updatePassword', async () => {
      opened = (await s.signIn(EMAIL, FIRST)).bearer;
    });

    expect(await answer(await s.fire('/phone-number/reset-password', { phoneNumber: PHONE, otp, newPassword: SECOND }))).toEqual({ status: 200 });

    expect(opened, 'a sign-in ran before the password write').toBeTruthy();
    expect(await s.whoIs(opened!)).toBeNull();
    expect(await s.liveSessions()).toEqual([]);
  }, 60_000);

  it('/change-password asked to end the other sessions; the session it installs stands', async () => {
    const s = await stage();
    const user = await s.signIn(EMAIL, FIRST);
    let opened: string | undefined;
    await beforeThePasswordWrite(s, 'updateAccount', async () => {
      opened = (await s.signIn(EMAIL, FIRST)).bearer;
    });

    const changed = await s.fire(
      '/change-password',
      { currentPassword: FIRST, newPassword: SECOND, revokeOtherSessions: true },
      s.bearer(user.bearer!),
    );
    expect(changed.status, await changed.clone().text()).toBe(200);
    const installed = String(((await changed.json()) as { token?: string }).token);

    expect(opened, 'a sign-in ran before the password write').toBeTruthy();
    expect(await s.whoIs(opened!)).toBeNull();
    expect(await s.whoIs(installed)).toBe(s.userId);
    expect((await s.liveSessions()).map((row) => row.token)).toEqual([installed]);
  }, 60_000);
});

describe('a password sign-in during which the password changes is refused', () => {
  it('it answers what a wrong password answers and leaves no session', async () => {
    const s = await stage();
    const wrong = await s.signIn(EMAIL, 'Not!The-Password-1');
    expect(wrong.status).toBe(401);
    const link = await s.requestLink();
    const internal = (await s.manager.getAuthContext()).internalAdapter;
    const original = internal.createSession.bind(internal);
    let changed: { status: number; code?: string } | undefined;
    vi.spyOn(internal, 'createSession').mockImplementation(async (...args: unknown[]) => {
      if (!changed) changed = await answer(await s.fire('/reset-password', { token: link, newPassword: SECOND }));
      return original(...args);
    });

    const raced = await s.signIn(EMAIL, FIRST);

    expect(changed).toEqual({ status: 200 });
    expect({ status: raced.status, code: raced.code }).toEqual({ status: wrong.status, code: wrong.code });
    expect(wrong.handsOutSession, 'a wrong password hands out no session').toBe(false);
    expect(raced.handsOutSession, 'the refused sign-in hands out no session token in its headers').toBe(false);
    expect(await s.liveSessions()).toEqual([]);
  }, 60_000);

  it('the phone door: it answers what a wrong password answers there and leaves no session', async () => {
    const s = await stage({ plugins: { phoneNumber: true }, phoneOtp: { cooldownSeconds: 0 } });
    await s.engine.update('sys_user', { id: s.userId, phone_number: PHONE, phone_number_verified: true }, SYS);
    const phoneSignIn = async (password: string) => {
      const res = await s.fire('/sign-in/phone-number', { phoneNumber: PHONE, password });
      return { ...(await answer(res)), handsOutSession: handsOutSession(res) };
    };
    const wrong = await phoneSignIn('Not!The-Password-1');
    expect(wrong).toMatchObject({ status: 401, code: 'INVALID_PHONE_NUMBER_OR_PASSWORD' });
    const fine = await phoneSignIn(FIRST);
    expect(fine, 'the control: the phone door hands out a session to the right password').toMatchObject({ status: 200, handsOutSession: true });
    const link = await s.requestLink();
    const internal = (await s.manager.getAuthContext()).internalAdapter;
    const original = internal.createSession.bind(internal);
    let changed: { status: number; code?: string } | undefined;
    vi.spyOn(internal, 'createSession').mockImplementation(async (...args: unknown[]) => {
      if (!changed) changed = await answer(await s.fire('/reset-password', { token: link, newPassword: SECOND }));
      return original(...args);
    });

    const raced = await phoneSignIn(FIRST);

    expect(changed).toEqual({ status: 200 });
    expect({ status: raced.status, code: raced.code }).toEqual({ status: wrong.status, code: wrong.code });
    expect(wrong.handsOutSession, 'a wrong password hands out no session').toBe(false);
    expect(raced.handsOutSession, 'the refused sign-in hands out no session token in its headers').toBe(false);
    expect(await s.liveSessions()).toEqual([]);
  }, 60_000);

  it('a sign-in the password does not change during stands (the control)', async () => {
    const s = await stage();
    const fine = await s.signIn(EMAIL, FIRST);
    expect(fine.status).toBe(200);
    expect(fine.handsOutSession).toBe(true);
    expect(await s.whoIs(fine.bearer!)).toBe(s.userId);
  }, 60_000);
});

describe('a check that cannot read its record refuses', () => {
  /** The account's credential row cannot be read through the vendor's adapter, until the spy is restored. */
  async function unreadableCredential(s: Awaited<ReturnType<typeof stage>>) {
    const internal = (await s.manager.getAuthContext()).internalAdapter;
    return vi.spyOn(internal, 'findCredentialAccount').mockRejectedValue(new Error('the credential row cannot be read'));
  }

  it('an email-change link whose clock cannot be read answers what a link never issued answers; read again, it verifies', async () => {
    const s = await stage();
    const user = await s.signIn(EMAIL, FIRST);
    const link = await s.requestEmailChange(user.bearer!);
    const neverIssued = await s.verifyEmail('a-token-never-issued');

    const unreadable = await unreadableCredential(s);
    expect(await s.verifyEmail(link)).toEqual(neverIssued);
    expect(unreadable).toHaveBeenCalled();
    expect(await s.emailOf()).toBe(EMAIL);

    // The control: the account never changed its password, so the same link verifies once the clock reads.
    unreadable.mockRestore();
    expect(await s.verifyEmail(link)).toMatchObject({ status: 200 });
    expect(await s.emailOf()).toBe(NEW_ADDRESS);
  }, 60_000);

  it('a second-factor challenge whose clock cannot be read answers what a challenge never opened answers', async () => {
    const s = await stage({ plugins: { twoFactor: true } });
    const secret = await enrolTotp(s, (await s.signIn(EMAIL, FIRST)).bearer!);
    const opened = await s.signIn(EMAIL, FIRST);
    expect(opened.challenge, 'the password sign-in stops at the challenge').toBeTruthy();
    const neverOpened = await answer(await s.fire('/two-factor/verify-totp', { code: totp(secret) }));

    const unreadable = await unreadableCredential(s);
    expect(await answer(await s.fire('/two-factor/verify-totp', { code: totp(secret) }, { cookie: opened.challenge! }))).toEqual(neverOpened);
    expect(unreadable).toHaveBeenCalled();
    unreadable.mockRestore();

    // The control: a challenge verified while the clock reads completes.
    const fresh = await s.signIn(EMAIL, FIRST);
    const completed = await s.fire('/two-factor/verify-totp', { code: totp(secret) }, { cookie: fresh.challenge! });
    expect(completed.status, await completed.clone().text()).toBe(200);
  }, 60_000);

  it('a password sign-in whose first reading cannot be taken answers what a wrong password answers and leaves no session', async () => {
    const s = await stage();
    const wrong = await s.signIn(EMAIL, 'Not!The-Password-1');
    const internal = (await s.manager.getAuthContext()).internalAdapter;
    const original = internal.findCredentialAccount.bind(internal);
    let refusedReads = 0;
    vi.spyOn(internal, 'findCredentialAccount').mockImplementation(async (...args: unknown[]) => {
      if (refusedReads === 0) {
        refusedReads += 1;
        throw new Error('the credential row cannot be read');
      }
      return (original as (...a: unknown[]) => Promise<unknown>)(...args);
    });

    // The session sign-up opened stands throughout; the refused sign-in adds none to it.
    const tokens = async () => (await s.liveSessions()).map((row) => row.token).sort();
    const sessionsBefore = await tokens();
    const refused = await s.signIn(EMAIL, FIRST);

    expect(refusedReads, 'the first reading was the one that failed').toBe(1);
    expect({ status: refused.status, code: refused.code }).toEqual({ status: wrong.status, code: wrong.code });
    expect(refused.handsOutSession).toBe(false);
    expect(await tokens()).toEqual(sessionsBefore);

    // The control: with both readings taken, the same sign-in stands and adds its session.
    const fine = await s.signIn(EMAIL, FIRST);
    expect(fine).toMatchObject({ status: 200, handsOutSession: true });
    expect(await s.whoIs(fine.bearer!)).toBe(s.userId);
    expect((await tokens()).length).toBe(sessionsBefore.length + 1);
  }, 60_000);
});

describe('the clock and the sign-in readings need no data engine', () => {
  it('on the vendor in-memory adapter: a link of an account that never changed its password verifies; one minted before a change does not; both password doors sign in', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    // No `dataEngine`: the manager runs on better-auth's own in-memory adapter.
    const manager = new AuthManager({ secret: SECRET, baseUrl: ORIGIN, plugins: { admin: true, phoneNumber: true } } as never);
    const mail: Array<{ template: string; to?: { address?: string }; data: Record<string, unknown> }> = [];
    manager.setEmailService({
      sendTemplate: async (input: any) => {
        mail.push(input);
        return { status: 'sent' };
      },
    } as never);
    manager.setSmsService({ send: async () => ({ id: 'sms', status: 'sent' }), isConfigured: () => true } as never);
    const app = new Hono();
    const ctx = mockCtx();
    const plugin = new AuthPlugin({ secret: SECRET });
    await plugin.init(ctx);
    (plugin as any).authManager = manager;
    (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);
    const fire = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      app.request(`${ORIGIN}${BASE}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
        body: JSON.stringify(body),
      });
    const verify = async (token: string) =>
      answer(await app.request(`${ORIGIN}${BASE}/verify-email?token=${encodeURIComponent(token)}`, { headers: { origin: ORIGIN } }));
    const linkTo = async (bearer: string, newEmail: string): Promise<string> => {
      const sent = () => mail.filter((m) => m.template === 'auth.verify_email' && m.to?.address === newEmail);
      const before = sent().length;
      const res = await fire('/change-email', { newEmail, callbackURL: '/' }, { authorization: `Bearer ${bearer}` });
      expect(res.status, `change-email: ${await res.clone().text()}`).toBe(200);
      await vi.waitFor(() => expect(sent().length).toBe(before + 1));
      return String(sent()[before].data.token);
    };

    // Without a data engine no sign-up door admits an account (no posture can
    // prove a first run or resolve a grant there): the account is created the
    // operator's way, by the administrator's create-user called in-process.
    const api: any = await manager.getApi();
    await api.createUser({ body: { email: EMAIL, name: EMAIL, password: FIRST } });
    const auth: any = await manager.getAuthContext();
    const internal = auth.internalAdapter;
    const userId = String((await internal.findUserByEmail(EMAIL))?.user?.id);
    await auth.adapter.update({ model: 'user', where: [{ field: 'id', value: userId }], update: { phoneNumber: PHONE, phoneNumberVerified: true } });

    const signedIn = await fire('/sign-in/email', { email: EMAIL, password: FIRST });
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);
    expect(handsOutSession(signedIn), 'the email door hands out a session').toBe(true);
    const bearer = String(signedIn.headers.get('set-auth-token'));
    const addressNow = async () => ((await internal.findUserByEmail(NEW_ADDRESS)) ? NEW_ADDRESS : 'unchanged');
    const neverIssued = await verify('a-token-never-issued');

    // Never changed: the link verifies.
    expect(await verify(await linkTo(bearer, 'prior-access-first-move@example.com'))).toMatchObject({ status: 200 });

    // Minted before a change: it answers what a link never issued answers.
    const before = await linkTo(bearer, NEW_ADDRESS);
    advanceTheClock();
    const changed = await fire('/change-password', { currentPassword: FIRST, newPassword: SECOND }, { authorization: `Bearer ${bearer}` });
    expect(changed.status, await changed.clone().text()).toBe(200);
    expect(await verify(before)).toEqual(neverIssued);
    expect(await addressNow()).toBe('unchanged');

    // The phone door's first reading names its account through the vendor's adapter too.
    const byPhone = await fire('/sign-in/phone-number', { phoneNumber: PHONE, password: SECOND });
    expect(byPhone.status, await byPhone.clone().text()).toBe(200);
    expect(handsOutSession(byPhone), 'the phone door hands out a session').toBe(true);
  }, 60_000);
});

describe('the predicate and its clock', () => {
  it('nothing is before a change that never happened; an unreadable issue time is before one that did', () => {
    expect(issuedBeforeCredentialChange(1_000, undefined)).toBe(false);
    expect(issuedBeforeCredentialChange(999, 1_000)).toBe(true);
    expect(issuedBeforeCredentialChange(1_000, 1_000)).toBe(false);
    expect(issuedBeforeCredentialChange(Number.NaN, 1_000)).toBe(true);
  });

  it("the clock is the last write over the credential row; an account's first password and no row are no change", async () => {
    const reader = (account: unknown) => ({ findCredentialAccount: async () => account }) as never;
    const created = '2026-01-01T00:00:00.000Z';
    // `u`'s first password: the row carries the id derived from the account's.
    const first = (updatedAt: unknown, createdAt: unknown = created) => reader({ id: firstPasswordRowId('u'), createdAt, updatedAt });
    expect(await readCredentialChangedAt(reader(null), 'u')).toBeUndefined();
    expect(await readCredentialChangedAt(first(created), 'u')).toBeUndefined();
    // The vendor takes the row's two stamps separately, in one write.
    expect(await readCredentialChangedAt(first('2026-01-01T00:00:00.900Z'), 'u')).toBeUndefined();
    expect(await readCredentialChangedAt(first('2026-02-01T00:00:00.000Z'), 'u')).toBe(Date.parse('2026-02-01T00:00:00.000Z'));
    // Both sides are bounded: an update stamp before the creation stamp is no creation.
    expect(await readCredentialChangedAt(first('2025-12-31T23:59:59.999Z'), 'u')).toBe(Date.parse('2025-12-31T23:59:59.999Z'));
    // The adapter answers `Date` values.
    expect(await readCredentialChangedAt(first(new Date('2026-02-01T00:00:00.000Z'), new Date(created)), 'u')).toBe(
      Date.parse('2026-02-01T00:00:00.000Z'),
    );
    await expect(
      readCredentialChangedAt({ findCredentialAccount: async () => { throw new Error('down'); } } as never, 'u'),
    ).rejects.toThrow('down');
  });

  it("a credential row that does not carry the id derived from its account's is a change at its creation", async () => {
    const at = '2026-02-01T00:00:00.000Z';
    const read = (account: unknown) => readCredentialChangedAt({ findCredentialAccount: async () => account } as never, 'u');
    // Created onto an account that was already there, outside a request, or before the rule shipped.
    expect(await read({ id: 'some-other-id', createdAt: at, updatedAt: at })).toBe(Date.parse(at));
    expect(await read({ createdAt: at, updatedAt: at })).toBe(Date.parse(at));
    // The account's own id names its `sys_user` row, never its first password.
    expect(firstPasswordRowId('u')).not.toBe('u');
    expect(await read({ id: 'u', createdAt: at, updatedAt: at })).toBe(Date.parse(at));
    // A row whose creation cannot be read is judged written over.
    expect(await read({ id: firstPasswordRowId('u'), updatedAt: at })).toBe(Date.parse(at));
  });
});

describe("an account's first password is told by the request that created the account, not by elapsed time", () => {
  /** A host database hook that holds its write past a second. */
  const hold = () => new Promise<void>((resolve) => setTimeout(resolve, 1_200));

  // The vendor stamps each row when its create is called, before that row's
  // own `create.before` hooks run: a hook held on the account's creation
  // falls between the account's stamp and its credential row's.
  it("a host hook holds the account's creation: the sign-up still creates the first password, and the verification link it mails signs in", async () => {
    const s = await stage({
      emailVerification: { autoSignInAfterVerification: true, sendOnSignUp: true },
      databaseHooks: { user: { create: { before: hold } } },
    });
    expect(await s.changedAt(), 'the password the sign-up created is the first one').toBeUndefined();
    await s.engine.update('sys_user', { id: s.userId, email_verified: false }, SYS);
    const link = s.mail.find((m) => m.template === 'auth.verify_email' && m.to?.address === EMAIL);
    expect(link, 'the sign-up mailed its verification link').toBeTruthy();
    expect(await s.verifyEmail(String(link!.data.token))).toMatchObject({ status: 200, opensSession: true });

    // The control: the same hook, on a first password a later request sets onto the account, reads a change.
    await s.dropLocalPassword();
    const set = await s.fire(
      '/admin/set-user-password',
      { userId: s.userId, newPassword: SECOND, mustChangePassword: false, revokeSessionsAndKeys: false },
      s.bearer(s.adminBearer),
    );
    expect(set.status, await set.clone().text()).toBe(200);
    expect(await s.changedAt()).toBeDefined();
  }, 60_000);

  it("a host hook runs long after the account's creation: an administrator's create-user still creates the first password", async () => {
    const s = await stage({ databaseHooks: { user: { create: { after: hold } } } });
    const res = await s.fire('/admin/create-user', { email: 'held@example.com', name: 'Held', password: SECOND }, s.bearer(s.adminBearer));
    expect(res.status, await res.clone().text()).toBe(200);
    const internal: any = (await s.manager.getAuthContext()).internalAdapter;
    const id = String((await internal.findUserByEmail('held@example.com'))?.user?.id);
    expect(await readCredentialChangedAt(internal, id)).toBeUndefined();
  }, 60_000);
});

describe("a door that creates the account's first password is a credential change", () => {
  it('the control: an account that signed up with a password has never changed it', async () => {
    const s = await stage();
    expect(await s.changedAt()).toBeUndefined();
    const user = await s.signIn(EMAIL, FIRST);
    expect(await s.verifyEmail(await s.requestEmailChange(user.bearer!))).toMatchObject({ status: 200 });
  }, 60_000);

  it('the emailed reset: an email-change link minted before it answers what a link never issued answers', async () => {
    const s = await stage();
    const user = await s.signIn(EMAIL, FIRST);
    const before = await s.requestEmailChange(user.bearer!);
    const neverIssued = await s.verifyEmail('a-token-never-issued');
    await s.dropLocalPassword();
    expect(await s.changedAt()).toBeUndefined();

    advanceTheClock();
    expect(await s.reset(SECOND)).toEqual({ status: 200 });

    expect(await s.changedAt(), 'the reset created the first password: a change').toBeDefined();
    expect(await s.verifyEmail(before)).toEqual(neverIssued);
    expect(await s.emailOf()).toBe(EMAIL);

    // The control: a link minted after the reset verifies.
    advanceTheClock();
    const again = await s.signIn(EMAIL, SECOND);
    expect(await s.verifyEmail(await s.requestEmailChange(again.bearer!))).toMatchObject({ status: 200 });
    expect(await s.emailOf()).toBe(NEW_ADDRESS);
  }, 60_000);

  it('the texted reset: the same', async () => {
    const s = await stage({ plugins: { phoneNumber: true }, phoneOtp: { cooldownSeconds: 0 } });
    await s.engine.update('sys_user', { id: s.userId, phone_number: PHONE, phone_number_verified: true }, SYS);
    const user = await s.signIn(EMAIL, FIRST);
    const before = await s.requestEmailChange(user.bearer!);
    const neverIssued = await s.verifyEmail('a-token-never-issued');
    await s.dropLocalPassword();

    advanceTheClock();
    const sent = await s.fire('/phone-number/request-password-reset', { phoneNumber: PHONE });
    expect(sent.status, await sent.clone().text()).toBe(200);
    await vi.waitFor(() => expect(s.texts.length).toBe(1));
    const otp = String(s.texts[0].templateParams?.code ?? '');
    expect(await answer(await s.fire('/phone-number/reset-password', { phoneNumber: PHONE, otp, newPassword: SECOND }))).toEqual({ status: 200 });

    expect(await s.changedAt()).toBeDefined();
    expect(await s.verifyEmail(before)).toEqual(neverIssued);
    expect(await s.emailOf()).toBe(EMAIL);
  }, 60_000);

  it("an administrator's /admin/set-user-password: the same", async () => {
    const s = await stage();
    const user = await s.signIn(EMAIL, FIRST);
    const before = await s.requestEmailChange(user.bearer!);
    const neverIssued = await s.verifyEmail('a-token-never-issued');
    await s.dropLocalPassword();

    advanceTheClock();
    const set = await s.fire(
      '/admin/set-user-password',
      { userId: s.userId, newPassword: SECOND, mustChangePassword: false, revokeSessionsAndKeys: false },
      s.bearer(s.adminBearer),
    );
    expect(set.status, await set.clone().text()).toBe(200);

    expect(await s.changedAt()).toBeDefined();
    expect(await s.verifyEmail(before)).toEqual(neverIssued);
    expect(await s.emailOf()).toBe(EMAIL);
  }, 60_000);
});

describe('a link that signs its holder in, minted before a credential change, answers what a link never issued answers', () => {
  /** The verification link `/send-verification-email` mails the account, for an account whose address is not yet verified. */
  async function verificationLink(s: Awaited<ReturnType<typeof stage>>, bearerToken: string): Promise<string> {
    await s.engine.update('sys_user', { id: s.userId, email_verified: false }, SYS);
    const sent = () => s.mail.filter((m) => m.template === 'auth.verify_email' && m.to?.address === EMAIL);
    const before = sent().length;
    const res = await s.fire('/send-verification-email', { email: EMAIL }, s.bearer(bearerToken));
    expect(res.status, `send-verification-email: ${await res.clone().text()}`).toBe(200);
    await vi.waitFor(() => expect(sent().length).toBe(before + 1));
    return String(sent()[before].data.token);
  }
  const verified = async (s: Awaited<ReturnType<typeof stage>>) =>
    Boolean(((await s.engine.findOne('sys_user', { where: { id: s.userId }, context: { isSystem: true } } as never)) as { email_verified?: unknown }).email_verified);

  it('a verification link with auto-sign-in: no session, the address stays unverified; one minted after signs in', async () => {
    const s = await stage({ emailVerification: { autoSignInAfterVerification: true } });
    const user = await s.signIn(EMAIL, FIRST);
    const before = await verificationLink(s, user.bearer!);
    const neverIssued = await s.verifyEmail('a-token-never-issued');
    expect(neverIssued).toMatchObject({ status: 401, code: 'INVALID_TOKEN', opensSession: false });

    advanceTheClock();
    const changed = await s.fire('/change-password', { currentPassword: FIRST, newPassword: SECOND }, s.bearer(user.bearer!));
    expect(changed.status, await changed.clone().text()).toBe(200);

    expect(await s.verifyEmail(before)).toEqual(neverIssued);
    expect(await verified(s)).toBe(false);

    // The control: a link minted after the change verifies and signs its holder in.
    advanceTheClock();
    const again = await s.signIn(EMAIL, SECOND);
    expect(await s.verifyEmail(await verificationLink(s, again.bearer!))).toMatchObject({ status: 200, opensSession: true });
    expect(await verified(s)).toBe(true);
  }, 60_000);

  it('the control: with auto-sign-in off the link signs nobody in, and the vendor judges it as before', async () => {
    const s = await stage();
    const user = await s.signIn(EMAIL, FIRST);
    const before = await verificationLink(s, user.bearer!);

    advanceTheClock();
    const changed = await s.fire('/change-password', { currentPassword: FIRST, newPassword: SECOND }, s.bearer(user.bearer!));
    expect(changed.status, await changed.clone().text()).toBe(200);

    expect(await s.verifyEmail(before)).toMatchObject({ status: 200, opensSession: false });
    expect(await verified(s)).toBe(true);
  }, 60_000);

  it('a magic link: its never-issued redirect and no session; one minted after signs in', async () => {
    const s = await stage({ plugins: { magicLink: true } });
    const user = await s.signIn(EMAIL, FIRST);
    const magicLink = async (): Promise<string> => {
      const sent = () => s.mail.filter((m) => m.template === 'auth.magic_link');
      const before = sent().length;
      const res = await s.fire('/sign-in/magic-link', { email: EMAIL, callbackURL: '/' });
      expect(res.status, `sign-in/magic-link: ${await res.clone().text()}`).toBe(200);
      await vi.waitFor(() => expect(sent().length).toBe(before + 1));
      return String(sent()[before].data.token);
    };
    const open = async (token: string) => {
      const res = await s.app.request(`${ORIGIN}${BASE}/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=%2Fhome`, {
        headers: { origin: ORIGIN },
      });
      const location = res.headers.get('location');
      return {
        status: res.status,
        redirectError: location ? new URL(location, ORIGIN).searchParams.get('error') : undefined,
        opensSession: /session_token=[^;]+/.test(res.headers.getSetCookie?.().join('\n') ?? ''),
      };
    };
    const before = await magicLink();
    const neverIssued = await open('a-link-never-issued');
    expect(neverIssued).toMatchObject({ redirectError: 'INVALID_TOKEN', opensSession: false });

    advanceTheClock();
    const changed = await s.fire('/change-password', { currentPassword: FIRST, newPassword: SECOND }, s.bearer(user.bearer!));
    expect(changed.status, await changed.clone().text()).toBe(200);

    expect(await open(before)).toEqual(neverIssued);

    // The control: a link minted after the change signs its holder in.
    expect(await open(await magicLink())).toMatchObject({ redirectError: null, opensSession: true });
  }, 60_000);
});

describe('a sign-in code texted before a credential change answers what a code never sent answers', () => {
  async function phoneStage() {
    const s = await stage({ plugins: { phoneNumber: true }, phoneOtp: { cooldownSeconds: 0 } });
    await s.engine.update('sys_user', { id: s.userId, phone_number: PHONE, phone_number_verified: true }, SYS);
    /** The code `/phone-number/send-otp` texts the number. */
    const sendCode = async (): Promise<string> => {
      const before = s.texts.length;
      const res = await s.fire('/phone-number/send-otp', { phoneNumber: PHONE });
      expect(res.status, `send-otp: ${await res.clone().text()}`).toBe(200);
      await vi.waitFor(() => expect(s.texts.length).toBe(before + 1));
      return String(s.texts[before].templateParams?.code ?? '');
    };
    /** What `/phone-number/verify` answers, and whether it hands out a session. */
    const verify = async (code: string, extra: Record<string, unknown> = {}, phoneNumber = PHONE) => {
      const res = await s.fire('/phone-number/verify', { phoneNumber, code, ...extra });
      return { ...(await answer(res)), handsOutSession: handsOutSession(res) };
    };
    // A number no code was ever texted to.
    const neverSent = await verify('000000', {}, '+15550199');
    expect(neverSent).toMatchObject({ status: 400, code: 'OTP_NOT_FOUND', handsOutSession: false });
    const change = async () => {
      const user = await s.signIn(EMAIL, FIRST);
      advanceTheClock();
      const changed = await s.fire('/change-password', { currentPassword: FIRST, newPassword: SECOND }, s.bearer(user.bearer!));
      expect(changed.status, await changed.clone().text()).toBe(200);
    };
    return { s, sendCode, verify, neverSent, change };
  }

  it('at /phone-number/verify: no session; a code texted after the change signs in', async () => {
    const { sendCode, verify, neverSent, change } = await phoneStage();
    const before = await sendCode();
    await change();

    expect(await verify(before)).toEqual(neverSent);

    // The control: a code texted after the change signs its holder in.
    expect(await verify(await sendCode())).toMatchObject({ status: 200, handsOutSession: true });
  }, 60_000);

  it('a wrong attempt that writes the code again after the change does not date it after the change', async () => {
    const { sendCode, verify, neverSent, change } = await phoneStage();
    const before = await sendCode();
    await change();
    // A request that signs nobody in is not judged; its wrong attempt writes the code's row again.
    const wrong = String((Number(before) + 1) % 1_000_000).padStart(before.length, '0');
    expect(await verify(wrong, { disableSession: true })).toMatchObject({ status: 400, code: 'INVALID_OTP' });

    expect(await verify(before)).toEqual(neverSent);
  }, 60_000);
});
