// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An auth request is judged and executed as one account
 * (`one-account-per-request.ts`).
 *
 * Driven end to end through `AuthManager.handleRequest` over a real `ObjectQL`
 * engine (better-sqlite3, this plugin's own manifest) and the installed
 * better-auth, with two real accounts signed up through the real sign-up
 * route: every credential below is one better-auth minted, and every write is
 * read back from the store.
 *
 * Pinned:
 *  - a session cookie and a bearer token that name two different accounts are
 *    refused with `401 CREDENTIALS_NAME_DIFFERENT_ACCOUNTS` on the admin
 *    paths, `/change-password`, `/revoke-session`, `/update-user` and the
 *    session read itself (over HTTP and in process, where every data door
 *    reads it), and nothing is written for either account;
 *  - the same account on both credentials still works, two sessions of one
 *    user included; the cookie alone and the bearer alone still work;
 *  - a credential that names no signed-in account does not trip the rule, and
 *    an API key is not a session credential for it;
 *  - the identity mount refuses the request ahead of its raw routes, with the
 *    same code, and answers 503 when its judgment cannot be reached;
 *  - a session read that cannot answer refuses, as an outage (503).
 */

import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { API_KEY_PREFIX, resolveRequestExecutionContext, type PluginContext, type RequestAuthService } from '@objectstack/core';
import { AuthManager } from './auth-manager.js';
import { AuthPlugin } from './auth-plugin.js';
import { authIdentityObjects } from './manifest.js';
import { inviteForAudienceGate } from './audience-gate-test-support';
import {
  CREDENTIALS_NAME_DIFFERENT_ACCOUNTS_CODE,
  CREDENTIALS_NAME_DIFFERENT_ACCOUNTS_MESSAGE,
  ONE_ACCOUNT_READ_FAULT_CODE,
  ONE_ACCOUNT_READ_FAULT_MESSAGE,
  OneAccountReadFault,
  presentedSessionTokens,
  refuseRequestNamingDifferentAccounts,
  requestNamesDifferentAccounts,
} from './one-account-per-request.js';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';
import { sqliteEnginePool } from './__tests__/sqlite-engine-pool.testkit';
// better-auth's first module load is paid here, at module load, not inside the
// first case (AGENTS.md, Build & Test: clocked windows measure behaviour).
import 'better-auth';
import 'better-auth/api';
import 'better-auth/plugins';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-one-account';
const SYS = { context: { isSystem: true } } as never;
const PASSWORD_A = 'Passw0rd!Holder-A-2026';
const PASSWORD_B = 'Passw0rd!Holder-B-2026';
const NEW_PASSWORD = 'N3w!Passw0rd-Chosen-2026';

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

type Credentials = { cookie?: string; bearer?: string };

const headersOf = (credentials: Credentials): Record<string, string> => ({
  ...(credentials.cookie ? { cookie: credentials.cookie } : {}),
  ...(credentials.bearer ? { authorization: `Bearer ${credentials.bearer}` } : {}),
});

const send = (manager: AuthManager, method: 'GET' | 'POST', path: string, credentials: Credentials, body?: unknown) =>
  manager.handleRequest(
    new Request(`${AUTH}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', origin: BASE, ...headersOf(credentials) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

/** Status + the error code, in either envelope (better-auth's flat one, or ADR-0112's nested one). */
async function verdict(res: Response): Promise<{ status: number; code?: string; message?: string }> {
  const body = (await res.clone().json().catch(() => ({}))) as
    | { code?: unknown; message?: unknown; error?: { code?: unknown; message?: unknown } }
    | null;
  const code = body?.error?.code ?? body?.code;
  const message = body?.error?.message ?? body?.message;
  return {
    status: res.status,
    ...(typeof code === 'string' ? { code } : {}),
    ...(typeof message === 'string' ? { message } : {}),
  };
}

const REFUSED = {
  status: 401,
  code: CREDENTIALS_NAME_DIFFERENT_ACCOUNTS_CODE,
  message: CREDENTIALS_NAME_DIFFERENT_ACCOUNTS_MESSAGE,
};

interface Account {
  id: string;
  email: string;
  password: string;
  cookie: string;
  bearer: string;
}

interface Deployment {
  engine: ObjectQL;
  manager: AuthManager;
  a: Account;
  b: Account;
}

/**
 * Two accounts, A (the first, admitted by the bootstrap window) and B (by
 * invitation), each holding the cookie and the bearer its sign-up minted.
 * The admin plugin is mounted, so its paths are live; `a` holds its role.
 */
async function deployment(): Promise<Deployment> {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const engine = await engines.take();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    plugins: { admin: true },
  } as never);
  const signUp = async (email: string, password: string, name: string): Promise<Account> => {
    const invitationId = await inviteForAudienceGate(engine, email);
    const res = await send(manager, 'POST', '/sign-up/email', {}, { email, password, name, invitationId });
    expect(res.status, await res.clone().text()).toBe(200);
    const id = String(((await res.clone().json()) as { user: { id: string } }).user.id);
    const bearer = res.headers.get('set-auth-token') ?? '';
    expect(bearer, 'sign-up must hand out a bearer').not.toBe('');
    return { id, email, password, cookie: cookieFrom(res), bearer };
  };
  const a = await signUp('holder-a@example.com', PASSWORD_A, 'Holder A');
  const b = await signUp('holder-b@example.com', PASSWORD_B, 'Holder B');
  return { engine, manager, a, b };
}

const twoAccounts = (d: Deployment): Credentials => ({ cookie: d.a.cookie, bearer: d.b.bearer });

const userRow = async (d: Deployment, id: string): Promise<Record<string, unknown>> =>
  ((await d.engine.findOne('sys_user', { where: { id }, ...(SYS as object) } as never)) ?? {}) as Record<string, unknown>;

const sessionRows = async (d: Deployment): Promise<Array<Record<string, unknown>>> =>
  (await d.engine.find('sys_session', { ...(SYS as object) } as never)) as Array<Record<string, unknown>>;

/** The account a `/get-session` answer names, or the refusal it is. */
async function sessionUser(res: Response): Promise<string | undefined> {
  if (res.status !== 200) return undefined;
  const body = (await res.clone().json().catch(() => null)) as { user?: { id?: string } } | null;
  return body?.user?.id;
}

const signsIn = async (d: Deployment, email: string, password: string): Promise<boolean> =>
  (await send(d.manager, 'POST', '/sign-in/email', {}, { email, password })).status === 200;

// ───────────────────────────────────────────────────────────────────────────
describe('an auth request whose credentials name two different accounts is refused, and nothing runs', () => {
  it('the session read refuses it, over HTTP and in process (the read every data door makes)', async () => {
    const d = await deployment();

    expect(await verdict(await send(d.manager, 'GET', '/get-session', twoAccounts(d)))).toEqual(REFUSED);

    const api = (await d.manager.getApi()) as unknown as { getSession(input: { headers: Headers }): Promise<unknown> };
    const read = api.getSession({ headers: new Headers(headersOf(twoAccounts(d))) });
    await expect(read).rejects.toMatchObject({
      statusCode: 401,
      body: { code: CREDENTIALS_NAME_DIFFERENT_ACCOUNTS_CODE },
    });
  });

  it('a data door that reads that request resolves no account', async () => {
    const d = await deployment();
    const resolve = (credentials: Credentials) =>
      resolveRequestExecutionContext({
        headers: new Headers(headersOf(credentials)),
        // The session leg is the question here, not the grants: with no
        // engine the resolver stops at the principal it admitted.
        ql: undefined,
        authService: d.manager as unknown as RequestAuthService,
        tenancy: undefined,
        anonymous: 'fail-closed',
        authGate: 'resolved',
        credentials: 'session-only',
        sessionApi: 'optional',
        session: 'request',
        localization: 'withhold',
        requestLocale: undefined,
        accessToken: 'withhold',
        oauth: undefined,
        onAdmission: undefined,
      });

    expect(await resolve(twoAccounts(d))).toBeUndefined();
    // The controls: each credential alone resolves its own account.
    expect((await resolve({ cookie: d.a.cookie }))?.userId).toBe(d.a.id);
    expect((await resolve({ bearer: d.b.bearer }))?.userId).toBe(d.b.id);
  });

  it('/change-password is refused, and neither account’s password, stamp or forced-change flag moves', async () => {
    const d = await deployment();
    await d.engine.update('sys_user', { id: d.a.id, must_change_password: true }, SYS);
    d.manager.noteMustChangePasswordIssued();
    const before = { a: await userRow(d, d.a.id), b: await userRow(d, d.b.id) };

    for (const currentPassword of [PASSWORD_A, PASSWORD_B]) {
      const res = await send(d.manager, 'POST', '/change-password', twoAccounts(d), {
        currentPassword,
        newPassword: NEW_PASSWORD,
      });
      expect(await verdict(res)).toEqual(REFUSED);
    }

    const after = { a: await userRow(d, d.a.id), b: await userRow(d, d.b.id) };
    expect(after.a.password_changed_at).toEqual(before.a.password_changed_at);
    expect(after.b.password_changed_at).toEqual(before.b.password_changed_at);
    expect(Boolean(after.a.must_change_password)).toBe(true);
    expect(await signsIn(d, d.a.email, PASSWORD_A)).toBe(true);
    expect(await signsIn(d, d.b.email, PASSWORD_B)).toBe(true);
    expect(await signsIn(d, d.a.email, NEW_PASSWORD)).toBe(false);
    expect(await signsIn(d, d.b.email, NEW_PASSWORD)).toBe(false);
  });

  it('/revoke-session is refused, and every session stays live', async () => {
    const d = await deployment();
    const sessionsBefore = await sessionRows(d);
    expect(sessionsBefore).toHaveLength(2);

    for (const row of sessionsBefore) {
      const res = await send(d.manager, 'POST', '/revoke-session', twoAccounts(d), { token: row.token });
      expect(await verdict(res)).toEqual(REFUSED);
    }

    const sessionsAfter = await sessionRows(d);
    expect(sessionsAfter.map((s) => s.id).sort()).toEqual(sessionsBefore.map((s) => s.id).sort());
    expect(sessionsAfter.every((s) => s.revoked_at === null || s.revoked_at === undefined)).toBe(true);
    expect(await sessionUser(await send(d.manager, 'GET', '/get-session', { cookie: d.a.cookie }))).toBe(d.a.id);
    expect(await sessionUser(await send(d.manager, 'GET', '/get-session', { bearer: d.b.bearer }))).toBe(d.b.id);
  });

  it('a plain data write (/update-user) is refused, and neither account’s record changes', async () => {
    const d = await deployment();

    const res = await send(d.manager, 'POST', '/update-user', twoAccounts(d), { name: 'Renamed By Request' });
    expect(await verdict(res)).toEqual(REFUSED);

    expect((await userRow(d, d.a.id)).name).toBe('Holder A');
    expect((await userRow(d, d.b.id)).name).toBe('Holder B');
  });

  it('the admin paths are refused, whichever credential the administrator holds, and nothing is written', async () => {
    const d = await deployment();
    await d.engine.update('sys_user', { id: d.a.id, role: 'admin' }, SYS);
    const adminCookie = cookieFrom(await send(d.manager, 'POST', '/sign-in/email', {}, { email: d.a.email, password: PASSWORD_A }));
    const adminBearer = (await send(d.manager, 'POST', '/sign-in/email', {}, { email: d.a.email, password: PASSWORD_A }))
      .headers.get('set-auth-token') ?? '';
    const memberSession = (await sessionRows(d)).find((s) => s.user_id === d.b.id)!;

    for (const credentials of [
      { cookie: adminCookie, bearer: d.b.bearer },
      { cookie: d.b.cookie, bearer: adminBearer },
    ]) {
      const setRole = await send(d.manager, 'POST', '/admin/set-role', credentials, { userId: d.b.id, role: 'admin' });
      expect(await verdict(setRole)).toEqual(REFUSED);
      const revoke = await send(d.manager, 'POST', '/admin/revoke-user-session', credentials, {
        sessionToken: memberSession.token,
      });
      expect(await verdict(revoke)).toEqual(REFUSED);
    }

    expect((await userRow(d, d.b.id)).role ?? 'user').not.toBe('admin');
    const memberAfter = (await sessionRows(d)).find((s) => s.id === memberSession.id);
    expect(memberAfter?.revoked_at ?? null).toBeNull();
    // The control: the administrator alone is admitted to the same action.
    const admitted = await send(d.manager, 'POST', '/admin/set-role', { cookie: adminCookie }, { userId: d.b.id, role: 'user' });
    expect(admitted.status, await admitted.clone().text()).toBe(200);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('a request that names one account, or carries one credential, goes on as before', () => {
  it('the same session on both credentials, and two sessions of one user, still work', async () => {
    const d = await deployment();
    const second = await send(d.manager, 'POST', '/sign-in/email', {}, { email: d.a.email, password: PASSWORD_A });
    const secondBearer = second.headers.get('set-auth-token') ?? '';
    expect(secondBearer).not.toBe('');

    for (const credentials of [
      { cookie: d.a.cookie, bearer: d.a.bearer },
      { cookie: d.a.cookie, bearer: secondBearer },
    ]) {
      expect(await sessionUser(await send(d.manager, 'GET', '/get-session', credentials))).toBe(d.a.id);
    }
    const changed = await send(d.manager, 'POST', '/change-password', { cookie: d.a.cookie, bearer: d.a.bearer }, {
      currentPassword: PASSWORD_A,
      newPassword: NEW_PASSWORD,
    });
    expect(changed.status, await changed.clone().text()).toBe(200);
    expect(await signsIn(d, d.a.email, NEW_PASSWORD)).toBe(true);
  });

  it('the cookie alone and the bearer alone still work', async () => {
    const d = await deployment();
    expect(await sessionUser(await send(d.manager, 'GET', '/get-session', { cookie: d.a.cookie }))).toBe(d.a.id);
    expect(await sessionUser(await send(d.manager, 'GET', '/get-session', { bearer: d.b.bearer }))).toBe(d.b.id);
    const renamed = await send(d.manager, 'POST', '/update-user', { bearer: d.b.bearer }, { name: 'Holder B Renamed' });
    expect(renamed.status, await renamed.clone().text()).toBe(200);
    expect((await userRow(d, d.b.id)).name).toBe('Holder B Renamed');
    expect((await userRow(d, d.a.id)).name).toBe('Holder A');
  });

  it('a bearer that names no signed-in account beside a valid cookie does not trip the rule', async () => {
    const d = await deployment();
    // A value no session carries, with a signature that does not verify:
    // better-auth reads the cookie, and so does the request.
    const bogus = await send(d.manager, 'GET', '/get-session', { cookie: d.a.cookie, bearer: 'no-such-session.not-a-signature' });
    expect(await sessionUser(bogus)).toBe(d.a.id);

    // A bearer whose session has ended (B signed out): not this rule's refusal.
    const signedOut = await send(d.manager, 'POST', '/sign-out', { cookie: d.b.cookie }, {});
    expect(signedOut.status).toBe(200);
    const ended = await verdict(await send(d.manager, 'GET', '/get-session', { cookie: d.a.cookie, bearer: d.b.bearer }));
    expect(ended.code).not.toBe(CREDENTIALS_NAME_DIFFERENT_ACCOUNTS_CODE);
    // …and the cookie alone still answers for its account, the retry a client makes.
    expect(await sessionUser(await send(d.manager, 'GET', '/get-session', { cookie: d.a.cookie }))).toBe(d.a.id);
  });

  it('an API key beside a session cookie is not a session credential for this rule, and is not refused by it', async () => {
    const d = await deployment();
    const key = `${API_KEY_PREFIX}one_account_rule_${'k'.repeat(24)}`;

    // On the wire: an API key beside a valid cookie is never this rule's refusal.
    const res = await verdict(await send(d.manager, 'GET', '/get-session', { cookie: d.a.cookie, bearer: key }));
    expect(res.code).not.toBe(CREDENTIALS_NAME_DIFFERENT_ACCOUNTS_CODE);

    // The judgment: the key is never read as a session, even from a store that
    // would answer its value as another account's session.
    const findSession = vi.fn(async (token: string) => ({
      session: { userId: token === 'tokA' ? 'u_a' : 'u_key_owner', expiresAt: new Date(Date.now() + 60_000) },
      user: { id: token === 'tokA' ? 'u_a' : 'u_key_owner' },
    }));
    const headers = new Headers({ cookie: 'better-auth.session_token=tokA.sig', authorization: `Bearer ${key}` });
    const context = { authCookies: { sessionToken: { name: 'better-auth.session_token' } }, internalAdapter: { findSession } };
    expect(await requestNamesDifferentAccounts(headers, context)).toBe(false);
    expect(findSession).not.toHaveBeenCalled();
  });

  it('a cookie that names no signed-in account beside a valid bearer does not trip the rule', async () => {
    const d = await deployment();
    const signedOut = await send(d.manager, 'POST', '/sign-out', { cookie: d.a.cookie }, {});
    expect(signedOut.status).toBe(200);
    expect(await sessionUser(await send(d.manager, 'GET', '/get-session', { cookie: d.a.cookie, bearer: d.b.bearer }))).toBe(d.b.id);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the identity mount refuses the request ahead of its raw routes', () => {
  const mockCtx = (): PluginContext =>
    ({
      registerService: vi.fn(),
      getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
      getServices: vi.fn(() => new Map()),
      hook: vi.fn(),
      trigger: vi.fn(),
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      getKernel: vi.fn(),
    }) as never;

  async function mounted(d: Deployment): Promise<(path: string, credentials: Credentials, body: unknown) => Promise<Response>> {
    const app = new Hono();
    const ctx = mockCtx();
    const plugin = new AuthPlugin({ secret: SECRET });
    await plugin.init(ctx);
    (plugin as unknown as { authManager: AuthManager }).authManager = d.manager;
    (plugin as unknown as { registerAuthRoutes(server: unknown, ctx: PluginContext): void }).registerAuthRoutes(
      { getRawApp: () => app, getPort: () => 0 },
      ctx,
    );
    return async (path, credentials, body) =>
      await app.request(`${AUTH}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE, ...headersOf(credentials) },
        body: JSON.stringify(body),
      });
  }

  it('a raw admin mount answers the code, and the account it names is untouched', async () => {
    const d = await deployment();
    await d.engine.update('sys_user', { id: d.a.id, role: 'admin' }, SYS);
    const adminCookie = cookieFrom(await send(d.manager, 'POST', '/sign-in/email', {}, { email: d.a.email, password: PASSWORD_A }));
    const fire = await mounted(d);

    const res = await fire('/admin/ban-user', { cookie: adminCookie, bearer: d.b.bearer }, { userId: d.b.id });
    expect(await verdict(res)).toEqual(REFUSED);
    expect(Boolean((await userRow(d, d.b.id)).banned)).toBe(false);

    // The vendor catch-all behind the same mount answers the same refusal.
    const read = await fire('/update-user', { cookie: adminCookie, bearer: d.b.bearer }, { name: 'Renamed At Mount' });
    expect(await verdict(read)).toEqual(REFUSED);
    expect((await userRow(d, d.b.id)).name).toBe('Holder B');
  });

  it('a request carrying both credentials whose judgment cannot be reached is answered 503, and goes no further', async () => {
    const d = await deployment();
    const fire = await mounted(d);
    vi.spyOn(d.manager, 'getAuthContext').mockRejectedValue(new Error('auth context unavailable'));

    const res = await fire('/update-user', { cookie: d.a.cookie, bearer: d.b.bearer }, { name: 'Renamed At Mount' });
    expect(await verdict(res)).toEqual({
      status: 503,
      code: ONE_ACCOUNT_READ_FAULT_CODE,
      message: ONE_ACCOUNT_READ_FAULT_MESSAGE,
    });
    expect((await userRow(d, d.a.id)).name).toBe('Holder A');
    expect((await userRow(d, d.b.id)).name).toBe('Holder B');

    // The control: one credential is handed on without the judgment being asked.
    const one = await fire('/update-user', { bearer: d.b.bearer }, { name: 'Holder B Renamed' });
    expect(one.status, await one.clone().text()).toBe(200);
    expect((await userRow(d, d.b.id)).name).toBe('Holder B Renamed');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the judgment itself', () => {
  const live = (userId: string) => ({ session: { userId, expiresAt: new Date(Date.now() + 60_000) }, user: { id: userId } });
  const context = (sessions: Record<string, unknown>) => {
    const findSession = vi.fn(async (token: string) => (sessions[token] ?? null) as never);
    return {
      findSession,
      context: { authCookies: { sessionToken: { name: 'better-auth.session_token' } }, internalAdapter: { findSession } },
    };
  };
  const request = (cookie: string, bearer: string) =>
    new Headers({ cookie: `better-auth.session_token=${cookie}`, authorization: `Bearer ${bearer}` });

  it('reads each credential by its token, the signature removed and the value decoded', () => {
    const header = (name: string) =>
      ({ cookie: 'other=1; better-auth.session_token=tokA.sig%3D; better-auth.session_token=tokZ.sig', authorization: 'Bearer tokB.c2ln' })[name] ?? '';
    expect(presentedSessionTokens(header, 'better-auth.session_token')).toEqual({ cookie: 'tokA', bearer: 'tokB' });
    expect(presentedSessionTokens(() => '', 'better-auth.session_token')).toEqual({});
    expect(presentedSessionTokens((n) => (n === 'authorization' ? 'Basic dXNlcjpwYXNz' : ''), undefined)).toEqual({});
  });

  it('two accounts are refused; one account, a token naming nobody, or an ended session are not', async () => {
    const ended = { session: { userId: 'u_b', expiresAt: new Date(Date.now() - 1_000) }, user: { id: 'u_b' } };
    const c = context({ tokA: live('u_a'), tokB: live('u_b'), tokA2: live('u_a'), tokOld: ended });
    expect(await requestNamesDifferentAccounts(request('tokA.s', 'tokB.s'), c.context)).toBe(true);
    expect(await requestNamesDifferentAccounts(request('tokA.s', 'tokA2.s'), c.context)).toBe(false);
    expect(await requestNamesDifferentAccounts(request('tokA.s', 'nobody'), c.context)).toBe(false);
    expect(await requestNamesDifferentAccounts(request('nobody', 'tokB'), c.context)).toBe(false);
    expect(await requestNamesDifferentAccounts(request('tokA', 'tokOld'), c.context)).toBe(false);
  });

  it('the same token on both credentials, and a token carrying a control character, read nothing', async () => {
    const c = context({ tokA: live('u_a') });
    expect(await requestNamesDifferentAccounts(request('tokA.sig1', 'tokA.sig2'), c.context)).toBe(false);
    expect(await requestNamesDifferentAccounts(request('tokA', 'tok%07B'), c.context)).toBe(false);
    expect(c.findSession).not.toHaveBeenCalled();
  });

  it('a session read that cannot answer refuses, as an outage (503), never as a pass', async () => {
    const failure = new Error('driver down');
    const findSession = vi.fn(async () => {
      throw failure;
    });
    const ctx = {
      headers: request('tokA', 'tokB'),
      context: { authCookies: { sessionToken: { name: 'better-auth.session_token' } }, internalAdapter: { findSession } },
    };
    await expect(requestNamesDifferentAccounts(ctx.headers, ctx.context)).rejects.toBeInstanceOf(OneAccountReadFault);
    await expect(refuseRequestNamingDifferentAccounts(ctx)).rejects.toMatchObject({
      statusCode: 503,
      body: { code: ONE_ACCOUNT_READ_FAULT_CODE },
      cause: failure,
    });
  });
});
