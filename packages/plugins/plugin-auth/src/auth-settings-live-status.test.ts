// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Authentication shows what runs (`auth-settings-declared-defaults.ts`,
 * `auth-settings-live-status.ts`).
 *
 * Through the REAL settings service (`@objectstack/service-settings`, aliased
 * to its source) and its real `GET /api/settings/:namespace` route, the one
 * the settings page reads, over the real `AuthPlugin` / `AuthManager`.
 *
 * Pinned:
 *   1. a deployment that declares email and password off, with nothing stored:
 *      the switch resolves to the declaration (`false`, `source: 'default'`),
 *      what runs, and the page states nothing (measured before the change: the
 *      manifest default `true` and an `info` banner saying it is off);
 *   2. CONTROL: email and password declared on (the default), nothing stored:
 *      `true`, no banner;
 *   3. a stored value still wins where it is applied: saved on over a declared
 *      off, or saved off over a declared on, and the page states nothing;
 *   4. on a cloud-managed runtime that holds it off: nothing stored reads off
 *      with no banner; a value stored on, not applied, is the one case the
 *      value cannot say, headed by a `warning`;
 *   5. `signup_enabled` and `require_email_verification` read their
 *      declarations the same way: self-registration declared off or forced off
 *      by SSO-only, verification forced on by the `email_domain` posture.
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
const ENV_KEYS = ['OS_CLOUD_MANAGED', 'OS_AUTH_EMAIL_PASSWORD_ENABLED', 'OS_AUTH_SSO_ONLY', 'OS_DISABLE_SIGNUP'] as const;

describe('Setup → Authentication shows the auth switches as they run', () => {
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
  const boot = async (opts: {
    emailPassword?: boolean;
    emailAndPassword?: Record<string, unknown>;
    audience?: Record<string, unknown>;
    hostSignInHandoff?: boolean;
    settings?: SettingsService;
  } = {}) => {
    const settings = opts.settings ?? new SettingsService({ env: {} });
    if (!opts.settings) settings.registerManifest(builtinSettingsManifests.find((m) => m.namespace === 'auth')!);
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
      ...(opts.emailPassword === undefined && !opts.emailAndPassword ? {} : {
        emailAndPassword: {
          ...(opts.emailPassword === undefined ? {} : { enabled: opts.emailPassword }),
          ...opts.emailAndPassword,
        },
      }),
      ...(opts.audience ? { audience: opts.audience } : {}),
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

  it('declared off with nothing stored: the switch reads the declaration, and the page states nothing', async () => {
    const { settings, manager } = await boot({ emailPassword: false });
    expect(passwordOn(manager)).toBe(false);
    expect(await settings.get('auth', 'email_password_enabled')).toMatchObject({ value: false, source: 'default' });

    const { page, banner } = await readPage(settings);
    expect(page.values.email_password_enabled).toMatchObject({ value: false, source: 'default', locked: false });
    expect(banner).toBeUndefined();
  });

  it('CONTROL: declared on with nothing stored, the switch reads on and the page states nothing', async () => {
    const { settings, manager } = await boot();
    expect(passwordOn(manager)).toBe(true);
    expect(await settings.get('auth', 'email_password_enabled')).toMatchObject({ value: true, source: 'default' });
    const { page, banner } = await readPage(settings);
    expect(page.values.email_password_enabled).toMatchObject({ value: true, source: 'default' });
    expect(banner).toBeUndefined();
  });

  it('a stored value still wins where it is applied, and a clear returns to the declaration', async () => {
    // The host's sign-in handoff keeps a way in, so the sign-in floor lets the clear below through.
    const off = await boot({ emailPassword: false, hostSignInHandoff: true });
    await off.settings.setMany('auth', { email_password_enabled: true });
    await vi.waitFor(() => expect(passwordOn(off.manager)).toBe(true));
    const savedOn = await readPage(off.settings);
    expect(savedOn.page.values.email_password_enabled).toMatchObject({ value: true, source: 'global' });
    expect(savedOn.banner).toBeUndefined();
    await off.settings.setMany('auth', { email_password_enabled: null });
    await vi.waitFor(() => expect(passwordOn(off.manager)).toBe(false));
    expect(await off.settings.get('auth', 'email_password_enabled')).toMatchObject({ value: false, source: 'default' });

    // Saved off over a declared on; the host's sign-in handoff keeps a way in, so the sign-in floor lets it through.
    const on = await boot({ hostSignInHandoff: true });
    expect(passwordOn(on.manager)).toBe(true);
    await on.settings.setMany('auth', { email_password_enabled: false });
    await vi.waitFor(() => expect(passwordOn(on.manager)).toBe(false));
    const savedOff = await readPage(on.settings);
    expect(savedOff.page.values.email_password_enabled).toMatchObject({ value: false, source: 'global' });
    expect(savedOff.banner).toBeUndefined();
  });

  it('a cloud-managed runtime that holds it off: nothing stored reads off; a value stored on is stated as a warning', async () => {
    setManaged(true);
    const { settings, manager } = await boot({ emailPassword: false });
    const nothingStored = await readPage(settings);
    expect(nothingStored.page.values.email_password_enabled).toMatchObject({ value: false, source: 'default' });
    expect(nothingStored.banner).toBeUndefined();

    // A row stored on before boot (the save door now refuses a save of on here) is not applied.
    const seeded = new SettingsService({ env: {} });
    seeded.registerManifest(builtinSettingsManifests.find((m) => m.namespace === 'auth')!);
    await seeded.set('auth', 'email_password_enabled', true, {});
    const held = await boot({ emailPassword: false, settings: seeded });
    await settle();
    expect(passwordOn(held.manager)).toBe(false);
    const storedOn = await readPage(held.settings);
    expect(storedOn.page.values.email_password_enabled).toMatchObject({ value: true, source: 'global' });
    expect(storedOn.banner).toMatchObject({
      type: 'info_banner',
      label: AUTH_LIVE_STATUS_COPY.en.managedOffLabel,
      bannerText: AUTH_LIVE_STATUS_COPY.en.managedOffText,
      bannerSeverity: 'warning',
    });
    expect(storedOn.page.manifest.specifiers[0].id).toBe(SETTINGS_LIVE_STATUS_BANNER_ID);
    const zh = await readPage(held.settings, { 'accept-language': 'zh-CN' });
    expect(zh.banner).toMatchObject({ label: AUTH_LIVE_STATUS_COPY['zh-CN'].managedOffLabel });
    expect(passwordOn(manager)).toBe(false);
  });

  it('signup_enabled reads the declaration: declared off, or forced off by SSO-only; CONTROL on', async () => {
    const control = await boot();
    expect(control.manager.getPublicConfig().emailPassword.disableSignUp).toBe(false);
    expect((await readPage(control.settings)).page.values.signup_enabled).toMatchObject({ value: true, source: 'default' });

    const declared = await boot({ emailAndPassword: { disableSignUp: true } });
    expect(declared.manager.getPublicConfig().emailPassword.disableSignUp).toBe(true);
    expect((await readPage(declared.settings)).page.values.signup_enabled).toMatchObject({ value: false, source: 'default' });
    // A stored value still wins over it.
    await declared.settings.setMany('auth', { signup_enabled: true });
    await vi.waitFor(() => expect(declared.manager.getPublicConfig().emailPassword.disableSignUp).toBe(false));
    expect(await declared.settings.get('auth', 'signup_enabled')).toMatchObject({ value: true, source: 'global' });

    process.env.OS_AUTH_SSO_ONLY = 'true';
    const ssoOnly = await boot();
    expect(ssoOnly.manager.getPublicConfig().emailPassword.disableSignUp).toBe(true);
    expect(await ssoOnly.settings.get('auth', 'signup_enabled')).toMatchObject({ value: false, source: 'default' });
  });

  it('signup_enabled reads off where a cloud-managed runtime or OS_DISABLE_SIGNUP turns sign-up off', async () => {
    process.env.OS_DISABLE_SIGNUP = 'true';
    const envOff = await boot();
    expect(envOff.manager.getPublicConfig().emailPassword.disableSignUp).toBe(true);
    expect(await envOff.settings.get('auth', 'signup_enabled')).toMatchObject({ value: false, source: 'default' });
    delete process.env.OS_DISABLE_SIGNUP;

    setManaged(true);
    const managed = await boot();
    expect(managed.manager.getPublicConfig().emailPassword.disableSignUp).toBe(true);
    expect(await managed.settings.get('auth', 'signup_enabled')).toMatchObject({ value: false, source: 'default' });
  });

  it('declared off, nothing stored: the keys shown only while email and password is on are hidden, so a save of one is not judged', async () => {
    // The same as under a stored `false`: password_min_length (min 6) is visible only while
    // email_password_enabled !== false, and a hidden specifier is not validated.
    const off = await boot({ emailPassword: false });
    await expect(off.settings.setMany('auth', { password_min_length: 2 })).resolves.toBeDefined();
    expect(await off.settings.get('auth', 'password_min_length')).toMatchObject({ value: 2, source: 'global' });
    // Turning email and password on re-judges it (it is the gated key's visibility dependency).
    await expect(off.settings.setMany('auth', { email_password_enabled: true })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [expect.objectContaining({ field: 'password_min_length' })],
    });

    // CONTROL: declared on, the same save is refused at the key's bound.
    const on = await boot();
    await expect(on.settings.setMany('auth', { password_min_length: 2 })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [expect.objectContaining({ field: 'password_min_length' })],
    });
    expect(await on.settings.get('auth', 'password_min_length')).toMatchObject({ source: 'default' });
  });

  it('require_email_verification reads the declaration under the posture in force; CONTROL off', async () => {
    const control = await boot();
    expect(control.manager.getPublicConfig().emailPassword.requireEmailVerification).toBe(false);
    expect(await control.settings.get('auth', 'require_email_verification')).toMatchObject({ value: false, source: 'default' });

    const declared = await boot({ emailAndPassword: { requireEmailVerification: true } });
    expect(declared.manager.getPublicConfig().emailPassword.requireEmailVerification).toBe(true);
    expect(await declared.settings.get('auth', 'require_email_verification')).toMatchObject({ value: true, source: 'default' });

    const domain = await boot({
      audience: { posture: 'email_domain', allowedEmailDomains: ['acme.com'], selfRegistrationPermissionSet: 'member_default' },
    });
    expect(domain.manager.getPublicConfig().emailPassword.requireEmailVerification).toBe(true);
    expect((await readPage(domain.settings)).page.values.require_email_verification)
      .toMatchObject({ value: true, source: 'default' });
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
