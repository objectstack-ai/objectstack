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
 *    written first all the same;
 *  - every reset (both self-service doors, the administrator's forced reset
 *    with revocation on, the operator's) disables the OAuth applications the
 *    account registered and revokes the SCIM credentials it minted: the MCP
 *    door refuses a token of the disabled app whoever holds it, the provider
 *    mints the app no client-credentials token and answers its earlier one
 *    inactive, and the credential's bearer no longer verifies; another
 *    account's app and another administrator's credential for the same
 *    connection are untouched, and the account's single sign-on provider and
 *    second-factor rows are unchanged. The self-service reset mails
 *    `auth.password_reset_notice` naming what it ended and what it kept; a
 *    password change disables and revokes nothing, and its reminder lists
 *    them. A store the deployment does not hold holds none, and a write that
 *    fails reaches the requester (self-service) or keeps the forced reset's
 *    outcome incomplete.
 */

import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { hashApiKey, resolveApiKeyAdmission } from '@objectstack/core';
import { createHash } from 'node:crypto';
import { mcpConsentAdmits } from './mcp-token-revocation.js';
import { endWhatTheAccountRegistered } from './password-reset-ends-added-access.js';
import { mintScimConnectionCredential, verifyScimBearerToken } from './scim-connection-service.js';
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
const RESET_NOTICE = 'auth.password_reset_notice';

/**
 * The columns `sys_audit_log` declares that the administrator's ledger row
 * writes (`writeAdminAudit`): the fixture the plugin-auth harness carries, as
 * plugin-audit, the object's owner, is not a dependency of this package.
 */
const sysAuditLog = {
  name: 'sys_audit_log',
  label: 'Audit Log',
  systemFields: { tenant: false },
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    action: { name: 'action', type: 'text' as const },
    user_id: { name: 'user_id', type: 'text' as const },
    actor: { name: 'actor', type: 'text' as const },
    object_name: { name: 'object_name', type: 'text' as const },
    record_id: { name: 'record_id', type: 'text' as const },
    metadata: { name: 'metadata', type: 'textarea' as const },
  },
};

const engines = sqliteEnginePool(async () => {
  const engine = new ObjectQL();
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  engine.registerDriver(driver, true);
  await engine.init();
  for (const object of [...authIdentityObjects, sysAuditLog]) {
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
    const grantStands = () => mcpConsentAdmits(s.auth.adapter, { clientId: CLIENT_ID, userId: s.userId }, issuedAt, s.auth.internalAdapter);
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
    const grantStands = () => mcpConsentAdmits(s.auth.adapter, { clientId: CLIENT_ID, userId: s.userId }, issuedAt, s.auth.internalAdapter);

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

  it("a forced reset reports the apps it ended though a later grant store fails; the failure keeps it incomplete", async () => {
    const s = await stage({ plugins: { oidcProvider: true, deviceAuthorization: true } });
    await registerClient(s);
    await authorize(s, s.userId, 'user');
    const deleteRow = s.auth.adapter.delete.bind(s.auth.adapter);
    vi.spyOn(s.auth.adapter, 'delete').mockImplementation((async (query: { model: string }) => {
      if (query.model === 'oauthRefreshToken') throw new Error('the refresh token store refused the delete');
      return deleteRow(query);
    }) as never);

    const forced = await s.fire(
      '/admin/set-user-password',
      { userId: s.userId, newPassword: SECOND, mustChangePassword: false },
      s.bearer(s.adminBearer),
    );
    expect(forced.status, await forced.clone().text()).toBe(200);
    const body = (await forced.json()) as { data?: { revoked?: Record<string, unknown> } };
    expect(body.data?.revoked).toMatchObject({ authorizedApps: 1, failed: 1, complete: false });
    expect(await grantsOf(s, s.userId)).toMatchObject({ consents: 0, refreshTokens: 1 });
  }, 60_000);
});

describe('an MCP access token issued before the account\'s password changed is refused, whatever its grant', () => {
  const ENV_KEYS = ['OS_OIDC_PROVIDER_ENABLED', 'OS_MCP_SERVER_ENABLED'] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    vi.useRealTimers();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  /**
   * Move the wall clock two seconds on, as `credential-change-ends-prior-access.test.ts`
   * does: past the window in which the sign-up's password row is still its
   * creation, so the write that follows reads as a change.
   */
  const advanceTheClock = () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 2_000);
  };

  const CONSENTED_CLIENT = 'consented-assistant';
  const SERVER_CLIENT = 'server-assistant';
  /** Two apps: one the account consented to, and a server-only one the provider never asks consent for. */
  async function apps(s: Awaited<ReturnType<typeof stage>>) {
    for (const [id, clientId, skip] of [['app_consented', CONSENTED_CLIENT, false], ['app_server', SERVER_CLIENT, true]] as const) {
      await s.engine.insert(
        'sys_oauth_application',
        { id, client_id: clientId, name: clientId, redirect_uris: JSON.stringify(['http://localhost:56789/cb']), skip_consent: skip },
        SYS,
      );
    }
    const now = new Date();
    await s.auth.adapter.create({
      model: 'oauthConsent',
      data: { clientId: CONSENTED_CLIENT, userId: s.userId, scopes: ['openid'], createdAt: now, updatedAt: now },
    });
  }
  /** The MCP door's grant read for a token of `clientId` issued at `iat` (whole seconds). */
  const admits = (s: Awaited<ReturnType<typeof stage>>, clientId: string, iat: number) =>
    mcpConsentAdmits(s.auth.adapter, { clientId, userId: s.userId }, iat, s.auth.internalAdapter);
  const nowS = () => Math.floor(Date.now() / 1000);

  it('with no clock to read, the grant read answers no, and throws nothing', async () => {
    const store = {
      findOne: async () => ({ clientId: SERVER_CLIENT, skipConsent: true, disabled: false }),
      findMany: async () => [],
      delete: async () => undefined,
      deleteMany: async () => undefined,
    };
    const clock = { findCredentialAccount: async () => null };
    // The control: the same server-only app, its clock readable, admits.
    await expect(mcpConsentAdmits(store, { clientId: SERVER_CLIENT, userId: 'someone' }, nowS(), clock)).resolves.toBe(true);
    await expect(mcpConsentAdmits(store, { clientId: SERVER_CLIENT, userId: 'someone' }, nowS(), undefined)).resolves.toBe(false);
  });

  it('a completed self-service reset: a token issued before it is refused; one issued a second after admits', async () => {
    const s = await stage({ plugins: { oidcProvider: true } });
    await apps(s);
    const before = nowS();
    expect(await admits(s, SERVER_CLIENT, before), 'admitted before the reset').toBe(true);
    advanceTheClock();

    expect(await s.reset(SECOND)).toEqual({ status: 200 });

    expect(await admits(s, SERVER_CLIENT, before), 'refused after it').toBe(false);
    // The control: a token the app is issued after the reset admits.
    expect(await admits(s, SERVER_CLIENT, nowS() + 1)).toBe(true);
  }, 60_000);

  it("an administrator's forced reset: a token issued before it is refused; one issued a second after admits", async () => {
    const s = await stage({ plugins: { oidcProvider: true } });
    await apps(s);
    const before = nowS();
    expect(await admits(s, SERVER_CLIENT, before), 'admitted before the reset').toBe(true);
    advanceTheClock();

    const forced = await s.fire(
      '/admin/set-user-password',
      { userId: s.userId, newPassword: SECOND, mustChangePassword: false },
      s.bearer(s.adminBearer),
    );
    expect(forced.status, await forced.clone().text()).toBe(200);

    expect(await admits(s, SERVER_CLIENT, before), 'refused after it').toBe(false);
    expect(await admits(s, SERVER_CLIENT, nowS() + 1)).toBe(true);
  }, 60_000);

  it('a password change keeps the grant: a token issued before it is refused, and the one the app is issued after admits', async () => {
    const s = await stage({ plugins: { oidcProvider: true } });
    await apps(s);
    const before = nowS();
    expect(await admits(s, CONSENTED_CLIENT, before)).toBe(true);
    expect(await admits(s, SERVER_CLIENT, before)).toBe(true);
    const user = await s.signIn(EMAIL, FIRST);
    advanceTheClock();

    const changed = await s.fire('/change-password', { currentPassword: FIRST, newPassword: SECOND }, s.bearer(user.bearer!));
    expect(changed.status, await changed.clone().text()).toBe(200);

    const consents = (await s.engine.find('sys_oauth_consent', { where: { user_id: s.userId }, context: { isSystem: true } } as never)) as unknown[];
    expect(consents, 'the change keeps the consent').toHaveLength(1);
    expect(await admits(s, CONSENTED_CLIENT, before)).toBe(false);
    expect(await admits(s, SERVER_CLIENT, before)).toBe(false);
    const after = nowS() + 1;
    expect(await admits(s, CONSENTED_CLIENT, after)).toBe(true);
    expect(await admits(s, SERVER_CLIENT, after)).toBe(true);
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

describe('every reset disables the OAuth applications the account registered and revokes the SCIM credentials it minted', () => {
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

  type Stage = Awaited<ReturnType<typeof stage>>;
  const REDIRECTS = JSON.stringify(['http://localhost:56789/cb']);
  const CONNECTION = 'okta-prod';
  /** The organization the connection provisions into, as the mint door resolves it. */
  const ORGANIZATION = 'org_acme';

  /**
   * The setup the account added, beside the administrator's: two OAuth
   * applications it registered (one whose `disabled` flag was never written,
   * one written false) and one it had already disabled, an app the
   * administrator registered, a SCIM credential the account minted and one the
   * administrator minted for the same connection, a single sign-on provider it
   * registered and its second-factor enrolment. Each app is written the way the
   * Setup form's create door writes one (the owner in `user_id`); each
   * credential is minted by the mint door's own persist step, its minting
   * account in `user_id`.
   */
  async function registered(s: Stage) {
    const app = (id: string, clientId: string, name: string, owner: string, disabled?: boolean) =>
      s.engine.insert(
        'sys_oauth_application',
        { id, client_id: clientId, name, redirect_uris: REDIRECTS, user_id: owner, ...(disabled === undefined ? {} : { disabled }) },
        SYS,
      );
    await app('app_desk', 'desk-assistant', 'Desk Assistant', s.userId);
    await app('app_reports', 'report-sync', 'Report Sync', s.userId, false);
    await app('app_retired', 'retired-tool', 'Retired Tool', s.userId, true);
    await app('app_admin', 'admin-console', 'Admin Console', s.adminUserId, false);
    const mint = (mintedBy: string, label: string) =>
      mintScimConnectionCredential({ insert: (object: string, row: Record<string, unknown>) => s.engine.insert(object, row as never, SYS) } as never, SECRET, {
        connectionId: CONNECTION,
        organizationId: ORGANIZATION,
        label,
        mintedByUserId: mintedBy,
      });
    const userBearer = (await mint(s.userId, 'rotation')).token;
    const adminBearer = (await mint(s.adminUserId, 'primary')).token;
    await s.engine.insert(
      'sys_sso_provider',
      { id: 'sso_acme', provider_id: 'acme-okta', issuer: 'https://acme.okta.example', domain: 'acme.example', user_id: s.userId },
      SYS,
    );
    await s.engine.update('sys_user', { id: s.userId, two_factor_enabled: true }, SYS);
    await s.engine.insert('sys_two_factor', { id: 'tf_user', user_id: s.userId, secret: 'enrolled-secret', backup_codes: 'enrolled-codes' }, SYS);
    return { userBearer, adminBearer };
  }
  /** Whether each app is disabled, read the way the provider reads the flag (a SQLite `1` is on). */
  async function disabledApps(s: Stage): Promise<Record<string, boolean>> {
    const rows = (await s.engine.find('sys_oauth_application', { context: { isSystem: true } } as never)) as Array<{ id: string; disabled?: unknown }>;
    return Object.fromEntries(rows.map((row) => [row.id, row.disabled === true || row.disabled === 1]));
  }
  const NONE_DISABLED = { app_desk: false, app_reports: false, app_retired: true, app_admin: false };
  const OWNED_DISABLED = { app_desk: true, app_reports: true, app_retired: true, app_admin: false };
  /** The production SCIM bearer verifier's verdict on a bearer. */
  const scimAdmits = async (s: Stage, bearer: string) => (await verifyScimBearerToken(s.engine as never, SECRET, bearer)) !== null;
  /** The account's single sign-on provider row, its second-factor row and its enrolment flag, as stored. */
  async function keptRows(s: Stage) {
    const one = async (object: string, where: Record<string, unknown>) =>
      ((await s.engine.find(object, { where, context: { isSystem: true } } as never)) as Array<Record<string, unknown>>)[0];
    const user = await one('sys_user', { id: s.userId });
    return {
      sso: await one('sys_sso_provider', { id: 'sso_acme' }),
      twoFactor: await one('sys_two_factor', { id: 'tf_user' }),
      twoFactorEnabled: user?.two_factor_enabled === true || user?.two_factor_enabled === 1,
    };
  }
  /** The names a prepared notice list carries, sorted. */
  const names = (list: unknown) => String(list).split(', ').sort();

  it('the emailed reset: the apps are disabled and the credential revoked; the rest is kept, and the notice names both', async () => {
    const s = await stage({ plugins: { oidcProvider: true } });
    const { userBearer, adminBearer } = await registered(s);
    const kept = await keptRows(s);
    expect(kept.twoFactorEnabled, 'the account is enrolled in a second factor').toBe(true);
    expect(await disabledApps(s)).toEqual(NONE_DISABLED);
    expect(await scimAdmits(s, userBearer), 'the credential the account minted verifies before the reset').toBe(true);

    expect(await s.reset(SECOND)).toEqual({ status: 200 });

    expect(await disabledApps(s), "the account's enabled apps are disabled; the administrator's is not").toEqual(OWNED_DISABLED);
    expect(await scimAdmits(s, userBearer), 'the credential the account minted no longer verifies').toBe(false);
    expect(await scimAdmits(s, adminBearer), "the administrator's credential for the same connection still does").toBe(true);
    expect(await keptRows(s), 'the single sign-on provider and the second factor are unchanged').toEqual(kept);

    const notices = s.mail.filter((m) => m.template === RESET_NOTICE);
    expect(notices).toHaveLength(1);
    expect(notices[0].to?.address).toBe(EMAIL);
    expect(notices[0].data).toMatchObject({
      user: { email: EMAIL, id: s.userId },
      ownedAppCount: 2,
      scimCredentialCount: 1,
      scimCredentials: `${CONNECTION} (rotation)`,
      ssoProviderCount: 1,
      ssoProviders: 'acme-okta',
      twoFactorCount: 1,
    });
    expect(names(notices[0].data.ownedApps), 'each app it disabled, by name; not the one already disabled').toEqual(['Desk Assistant', 'Report Sync']);
    expect(s.mail.filter((m) => m.template === NOTICE), 'a reset sends no change reminder').toEqual([]);
  }, 60_000);

  it('the texted reset: the same, where the OAuth provider is not mounted', async () => {
    const s = await stage({ plugins: { phoneNumber: true, oidcProvider: false }, phoneOtp: { cooldownSeconds: 0 } });
    expect(s.auth.getPlugin('oauth-provider'), 'the provider is not mounted').toBeFalsy();
    await s.engine.update('sys_user', { id: s.userId, phone_number: PHONE, phone_number_verified: true }, SYS);
    const { userBearer, adminBearer } = await registered(s);
    const sent = await s.fire('/phone-number/request-password-reset', { phoneNumber: PHONE });
    expect(sent.status, await sent.clone().text()).toBe(200);
    await vi.waitFor(() => expect(s.texts.length).toBe(1));
    const otp = String(s.texts[0].templateParams?.code ?? '');

    expect(await answer(await s.fire('/phone-number/reset-password', { phoneNumber: PHONE, otp, newPassword: SECOND }))).toEqual({ status: 200 });

    expect(await disabledApps(s)).toEqual(OWNED_DISABLED);
    expect(await scimAdmits(s, userBearer)).toBe(false);
    expect(await scimAdmits(s, adminBearer)).toBe(true);
    expect(s.mail.filter((m) => m.template === RESET_NOTICE)).toHaveLength(1);
  }, 60_000);

  it('a reset that does not complete disables, revokes and mails nothing', async () => {
    const s = await stage();
    const { userBearer } = await registered(s);

    const refused = await answer(await s.fire('/reset-password', { token: 'a-token-never-issued', newPassword: SECOND }));
    expect(refused).toMatchObject({ status: 400, code: 'INVALID_TOKEN' });

    expect(await disabledApps(s)).toEqual(NONE_DISABLED);
    expect(await scimAdmits(s, userBearer)).toBe(true);
    expect(s.mail.filter((m) => m.template === RESET_NOTICE)).toEqual([]);
  }, 60_000);

  it('the MCP door refuses a token of a disabled app whoever authorized it; a token of another app still admits', async () => {
    const s = await stage({ plugins: { oidcProvider: true } });
    await registered(s);
    // The administrator authorized the account's app and its own.
    const now = new Date();
    for (const clientId of ['desk-assistant', 'admin-console']) {
      await s.auth.adapter.create({ model: 'oauthConsent', data: { clientId, userId: s.adminUserId, scopes: ['openid'], createdAt: now, updatedAt: now } });
    }
    const issuedAt = Math.floor(Date.now() / 1000) + 1;
    const admits = (clientId: string) =>
      mcpConsentAdmits(s.auth.adapter, { clientId, userId: s.adminUserId }, issuedAt, s.auth.internalAdapter);
    expect(await admits('desk-assistant'), "a token of the account's app admits before the reset").toBe(true);
    expect(await admits('admin-console')).toBe(true);

    expect(await s.reset(SECOND)).toEqual({ status: 200 });

    expect(await admits('desk-assistant'), 'and is refused after it, though its holder reset nothing').toBe(false);
    expect(await admits('admin-console'), "the control: the administrator's own app still admits").toBe(true);
  }, 60_000);

  it('a client-credentials app the account registered is minted no token after the reset, and its earlier token reads inactive', async () => {
    const s = await stage({ plugins: { oidcProvider: true } });
    const CLIENT_ID = 'headless-sync';
    const CLIENT_SECRET = 'headless-sync-secret';
    const now = new Date();
    await s.auth.adapter.create({
      model: 'oauthClient',
      data: {
        clientId: CLIENT_ID,
        clientSecret: createHash('sha256').update(CLIENT_SECRET).digest('base64url'),
        name: 'Headless Sync',
        redirectUris: ['http://localhost:56789/cb'],
        grantTypes: ['client_credentials'],
        responseTypes: [],
        tokenEndpointAuthMethod: 'client_secret_post',
        scopes: ['data:read'],
        clientCredentialsScopes: ['data:read'],
        disabled: false,
        userId: s.userId,
        createdAt: now,
        updatedAt: now,
      },
    });
    const form = (path: string, body: Record<string, string>) =>
      s.manager.handleRequest(
        new Request(`${ORIGIN}${BASE}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN },
          body: new URLSearchParams(body).toString(),
        }),
      );
    const grant = () => form('/oauth2/token', { grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET, scope: 'data:read' });
    const introspect = async (token: string) => {
      const res = await form('/oauth2/introspect', { token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
      return { status: res.status, active: ((await res.json().catch(() => ({}))) as { active?: unknown }).active };
    };
    const minted = await grant();
    const mintedBody = (await minted.json()) as { access_token?: string };
    expect(minted.status, `the grant mints before the reset: ${JSON.stringify(mintedBody)}`).toBe(200);
    const token = String(mintedBody.access_token);
    expect(await introspect(token), 'its token reads active before the reset').toEqual({ status: 200, active: true });

    expect(await s.reset(SECOND)).toEqual({ status: 200 });

    const refused = await grant();
    const refusedBody = (await refused.json().catch(() => ({}))) as { error?: unknown };
    expect(refused.status, 'the grant is refused after it').toBeGreaterThanOrEqual(400);
    expect(refusedBody.error).toBe('invalid_client');
    expect((await introspect(token)).active, 'and the earlier token no longer reads active').not.toBe(true);
  }, 60_000);

  it('a password change disables and revokes nothing, and its reminder lists the apps and the credential', async () => {
    const s = await stage();
    const { userBearer } = await registered(s);
    const user = await s.signIn(EMAIL, FIRST);

    const changed = await s.fire('/change-password', { currentPassword: FIRST, newPassword: SECOND }, s.bearer(user.bearer!));
    expect(changed.status, await changed.clone().text()).toBe(200);

    expect(await disabledApps(s)).toEqual(NONE_DISABLED);
    expect(await scimAdmits(s, userBearer)).toBe(true);
    const notices = s.mail.filter((m) => m.template === NOTICE);
    expect(notices, 'the account holds no key, link or authorized app, and is reminded of these all the same').toHaveLength(1);
    expect(notices[0].data).toMatchObject({ apiKeyCount: 0, ownedAppCount: 2, scimCredentialCount: 1, scimCredentials: `${CONNECTION} (rotation)` });
    expect(names(notices[0].data.ownedApps)).toEqual(['Desk Assistant', 'Report Sync']);
    expect(s.mail.filter((m) => m.template === RESET_NOTICE), 'a change sends no reset notice').toEqual([]);
  }, 60_000);

  it("an administrator's forced reset: the same, counted on the response and the ledger; with revocation off, nothing", async () => {
    const s = await stage();
    const { userBearer, adminBearer } = await registered(s);
    const kept = await keptRows(s);

    const routine = await s.fire(
      '/admin/set-user-password',
      { userId: s.userId, newPassword: SECOND, mustChangePassword: false, revokeSessionsAndKeys: false },
      s.bearer(s.adminBearer),
    );
    expect(routine.status, await routine.clone().text()).toBe(200);
    expect(await disabledApps(s), 'a routine reset disables nothing').toEqual(NONE_DISABLED);
    expect(await scimAdmits(s, userBearer)).toBe(true);

    const forced = await s.fire(
      '/admin/set-user-password',
      { userId: s.userId, newPassword: FIRST, mustChangePassword: false },
      s.bearer(s.adminBearer),
    );
    expect(forced.status, await forced.clone().text()).toBe(200);
    const body = (await forced.json()) as { data?: { revoked?: Record<string, unknown> } };
    expect(body.data?.revoked).toMatchObject({ ownedApps: 2, scimCredentials: 1, failed: 0, complete: true });
    expect(await disabledApps(s)).toEqual(OWNED_DISABLED);
    expect(await scimAdmits(s, userBearer)).toBe(false);
    expect(await scimAdmits(s, adminBearer), "the administrator's own credential is untouched").toBe(true);
    expect(await keptRows(s)).toEqual(kept);
    const ledger = ((await s.engine.find('sys_audit_log', { where: { record_id: s.userId }, context: { isSystem: true } } as never)) as Array<{ metadata: string }>)
      .map((row) => JSON.parse(row.metadata) as Record<string, unknown>)
      .filter((metadata) => metadata.revokeSessionsAndKeys === true);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ revokedOwnedApps: 2, revokedScimCredentials: 1, revocationComplete: true });
    expect(s.mail.filter((m) => m.template === RESET_NOTICE), 'the administrator is answered; the account is not mailed').toEqual([]);
  }, 60_000);

  it("the operator's reset: the same, counted on its outcome", async () => {
    const s = await stage();
    const { userBearer, adminBearer } = await registered(s);
    const kept = await keptRows(s);

    const outcome = await setOperatorPassword(s.engine as never, { email: EMAIL, password: SECOND });

    expect(outcome).toMatchObject({ outcome: 'set', ownedAppsDisabled: 2, scimCredentialsRevoked: 1, revocationComplete: true });
    expect(await disabledApps(s)).toEqual(OWNED_DISABLED);
    expect(await scimAdmits(s, userBearer)).toBe(false);
    expect(await scimAdmits(s, adminBearer)).toBe(true);
    expect(await keptRows(s)).toEqual(kept);
  }, 60_000);

  it('an app that cannot be disabled is not swallowed: the self-service reset revokes the credential and answers an error; the forced one reports itself incomplete', async () => {
    const s = await stage();
    const { userBearer, adminBearer } = await registered(s);
    const original = s.engine.update.bind(s.engine);
    const refusing = vi.spyOn(s.engine, 'update').mockImplementation((async (object: string, ...rest: unknown[]) => {
      if (object === 'sys_oauth_application') throw new Error('sys_oauth_application cannot be written');
      return (original as (...a: unknown[]) => Promise<unknown>)(object, ...rest);
    }) as never);

    const res = await s.reset(SECOND);
    expect(res.status, 'the requester is told').toBeGreaterThanOrEqual(500);
    expect(await scimAdmits(s, userBearer), 'the credential is revoked all the same').toBe(false);
    expect(await scimAdmits(s, adminBearer)).toBe(true);

    const forced = await s.fire(
      '/admin/set-user-password',
      { userId: s.userId, newPassword: FIRST, mustChangePassword: false },
      s.bearer(s.adminBearer),
    );
    expect(forced.status, await forced.clone().text()).toBe(200);
    const body = (await forced.json()) as { data?: { revoked?: Record<string, unknown> } };
    expect(body.data?.revoked).toMatchObject({ ownedApps: 0, scimCredentials: 0, failed: 1, complete: false });
    refusing.mockRestore();
    expect(await disabledApps(s), 'the apps that could not be disabled are still enabled, and both requesters know').toEqual(NONE_DISABLED);
  }, 60_000);

  it('a deployment that holds neither store holds none to end', async () => {
    const engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
    await engine.init();
    try {
      await expect(endWhatTheAccountRegistered(engine as never, 'usr_any')).resolves.toEqual({ ownedApps: [], scimCredentials: [] });
    } finally {
      await engine.destroy?.();
    }
  });
});
