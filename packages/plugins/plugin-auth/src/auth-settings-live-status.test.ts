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
import {
  AUTH_LIVE_STATUS_COPY,
  combineAuthLiveStatus,
  describeEmailPasswordLiveStatus,
  describeSignUpLiveStatus,
} from './auth-settings-live-status.js';
import { AUTH_SETTING_RESTORE } from './auth-settings-declared.js';

const SECRET = 'test-secret-at-least-32-chars-long';
const ADMIN = { enforced: true, permissions: ['manage_platform_settings'], userId: 'usr_admin' };
const ENV_KEYS = [
  'OS_CLOUD_MANAGED', 'OS_AUTH_EMAIL_PASSWORD_ENABLED', 'OS_AUTH_SSO_ONLY', 'OS_DISABLE_SIGNUP',
  'OS_AUTH_SIGNUP_ENABLED', 'OS_AUTH_PASSWORD_REJECT_BREACHED',
] as const;

/** Boot as a host does (init → start → kernel:ready), with email and password declared as given. */
const boot = async (opts: {
  emailPassword?: boolean;
  emailAndPassword?: Record<string, unknown>;
  audience?: Record<string, unknown>;
  hostSignInHandoff?: boolean;
  settings?: SettingsService;
  /** Further plugin options, as a deployment declares them. */
  declare?: Record<string, unknown>;
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
    ...opts.declare,
  } as ConstructorParameters<typeof AuthPlugin>[0]);
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

// Every case in this file starts from a clean auth env and a fresh cloud-managed read.
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

describe('Setup → Authentication shows the auth switches as they run', () => {
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

/**
 * Every other key the settings pass applies, measured against the running
 * config: a deployment that declares a value reads it with nothing stored
 * (`AUTH_DECLARED_DEFAULTS`), and one that declares nothing reads the manifest
 * default as before.
 */
describe('Setup → Authentication reads every declared auth key as it runs', () => {
  /** One deployment declaring a non-default value for every key the module states. */
  const DECLARED = {
    emailAndPassword: { minPasswordLength: 12, maxPasswordLength: 64 },
    membershipPolicy: 'invite-only',
    plugins: { passwordRejectBreached: true },
    passwordRequireComplexity: true,
    passwordMinClasses: 2,
    passwordHistoryCount: 5,
    passwordExpiryDays: 90,
    mfaRequirement: 'administrators',
    mfaGracePeriodDays: 3,
    apiKeyDefaultExpiryDays: 30,
    apiKeyMaxExpiryDays: 180,
    apiKeyInactivityDays: 0,
    session: { expiresIn: 30 * 86_400, updateAge: 2 * 86_400 },
    sessionIdleTimeoutMinutes: 30,
    sessionAbsoluteMaxHours: 12,
    maxConcurrentSessions: 3,
    allowedIpRanges: ['10.0.0.0/8', '192.168.1.1'],
    lockoutThreshold: 5,
    lockoutDurationMinutes: 30,
    audience: { posture: 'email_domain', allowedEmailDomains: ['acme.com', 'b.io'], selfRegistrationPermissionSet: 'member_default' },
    // Declared too, and deliberately NOT stated (see the module): the settings keep the manifest default.
    rateLimit: { enabled: true, window: 120, max: 5 },
    socialProviders: { google: { clientId: 'declared-client', clientSecret: 'declared-secret' } },
  };

  /** What each key reads with nothing stored on that deployment. */
  const EXPECTED: Record<string, unknown> = {
    password_min_length: 12,
    password_max_length: 64,
    membership_policy: 'invite-only',
    password_reject_breached: true,
    password_require_complexity: true,
    password_min_classes: 2,
    password_history_count: 5,
    password_expiry_days: 90,
    mfa_required: 'administrators',
    mfa_grace_period_days: 3,
    api_key_default_expiry_days: 30,
    api_key_max_expiry_days: 180,
    api_key_inactivity_days: 0,
    session_expiry_days: 30,
    session_refresh_days: 2,
    session_idle_timeout_minutes: 30,
    session_absolute_max_hours: 12,
    max_concurrent_sessions_per_user: 3,
    allowed_ip_ranges: '10.0.0.0/8\n192.168.1.1',
    lockout_threshold: 5,
    lockout_duration_minutes: 30,
    audience_posture: 'email_domain',
    audience_allowed_email_domains: 'acme.com\nb.io',
    audience_self_registration_permission_set: 'member_default',
  };

  /** The value the running config takes for each key, read off the manager as the enforcement reads it. */
  const running = (manager: AuthManager): Record<string, unknown> => {
    const config = (manager as any).config;
    const floor = manager.getDeploymentAccessFloor();
    const apiKeys = manager.resolveApiKeyLifecyclePolicy();
    const audience = manager.getAudience();
    return {
      password_min_length: config.emailAndPassword?.minPasswordLength,
      password_max_length: config.emailAndPassword?.maxPasswordLength,
      membership_policy: manager.getMembershipPolicy(),
      password_reject_breached: config.plugins?.passwordRejectBreached,
      password_require_complexity: config.passwordRequireComplexity,
      password_min_classes: config.passwordMinClasses,
      password_history_count: config.passwordHistoryCount,
      password_expiry_days: config.passwordExpiryDays,
      mfa_required: floor.mfaRequirement,
      mfa_grace_period_days: manager.getMfaGracePeriodDays(),
      api_key_default_expiry_days: apiKeys.defaultExpiryDays,
      api_key_max_expiry_days: apiKeys.maxExpiryDays,
      api_key_inactivity_days: apiKeys.inactivityDays,
      session_expiry_days: config.session.expiresIn / 86_400,
      session_refresh_days: config.session.updateAge / 86_400,
      session_idle_timeout_minutes: floor.sessionIdleTimeoutMinutes,
      session_absolute_max_hours: floor.sessionAbsoluteMaxHours,
      max_concurrent_sessions_per_user: floor.maxConcurrentSessions,
      allowed_ip_ranges: floor.allowedIpRanges.join('\n'),
      lockout_threshold: config.lockoutThreshold,
      lockout_duration_minutes: config.lockoutDurationMinutes,
      audience_posture: audience.posture,
      audience_allowed_email_domains: audience.allowedEmailDomains.join('\n'),
      audience_self_registration_permission_set: audience.selfRegistrationPermissionSet,
    };
  };

  const manifestDefault = (key: string): unknown => {
    const spec = builtinSettingsManifests.find((m) => m.namespace === 'auth')!.specifiers
      .find((candidate) => (candidate as { key?: string }).key === key) as { default?: unknown } | undefined;
    return spec?.default ?? null;
  };

  it('declared: each key reads what runs, as source default, through get and the page route', async () => {
    const { settings, manager } = await boot({ declare: DECLARED });
    const runs = running(manager);
    const { page, banner } = await readPage(settings);
    for (const [key, expected] of Object.entries(EXPECTED)) {
      expect(runs[key], `running ${key}`).toEqual(expected);
      expect(expected, `${key} differs from its manifest default`).not.toEqual(manifestDefault(key));
      expect(await settings.get('auth', key), key).toMatchObject({ value: expected, source: 'default' });
      expect(page.values[key], `page ${key}`).toMatchObject({ value: expected, source: 'default' });
    }
    expect(banner).toBeUndefined();
  });

  it('CONTROL: the keys not stated keep the manifest default, declared or not', async () => {
    const { settings, manager } = await boot({ declare: DECLARED });
    expect((manager as any).config.rateLimit).toMatchObject({ window: 120, max: 5 });
    for (const key of ['rate_limit_max', 'rate_limit_window_seconds', 'google_enabled', 'google_client_id', 'google_client_secret']) {
      expect((await settings.get('auth', key)).value ?? null, key).toEqual(manifestDefault(key));
    }
  });

  it('CONTROL: nothing declared, every auth key reads its manifest default', async () => {
    const { settings } = await boot();
    const keys = Object.keys(AUTH_SETTING_RESTORE).filter((key) => key !== 'api_key_policy_started_at');
    for (const key of keys) {
      const resolved = await settings.get('auth', key);
      expect(resolved.source, key).toBe('default');
      expect(resolved.value ?? null, key).toEqual(manifestDefault(key));
    }
  });

  it('CONTROL: a declaration equal to the manifest default reads the same value', async () => {
    const { settings } = await boot({
      declare: { membershipPolicy: 'auto', lockoutDurationMinutes: 15, session: { expiresIn: 7 * 86_400 } },
    });
    expect(await settings.get('auth', 'membership_policy')).toMatchObject({ value: 'auto', source: 'default' });
    expect(await settings.get('auth', 'lockout_duration_minutes')).toMatchObject({ value: 15, source: 'default' });
    expect(await settings.get('auth', 'session_expiry_days')).toMatchObject({ value: 7, source: 'default' });
  });

  it('a declaration the select cannot offer answers nothing, so the manifest default stands', async () => {
    const { settings, manager } = await boot({ declare: { membershipPolicy: 'everyone' } });
    expect(manager.getMembershipPolicy()).toBe('everyone');
    expect(await settings.get('auth', 'membership_policy')).toMatchObject({ value: 'auto', source: 'default' });
  });

  it('a stored value still wins, and a clear returns to the declaration', async () => {
    const { settings, manager } = await boot({ declare: { lockoutThreshold: 5 } });
    await settings.setMany('auth', { lockout_threshold: 2 });
    await vi.waitFor(() => expect((manager as any).config.lockoutThreshold).toBe(2));
    expect(await settings.get('auth', 'lockout_threshold')).toMatchObject({ value: 2, source: 'global' });
    await settings.setMany('auth', { lockout_threshold: null });
    await vi.waitFor(() => expect((manager as any).config.lockoutThreshold).toBe(5));
    expect(await settings.get('auth', 'lockout_threshold')).toMatchObject({ value: 5, source: 'default' });
  });

  it('a key a declaration makes visible is judged on save; CONTROL undeclared, it is hidden and not judged', async () => {
    // lockout_duration_minutes (1..1440) is visible only while lockout_threshold > 0.
    const declared = await boot({ declare: { lockoutThreshold: 5 } });
    await expect(declared.settings.setMany('auth', { lockout_duration_minutes: 5000 })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [expect.objectContaining({ field: 'lockout_duration_minutes' })],
    });
    expect(await declared.settings.get('auth', 'lockout_duration_minutes')).toMatchObject({ source: 'default' });

    const control = await boot();
    await expect(control.settings.setMany('auth', { lockout_duration_minutes: 5000 })).resolves.toBeDefined();
    expect(await control.settings.get('auth', 'lockout_duration_minutes')).toMatchObject({ value: 5000, source: 'global' });
  });
});

describe('Setup → Authentication states a sign-up the deployment forces off over a value saved on', () => {
  const signUpRuns = (manager: AuthManager) => !manager.getPublicConfig().emailPassword.disableSignUp;

  it('SSO-only: nothing stored reads off with no banner; a value saved on is stated as a warning', async () => {
    process.env.OS_AUTH_SSO_ONLY = 'true';
    const { settings, manager } = await boot();
    const nothingStored = await readPage(settings);
    expect(nothingStored.page.values.signup_enabled).toMatchObject({ value: false, source: 'default' });
    expect(nothingStored.banner).toBeUndefined();

    await settings.setMany('auth', { signup_enabled: true });
    await settle();
    expect(signUpRuns(manager)).toBe(false);
    const storedOn = await readPage(settings);
    expect(storedOn.page.values.signup_enabled).toMatchObject({ value: true, source: 'global' });
    expect(storedOn.banner).toMatchObject({
      type: 'info_banner',
      label: AUTH_LIVE_STATUS_COPY.en.signupForcedOffLabel,
      bannerText: AUTH_LIVE_STATUS_COPY.en.signupForcedOffText,
      bannerSeverity: 'warning',
    });
    const zh = await readPage(settings, { 'accept-language': 'zh-CN' });
    expect(zh.banner).toMatchObject({ label: AUTH_LIVE_STATUS_COPY['zh-CN'].signupForcedOffLabel });
  });

  it('CONTROL: self-hosted, a value saved on over a declared off is applied, and nothing is stated', async () => {
    const { settings, manager } = await boot({ emailAndPassword: { disableSignUp: true } });
    await settings.setMany('auth', { signup_enabled: true });
    await vi.waitFor(() => expect(signUpRuns(manager)).toBe(true));
    expect((await readPage(settings)).banner).toBeUndefined();
  });

  it('cloud-managed: a value stored on is stated; with email and password held off too, both are stated', async () => {
    setManaged(true);
    const seeded = new SettingsService({ env: {} });
    seeded.registerManifest(builtinSettingsManifests.find((m) => m.namespace === 'auth')!);
    await seeded.set('auth', 'signup_enabled', true, {});
    const signUpOnly = await boot({ settings: seeded });
    await settle();
    expect(signUpRuns(signUpOnly.manager)).toBe(false);
    expect((await readPage(signUpOnly.settings)).banner).toMatchObject({
      label: AUTH_LIVE_STATUS_COPY.en.signupForcedOffLabel,
      bannerSeverity: 'warning',
    });

    const both = new SettingsService({ env: {} });
    both.registerManifest(builtinSettingsManifests.find((m) => m.namespace === 'auth')!);
    await both.set('auth', 'email_password_enabled', true, {});
    await both.set('auth', 'signup_enabled', true, {});
    const held = await boot({ emailPassword: false, settings: both });
    await settle();
    const { banner } = await readPage(held.settings);
    expect(banner).toMatchObject({ label: AUTH_LIVE_STATUS_COPY.en.managedOffLabel, bannerSeverity: 'warning' });
    expect(String((banner as { bannerText?: unknown }).bannerText)).toContain(AUTH_LIVE_STATUS_COPY.en.managedOffText);
    expect(String((banner as { bannerText?: unknown }).bannerText)).toContain(AUTH_LIVE_STATUS_COPY.en.signupForcedOffText);
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

describe('describeSignUpLiveStatus', () => {
  const on = { value: true, source: 'global' };
  it('states a value shown on that the deployment forces off', () => {
    expect(describeSignUpLiveStatus({ running: false, shown: on, forcedOff: true, emailPasswordShown: { value: true } }))
      .toEqual({
        label: AUTH_LIVE_STATUS_COPY.en.signupForcedOffLabel,
        bannerText: AUTH_LIVE_STATUS_COPY.en.signupForcedOffText,
        bannerSeverity: 'warning',
      });
  });

  it('states nothing when the switch already says it, sign-up runs, nothing forces it, or the switch is hidden', () => {
    const base = { running: false, shown: on, forcedOff: true, emailPasswordShown: { value: true } };
    expect(describeSignUpLiveStatus({ ...base, shown: { value: false, source: 'default' } })).toBeUndefined();
    expect(describeSignUpLiveStatus({ ...base, running: true })).toBeUndefined();
    expect(describeSignUpLiveStatus({ ...base, forcedOff: false })).toBeUndefined();
    expect(describeSignUpLiveStatus({ ...base, emailPasswordShown: { value: false } })).toBeUndefined();
  });
});

describe('combineAuthLiveStatus', () => {
  const a = { label: 'A', bannerText: 'a.', bannerSeverity: 'warning' as const };
  const b = { label: 'B', bannerText: 'b.', bannerSeverity: 'info' as const };
  it('answers nothing, the one statement, or one banner carrying every statement in order', () => {
    expect(combineAuthLiveStatus([undefined, undefined])).toBeUndefined();
    expect(combineAuthLiveStatus([undefined, b])).toBe(b);
    expect(combineAuthLiveStatus([a, b])).toEqual({
      label: 'A', bannerText: '**A.** a.\n\n**B.** b.', bannerSeverity: 'warning',
    });
  });
});
