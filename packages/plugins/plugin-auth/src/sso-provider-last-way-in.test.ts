// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30300] The two ways a deployment lost its last way to sign in without
 * anyone being told, judged by the sign-in method floor of #30202
 * (`sign-in-method-floor.ts`).
 *
 * Door 1, deleting the last identity provider. With email and password off,
 * Setup's "Delete SSO Provider" (`POST /sso/delete-provider`) removed the only
 * `sys_sso_provider` row and answered 200; from then on nobody could sign in.
 * The global before-hook now refuses that delete: 409 `DELETE_RESTRICTED`,
 * in the caller's language, with nothing deleted. Pinned with CONTROLS: the
 * same delete goes through while another provider remains or while email and
 * password is on, an unknown provider is still the vendor's 404, and a caller
 * with no session is still the vendor's 401.
 *
 * Door 2, a boot that serves no way in. A redeploy that drops the last provider
 * (here: the `GOOGLE_CLIENT_*` pair) while email and password is off booted
 * silently. It now says `no_sign_in_method_at_boot` at `error` and still
 * boots (ruling A: never refused). CONTROLS: the deploy that still declares
 * the provider, and the documented recovery `OS_AUTH_EMAIL_PASSWORD_ENABLED=true`,
 * say nothing.
 *
 * Real composition: `ObjectKernel` with `ObjectQLPlugin` over in-memory SQLite,
 * the real `SettingsServicePlugin` and the real `AuthPlugin` with the SSO
 * plugin, a real sign-up and session cookie. The provider rows are written
 * straight into `sys_sso_provider` (registering one needs an IdP; the delete
 * reads only the row). The judge's answers that need a fault (a provider list
 * that cannot be read) are pinned against the floor function itself, below.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { InMemoryCryptoProvider, SettingsServicePlugin, type SettingsService } from '@objectstack/service-settings';
import { AuthPlugin } from './auth-plugin.js';
import type { AuthManager } from './auth-manager.js';
import { SSO_PROVIDER_OBJECT } from './sso-client-secret.js';
import {
  NO_SIGN_IN_METHOD_AT_BOOT,
  SIGN_IN_FLOOR_COPY,
  reportIfNoSignInMethodAtBoot,
  resolveNoSignInMethodReport,
  ssoProviderDeleteRefusal,
  type SignInMethodConfigView,
  type SignInMethodFloorDeps,
} from './sign-in-method-floor.js';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-30300';
const PASSWORD = 'S3cure!Passw0rd-30300';
const SYS = { isSystem: true } as const;

const ENV_KEYS = [
  'OS_AUTH_EMAIL_PASSWORD_ENABLED',
  'OS_AUTH_GOOGLE_ENABLED',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'OS_SSO_ENABLED',
  'OS_AUTH_SSO_ONLY',
  'OS_TENANCY_POSTURE',
  'OS_MULTI_ORG_ENABLED',
  'OS_PLATFORM_OWNER_EMAIL',
] as const;

function sqliteDriverPlugin(): Plugin {
  return {
    name: 'test.driver.sqlite',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService(
        'driver.default',
        new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
      );
    },
  };
}

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

describe('the last way to sign in is kept, and a boot without one is said (#30300)', () => {
  let kernel: ObjectKernel | undefined;
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    try {
      await kernel?.shutdown();
    } catch {
      /* a stopped kernel */
    }
    kernel = undefined;
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.restoreAllMocks();
  });

  /**
   * Boot the composition. The kernel logger's `error` is spied on the
   * instance every plugin's `ctx.logger` is (the seeded-boot pin's way).
   */
  async function boot(authOptions: Record<string, unknown> = {}) {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    const kernelLogger = (kernel as unknown as { logger: { error: (message: string, meta?: unknown) => void } }).logger;
    const error = vi.spyOn(kernelLogger, 'error');
    await kernel.use(sqliteDriverPlugin());
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AuthPlugin({ secret: SECRET, baseUrl: BASE, ...authOptions }));
    await kernel.use(new SettingsServicePlugin({ registerRoutes: false, cryptoProvider: new InMemoryCryptoProvider() }));
    await kernel.bootstrap();
    const ql = kernel.getService<ObjectQL>('objectql');
    const manager = kernel.getService<AuthManager>('auth');
    const settings = kernel.getService<SettingsService>('settings');
    const reports = () =>
      error.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(NO_SIGN_IN_METHOD_AT_BOOT));
    return { ql, manager, settings, reports };
  }

  // ── Door 1 ─────────────────────────────────────────────────────────────────

  /** A signed-in administrator who owns `providers`, on a deployment with enterprise SSO switched on. */
  async function adminWithProviders(providers: string[]) {
    const env = await boot({ plugins: { sso: true } });
    const { ql, manager } = env;
    const signedUp = await manager.handleRequest(
      new Request(`${AUTH}/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ email: 'admin@acme.test', password: PASSWORD, name: 'Admin' }),
      }),
    );
    expect(signedUp.status, await signedUp.clone().text()).toBe(200);
    const cookie = cookieFrom(signedUp);
    const [user] = (await ql.find('sys_user', { where: { email: 'admin@acme.test' }, limit: 1, context: SYS })) as any[];
    for (const providerId of providers) {
      await ql.insert(
        SSO_PROVIDER_OBJECT,
        {
          id: `ssop_${providerId}`,
          provider_id: providerId,
          issuer: `https://${providerId}.idp.test`,
          domain: 'acme.test',
          oidc_config: JSON.stringify({ clientId: `${providerId}-client`, discoveryEndpoint: `https://${providerId}.idp.test/.well-known/openid-configuration` }),
          user_id: String(user.id),
        },
        { context: SYS },
      );
    }
    const providerIds = async () =>
      ((await ql.find(SSO_PROVIDER_OBJECT, { limit: 10, context: SYS })) as any[]).map((r) => r.provider_id).sort();
    const remove = (providerId: string, opts: { cookie?: string; language?: string } = {}) =>
      manager.handleRequest(
        new Request(`${AUTH}/sso/delete-provider`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: BASE,
            ...(opts.cookie === '' ? {} : { cookie: opts.cookie ?? cookie }),
            ...(opts.language ? { 'accept-language': opts.language } : {}),
          },
          body: JSON.stringify({ providerId }),
        }),
      );
    /** Email and password off through the console, as the operator did; the floor admits it while a provider row exists. */
    const passwordOff = async () => {
      await env.settings.setMany('auth', { email_password_enabled: false });
      await vi.waitFor(() => expect(manager.getPublicConfig().emailPassword.enabled).toBe(false));
    };
    return { ...env, cookie, providerIds, remove, passwordOff };
  }

  it('refuses deleting the last identity provider while email and password is off: 409, localized, nothing deleted', async () => {
    const { remove, providerIds, passwordOff } = await adminWithProviders(['okta']);
    await passwordOff();

    const res = await remove('okta', { language: 'zh-CN,zh;q=0.9' });
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body).toMatchObject({
      code: 'DELETE_RESTRICTED',
      message: SIGN_IN_FLOOR_COPY['zh-CN'].enterpriseSso,
      lastSignInMethod: 'enterprise_sso',
    });
    expect(await providerIds()).toEqual(['okta']);

    // Same refusal in the default language.
    const en = await remove('okta');
    expect(en.status).toBe(409);
    expect((await en.json()).message).toBe(SIGN_IN_FLOOR_COPY.en.enterpriseSso);
    expect(await providerIds()).toEqual(['okta']);
  }, 30_000);

  it('control: while another provider remains the delete goes through; the one left is then the last and is refused', async () => {
    const { remove, providerIds, passwordOff } = await adminWithProviders(['okta', 'entra']);
    await passwordOff();

    const first = await remove('okta');
    expect(first.status, await first.clone().text()).toBe(200);
    expect(await providerIds()).toEqual(['entra']);

    const last = await remove('entra');
    expect(last.status, await last.clone().text()).toBe(409);
    expect(await providerIds()).toEqual(['entra']);
  }, 30_000);

  it('control: while email and password is on, deleting the last provider goes through', async () => {
    const { remove, providerIds } = await adminWithProviders(['okta']);

    const res = await remove('okta');
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await providerIds()).toEqual([]);
  }, 30_000);

  it('control: an unknown provider is still the vendor 404, and no session is still the vendor 401', async () => {
    const { remove, providerIds, passwordOff } = await adminWithProviders(['okta']);
    await passwordOff();

    expect((await remove('nobody')).status).toBe(404);
    expect((await remove('okta', { cookie: '' })).status).toBe(401);
    expect(await providerIds()).toEqual(['okta']);
  }, 30_000);

  // ── Door 2 ─────────────────────────────────────────────────────────────────

  it('a redeploy that drops the last provider while email and password is off is said at error, and still boots', async () => {
    const { manager, reports } = await boot({ emailAndPassword: { enabled: false } });

    // The boot completed (bootstrap resolved, the manager serves) and serves no way in.
    expect(manager.getPublicConfig().emailPassword.enabled).toBe(false);
    expect(manager.getPublicConfig().socialProviders).toEqual([]);
    expect(reports()).toHaveLength(1);
    expect(reports()[0]).toContain('nobody can sign in');
    expect(reports()[0]).toContain('OS_AUTH_EMAIL_PASSWORD_ENABLED=true');
  }, 30_000);

  it('the same with enterprise SSO switched on but no identity provider row', async () => {
    const { reports } = await boot({ emailAndPassword: { enabled: false }, plugins: { sso: true } });
    expect(reports()).toHaveLength(1);
  }, 30_000);

  it('control: the deploy that still declares the provider says nothing', async () => {
    process.env.GOOGLE_CLIENT_ID = 'google-env-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'google-env-client-secret';
    const { manager, reports } = await boot({ emailAndPassword: { enabled: false } });

    expect(manager.getPublicConfig().socialProviders.map((p: { id: string }) => p.id)).toContain('google');
    expect(reports()).toEqual([]);
  }, 30_000);

  it('recovery: OS_AUTH_EMAIL_PASSWORD_ENABLED=true turns email and password back on over the stack config, and nothing is said', async () => {
    process.env.OS_AUTH_EMAIL_PASSWORD_ENABLED = 'true';
    const { manager, reports } = await boot({ emailAndPassword: { enabled: false } });

    expect(manager.getPublicConfig().emailPassword.enabled).toBe(true);
    expect(reports()).toEqual([]);
  }, 30_000);
});

// ── The judge and the report, against a fault the composition cannot make ───

describe('the floor judges a provider delete and a boot by what it can read (#30300)', () => {
  const OFF: SignInMethodConfigView = { emailPassword: { enabled: false }, socialProviders: [], features: { sso: true } };

  const deps = (
    over: { config?: SignInMethodConfigView; rows?: unknown[] | 'throws'; hostSignInHandoff?: boolean } = {},
  ): SignInMethodFloorDeps => ({
    publicConfig: () => over.config ?? OFF,
    engine: () => ({
      find: async () => {
        if (over.rows === 'throws') throw new Error('provider table unreadable');
        return (over.rows ?? []) as any[];
      },
    }) as any,
    hostSignInHandoff: over.hostSignInHandoff ?? false,
    stackConfiguredGoogle: () => false,
    providerHasCredentials: () => true,
    env: () => ({}),
  });

  it('the last provider: 409 DELETE_RESTRICTED; an unreadable provider list: 503 SERVICE_UNAVAILABLE, never a pass', async () => {
    await expect(ssoProviderDeleteRefusal(deps({ rows: [{ provider_id: 'okta' }] }), 'okta', 'ja-JP')).resolves.toEqual({
      status: 'CONFLICT',
      code: 'DELETE_RESTRICTED',
      message: SIGN_IN_FLOOR_COPY['ja-JP'].enterpriseSso,
      lastSignInMethod: 'enterprise_sso',
    });
    await expect(ssoProviderDeleteRefusal(deps({ rows: 'throws' }), 'okta', 'es-ES')).resolves.toEqual({
      status: 'SERVICE_UNAVAILABLE',
      code: 'SERVICE_UNAVAILABLE',
      message: SIGN_IN_FLOOR_COPY['es-ES'].enterpriseSsoUnverified,
    });
  });

  it.each([
    { name: 'email and password on', d: () => deps({ config: { ...OFF, emailPassword: { enabled: true } }, rows: [{ provider_id: 'okta' }] }) },
    { name: 'enterprise SSO not switched on', d: () => deps({ config: { ...OFF, features: { sso: false } }, rows: [{ provider_id: 'okta' }] }) },
    { name: 'another provider row', d: () => deps({ rows: [{ provider_id: 'okta' }, { provider_id: 'entra' }] }) },
    { name: 'no row at all (the vendor answers 404)', d: () => deps({ rows: [] }) },
    { name: 'a social provider with credentials', d: () => deps({ config: { ...OFF, socialProviders: [{ id: 'github', type: 'social' }] }, rows: [{ provider_id: 'okta' }] }) },
    { name: 'phone-number sign-in', d: () => deps({ config: { ...OFF, features: { sso: true, phoneNumber: true } }, rows: [{ provider_id: 'okta' }] }) },
    { name: 'a host sign-in handoff', d: () => deps({ hostSignInHandoff: true, rows: [{ provider_id: 'okta' }] }) },
  ])('passes the delete with $name', async ({ d }) => {
    await expect(ssoProviderDeleteRefusal(d(), 'okta')).resolves.toBeUndefined();
  });

  it('the boot report is a positive claim: an unreadable provider table says nothing, an empty one says it', async () => {
    expect(await resolveNoSignInMethodReport(deps({ rows: 'throws' }))).toBeNull();
    expect(await resolveNoSignInMethodReport(deps({ rows: [{ provider_id: 'okta' }] }))).toBeNull();
    expect(await resolveNoSignInMethodReport(deps({ rows: [] }))).toContain(NO_SIGN_IN_METHOD_AT_BOOT);
    // Enterprise SSO not switched on: its table is not read, and nothing else is in force.
    expect(await resolveNoSignInMethodReport(deps({ config: { ...OFF, features: { sso: false } }, rows: 'throws' }))).toContain(
      NO_SIGN_IN_METHOD_AT_BOOT,
    );
    expect(await resolveNoSignInMethodReport(deps({ hostSignInHandoff: true }))).toBeNull();
  });

  it('says it once at error (warn on a sink without error), and never throws', async () => {
    const error = vi.fn();
    const warn = vi.fn();
    const said = await reportIfNoSignInMethodAtBoot(deps(), { error, warn } as any);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(said);
    expect(warn).not.toHaveBeenCalled();

    const warnOnly = vi.fn();
    await reportIfNoSignInMethodAtBoot(deps(), { warn: warnOnly } as any);
    expect(warnOnly).toHaveBeenCalledTimes(1);

    const throwing = { error: () => { throw new Error('sink down'); }, warn: vi.fn() };
    await expect(reportIfNoSignInMethodAtBoot(deps(), throwing as any)).resolves.toContain(NO_SIGN_IN_METHOD_AT_BOOT);
  });
});
