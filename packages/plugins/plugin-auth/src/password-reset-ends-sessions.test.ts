// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A completed password reset ends the account's other sessions
 * (`password-reset-ends-sessions.ts`).
 *
 * Driven end to end through `AuthManager.handleRequest` over a real `ObjectQL`
 * engine (better-sqlite3, this plugin's own manifest): sign in, request a
 * reset, complete it with the token the reset mail carries, then present the
 * session that was signed in before.
 *
 * Pinned:
 *  - the session signed in before a completed reset is refused afterwards
 *    (401 `UNAUTHENTICATED`, the declared answer for no session), and a fresh
 *    sign-in with the new password is served (the control: the account works);
 *  - the same through the phone OTP reset (`plugins.phoneNumber` with an SMS
 *    service): the session signed in before a reset completed with the texted
 *    code is refused afterwards, and a fresh sign-in is served;
 *  - a reset that does not complete (a token that does not match) ends nothing;
 *  - with no configuration at all, the auth instance asks better-auth to end
 *    sessions on every reset door;
 *  - the retired `revokeSessionsOnPasswordReset` is refused at any value, with
 *    the spec tombstone's prescription, at construction and on a
 *    configuration patch, where the standing configuration keeps ruling; an
 *    absent key passes;
 *  - a session a password reset ends leaves a revocation trail: on each reset
 *    door every session the account held is still a `sys_session` row
 *    afterwards, stamped `revoked_at` and `revoke_reason: password_reset`, and
 *    it still answers 401; the control, an administrator's forced reset over
 *    the same engine, stamps `admin_password_reset` instead;
 *  - a password-state write names the person who caused it: the forced
 *    reset's `must_change_password` set names the administrator (and the
 *    administrator at the keyboard of an impersonation session), the user's
 *    own `/change-password` clear names the user, both still as the system;
 *    the stamp is never credited to another session's holder, and the
 *    sign-in stamp and the emailed-link reset are unchanged.
 */

import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { runAdminSetUserPassword, type AdminUserEndpointDeps } from './admin-user-endpoints.js';
import { authIdentityObjects } from './manifest.js';
import { REVOKE_SESSIONS_ON_PASSWORD_RESET_RETIRED } from '@objectstack/spec/system';
import { assertPasswordResetEndsSessions } from './password-reset-ends-sessions.js';
import { runAttributedToUser } from './auth-actor-attribution.js';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';
import { sqliteEnginePool } from './__tests__/sqlite-engine-pool.testkit';
// better-auth's first module load is paid here, at module load, not inside the
// first case (AGENTS.md, Build & Test: clocked windows measure behaviour).
import 'better-auth';
import 'better-auth/api';
import 'better-auth/plugins';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-reset-ends-sessions';
const EMAIL = 'reset-ends-sessions@example.com';
const FIRST = 'F1rst!Password-For-Reset';
const SECOND = 'S3cond!Password-After-Reset';
const SYS = { context: { isSystem: true } } as never;
/** The retired configuration key, spelled once. */
const RETIRED = 'revokeSessionsOnPasswordReset';

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
  vi.restoreAllMocks();
});

const post = (manager: AuthManager, path: string, body: unknown, headers: Record<string, string> = {}) =>
  manager.handleRequest(
    new Request(`${AUTH}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: BASE, ...headers },
      body: JSON.stringify(body),
    }),
  );

const getSession = (manager: AuthManager, cookie: string) =>
  manager.handleRequest(new Request(`${AUTH}/get-session`, { method: 'GET', headers: { origin: BASE, cookie } }));

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

/** Status and the ADR-0112 envelope's code. */
async function answer(res: Response): Promise<{ status: number; code?: string; email?: string }> {
  const body = (await res.clone().json().catch(() => null)) as
    | { error?: { code?: unknown }; user?: { email?: unknown } }
    | null;
  return {
    status: res.status,
    ...(typeof body?.error?.code === 'string' ? { code: body.error.code } : {}),
    ...(typeof body?.user?.email === 'string' ? { email: body.user.email } : {}),
  };
}

interface Account {
  engine: ObjectQL;
  manager: AuthManager;
  /** The session signed in before any reset. */
  earlier: string;
  sent: Array<{ template: string; data: Record<string, unknown> }>;
}

async function signedInAccount(config: Record<string, unknown> = {}): Promise<Account> {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const engine = await engines.take();
  const manager = new AuthManager({ secret: SECRET, baseUrl: BASE, dataEngine: engine as never, ...config } as never);
  const sent: Account['sent'] = [];
  manager.setEmailService({
    sendTemplate: async (input: any) => {
      sent.push(input);
      return { status: 'sent' };
    },
  } as never);
  const signedUp = await post(manager, '/sign-up/email', { email: EMAIL, password: FIRST, name: 'Reset' });
  expect(signedUp.status, await signedUp.clone().text()).toBe(200);
  const signedIn = await post(manager, '/sign-in/email', { email: EMAIL, password: FIRST });
  expect(signedIn.status, await signedIn.clone().text()).toBe(200);
  const earlier = cookieFrom(signedIn);
  // Non-vacuity: the earlier session is served before any reset.
  expect(await answer(await getSession(manager, earlier))).toEqual({ status: 200, email: EMAIL });
  return { engine, manager, earlier, sent };
}

/** The token the reset mail carries, read the way its recipient reads it. */
async function requestResetToken(a: Account): Promise<string> {
  const requested = await post(a.manager, '/request-password-reset', { email: EMAIL, redirectTo: `${BASE}/reset` });
  expect(requested.status, await requested.clone().text()).toBe(200);
  await vi.waitFor(() => expect(a.sent.some((m) => m.template === 'auth.password_reset')).toBe(true));
  return String(a.sent.find((m) => m.template === 'auth.password_reset')!.data.token);
}

describe("a completed password reset ends the account's other sessions", () => {
  it('the session signed in before the reset is refused afterwards; a fresh sign-in with the new password is served', async () => {
    const a = await signedInAccount();
    const token = await requestResetToken(a);

    const reset = await post(a.manager, '/reset-password', { token, newPassword: SECOND });
    expect(reset.status, await reset.clone().text()).toBe(200);

    expect(await answer(await getSession(a.manager, a.earlier))).toEqual({ status: 401, code: 'UNAUTHENTICATED' });

    // The control: the account itself works, with the password just set.
    const fresh = await post(a.manager, '/sign-in/email', { email: EMAIL, password: SECOND });
    expect(fresh.status, await fresh.clone().text()).toBe(200);
    expect(await answer(await getSession(a.manager, cookieFrom(fresh)))).toEqual({ status: 200, email: EMAIL });
  }, 60_000);

  it('a reset that does not complete ends nothing', async () => {
    const a = await signedInAccount();
    await requestResetToken(a);

    const refused = await post(a.manager, '/reset-password', { token: 'not-the-issued-token', newPassword: SECOND });
    expect(refused.status).toBe(400);

    expect(await answer(await getSession(a.manager, a.earlier))).toEqual({ status: 200, email: EMAIL });
  }, 60_000);

  it('asks better-auth to end sessions on every reset door, with no configuration', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = await engines.take();
    const manager = new AuthManager({ secret: SECRET, baseUrl: BASE, dataEngine: engine as never } as never);
    const auth = (await manager.getAuthInstance()) as unknown as {
      options: { emailAndPassword?: { revokeSessionsOnPasswordReset?: unknown } };
    };
    expect(auth.options.emailAndPassword?.revokeSessionsOnPasswordReset).toBe(true);
  });
});

describe("a completed phone OTP reset ends the account's other sessions", () => {
  const PHONE = '+15550142';

  it('the session signed in before the reset is refused afterwards; a fresh sign-in with the new password is served', async () => {
    const a = await signedInAccount({ plugins: { phoneNumber: true } });
    const texts: Array<{ to: string; templateParams?: { code?: string } }> = [];
    a.manager.setSmsService({
      async send(input: { to: string; templateParams?: { code?: string } }) {
        texts.push(input);
        return { id: `sms${texts.length}`, status: 'sent' };
      },
      isConfigured: () => true,
    } as never);
    const [user] = (await a.engine.find('sys_user', { where: { email: EMAIL }, limit: 1 }, SYS)) as Array<{ id: string }>;
    await a.engine.update('sys_user', { id: user.id, phone_number: PHONE, phone_number_verified: true }, SYS);

    const requested = await post(a.manager, '/phone-number/request-password-reset', { phoneNumber: PHONE });
    expect(requested.status, await requested.clone().text()).toBe(200);
    await vi.waitFor(() => expect(texts.map((t) => t.to)).toEqual([PHONE]));
    const otp = String(texts[0].templateParams?.code ?? '');
    expect(otp, 'the reset text carries its code').not.toBe('');

    const reset = await post(a.manager, '/phone-number/reset-password', { phoneNumber: PHONE, otp, newPassword: SECOND });
    expect(reset.status, await reset.clone().text()).toBe(200);

    expect(await answer(await getSession(a.manager, a.earlier))).toEqual({ status: 401, code: 'UNAUTHENTICATED' });

    // The control: the account itself works, with the password just set.
    const fresh = await post(a.manager, '/sign-in/email', { email: EMAIL, password: SECOND });
    expect(fresh.status, await fresh.clone().text()).toBe(200);
    expect(await answer(await getSession(a.manager, cookieFrom(fresh)))).toEqual({ status: 200, email: EMAIL });
  }, 60_000);
});

describe('a session a password reset ends leaves a revocation trail', () => {
  type SessionRow = { id: string; expires_at?: unknown; revoked_at?: unknown; revoke_reason?: unknown };

  /** The account's `sys_session` rows, read off the table the way an auditor reads them. */
  async function sessionRowsOf(engine: ObjectQL): Promise<SessionRow[]> {
    const [user] = (await engine.find('sys_user', { where: { email: EMAIL }, limit: 1 }, SYS)) as Array<{ id: string }>;
    return (await engine.find('sys_session', { where: { user_id: user.id } }, SYS)) as SessionRow[];
  }

  /** The sessions the account holds before the reset: at least one, none of them ended. */
  async function liveSessionsBefore(a: Account): Promise<SessionRow[]> {
    const before = await sessionRowsOf(a.engine);
    expect(before.length).toBeGreaterThan(0);
    expect(before.map((row) => row.revoked_at ?? null)).toEqual(before.map(() => null));
    return before;
  }

  /**
   * Every session in `before` is still a row, stamped with when and why it
   * ended, and the session signed in before the reset is refused.
   */
  async function expectTrail(a: Account, before: SessionRow[], reason: string, startedAt: number): Promise<void> {
    const after = new Map((await sessionRowsOf(a.engine)).map((row) => [row.id, row]));
    for (const { id } of before) {
      const row = after.get(id);
      expect({ id, kept: row !== undefined }).toEqual({ id, kept: true });
      expect(row!.revoke_reason).toBe(reason);
      const revokedAt = new Date(row!.revoked_at as string).getTime();
      expect(Number.isFinite(revokedAt)).toBe(true);
      // Whole-second storage may round the stamp down, never ahead of now.
      expect(revokedAt).toBeGreaterThanOrEqual(startedAt - 1000);
      expect(revokedAt).toBeLessThanOrEqual(Date.now());
      expect(new Date(row!.expires_at as string).getTime()).toBeLessThan(Date.now());
    }
    expect(await answer(await getSession(a.manager, a.earlier))).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
  }

  it('the emailed-link reset (/reset-password) stamps every earlier session password_reset, and the session still answers 401', async () => {
    const a = await signedInAccount();
    const token = await requestResetToken(a);
    const before = await liveSessionsBefore(a);
    const startedAt = Date.now();

    const reset = await post(a.manager, '/reset-password', { token, newPassword: SECOND });
    expect(reset.status, await reset.clone().text()).toBe(200);

    await expectTrail(a, before, 'password_reset', startedAt);
  }, 60_000);

  it('the phone OTP reset (/phone-number/reset-password) stamps every earlier session password_reset, and the session still answers 401', async () => {
    const PHONE = '+15550143';
    const a = await signedInAccount({ plugins: { phoneNumber: true } });
    const texts: Array<{ to: string; templateParams?: { code?: string } }> = [];
    a.manager.setSmsService({
      async send(input: { to: string; templateParams?: { code?: string } }) {
        texts.push(input);
        return { id: `sms${texts.length}`, status: 'sent' };
      },
      isConfigured: () => true,
    } as never);
    const [user] = (await a.engine.find('sys_user', { where: { email: EMAIL }, limit: 1 }, SYS)) as Array<{ id: string }>;
    await a.engine.update('sys_user', { id: user.id, phone_number: PHONE, phone_number_verified: true }, SYS);
    const requested = await post(a.manager, '/phone-number/request-password-reset', { phoneNumber: PHONE });
    expect(requested.status, await requested.clone().text()).toBe(200);
    await vi.waitFor(() => expect(texts.map((t) => t.to)).toEqual([PHONE]));
    const otp = String(texts[0].templateParams?.code ?? '');
    expect(otp, 'the reset text carries its code').not.toBe('');
    const before = await liveSessionsBefore(a);
    const startedAt = Date.now();

    const reset = await post(a.manager, '/phone-number/reset-password', { phoneNumber: PHONE, otp, newPassword: SECOND });
    expect(reset.status, await reset.clone().text()).toBe(200);

    await expectTrail(a, before, 'password_reset', startedAt);
  }, 60_000);

  it("the control: an administrator's forced reset still stamps admin_password_reset, so the value says who ended the session", async () => {
    const a = await signedInAccount();
    const before = await liveSessionsBefore(a);
    const [user] = (await a.engine.find('sys_user', { where: { email: EMAIL }, limit: 1 }, SYS)) as Array<{ id: string }>;
    const m = a.manager;
    const quiet = { warn() {}, info() {}, error() {}, debug() {} };
    // The deps `auth-plugin.ts` hands the forced-reset door, built from the same manager.
    const deps = {
      getAuthApi: () => m.getApi(),
      getAuthContext: () => m.getAuthContext(),
      getDataEngine: () => m.getDataEngine(),
      assertPasswordComplexity: (pw: string) => m.checkPasswordComplexity(pw),
      noteMustChangePasswordIssued: () => m.noteMustChangePasswordIssued(),
      phoneNumberEnabled: () => m.isPhoneNumberEnabled(),
      getMembershipPolicy: () => m.getMembershipPolicy(),
      logger: quiet,
    } as unknown as AdminUserEndpointDeps;
    const startedAt = Date.now();

    const forced = await runAdminSetUserPassword(
      deps,
      new Request(`${AUTH}/admin/set-user-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: BASE },
        body: JSON.stringify({ userId: user.id, newPassword: SECOND }),
      }),
      { id: 'admin-control', email: 'admin-control@example.com' },
    );
    expect(forced.status, JSON.stringify(forced.body)).toBe(200);

    await expectTrail(a, before, 'admin_password_reset', startedAt);
  }, 60_000);
});

describe('the retired revokeSessionsOnPasswordReset is refused at any value, never silently ignored', () => {
  // The manager takes its configuration unparsed, so the spec tombstone never
  // sees a host's object: this guard answers it with the tombstone's own text.
  const PRESCRIPTION =
    /^\[auth\] `emailAndPassword\.revokeSessionsOnPasswordReset` was removed in @objectstack\/spec 18 \(ADR-0049 enforce-or-remove\) — .*Delete the key; nothing replaces it\.$/s;

  it('the refusal is the spec tombstone\'s prescription, word for word', () => {
    expect(() => assertPasswordResetEndsSessions({ revokeSessionsOnPasswordReset: true })).toThrow(
      `[auth] ${REVOKE_SESSIONS_ON_PASSWORD_RESET_RETIRED}`,
    );
  });

  for (const value of [false, true, 'false', 0, null]) {
    it(`is refused at construction: ${JSON.stringify(value)}`, () => {
      expect(
        () =>
          new AuthManager({
            secret: SECRET,
            baseUrl: BASE,
            emailAndPassword: { enabled: true, revokeSessionsOnPasswordReset: value },
          } as never),
      ).toThrow(PRESCRIPTION);
    });
  }

  for (const value of [false, true]) {
    it(`is refused on a configuration patch, and the standing configuration keeps ruling: ${value}`, () => {
      const manager = new AuthManager({ secret: SECRET, baseUrl: BASE, emailAndPassword: { enabled: true, minPasswordLength: 10 } } as never);
      expect(() =>
        manager.applyConfigPatch({ emailAndPassword: { revokeSessionsOnPasswordReset: value, minPasswordLength: 20 } } as never),
      ).toThrow(PRESCRIPTION);
      const standing = (manager as unknown as { config: { emailAndPassword?: Record<string, unknown> } }).config.emailAndPassword;
      expect(standing?.minPasswordLength).toBe(10);
      expect(standing && RETIRED in standing).toBe(false);
    });
  }

  it('CONTROL: an absent key, an undefined one and no block at all pass, and the manager is built', () => {
    expect(() => assertPasswordResetEndsSessions({})).not.toThrow();
    expect(() => assertPasswordResetEndsSessions({ [RETIRED]: undefined })).not.toThrow();
    expect(() => assertPasswordResetEndsSessions(undefined)).not.toThrow();
    expect(
      () => new AuthManager({ secret: SECRET, baseUrl: BASE, emailAndPassword: { enabled: true, minPasswordLength: 10 } } as never),
    ).not.toThrow();
  });
});

describe('a completed password reset clears the sign-in lockout (ADR-0069 D2)', () => {
  const THRESHOLD = 3;
  const WRONG = 'Wr0ng!Guess-Zebra-7731';

  /** The account's lockout columns, read off the table. */
  async function lockoutRow(engine: ObjectQL): Promise<{ failed_login_count?: unknown; locked_until?: unknown }> {
    const [row] = (await engine.find(
      'sys_user',
      { where: { email: EMAIL }, fields: ['failed_login_count', 'locked_until'], limit: 1 },
      SYS,
    )) as Array<{ failed_login_count?: unknown; locked_until?: unknown }>;
    return row;
  }

  const signIn = (a: Account, password: string) => post(a.manager, '/sign-in/email', { email: EMAIL, password });

  /** A signed-in account, then locked by wrong passwords through the real engine. */
  async function lockedAccount(config: Record<string, unknown> = {}): Promise<Account> {
    const a = await signedInAccount({ lockoutThreshold: THRESHOLD, ...config });
    for (let i = 0; i < THRESHOLD; i++) expect((await signIn(a, WRONG)).status).toBe(401);
    const row = await lockoutRow(a.engine);
    expect(Number(row.failed_login_count)).toBe(THRESHOLD);
    expect(new Date(row.locked_until as string).getTime()).toBeGreaterThan(Date.now());
    // Non-vacuity: the lock holds against the correct password.
    expect((await signIn(a, FIRST)).status).toBe(401);
    return a;
  }

  it('the emailed link: the counter and the lock are cleared, and the new password signs in at once', async () => {
    const a = await lockedAccount();
    const token = await requestResetToken(a);

    const reset = await post(a.manager, '/reset-password', { token, newPassword: SECOND });
    expect(reset.status, await reset.clone().text()).toBe(200);

    const row = await lockoutRow(a.engine);
    expect(Number(row.failed_login_count ?? 0)).toBe(0);
    expect(row.locked_until ?? null).toBeNull();
    const fresh = await signIn(a, SECOND);
    expect(fresh.status, await fresh.clone().text()).toBe(200);
  }, 60_000);

  it('the phone OTP reset clears it too', async () => {
    const PHONE = '+15550143';
    const a = await lockedAccount({ plugins: { phoneNumber: true } });
    const texts: Array<{ to: string; templateParams?: { code?: string } }> = [];
    a.manager.setSmsService({
      async send(input: { to: string; templateParams?: { code?: string } }) {
        texts.push(input);
        return { id: `sms${texts.length}`, status: 'sent' };
      },
      isConfigured: () => true,
    } as never);
    const [user] = (await a.engine.find('sys_user', { where: { email: EMAIL }, limit: 1 }, SYS)) as Array<{ id: string }>;
    await a.engine.update('sys_user', { id: user.id, phone_number: PHONE, phone_number_verified: true }, SYS);

    const requested = await post(a.manager, '/phone-number/request-password-reset', { phoneNumber: PHONE });
    expect(requested.status, await requested.clone().text()).toBe(200);
    await vi.waitFor(() => expect(texts.map((t) => t.to)).toEqual([PHONE]));
    const otp = String(texts[0].templateParams?.code ?? '');
    const reset = await post(a.manager, '/phone-number/reset-password', { phoneNumber: PHONE, otp, newPassword: SECOND });
    expect(reset.status, await reset.clone().text()).toBe(200);

    const row = await lockoutRow(a.engine);
    expect(Number(row.failed_login_count ?? 0)).toBe(0);
    expect(row.locked_until ?? null).toBeNull();
    expect((await signIn(a, SECOND)).status).toBe(200);
  }, 60_000);

  it('a reset that does not complete leaves the lock where it stands', async () => {
    const a = await lockedAccount();
    await requestResetToken(a);
    const before = await lockoutRow(a.engine);

    const refused = await post(a.manager, '/reset-password', { token: 'not-the-issued-token', newPassword: SECOND });
    expect(refused.status).toBe(400);

    const row = await lockoutRow(a.engine);
    expect(new Date(row.locked_until as string).getTime()).toBe(new Date(before.locked_until as string).getTime());
    expect((await signIn(a, FIRST)).status).toBe(401);
  }, 60_000);
});

describe('ADR-0069 D2: an account whose failed_login_count is NULL is counted and cleared through ObjectQL + SqlDriver', () => {
  const THRESHOLD = 3;
  const WRONG = 'Wr0ng!Guess-Zebra-7731';
  const signIn = (a: Account, password: string) => post(a.manager, '/sign-in/email', { email: EMAIL, password });

  /** The account's id and lockout columns, read off the table. */
  async function lockoutRow(engine: ObjectQL): Promise<{ id: string; failed_login_count?: unknown; locked_until?: unknown }> {
    const [row] = (await engine.find(
      'sys_user',
      { where: { email: EMAIL }, fields: ['id', 'failed_login_count', 'locked_until'], limit: 1 },
      SYS,
    )) as Array<{ id: string; failed_login_count?: unknown; locked_until?: unknown }>;
    return row;
  }

  /** A signed-in account whose counter column is then written NULL, read back NULL. */
  async function nullCounterAccount(): Promise<Account> {
    const a = await signedInAccount({ lockoutThreshold: THRESHOLD });
    const { id } = await lockoutRow(a.engine);
    await a.engine.update('sys_user', { id, failed_login_count: null, locked_until: null }, SYS);
    // Non-vacuity: the column really is NULL, so the compare-and-set compares against NULL.
    expect((await lockoutRow(a.engine)).failed_login_count).toBeNull();
    return a;
  }

  it('the correct password signs in, and the counter is cleared to 0', async () => {
    const a = await nullCounterAccount();
    const res = await signIn(a, FIRST);
    expect(res.status, await res.clone().text()).toBe(200);
    const row = await lockoutRow(a.engine);
    expect(Number(row.failed_login_count)).toBe(0);
    expect(row.locked_until ?? null).toBeNull();
  }, 60_000);

  it('a wrong password counts to 1, and the correct one still signs in after it', async () => {
    const a = await nullCounterAccount();
    expect((await signIn(a, WRONG)).status).toBe(401);
    const row = await lockoutRow(a.engine);
    expect(Number(row.failed_login_count)).toBe(1);
    expect(row.locked_until ?? null).toBeNull();
    const res = await signIn(a, FIRST);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(Number((await lockoutRow(a.engine)).failed_login_count)).toBe(0);
  }, 60_000);
});

describe('a password-state write names the person who caused it', () => {
  // The `sys_user` writes that set and clear `must_change_password` reach the
  // engine as the system (their authorization, unchanged) and name their
  // caller on the attribution seam (`auth-actor-attribution.ts`): the
  // execution context's `attributedUserId`, and `impersonatedBy` from an
  // impersonation session. plugin-audit's ledger writer turns that channel
  // into `sys_audit_log.user_id` and `actor` (its own `audit-writers.test.ts`
  // pins the `provenance.attributedUserId` read), the way the sign-in stamp
  // is already attributed. Observed on the raw engine, beneath every caller,
  // so the context is the one the audit writer's hooks are built from.
  const THIRD = 'Th1rd!Password-After-Change';
  const ADMIN = 'admin_password_state';

  interface UserWrite {
    patch: Record<string, unknown>;
    context: Record<string, unknown>;
  }

  /** Every `sys_user` update with the context it reached the engine with. Call-through. */
  function observeUserUpdates(engine: ObjectQL): UserWrite[] {
    const writes: UserWrite[] = [];
    const original = engine.update.bind(engine);
    vi.spyOn(engine, 'update').mockImplementation((async (object: string, data: Record<string, unknown>, options?: { context?: Record<string, unknown> }) => {
      if (object === 'sys_user') writes.push({ patch: { ...data }, context: { ...(options?.context ?? {}) } });
      return original(object as never, data as never, options as never);
    }) as never);
    return writes;
  }

  /** The one write that touched `field`. */
  const writeOf = (writes: UserWrite[], field: string): UserWrite => {
    const hits = writes.filter((w) => field in w.patch);
    expect(hits, JSON.stringify(writes.map((w) => Object.keys(w.patch)))).toHaveLength(1);
    return hits[0];
  };

  /** The authorization half and the attribution half of a write's context. */
  const credit = (w: UserWrite) => ({
    isSystem: w.context.isSystem,
    userId: w.context.userId ?? null,
    attributedUserId: w.context.attributedUserId ?? null,
    impersonatedBy: w.context.impersonatedBy ?? null,
  });

  async function userOf(a: Account): Promise<{ id: string; must_change_password: unknown }> {
    const [user] = (await a.engine.find('sys_user', { where: { email: EMAIL }, limit: 1 }, SYS)) as Array<{
      id: string;
      must_change_password: unknown;
    }>;
    return user;
  }

  /** An administrator's forced reset through the door `auth-plugin.ts` mounts, with the deps it hands it. */
  function forcedReset(a: Account, userId: string, actor: { id: string; email?: string; impersonatedBy?: string }) {
    const m = a.manager;
    const deps = {
      getAuthApi: () => m.getApi(),
      getAuthContext: () => m.getAuthContext(),
      getDataEngine: () => m.getDataEngine(),
      assertPasswordComplexity: (pw: string) => m.checkPasswordComplexity(pw),
      noteMustChangePasswordIssued: () => m.noteMustChangePasswordIssued(),
      phoneNumberEnabled: () => m.isPhoneNumberEnabled(),
      getMembershipPolicy: () => m.getMembershipPolicy(),
      logger: { warn() {}, info() {}, error() {}, debug() {} },
    } as unknown as AdminUserEndpointDeps;
    return runAdminSetUserPassword(
      deps,
      new Request(`${AUTH}/admin/set-user-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: BASE },
        body: JSON.stringify({ userId, newPassword: SECOND }),
      }),
      actor as never,
    );
  }

  it("the administrator's forced reset: the must_change_password write names the administrator, and still runs as the system", async () => {
    const a = await signedInAccount();
    const user = await userOf(a);
    const writes = observeUserUpdates(a.engine);

    const forced = await forcedReset(a, user.id, { id: ADMIN, email: 'admin@example.com' });

    // CONTROL: the door's answer and the value it writes are unchanged.
    expect(forced.status, JSON.stringify(forced.body)).toBe(200);
    expect(forced.body.data?.mustChangePassword).toBe(true);
    const flag = writeOf(writes, 'must_change_password');
    expect(flag.patch).toEqual({ id: user.id, must_change_password: true });
    expect((await userOf(a)).must_change_password).toBeTruthy();
    // The authorization half is the system's, as before; the attribution half names the administrator.
    expect(flag.context).toMatchObject({ isSystem: true, positions: [], permissions: [] });
    expect(credit(flag)).toEqual({ isSystem: true, userId: null, attributedUserId: ADMIN, impersonatedBy: null });
  }, 60_000);

  it('from an impersonation session, the administrator at the keyboard rides beside the admitted actor', async () => {
    const a = await signedInAccount();
    const user = await userOf(a);
    const writes = observeUserUpdates(a.engine);

    const forced = await forcedReset(a, user.id, { id: ADMIN, impersonatedBy: 'admin_at_keyboard' });

    expect(forced.status, JSON.stringify(forced.body)).toBe(200);
    expect(credit(writeOf(writes, 'must_change_password'))).toEqual({
      isSystem: true,
      userId: null,
      attributedUserId: ADMIN,
      impersonatedBy: 'admin_at_keyboard',
    });
  }, 60_000);

  it("the user's own change-password: the clear names the user; the sign-in stamp before it is unchanged", async () => {
    const a = await signedInAccount();
    const user = await userOf(a);
    expect((await forcedReset(a, user.id, { id: ADMIN })).status).toBe(200);
    const writes = observeUserUpdates(a.engine);

    const signedIn = await post(a.manager, '/sign-in/email', { email: EMAIL, password: SECOND });
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);
    // CONTROL: the sign-in stamp is the user's, as it already was.
    expect(credit(writeOf(writes, 'last_login_at'))).toEqual({
      isSystem: true,
      userId: null,
      attributedUserId: user.id,
      impersonatedBy: null,
    });

    const changed = await post(
      a.manager,
      '/change-password',
      { currentPassword: SECOND, newPassword: THIRD },
      { cookie: cookieFrom(signedIn) },
    );
    // CONTROL: the door's answer and the values it writes are unchanged.
    expect(changed.status, await changed.clone().text()).toBe(200);
    const clear = writeOf(writes, 'must_change_password');
    expect(Object.keys(clear.patch).sort()).toEqual(['id', 'must_change_password', 'password_changed_at']);
    expect(clear.patch).toMatchObject({ id: user.id, must_change_password: false });
    expect((await userOf(a)).must_change_password).toBeFalsy();
    expect(clear.context).toMatchObject({ isSystem: true, positions: [], permissions: [] });
    expect(credit(clear)).toEqual({ isSystem: true, userId: null, attributedUserId: user.id, impersonatedBy: null });
  }, 60_000);

  it("a stamp is credited only to the account's own holder: another session's holder, or none, leaves it the system's", async () => {
    const a = await signedInAccount();
    const user = await userOf(a);
    const stamp = (a.manager as never as { stampPasswordChangedAt(u: string): Promise<void> }).stampPasswordChangedAt.bind(a.manager);
    const writes = observeUserUpdates(a.engine);

    await runAttributedToUser('someone_else', () => stamp(user.id));
    await runAttributedToUser(user.id, () => stamp(user.id));
    expect(writes.map(credit)).toEqual([
      { isSystem: true, userId: null, attributedUserId: null, impersonatedBy: null },
      { isSystem: true, userId: null, attributedUserId: user.id, impersonatedBy: null },
    ]);

    // CONTROL: the emailed-link reset carries no session, so its stamp stays the system's.
    writes.length = 0;
    const token = await requestResetToken(a);
    const reset = await post(a.manager, '/reset-password', { token, newPassword: SECOND });
    expect(reset.status, await reset.clone().text()).toBe(200);
    expect(credit(writeOf(writes, 'must_change_password'))).toEqual({
      isSystem: true,
      userId: null,
      attributedUserId: null,
      impersonatedBy: null,
    });
  }, 60_000);
});
