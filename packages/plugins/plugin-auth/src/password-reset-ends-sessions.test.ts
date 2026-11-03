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
 *  - a reset that does not complete (a token that does not match) ends nothing;
 *  - with no configuration at all, the auth instance asks better-auth to end
 *    sessions on every reset door;
 *  - an explicit `revokeSessionsOnPasswordReset: false` is refused at
 *    construction and on a configuration patch, where the standing
 *    configuration keeps ruling; `true` is accepted.
 */

import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { assertPasswordResetEndsSessions } from './password-reset-ends-sessions.js';
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
  manager: AuthManager;
  /** The session signed in before any reset. */
  earlier: string;
  sent: Array<{ template: string; data: Record<string, unknown> }>;
}

async function signedInAccount(): Promise<Account> {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const engine = await engines.take();
  const manager = new AuthManager({ secret: SECRET, baseUrl: BASE, dataEngine: engine as never } as never);
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
  return { manager, earlier, sent };
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

describe('revokeSessionsOnPasswordReset: false is refused, never silently overridden', () => {
  it('is refused at construction', () => {
    expect(
      () =>
        new AuthManager({
          secret: SECRET,
          baseUrl: BASE,
          emailAndPassword: { enabled: true, revokeSessionsOnPasswordReset: false },
        } as never),
    ).toThrow(/revokeSessionsOnPasswordReset: false is not supported/);
  });

  it('is refused on a configuration patch, and the standing configuration keeps ruling', () => {
    const manager = new AuthManager({ secret: SECRET, baseUrl: BASE, emailAndPassword: { enabled: true, minPasswordLength: 10 } } as never);
    expect(() =>
      manager.applyConfigPatch({ emailAndPassword: { revokeSessionsOnPasswordReset: false, minPasswordLength: 20 } } as never),
    ).toThrow(/revokeSessionsOnPasswordReset: false is not supported/);
    const standing = (manager as unknown as { config: { emailAndPassword?: Record<string, unknown> } }).config.emailAndPassword;
    expect(standing?.minPasswordLength).toBe(10);
    expect(standing && 'revokeSessionsOnPasswordReset' in standing).toBe(false);
  });

  it('accepts true and an absent key', () => {
    expect(() => assertPasswordResetEndsSessions({ revokeSessionsOnPasswordReset: true })).not.toThrow();
    expect(() => assertPasswordResetEndsSessions({})).not.toThrow();
    expect(() => assertPasswordResetEndsSessions(undefined)).not.toThrow();
  });
});
