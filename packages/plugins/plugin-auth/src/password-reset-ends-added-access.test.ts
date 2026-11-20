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
 *    every API key the admission seam would admit (a `revoked` flag false or
 *    null) and every linked sign-in account the account held: the key no
 *    longer admits, the link is gone, the password row stays and the new
 *    password signs in; a key minted after the reset admits;
 *  - where the OAuth provider and device authorization are mounted, it ends
 *    the apps authorized to the account (consents, refresh and access
 *    tokens) and its approved device sign-ins, and no other account's;
 *    where they are not mounted, it reads none of those stores;
 *  - a reset that does not complete ends nothing;
 *  - a password change ends none of these, and mails the account
 *    `auth.password_changed_notice` listing what stays active (not a revoked
 *    or expired key); an account that holds none is sent nothing;
 *  - an administrator's forced reset with its revocation switch on unlinks the
 *    sign-in accounts beside the keys (a null flag's included) and sessions it
 *    already ended, and with the switch off ends nothing; the operator's reset
 *    unlinks them too;
 *  - a reset whose ending cannot be written, whose account cannot be named, or
 *    whose link a delete hook keeps, is not swallowed: the requester is
 *    answered an error, and the password-change stamp and history entry are
 *    written first all the same.
 */

import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { hashApiKey, resolveApiKeyAdmission } from '@objectstack/core';
import { mcpConsentAdmits } from './mcp-token-revocation.js';
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
// The SSO discovery egress guard the source loads with a dynamic import, paid
// here too, during collection (check-test-source-alias, "The source reach").
import '@objectstack/core/egress';

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
  /** A key whose `revoked` flag is null, which the admission seam reads as live. */
  const mintNullFlagKey = async (name: string): Promise<string> => {
    const raw = await mintKey(name);
    await engine.update('sys_api_key', { id: `key_${name}`, revoked: null }, SYS);
    const row = ((await engine.find('sys_api_key', { where: { id: `key_${name}` }, context: { isSystem: true } } as never)) as any[])[0];
    expect(row.revoked ?? null, 'the flag reads null').toBeNull();
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
    engine, manager, auth, fire, bearer, signIn, mintKey, mintNullFlagKey, keyAdmits, keyRow, link, providers, reset,
    requestLink, userId, adminUserId: await idOf(ADMIN_EMAIL), mail, texts, adminBearer: admin.bearer!,
  };
}

describe('a completed self-service password reset ends what the account added before it', () => {
  it('the emailed reset: every API key and every linked sign-in account; the password signs in, a key minted after admits', async () => {
    const s = await stage();
    const live = await s.mintKey('ci-deploy');
    const nullFlag = await s.mintNullFlagKey('null-flag');
    const ownerRevoked = await s.mintKey('old-laptop');
    await s.engine.update('sys_api_key', { id: 'key_old-laptop', revoked: true }, SYS);
    await s.link('github');
    expect(await s.keyAdmits(live), 'the key admits before the reset').toBe(true);
    expect(await s.keyAdmits(nullFlag), 'a key whose flag is null admits before the reset').toBe(true);
    expect(await s.providers()).toEqual(['credential', 'github']);

    expect(await s.reset(SECOND)).toEqual({ status: 200 });

    expect(await s.keyAdmits(live), 'the key the account held before the reset no longer admits').toBe(false);
    expect(await s.keyRow('ci-deploy')).toEqual({ revoked: true, revoked_reason: null });
    expect(await s.keyAdmits(nullFlag), 'nor does the key whose flag was null').toBe(false);
    expect(await s.keyRow('null-flag')).toEqual({ revoked: true, revoked_reason: null });
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

  it('a failed ending still leaves the written password its stamp and its history entry', async () => {
    const s = await stage({ passwordHistoryCount: 3 });
    await s.mintKey('ci-deploy');
    const stampOf = async () =>
      new Date(
        ((await s.engine.findOne('sys_user', { where: { id: s.userId }, fields: ['password_changed_at'], context: { isSystem: true } } as never)) as {
          password_changed_at?: string;
        }).password_changed_at ?? 0,
      ).getTime();
    const stampedAtSignUp = await stampOf();
    const original = s.engine.update.bind(s.engine);
    const refusing = vi.spyOn(s.engine, 'update').mockImplementation((async (object: string, ...rest: unknown[]) => {
      if (object === 'sys_api_key') throw new Error('sys_api_key cannot be written');
      return (original as (...a: unknown[]) => Promise<unknown>)(object, ...rest);
    }) as never);

    expect((await s.reset(SECOND)).status, 'the ending failed').toBeGreaterThanOrEqual(500);
    refusing.mockRestore();

    expect(await stampOf(), 'password_changed_at moved to the reset').toBeGreaterThan(stampedAtSignUp);
    // The history entry: the password the reset replaced is refused as a reuse.
    expect(await answer(await s.fire('/reset-password', { token: await s.requestLink(), newPassword: FIRST }))).toMatchObject({
      status: 400,
      code: 'PASSWORD_REUSE',
    });
  }, 60_000);

  it('a completed reset whose account cannot be named answers an error, and ends nothing it could not find', async () => {
    const s = await stage();
    const live = await s.mintKey('ci-deploy');
    const token = await s.requestLink();
    // The before-hook's read of the reset record fails once; every later read answers.
    const internal = s.auth.internalAdapter;
    const original = internal.findVerificationValue.bind(internal);
    let failed = 0;
    vi.spyOn(internal, 'findVerificationValue').mockImplementation((async (identifier: string) => {
      if (failed === 0 && identifier.startsWith('reset-password:')) {
        failed += 1;
        throw new Error('the reset record cannot be read');
      }
      return original(identifier);
    }) as never);

    const res = await answer(await s.fire('/reset-password', { token, newPassword: SECOND }));

    expect(failed, 'the read failed once').toBe(1);
    expect(res.status, 'the requester is told').toBeGreaterThanOrEqual(500);
    expect((await s.signIn(EMAIL, SECOND)).status, 'the password was written').toBe(200);
    expect(await s.keyAdmits(live), 'the key still admits, and the requester knows').toBe(true);
  }, 60_000);

  it('a linked sign-in account a delete hook keeps is not counted as ended: the reset answers an error', async () => {
    const s = await stage({
      databaseHooks: { account: { delete: { before: async (account: { providerId?: string }) => (account?.providerId === 'github' ? false : undefined) } } },
    });
    await s.link('github');

    const res = await s.reset(SECOND);

    expect(res.status, 'the requester is told').toBeGreaterThanOrEqual(500);
    expect(await s.providers(), 'the hook kept the link').toEqual(['credential', 'github']);
  }, 60_000);
});

describe('where the OAuth provider is mounted, a completed reset and a forced reset end the apps authorized to the account', () => {
  const ENV_KEYS = ['OS_OIDC_PROVIDER_ENABLED', 'OS_MCP_SERVER_ENABLED'] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  const CLIENT_ID = 'assistant-client';
  const LATER = () => new Date(Date.now() + 3_600_000);

  /** An app authorized by `userId` the way the provider stores one, through better-auth's own adapter, and an approved device sign-in. */
  async function authorize(s: Awaited<ReturnType<typeof stage>>, userId: string, tag: string) {
    const adapter = s.auth.adapter;
    const now = new Date();
    await adapter.create({ model: 'oauthConsent', data: { clientId: CLIENT_ID, userId, scopes: ['openid'], createdAt: now, updatedAt: now } });
    const refresh = await adapter.create({
      model: 'oauthRefreshToken',
      data: { token: `refresh-${tag}`, clientId: CLIENT_ID, userId, scopes: ['openid'], expiresAt: LATER(), createdAt: now },
    });
    await adapter.create({
      model: 'oauthAccessToken',
      data: { token: `access-${tag}`, clientId: CLIENT_ID, userId, refreshId: refresh.id, scopes: ['openid'], expiresAt: LATER(), createdAt: now },
    });
    await adapter.create({
      model: 'deviceCode',
      data: { deviceCode: `device-${tag}`, userCode: `USER-${tag}`, userId, status: 'approved', clientId: CLIENT_ID, expiresAt: LATER() },
    });
  }
  /** How many rows of each grant store name `userId`, read through the engine. */
  async function grantsOf(s: Awaited<ReturnType<typeof stage>>, userId: string) {
    const count = async (object: string) =>
      ((await s.engine.find(object, { where: { user_id: userId }, context: { isSystem: true } } as never)) as unknown[]).length;
    return {
      consents: await count('sys_oauth_consent'),
      refreshTokens: await count('sys_oauth_refresh_token'),
      accessTokens: await count('sys_oauth_access_token'),
      deviceCodes: await count('sys_device_code'),
    };
  }
  const ALL = { consents: 1, refreshTokens: 1, accessTokens: 1, deviceCodes: 1 };
  const NONE = { consents: 0, refreshTokens: 0, accessTokens: 0, deviceCodes: 0 };
  const registerClient = (s: Awaited<ReturnType<typeof stage>>) =>
    s.engine.insert(
      'sys_oauth_application',
      { id: 'app_assistant', client_id: CLIENT_ID, name: 'Desk Assistant', redirect_uris: JSON.stringify(['http://localhost:56789/cb']) },
      SYS,
    );

  it('its consents, refresh and access tokens and approved device sign-ins; another account keeps its own', async () => {
    const s = await stage({ plugins: { oidcProvider: true, deviceAuthorization: true } });
    await registerClient(s);
    await authorize(s, s.userId, 'user');
    await authorize(s, s.adminUserId, 'admin');
    const issuedAt = Math.floor(Date.now() / 1000) + 1;
    const grantStands = () => mcpConsentAdmits(s.auth.adapter, { clientId: CLIENT_ID, userId: s.userId }, issuedAt);
    expect(await grantsOf(s, s.userId)).toEqual(ALL);
    expect(await grantStands(), 'the MCP door admits a token of the grant before the reset').toBe(true);

    expect(await s.reset(SECOND)).toEqual({ status: 200 });

    expect(await grantsOf(s, s.userId)).toEqual(NONE);
    expect(await grantStands(), 'and refuses it after').toBe(false);
    // The control: another account's grants stay.
    expect(await grantsOf(s, s.adminUserId)).toEqual(ALL);
  }, 60_000);

  it('a password change ends none of them, and its reminder lists the app', async () => {
    const s = await stage({ plugins: { oidcProvider: true, deviceAuthorization: true } });
    await registerClient(s);
    await authorize(s, s.userId, 'user');
    const user = await s.signIn(EMAIL, FIRST);

    const changed = await s.fire('/change-password', { currentPassword: FIRST, newPassword: SECOND }, s.bearer(user.bearer!));
    expect(changed.status, await changed.clone().text()).toBe(200);

    expect(await grantsOf(s, s.userId)).toEqual(ALL);
    const notices = s.mail.filter((m) => m.template === NOTICE);
    expect(notices).toHaveLength(1);
    expect(notices[0].data).toMatchObject({ authorizedAppCount: 1, authorizedApps: 'Desk Assistant', apiKeyCount: 0, signInAccountCount: 0 });
  }, 60_000);

  /**
   * A stage on which neither plugin is mounted (the provider is on by default,
   * since it follows the MCP server, so it is turned off), its grant rows
   * written straight to the stores, as an earlier mount would have left them.
   */
  async function unmountedStage() {
    const s = await stage({ plugins: { oidcProvider: false } });
    expect(s.auth.getPlugin('oauth-provider'), 'the provider is not mounted').toBeFalsy();
    for (const [object, row] of [
      ['sys_oauth_consent', { client_id: CLIENT_ID, user_id: s.userId, scopes: JSON.stringify(['openid']) }],
      ['sys_oauth_refresh_token', { token: 'refresh-unmounted', client_id: CLIENT_ID, user_id: s.userId, scopes: JSON.stringify(['openid']), expires_at: LATER() }],
      ['sys_oauth_access_token', { token: 'access-unmounted', client_id: CLIENT_ID, user_id: s.userId, scopes: JSON.stringify(['openid']), expires_at: LATER() }],
      ['sys_device_code', { device_code: 'device-unmounted', user_code: 'USER-UNMOUNTED', user_id: s.userId, status: 'approved', expires_at: LATER() }],
    ] as const) {
      await s.engine.insert(object, row as never, SYS);
    }
    return s;
  }

  it('the control: where neither plugin is mounted, a reset reads none of those stores', async () => {
    const s = await unmountedStage();

    expect(await s.reset(SECOND)).toEqual({ status: 200 });

    expect(await grantsOf(s, s.userId)).toEqual(ALL);
  }, 60_000);

  it("an administrator's forced reset ends them too and reports the apps; with revocation off it ends none", async () => {
    const s = await stage({ plugins: { oidcProvider: true, deviceAuthorization: true } });
    await registerClient(s);
    await authorize(s, s.userId, 'user');
    await authorize(s, s.adminUserId, 'admin');
    const issuedAt = Math.floor(Date.now() / 1000) + 1;
    const grantStands = () => mcpConsentAdmits(s.auth.adapter, { clientId: CLIENT_ID, userId: s.userId }, issuedAt);

    const routine = await s.fire(
      '/admin/set-user-password',
      { userId: s.userId, newPassword: SECOND, mustChangePassword: false, revokeSessionsAndKeys: false },
      s.bearer(s.adminBearer),
    );
    expect(routine.status, await routine.clone().text()).toBe(200);
    expect(await grantsOf(s, s.userId), 'a routine reset ends nothing').toEqual(ALL);
    expect(await grantStands()).toBe(true);

    const forced = await s.fire(
      '/admin/set-user-password',
      { userId: s.userId, newPassword: FIRST, mustChangePassword: false },
      s.bearer(s.adminBearer),
    );
    expect(forced.status, await forced.clone().text()).toBe(200);
    const body = (await forced.json()) as { data?: { revoked?: Record<string, unknown> } };
    expect(body.data?.revoked).toMatchObject({ authorizedApps: 1, failed: 0, complete: true });
    expect(await grantsOf(s, s.userId)).toEqual(NONE);
    expect(await grantStands(), 'the MCP door refuses a token of the grant after it').toBe(false);
    // The control: the administrator's own grants stay.
    expect(await grantsOf(s, s.adminUserId)).toEqual(ALL);
  }, 60_000);

  it("the operator's reset ends them too, as the project database holds them", async () => {
    const s = await stage({ plugins: { oidcProvider: true, deviceAuthorization: true } });
    await registerClient(s);
    await authorize(s, s.userId, 'user');
    await authorize(s, s.adminUserId, 'admin');

    const outcome = await setOperatorPassword(s.engine as never, { email: EMAIL, password: SECOND });

    expect(outcome).toMatchObject({ outcome: 'set', authorizedAppsEnded: 1, revocationComplete: true });
    expect(await grantsOf(s, s.userId)).toEqual(NONE);
    expect(await grantsOf(s, s.adminUserId)).toEqual(ALL);
  }, 60_000);

  it("the control: where neither plugin is mounted, the administrator's forced reset reads none of those stores", async () => {
    const s = await unmountedStage();

    const forced = await s.fire(
      '/admin/set-user-password',
      { userId: s.userId, newPassword: SECOND, mustChangePassword: false },
      s.bearer(s.adminBearer),
    );
    expect(forced.status, await forced.clone().text()).toBe(200);
    const body = (await forced.json()) as { data?: { revoked?: Record<string, unknown> } };
    expect(body.data?.revoked).toMatchObject({ authorizedApps: 0, failed: 0, complete: true });
    expect(await grantsOf(s, s.userId)).toEqual(ALL);
  }, 60_000);
});

describe('a password change ends neither, and reminds the account what it keeps', () => {
  it('the API key and the linked sign-in account stay, and the notice lists them', async () => {
    const s = await stage();
    const live = await s.mintKey('ci-deploy');
    // Neither a revoked key nor one whose own expiry has passed is listed as active.
    await s.mintKey('old-laptop');
    await s.engine.update('sys_api_key', { id: 'key_old-laptop', revoked: true }, SYS);
    await s.mintKey('expired');
    await s.engine.update('sys_api_key', { id: 'key_expired', expires_at: new Date(Date.now() - 60_000).toISOString() }, SYS);
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
      authorizedAppCount: 0,
      authorizedApps: '—',
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
    const nullFlag = await s.mintNullFlagKey('null-flag');
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
    expect(body.data?.revoked).toMatchObject({ apiKeys: 2, signInAccounts: 1, failed: 0, complete: true });
    expect(await s.keyAdmits(live)).toBe(false);
    expect(await s.keyAdmits(nullFlag), 'a key whose flag was null is revoked too').toBe(false);
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
