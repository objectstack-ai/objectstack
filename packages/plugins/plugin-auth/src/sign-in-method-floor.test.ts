// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The auth settings save keeps a way to sign in (`sign-in-method-floor.ts`).
 *
 * Through the REAL settings service (`@objectstack/service-settings`, aliased
 * to its source) and the real `AuthPlugin` / `AuthManager`: the plugin
 * registers the write predicates when it binds the `auth` namespace, and a
 * save goes through `setMany`, or through the real `PUT /api/settings/:ns`
 * route for the envelope. The data engine is a stub that answers
 * `sys_sso_provider` reads from the case's rows and `[]` for everything else.
 *
 * Pinned:
 *   1. email and password off with nothing else in force is refused before
 *      anything is written: the stored value and the runtime stay on, and the
 *      batch it rode in writes nothing;
 *   2. the HTTP door answers 400 `SETTINGS_VALIDATION` with the field error, in
 *      the caller's language;
 *   3. each way in that counts lets it turn off; the SSO switch alone, or an
 *      unreadable provider table, does not;
 *   4. with email and password off, the Google change that removes the last
 *      provider is refused, and the same change is accepted where something
 *      else keeps a way in;
 *   5. recovery: a stored `false` from before this check is overridden by
 *      `OS_AUTH_EMAIL_PASSWORD_ENABLED=true` (control: without it, it rules).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/objectql';
import {
  InMemoryCryptoProvider,
  SettingsService,
  SettingsValidationError,
  builtinSettingsManifests,
  registerSettingsRoutes,
} from '@objectstack/service-settings';
import { AuthPlugin } from './auth-plugin.js';
import type { AuthManager } from './auth-manager.js';
import { SSO_PROVIDER_OBJECT } from './sso-client-secret.js';
import { SIGN_IN_FLOOR_COPY } from './sign-in-method-floor.js';

const SECRET = 'test-secret-at-least-32-chars-long';

const ENV_KEYS = [
  'OS_AUTH_EMAIL_PASSWORD_ENABLED',
  'OS_AUTH_GOOGLE_ENABLED',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'OS_SSO_ENABLED',
  'OS_AUTH_SSO_ONLY',
  'OS_SCIM_ENABLED',
] as const;

const GOOGLE = {
  google_enabled: true,
  google_client_id: 'google-settings-client-id',
  google_client_secret: 'google-settings-client-secret',
};

/** The error `setMany` refused with, or a failure naming what happened instead. */
async function refusalOf(write: Promise<unknown>): Promise<SettingsValidationError> {
  const outcome = await write.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(outcome, 'the save went through').toBeInstanceOf(SettingsValidationError);
  return outcome as SettingsValidationError;
}

describe('the auth settings save keeps a way to sign in', () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  let ssoRows: () => Promise<unknown[]>;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    ssoRows = async () => [];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  const makeEngine = () => ({
    insert: vi.fn(async (_object: string, row: any) => row),
    find: vi.fn(async (object: string) => (object === SSO_PROVIDER_OBJECT ? ssoRows() : [])),
    findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => {
      assertEngineFindOnePredicate(object, query);
      return null;
    }),
  });

  const makeSettings = (env: Record<string, string | undefined> = {}) => {
    // A crypto provider, so the Google client secret can be stored.
    const settings = new SettingsService({ env, cryptoProvider: new InMemoryCryptoProvider() });
    for (const manifest of builtinSettingsManifests) {
      if (manifest.namespace === 'auth') settings.registerManifest(manifest);
    }
    return settings;
  };

  /** Boot as a host does: init → start → kernel:ready (the auth namespace binds there). */
  const boot = async (opts: { settings?: SettingsService; pluginOptions?: Record<string, unknown> } = {}) => {
    const settings = opts.settings ?? makeSettings();
    const engine = makeEngine();
    const hooks = new Map<string, Array<() => Promise<void>>>();
    const ctx = {
      registerService: vi.fn(),
      getService: vi.fn((name: string) => {
        if (name === 'manifest') return { register: vi.fn() };
        if (name === 'settings') return settings;
        if (name === 'data' || name === 'objectql') return engine;
        return undefined;
      }),
      getServices: vi.fn(() => new Map()),
      hook: vi.fn((name: string, handler: () => Promise<void>) => {
        if (!hooks.has(name)) hooks.set(name, []);
        hooks.get(name)!.push(handler);
      }),
      trigger: vi.fn(),
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      getKernel: vi.fn(),
    } as unknown as PluginContext;
    const plugin = new AuthPlugin({ secret: SECRET, baseUrl: 'http://localhost:3000', ...(opts.pluginOptions ?? {}) });
    await plugin.init(ctx);
    const manager = (ctx.registerService as any).mock.calls.find(([name]: [string]) => name === 'auth')?.[1] as AuthManager;
    await plugin.start(ctx);
    for (const handler of hooks.get('kernel:ready') ?? []) await handler();
    return { settings, manager };
  };

  const passwordOn = (manager: AuthManager) => manager.getPublicConfig().emailPassword.enabled;
  const googleOn = (manager: AuthManager) =>
    manager.getPublicConfig().socialProviders.some((p: { id: string }) => p.id === 'google');

  /** Save Google through the console and wait for the pass to apply it. */
  const saveGoogle = async (settings: SettingsService, manager: AuthManager) => {
    await settings.setMany('auth', GOOGLE);
    await vi.waitFor(() => expect(googleOn(manager)).toBe(true));
  };

  // ── 1 + 2. The refusal ─────────────────────────────────────────────────────

  it('refuses email and password off when nothing else signs anyone in; nothing in the batch is written', async () => {
    const { settings, manager } = await boot();

    const refusal = await refusalOf(
      settings.setMany('auth', { email_password_enabled: false, password_min_length: 12 }),
    );
    expect(refusal.code).toBe('SETTINGS_VALIDATION');
    expect(refusal.fields).toEqual([
      expect.objectContaining({
        field: 'email_password_enabled',
        code: 'invalid_value',
        constraint: { lastSignInMethod: 'email_password' },
      }),
    ]);

    expect(await settings.get('auth', 'email_password_enabled')).toMatchObject({ value: true, source: 'default' });
    expect(await settings.get('auth', 'password_min_length')).toMatchObject({ source: 'default' });
    expect(passwordOn(manager)).toBe(true);
    // Turning it back on, or saving the value in force, is never refused.
    await expect(settings.setMany('auth', { email_password_enabled: true })).resolves.toBeDefined();
  });

  it('the settings PUT door answers 400 SETTINGS_VALIDATION at the key, in the caller language', async () => {
    const { settings, manager } = await boot();
    const routes = new Map<string, RouteHandler>();
    const add = (method: string) => (path: string, handler: RouteHandler) => {
      routes.set(`${method} ${path}`, handler);
      return http;
    };
    const http = {
      get: add('GET'),
      post: add('POST'),
      put: add('PUT'),
      delete: add('DELETE'),
      patch: add('PATCH'),
      use: () => http,
      listen: async () => {},
      close: async () => {},
      getInstance: () => null,
    } as unknown as IHttpServer;
    registerSettingsRoutes(http, settings, {
      contextFromRequest: () => ({ enforced: true, permissions: ['manage_platform_settings'], userId: 'usr_admin' }),
    });

    const state: { status: number; body?: any } = { status: 200 };
    const res = {
      json: vi.fn((data: unknown) => {
        state.body = data;
      }),
      send: vi.fn(),
      status: vi.fn((code: number) => {
        state.status = code;
        return res;
      }),
      header: vi.fn(() => res),
    } as unknown as IHttpResponse;
    const req = {
      params: { namespace: 'auth' },
      query: {},
      body: { email_password_enabled: false },
      headers: { 'accept-language': 'zh-CN,zh;q=0.9' },
      method: 'PUT',
      path: '/api/settings/auth',
    } as unknown as IHttpRequest;
    await routes.get('PUT /api/settings/:namespace')!(req, res);

    expect(state.status).toBe(400);
    expect(state.body.error.code).toBe('SETTINGS_VALIDATION');
    const [field] = state.body.error.details.fields;
    expect(field).toMatchObject({ field: 'email_password_enabled', code: 'invalid_value' });
    expect(field.message).toBe(SIGN_IN_FLOOR_COPY['zh-CN'].emailPassword);
    expect(passwordOn(manager)).toBe(true);
  });

  // ── 3. What counts ─────────────────────────────────────────────────────────

  const COUNTED: Array<{ name: string; pluginOptions: Record<string, unknown>; rows?: unknown[] }> = [
    { name: 'a social provider in the stack config', pluginOptions: { socialProviders: { github: { clientId: 'gh-id', clientSecret: 'gh-secret' } } } },
    { name: 'phone-number sign-in', pluginOptions: { plugins: { phoneNumber: true } } },
    { name: 'a host sign-in handoff', pluginOptions: { hostSignInHandoff: true } },
    { name: 'enterprise SSO with an identity provider registered', pluginOptions: { plugins: { sso: true } }, rows: [{ id: 'sso_1' }] },
  ];

  it.each(COUNTED)('$name lets email and password turn off', async ({ pluginOptions, rows = [] }) => {
    ssoRows = async () => rows;
    const { settings, manager } = await boot({ pluginOptions });

    await settings.setMany('auth', { email_password_enabled: false });
    await vi.waitFor(() => expect(passwordOn(manager)).toBe(false));
  });

  it('Google saved on the same page first lets email and password turn off', async () => {
    const { settings, manager } = await boot();
    await saveGoogle(settings, manager);

    await settings.setMany('auth', { email_password_enabled: false });
    await vi.waitFor(() => expect(passwordOn(manager)).toBe(false));
  });

  it('the SSO switch with no identity provider registered, or an unreadable provider table, does not count', async () => {
    const { settings, manager } = await boot({ pluginOptions: { plugins: { sso: true } } });
    await refusalOf(settings.setMany('auth', { email_password_enabled: false }));

    ssoRows = async () => {
      throw new Error('store unavailable');
    };
    await refusalOf(settings.setMany('auth', { email_password_enabled: false }));
    expect(passwordOn(manager)).toBe(true);
  });

  // ── 4. The last provider, while email and password is off ─────────────────

  it('refuses removing Google when it is the last way in: switched off, or a credential cleared', async () => {
    const { settings, manager } = await boot();
    await saveGoogle(settings, manager);
    await settings.setMany('auth', { email_password_enabled: false });
    await vi.waitFor(() => expect(passwordOn(manager)).toBe(false));

    for (const patch of [{ google_enabled: false }, { google_client_secret: null }, { google_client_id: '' }]) {
      const refusal = await refusalOf(settings.setMany('auth', patch));
      expect(refusal.fields).toEqual([
        expect.objectContaining({ code: 'invalid_value', constraint: { lastSignInMethod: 'google' } }),
      ]);
    }
    expect(googleOn(manager)).toBe(true);

    // With email and password back on, Google may go.
    await settings.setMany('auth', { email_password_enabled: true });
    await vi.waitFor(() => expect(passwordOn(manager)).toBe(true));
    await settings.setMany('auth', { google_enabled: false });
    await vi.waitFor(() => expect(googleOn(manager)).toBe(false));
  });

  it('accepts the same Google change where something else keeps a way in, or the env still supplies it', async () => {
    const withGithub = await boot({
      pluginOptions: { socialProviders: { github: { clientId: 'gh-id', clientSecret: 'gh-secret' } } },
    });
    await saveGoogle(withGithub.settings, withGithub.manager);
    await withGithub.settings.setMany('auth', { email_password_enabled: false });
    await vi.waitFor(() => expect(passwordOn(withGithub.manager)).toBe(false));
    await withGithub.settings.setMany('auth', { google_enabled: false });
    await vi.waitFor(() => expect(googleOn(withGithub.manager)).toBe(false));

    // A cleared secret the env variable still supplies removes nothing.
    const alone = await boot();
    await saveGoogle(alone.settings, alone.manager);
    await alone.settings.setMany('auth', { email_password_enabled: false });
    await vi.waitFor(() => expect(passwordOn(alone.manager)).toBe(false));
    process.env.GOOGLE_CLIENT_SECRET = 'google-env-client-secret';
    await alone.settings.setMany('auth', { google_client_secret: null });
    expect(googleOn(alone.manager)).toBe(true);
  });

  // ── 5. Recovery for a deployment that already stored the dead end ─────────

  it('OS_AUTH_EMAIL_PASSWORD_ENABLED=true overrides a stored false (control: without it, the stored false rules)', async () => {
    // The pre-fix save: written before any predicate is registered.
    const lockedOut = makeSettings();
    await lockedOut.setMany('auth', { email_password_enabled: false });
    expect(passwordOn((await boot({ settings: lockedOut })).manager)).toBe(false);

    const env: Record<string, string | undefined> = {};
    const recovered = makeSettings(env);
    await recovered.setMany('auth', { email_password_enabled: false });
    env.OS_AUTH_EMAIL_PASSWORD_ENABLED = 'true';
    expect(passwordOn((await boot({ settings: recovered })).manager)).toBe(true);
  });
});
