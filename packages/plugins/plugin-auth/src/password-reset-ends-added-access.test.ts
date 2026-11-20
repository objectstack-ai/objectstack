// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A password reset ends what the account added before it; a password change
 * reminds the account what it keeps (`password-reset-ends-added-access.ts`).
 *
 * Every door is driven through the real routes: a real `AuthManager` over a
 * real `ObjectQL` engine (better-sqlite3, this plugin's own manifest), behind
 * `AuthPlugin.registerAuthRoutes` mounted on a Hono app. An API key is judged
 * by the key-admission seam itself (`resolveApiKeyAdmission`), and a linked
 * sign-in account is a `sys_account` row of a provider other than `credential`,
 * linked through better-auth's own internal adapter.
 *
 * Pinned:
 *  - a completed self-service reset (the emailed link, the texted code) ends
 *    every API key and every linked sign-in account the account held: the key
 *    no longer admits, the link is gone, the password row stays and the new
 *    password signs in; a key minted after the reset admits;
 *  - a reset that does not complete ends nothing;
 *  - a password change ends neither, and mails the account
 *    `auth.password_changed_notice` listing what stays active; an account
 *    that holds neither is sent nothing;
 *  - an administrator's forced reset with its revocation switch on unlinks the
 *    sign-in accounts beside the keys and sessions it already ended, and with
 *    the switch off ends nothing; the operator's reset unlinks them too;
 *  - a reset whose ending cannot be written is not swallowed: the requester
 *    is answered an error.
 */

import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { hashApiKey, resolveApiKeyAdmission } from '@objectstack/core';
import { AuthManager } from './auth-manager.js';
import { AuthPlugin } from './auth-plugin.js';
import { authIdentityObjects } from './manifest.js';
import { setOperatorPassword } from './operator-password-reset.js';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';
import { sqliteEnginePool } from './__tests__/sqlite-engine-pool.testkit';
// better-auth's first module load is paid here, at module load, not inside the
// first case (AGENTS.md, Build & Test: clocked windows measure behaviour).
import 'better-auth';
import 'better-auth/api';
import 'better-auth/plugins';

const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const SECRET = 'test-secret-at-least-32-chars-long-added-access-ends';
const ADMIN_EMAIL = 'added-access-admin@example.com';
const EMAIL = 'added-access-user@example.com';
const PHONE = '+15550177';
const FIRST = 'F1rst!Password-Added';
const SECOND = 'S3cond!Password-Added';
const SYS = { context: { isSystem: true } } as never;
const NOTICE = 'auth.password_changed_notice';

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

/**
 * One deployment: an administrator (the first account) and the user under test
 * (signed up through an invitation, as `invite_only` admits a second account),
 * behind the real route mount, with mail and texts captured. The user holds an
 * API key and a linked sign-in account (a `github` link).
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
  const mail: Array<{ template: string; to?: { address?: string }; data: Record<string, any> }> = [];
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

  const signIn = async (email: string, password: string) => {
    const res = await fire('/sign-in/email', { email, password });
    return { ...(await answer(res)), bearer: res.headers.get('set-auth-token') ?? undefined };
  };

  /** Mint a key the way `POST /api/v1/keys` writes the row (system context, hash only); answers the raw key. */
  const mintKey = async (name: string): Promise<string> => {
    const raw = `osk_${name}_${'x'.repeat(24)}`;
    await engine.insert(
      'sys_api_key',
      { id: `key_${name}`, name, key: hashApiKey(raw), prefix: raw.slice(0, 12), user_id: userId, revoked: false },
      SYS,
    );
    return raw;
  };
  /** The key-admission seam's verdict on a raw key. */
  const keyAdmits = async (raw: string): Promise<boolean> =>
    (await resolveApiKeyAdmission(engine, { 'x-api-key': raw }, Date.now(), undefined, undefined, undefined)).outcome === 'admitted';
  const keyRow = async (name: string) => {
    const row = ((await engine.find('sys_api_key', { where: { id: `key_${name}` }, context: { isSystem: true } } as never)) as any[])[0];
    return { revoked: row.revoked === true || row.revoked === 1, revoked_reason: row.revoked_reason ?? null };
  };

  const auth: any = await manager.getAuthContext();
  /** Link a sign-in account of `providerId` to the user, through better-auth's own internal adapter. */
  const link = (providerId: string) =>
    auth.internalAdapter.linkAccount({ userId, providerId, accountId: `${providerId}-${userId}` });
  /** The providers of the sign-in accounts the user holds, the password's included. */
  const providers = async (): Promise<string[]> =>
    ((await auth.internalAdapter.findAccounts(userId)) as Array<{ providerId: string }>).map((a) => a.providerId).sort();

  const requestLink = async (): Promise<string> => {
    const before = mail.filter((m) => m.template === 'auth.password_reset').length;
    const res = await fire('/request-password-reset', { email: EMAIL, redirectTo: `${ORIGIN}/reset` });
    expect(res.status, await res.clone().text()).toBe(200);
    await vi.waitFor(() => expect(mail.filter((m) => m.template === 'auth.password_reset').length).toBe(before + 1));
    return String(mail.filter((m) => m.template === 'auth.password_reset')[before].data.token);
  };
  const reset = async (newPassword: string) => answer(await fire('/reset-password', { token: await requestLink(), newPassword }));

  const admin = await signIn(ADMIN_EMAIL, FIRST);
  expect(admin.bearer, 'the administrator signs in on the bearer lane').toBeTruthy();

  return {
    engine, manager, auth, fire, bearer, signIn, mintKey, keyAdmits, keyRow, link, providers, reset, userId, mail,
    texts, adminBearer: admin.bearer!,
  };
}

describe('a completed self-service password reset ends what the account added before it', () => {
  it('the emailed reset: every API key and every linked sign-in account; the password signs in, a key minted after admits', async () => {
    const s = await stage();
    const live = await s.mintKey('ci-deploy');
    const ownerRevoked = await s.mintKey('old-laptop');
    await s.engine.update('sys_api_key', { id: 'key_old-laptop', revoked: true }, SYS);
    await s.link('github');
    expect(await s.keyAdmits(live), 'the key admits before the reset').toBe(true);
    expect(await s.providers()).toEqual(['credential', 'github']);

    expect(await s.reset(SECOND)).toEqual({ status: 200 });

    expect(await s.keyAdmits(live), 'the key the account held before the reset no longer admits').toBe(false);
    expect(await s.keyRow('ci-deploy')).toEqual({ revoked: true, revoked_reason: null });
    expect(await s.keyAdmits(ownerRevoked)).toBe(false);
    expect(await s.providers(), 'the linked sign-in account is gone; the password row stays').toEqual(['credential']);
    expect(s.mail.filter((m) => m.template === NOTICE), 'a reset sends no reminder').toEqual([]);

    // The controls: the new password signs in, and a key minted after the reset admits.
    expect((await s.signIn(EMAIL, SECOND)).status).toBe(200);
    expect(await s.keyAdmits(await s.mintKey('after-reset'))).toBe(true);
  }, 60_000);

  it('the texted reset: the same', async () => {
    const s = await stage({ plugins: { phoneNumber: true }, phoneOtp: { cooldownSeconds: 0 } });
    await s.engine.update('sys_user', { id: s.userId, phone_number: PHONE, phone_number_verified: true }, SYS);
    const live = await s.mintKey('ci-deploy');
    await s.link('google');
    const sent = await s.fire('/phone-number/request-password-reset', { phoneNumber: PHONE });
    expect(sent.status, await sent.clone().text()).toBe(200);
    await vi.waitFor(() => expect(s.texts.length).toBe(1));
    const otp = String(s.texts[0].templateParams?.code ?? '');

    expect(await answer(await s.fire('/phone-number/reset-password', { phoneNumber: PHONE, otp, newPassword: SECOND }))).toEqual({ status: 200 });

    expect(await s.keyAdmits(live)).toBe(false);
    expect(await s.providers()).toEqual(['credential']);
  }, 60_000);

  it('a reset that does not complete ends nothing', async () => {
    const s = await stage();
    const live = await s.mintKey('ci-deploy');
    await s.link('github');

    const refused = await answer(await s.fire('/reset-password', { token: 'a-token-never-issued', newPassword: SECOND }));
    expect(refused).toMatchObject({ status: 400, code: 'INVALID_TOKEN' });

    expect(await s.keyAdmits(live)).toBe(true);
    expect(await s.providers()).toEqual(['credential', 'github']);
  }, 60_000);

  it('an ending that cannot be written is not swallowed: the reset answers an error', async () => {
    const s = await stage();
    const live = await s.mintKey('ci-deploy');
    const original = s.engine.update.bind(s.engine);
    vi.spyOn(s.engine, 'update').mockImplementation((async (object: string, ...rest: unknown[]) => {
      if (object === 'sys_api_key') throw new Error('sys_api_key cannot be written');
      return (original as (...a: unknown[]) => Promise<unknown>)(object, ...rest);
    }) as never);

    const res = await s.reset(SECOND);

    expect(res.status, 'the requester is told').toBeGreaterThanOrEqual(500);
    expect(await s.keyAdmits(live), 'the key that could not be revoked still admits, and the requester knows').toBe(true);
  }, 60_000);
});

describe('a password change ends neither, and reminds the account what it keeps', () => {
  it('the API key and the linked sign-in account stay, and the notice lists them', async () => {
    const s = await stage();
    const live = await s.mintKey('ci-deploy');
    await s.link('github');
    const user = await s.signIn(EMAIL, FIRST);

    const changed = await s.fire('/change-password', { currentPassword: FIRST, newPassword: SECOND }, s.bearer(user.bearer!));
    expect(changed.status, await changed.clone().text()).toBe(200);

    expect(await s.keyAdmits(live), 'a change does not end the key').toBe(true);
    expect(await s.providers(), 'a change does not unlink the account').toEqual(['credential', 'github']);
    const notices = s.mail.filter((m) => m.template === NOTICE);
    expect(notices).toHaveLength(1);
    expect(notices[0].to?.address).toBe(EMAIL);
    expect(notices[0].data).toMatchObject({
      apiKeyCount: 1,
      apiKeys: 'ci-deploy',
      signInAccountCount: 1,
      signInAccounts: 'github',
      user: { email: EMAIL, id: s.userId },
    });
  }, 60_000);

  it('an account that holds neither is sent nothing', async () => {
    const s = await stage();
    const user = await s.signIn(EMAIL, FIRST);

    const changed = await s.fire('/change-password', { currentPassword: FIRST, newPassword: SECOND }, s.bearer(user.bearer!));
    expect(changed.status, await changed.clone().text()).toBe(200);

    expect(s.mail.filter((m) => m.template === NOTICE)).toEqual([]);
  }, 60_000);
});

describe("an administrator's and the operator's resets end the same", () => {
  it("/admin/set-user-password with revocation on unlinks the sign-in accounts beside the keys; with it off, nothing ends", async () => {
    const s = await stage();
    const live = await s.mintKey('ci-deploy');
    await s.link('github');

    const routine = await s.fire(
      '/admin/set-user-password',
      { userId: s.userId, newPassword: SECOND, mustChangePassword: false, revokeSessionsAndKeys: false },
      s.bearer(s.adminBearer),
    );
    expect(routine.status, await routine.clone().text()).toBe(200);
    expect(await s.keyAdmits(live), 'a routine reset ends nothing').toBe(true);
    expect(await s.providers()).toEqual(['credential', 'github']);

    const forced = await s.fire(
      '/admin/set-user-password',
      { userId: s.userId, newPassword: FIRST, mustChangePassword: false },
      s.bearer(s.adminBearer),
    );
    expect(forced.status, await forced.clone().text()).toBe(200);
    const body = (await forced.json()) as { data?: { revoked?: Record<string, unknown> } };
    expect(body.data?.revoked).toMatchObject({ apiKeys: 1, signInAccounts: 1, failed: 0, complete: true });
    expect(await s.keyAdmits(live)).toBe(false);
    expect(await s.providers()).toEqual(['credential']);
  }, 60_000);

  it('the operator reset unlinks them too', async () => {
    const s = await stage();
    await s.link('github');

    const outcome = await setOperatorPassword(s.engine as never, { email: EMAIL, password: SECOND });

    expect(outcome).toMatchObject({ outcome: 'set', signInAccountsUnlinked: 1, revocationComplete: true });
    expect(await s.providers()).toEqual(['credential']);
  }, 60_000);
});
