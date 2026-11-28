// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Authentication says what runs when the email and password switch
 * says otherwise (`auth-settings-live-status.ts`).
 *
 * Through the REAL settings service (`@objectstack/service-settings`, aliased
 * to its source) and its real `GET /api/settings/:namespace` route, the one
 * the settings page reads, over the real `AuthPlugin` / `AuthManager`.
 *
 * Pinned:
 *   1. a deployment that declares email and password off, with nothing stored:
 *      the switch still resolves to the manifest default (`true`, `source:
 *      'default'`) while the runtime runs it off, and the page is headed by a
 *      live-status banner saying it is off on this deployment, in the caller's
 *      language (measured before the change: no banner);
 *   2. CONTROL: email and password declared on (the default), nothing stored:
 *      no banner;
 *   3. a stored value still wins where it is applied: saved on over a declared
 *      off, or saved off over a declared on, and the page states nothing;
 *   4. on a cloud-managed runtime that holds it off: the banner says so, `info`
 *      with nothing stored, `warning` over a stored on that is not applied.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Paid during collection, not inside a clocked case: the auth manager loads it lazily.
import '@objectstack/core/egress';
import { resetCloudManagedForTesting, type PluginContext } from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import {
  SETTINGS_LIVE_STATUS_BANNER_ID,
  SettingsService,
  builtinSettingsManifests,
  registerSettingsRoutes,
} from '@objectstack/service-settings';
import { AuthPlugin } from './auth-plugin.js';
import type { AuthManager } from './auth-manager.js';
import { AUTH_LIVE_STATUS_COPY, describeEmailPasswordLiveStatus } from './auth-settings-live-status.js';

const SECRET = 'test-secret-at-least-32-chars-long';
const ADMIN = { enforced: true, permissions: ['manage_platform_settings'], userId: 'usr_admin' };
const ENV_KEYS = ['OS_CLOUD_MANAGED', 'OS_AUTH_EMAIL_PASSWORD_ENABLED', 'OS_AUTH_SSO_ONLY'] as const;

describe('Setup → Authentication states email and password sign-in as it runs', () => {
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  const setManaged = (on: boolean) => {
    if (on) process.env.OS_CLOUD_MANAGED = '1';
    else delete process.env.OS_CLOUD_MANAGED;
    // `isCloudManaged()` memoizes its first read.
    resetCloudManagedForTesting();
  };

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    setManaged(false);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    resetCloudManagedForTesting();
    vi.restoreAllMocks();
  });

  /** Boot as a host does (init → start → kernel:ready), with email and password declared as given. */
  const boot = async (opts: { emailPassword?: boolean; hostSignInHandoff?: boolean } = {}) => {
    const settings = new SettingsService({ env: {} });
    settings.registerManifest(builtinSettingsManifests.find((m) => m.namespace === 'auth')!);
    const hooks = new Map<string, Array<() => Promise<void>>>();
    const ctx = {
      registerService: vi.fn(),
      getService: vi.fn((name: string) => {
        if (name === 'manifest') return { register: vi.fn() };
        if (name === 'settings') return settings;
        return undefined;
      }),
      getServices: vi.fn(() => new Map()),
      hook: vi.fn((name: string, handler: () => Promise<void>) => {
        hooks.set(name, [...(hooks.get(name) ?? []), handler]);
      }),
      trigger: vi.fn(),
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      getKernel: vi.fn(),
    } as unknown as PluginContext;
    const plugin = new AuthPlugin({
      secret: SECRET,
      baseUrl: 'http://localhost:3000',
      ...(opts.emailPassword === undefined ? {} : { emailAndPassword: { enabled: opts.emailPassword } }),
      ...(opts.hostSignInHandoff ? { hostSignInHandoff: true } : {}),
    });
    await plugin.init(ctx);
    const manager = (ctx.registerService as any).mock.calls.find(([name]: [string]) => name === 'auth')?.[1] as AuthManager;
    await plugin.start(ctx);
    for (const handler of hooks.get('kernel:ready') ?? []) await handler();
    return { settings, manager };
  };

  /** `GET /api/settings/auth` through the real settings route: the page's own read. */
  const readPage = async (settings: SettingsService, headers: Record<string, string> = {}) => {
    const routes = new Map<string, RouteHandler>();
    const add = (method: string) => (path: string, handler: RouteHandler) => {
      routes.set(`${method} ${path}`, handler);
      return http;
    };
    const http = {
      get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'), patch: add('PATCH'),
      use: () => http, listen: async () => {}, close: async () => {}, getInstance: () => null,
    } as unknown as IHttpServer;
    registerSettingsRoutes(http, settings, { contextFromRequest: () => ({ ...ADMIN }) });
    const state: { status: number; body?: any } = { status: 200 };
    const res = {
      json: vi.fn((data: unknown) => { state.body = data; }),
      send: vi.fn(),
      status: vi.fn((code: number) => { state.status = code; return res; }),
      header: vi.fn(() => res),
    } as unknown as IHttpResponse;
    const req = {
      params: { namespace: 'auth' }, query: {}, headers, method: 'GET', path: '/api/settings/auth',
    } as unknown as IHttpRequest;
    await routes.get('GET /api/settings/:namespace')!(req, res);
    expect(state.status).toBe(200);
    const page = state.body?.data ?? state.body;
    const banner = (page.manifest.specifiers as Array<Record<string, unknown>>)
      .find((spec) => spec.id === SETTINGS_LIVE_STATUS_BANNER_ID);
    return { page, banner };
  };

  const passwordOn = (manager: AuthManager) => manager.getPublicConfig().emailPassword.enabled;
  /** Let the settings pass a write's change event started run to its end. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  it('declared off with nothing stored: the switch reads the default, and the page says it is off', async () => {
    const { settings, manager } = await boot({ emailPassword: false });
    expect(passwordOn(manager)).toBe(false);
    // The stored-value read is unchanged: nothing is stored, so the manifest default.
    expect(await settings.get('auth', 'email_password_enabled')).toMatchObject({ value: true, source: 'default' });

    const { page, banner } = await readPage(settings);
    expect(page.values.email_password_enabled).toMatchObject({ value: true, source: 'default' });
    expect(banner).toMatchObject({
      type: 'info_banner',
      label: AUTH_LIVE_STATUS_COPY.en.declaredOffLabel,
      bannerText: AUTH_LIVE_STATUS_COPY.en.declaredOffText,
      bannerSeverity: 'info',
    });
    // It heads the page.
    expect(page.manifest.specifiers[0].id).toBe(SETTINGS_LIVE_STATUS_BANNER_ID);

    // In the caller's language.
    const zh = await readPage(settings, { 'accept-language': 'zh-CN' });
    expect(zh.banner).toMatchObject({ label: AUTH_LIVE_STATUS_COPY['zh-CN'].declaredOffLabel });
  });

  it('CONTROL: declared on with nothing stored, the page states nothing', async () => {
    const { settings, manager } = await boot();
    expect(passwordOn(manager)).toBe(true);
    const { page, banner } = await readPage(settings);
    expect(page.values.email_password_enabled).toMatchObject({ value: true, source: 'default' });
    expect(banner).toBeUndefined();
  });

  it('a stored value still wins where it is applied, and the page states nothing', async () => {
    const off = await boot({ emailPassword: false });
    await off.settings.setMany('auth', { email_password_enabled: true });
    await vi.waitFor(() => expect(passwordOn(off.manager)).toBe(true));
    const savedOn = await readPage(off.settings);
    expect(savedOn.page.values.email_password_enabled).toMatchObject({ value: true, source: 'global' });
    expect(savedOn.banner).toBeUndefined();

    // Saved off over a declared on; the host's sign-in handoff keeps a way in, so the sign-in floor lets it through.
    const on = await boot({ hostSignInHandoff: true });
    expect(passwordOn(on.manager)).toBe(true);
    await on.settings.setMany('auth', { email_password_enabled: false });
    await vi.waitFor(() => expect(passwordOn(on.manager)).toBe(false));
    const savedOff = await readPage(on.settings);
    expect(savedOff.page.values.email_password_enabled).toMatchObject({ value: false, source: 'global' });
    expect(savedOff.banner).toBeUndefined();
  });

  it('a cloud-managed runtime that holds it off says so: info with nothing stored, warning over a stored on', async () => {
    setManaged(true);
    const { settings, manager } = await boot({ emailPassword: false });
    const nothingStored = await readPage(settings);
    expect(nothingStored.banner).toMatchObject({
      label: AUTH_LIVE_STATUS_COPY.en.managedOffLabel,
      bannerText: AUTH_LIVE_STATUS_COPY.en.managedOffText,
      bannerSeverity: 'info',
    });

    // A re-save of the default is stored and not applied (the settings pass's managed hold).
    await settings.setMany('auth', { email_password_enabled: true });
    await settle();
    expect(passwordOn(manager)).toBe(false);
    const storedOn = await readPage(settings);
    expect(storedOn.page.values.email_password_enabled).toMatchObject({ value: true, source: 'global' });
    expect(storedOn.banner).toMatchObject({ label: AUTH_LIVE_STATUS_COPY.en.managedOffLabel, bannerSeverity: 'warning' });
  });
});

describe('describeEmailPasswordLiveStatus', () => {
  it('states nothing while the switch and the running value agree', () => {
    for (const running of [true, false]) {
      expect(describeEmailPasswordLiveStatus({
        running, shown: { value: running, source: 'global' }, heldOffByHost: false,
      })).toBeUndefined();
    }
    expect(describeEmailPasswordLiveStatus({ running: true, shown: undefined, heldOffByHost: false })).toBeUndefined();
  });

  it('any other disagreement is stated as a warning naming what runs', () => {
    expect(describeEmailPasswordLiveStatus({
      running: true, shown: { value: false, source: 'global' }, heldOffByHost: false,
    })).toEqual({
      label: AUTH_LIVE_STATUS_COPY.en.differsLabel(true),
      bannerText: AUTH_LIVE_STATUS_COPY.en.differsText,
      bannerSeverity: 'warning',
    });
    // Off by something other than the declaration (stored on, not applied, self-hosted).
    expect(describeEmailPasswordLiveStatus({
      running: false, shown: { value: true, source: 'global' }, heldOffByHost: false,
    })).toMatchObject({ label: AUTH_LIVE_STATUS_COPY.en.differsLabel(false), bannerSeverity: 'warning' });
  });

  it('every language on the copy table carries every sentence', () => {
    const keys = Object.keys(AUTH_LIVE_STATUS_COPY.en).sort();
    for (const [locale, copy] of Object.entries(AUTH_LIVE_STATUS_COPY)) {
      expect(Object.keys(copy).sort(), locale).toEqual(keys);
      for (const [key, value] of Object.entries(copy)) {
        const text = typeof value === 'function' ? value(false) : value;
        expect(typeof text === 'string' && text.length > 0, `${locale}.${key}`).toBe(true);
      }
    }
  });
});
