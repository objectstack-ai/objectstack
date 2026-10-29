// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An administrator's forced password change (`sys_user.must_change_password`)
 * is completed only by a password DIFFERENT from the current one, whatever the
 * deployment's `passwordHistoryCount` is — the default 0 included.
 *
 * The flag is cleared by `stampPasswordChangedAt`, which the after-hook runs on
 * a successful `/change-password` or `/reset-password`; both doors pass through
 * the before-hook's `assertPasswordNotReused` first, and that is where the
 * current password is refused while the flag is set. Driven end to end through
 * `AuthManager.handleRequest` over a real `ObjectQL` engine (better-sqlite3,
 * this plugin's own manifest), so the engine's `internal: true` strip of
 * `sys_account.password` is live and the refusal reads the recovered hash.
 *
 * Pinned:
 *  - `/change-password` refuses the current password as the new one while the
 *    flag is set (400 `PASSWORD_REUSE`), and nothing changes: the flag stays
 *    set and the current password still signs in;
 *  - a different new password completes the change and clears the flag;
 *  - the refusal answers only a caller whose current-password claim holds: a
 *    wrong claim gets the endpoint's own refusal, never `PASSWORD_REUSE`;
 *  - `/reset-password` refuses the current password while the flag is set, and
 *    completes with a different one;
 *  - the control: with no forced change outstanding and history off, the same
 *    password is still accepted — the history depth's behaviour is unchanged;
 *  - with history on (`passwordHistoryCount` > 0) the history ring's refusal
 *    follows the same rule on `/change-password`: it is given only once the
 *    request's current password is confirmed, and a wrong current password
 *    gets the endpoint's own `INVALID_PASSWORD`.
 */

import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { FORCED_ROTATION_REUSE_MESSAGE } from './auth-manager-password-session-policy.js';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';
import { sqliteEnginePool } from './__tests__/sqlite-engine-pool.testkit';
// better-auth's first module load is paid here, at module load, not inside the
// first case (AGENTS.md, Build & Test: clocked windows measure behaviour).
import 'better-auth';
import 'better-auth/api';
import 'better-auth/plugins';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-forced-rotation';
const SYS = { context: { isSystem: true } } as never;
const EMAIL = 'issued@example.com';
const TEMPORARY = 'Temp0rary!Issued-Pass';
const CHOSEN = 'Ch0sen!ByThe-User-2026';

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

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

async function refusal(res: Response): Promise<{ status: number; code?: string; message?: string }> {
  const body = (await res.clone().json().catch(() => ({}))) as { code?: unknown; message?: unknown };
  return {
    status: res.status,
    ...(typeof body.code === 'string' ? { code: body.code } : {}),
    ...(typeof body.message === 'string' ? { message: body.message } : {}),
  };
}

interface Deployment {
  engine: ObjectQL;
  manager: AuthManager;
  userId: string;
  cookie: string;
  sent: Array<{ template: string; data: Record<string, unknown> }>;
}

/**
 * A user holding the password an administrator issued, with the forced change
 * outstanding when `forced` — stamped the way the admin doors stamp it (the
 * row, then `noteMustChangePasswordIssued`). History depth left at its default.
 */
async function deployment(forced: boolean, config: Record<string, unknown> = {}): Promise<Deployment> {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const engine = await engines.take();
  const manager = new AuthManager({ secret: SECRET, baseUrl: BASE, dataEngine: engine as never, ...config } as never);
  const sent: Deployment['sent'] = [];
  manager.setEmailService({
    sendTemplate: async (input: any) => {
      sent.push(input);
      return { status: 'sent' };
    },
  } as never);
  const signedUp = await post(manager, '/sign-up/email', { email: EMAIL, password: TEMPORARY, name: 'Issued' });
  expect(signedUp.status, await signedUp.clone().text()).toBe(200);
  const userId = String(((await signedUp.clone().json()) as { user: { id: string } }).user.id);
  if (forced) {
    await engine.update('sys_user', { id: userId, must_change_password: true }, SYS);
    manager.noteMustChangePasswordIssued();
  }
  return { engine, manager, userId, cookie: cookieFrom(signedUp), sent };
}

async function mustChange(d: Deployment): Promise<boolean> {
  const row = (await d.engine.findOne('sys_user', {
    where: { id: d.userId },
    fields: ['must_change_password'],
    ...(SYS as object),
  } as never)) as { must_change_password?: unknown } | null;
  return row?.must_change_password === true || row?.must_change_password === 1;
}

const signIn = (d: Deployment, password: string) => post(d.manager, '/sign-in/email', { email: EMAIL, password });

const changePassword = (d: Deployment, currentPassword: string, newPassword: string) =>
  post(d.manager, '/change-password', { currentPassword, newPassword }, { cookie: d.cookie });

async function resetToken(d: Deployment): Promise<string> {
  const requested = await post(d.manager, '/request-password-reset', { email: EMAIL, redirectTo: `${BASE}/reset` });
  expect(requested.status, await requested.clone().text()).toBe(200);
  await vi.waitFor(() => expect(d.sent.some((m) => m.template === 'auth.password_reset')).toBe(true));
  return String(d.sent.find((m) => m.template === 'auth.password_reset')!.data.token);
}

describe('a forced password change requires a password different from the current one', () => {
  it('/change-password refuses the current password while the change is outstanding, and changes nothing', async () => {
    const d = await deployment(true);
    expect(await mustChange(d)).toBe(true);

    expect(await refusal(await changePassword(d, TEMPORARY, TEMPORARY))).toEqual({
      status: 400,
      code: 'PASSWORD_REUSE',
      message: FORCED_ROTATION_REUSE_MESSAGE,
    });

    expect(await mustChange(d), 'the forced change is still outstanding').toBe(true);
    expect((await signIn(d, TEMPORARY)).status, 'the issued password is unchanged').toBe(200);
  }, 60_000);

  it('/change-password with a different password completes the change and clears the flag', async () => {
    const d = await deployment(true);

    const changed = await changePassword(d, TEMPORARY, CHOSEN);
    expect(changed.status, await changed.clone().text()).toBe(200);

    expect(await mustChange(d)).toBe(false);
    expect((await signIn(d, CHOSEN)).status, 'the chosen password signs in').toBe(200);
    expect((await signIn(d, TEMPORARY)).status, 'the issued password no longer does').toBe(401);
  }, 60_000);

  it('answers only a caller whose current-password claim holds — a wrong claim gets the endpoint’s own refusal', async () => {
    const d = await deployment(true);

    const res = await refusal(await changePassword(d, 'Not!The-Current-0ne', TEMPORARY));
    expect(res.status).toBe(400);
    expect(res.code).not.toBe('PASSWORD_REUSE');
    expect(res.code).toBe('INVALID_PASSWORD');
    expect(await mustChange(d)).toBe(true);
  }, 60_000);

  it('/reset-password refuses the current password while the change is outstanding, and completes with a different one', async () => {
    const d = await deployment(true);
    const token = await resetToken(d);

    expect(await refusal(await post(d.manager, '/reset-password', { token, newPassword: TEMPORARY }))).toEqual({
      status: 400,
      code: 'PASSWORD_REUSE',
      message: FORCED_ROTATION_REUSE_MESSAGE,
    });
    expect(await mustChange(d)).toBe(true);

    const reset = await post(d.manager, '/reset-password', { token, newPassword: CHOSEN });
    expect(reset.status, await reset.clone().text()).toBe(200);
    expect(await mustChange(d)).toBe(false);
    expect((await signIn(d, CHOSEN)).status).toBe(200);
  }, 60_000);

  it('control: with no forced change outstanding and history off, the same password is still accepted', async () => {
    const d = await deployment(false);
    expect(await mustChange(d)).toBe(false);

    const changed = await changePassword(d, TEMPORARY, TEMPORARY);
    expect(changed.status, await changed.clone().text()).toBe(200);
    expect((await signIn(d, TEMPORARY)).status).toBe(200);
  }, 60_000);
});

describe('with history on, a reuse refusal is given only after the current password is confirmed', () => {
  const HISTORY = { passwordHistoryCount: 3 };
  /** A user who has changed TEMPORARY to CHOSEN, so TEMPORARY is in the history ring. */
  async function withHistory(): Promise<Deployment> {
    const d = await deployment(false, HISTORY);
    const changed = await changePassword(d, TEMPORARY, CHOSEN);
    expect(changed.status, await changed.clone().text()).toBe(200);
    return d;
  }

  it('a confirmed current password and a password from the history ring answers PASSWORD_REUSE', async () => {
    const d = await withHistory();
    const res = await refusal(await changePassword(d, CHOSEN, TEMPORARY));
    expect(res.status).toBe(400);
    expect(res.code).toBe('PASSWORD_REUSE');
    expect((await signIn(d, CHOSEN)).status, 'the password is unchanged').toBe(200);
  }, 60_000);

  it('a confirmed current password reused as the new one answers PASSWORD_REUSE', async () => {
    const d = await withHistory();
    const res = await refusal(await changePassword(d, CHOSEN, CHOSEN));
    expect(res.status).toBe(400);
    expect(res.code).toBe('PASSWORD_REUSE');
  }, 60_000);

  it('a wrong current password answers the endpoint’s own INVALID_PASSWORD, whatever the new password is', async () => {
    const d = await withHistory();
    for (const next of [TEMPORARY, CHOSEN]) {
      const res = await refusal(await changePassword(d, 'Not!The-Current-0ne', next));
      expect(res.status, next).toBe(400);
      expect(res.code, next).toBe('INVALID_PASSWORD');
    }
    expect((await signIn(d, CHOSEN)).status, 'the password is unchanged').toBe(200);
  }, 60_000);
});
