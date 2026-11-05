// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30312] Clearing an `auth.*` setting (the console sends `null`) or restoring
 * the namespace's defaults takes effect in the same pass: the key resolves
 * `source: 'default'`, and the running value returns to what the deployment
 * itself declared (plugin options, `auth:configure`), or to the manager's own
 * built-in default where it declared nothing. Measured before the fix on this
 * composition: `lockout_threshold` 3 and `max_concurrent_sessions_per_user` 2
 * stayed in force after both were saved `null`, until a restart.
 *
 * The composition is #30203's: the real `AuthPlugin` bound to a real
 * `SettingsService` carrying the shipped auth manifest, with the real settings
 * routes in front of it for the save-door cases. One pin per key family
 * (`AUTH_SETTING_RESTORE`'s pieces), the namespace reset, the table held to
 * the manifest, and the refusable piece the restore made reachable: a cleared
 * `email_password_enabled` on a deployment that declared it off is judged by
 * the sign-in floor as the off it now applies.
 *
 * The running values are read off the manager's config (`running()`): most of
 * these options have no public reader, and the config is what every consumer
 * reads at request time.
 *
 * `@objectstack/service-settings` resolves to its `src/` here (this package's
 * `vitest.config.ts`).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IHttpRequest, IHttpResponse, IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import {
  SettingsService,
  builtinSettingsManifests,
  registerSettingsRoutes,
} from '@objectstack/service-settings';
import { AuthPlugin } from './auth-plugin.js';
import type { AuthManager, AuthManagerOptions } from './auth-manager.js';
import { AUTH_SETTING_RESTORE } from './auth-settings-declared.js';

const ADMIN_CTX = { enforced: true, permissions: ['manage_platform_settings'], userId: 'usr_admin' };
const authManifest = builtinSettingsManifests.find((m) => m.namespace === 'auth')!;

class MockHttp implements IHttpServer {
  routes = new Map<string, RouteHandler>();
  private add(method: string, path: string, handler: RouteHandler) {
    this.routes.set(`${method} ${path}`, handler);
  }
  get(path: string, h: RouteHandler) { this.add('GET', path, h); return this as any; }
  post(path: string, h: RouteHandler) { this.add('POST', path, h); return this as any; }
  put(path: string, h: RouteHandler) { this.add('PUT', path, h); return this as any; }
  delete(path: string, h: RouteHandler) { this.add('DELETE', path, h); return this as any; }
  patch(path: string, h: RouteHandler) { this.add('PATCH', path, h); return this as any; }
  use() { return this as any; }
  listen() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  getInstance() { return null; }
}

interface Rig {
  svc: SettingsService;
  manager: AuthManager;
  save(body: Record<string, unknown>, transport?: { headers?: Record<string, string>; remoteAddress?: string }):
    Promise<{ status: number; body: any }>;
}

async function boot(
  opts: { env?: Record<string, string | undefined>; svc?: SettingsService; plugin?: Record<string, unknown> } = {},
): Promise<Rig> {
  const svc = opts.svc ?? new SettingsService({ env: opts.env ?? {} });
  if (!opts.svc) svc.registerManifest(authManifest);
  const handlers = new Map<string, Array<() => Promise<void>>>();
  const ctx: any = {
    registerService: vi.fn(),
    getService: vi.fn((name: string) => {
      if (name === 'manifest') return { register: vi.fn() };
      if (name === 'settings') return svc;
      return undefined;
    }),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn((name: string, handler: () => Promise<void>) => {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    }),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  };
  const plugin = new AuthPlugin({
    secret: 'test-secret-at-least-32-chars-long',
    baseUrl: 'http://localhost:3000',
    ...(opts.plugin ?? {}),
  });
  await plugin.init(ctx);
  const manager = ctx.registerService.mock.calls.find(([name]: [string]) => name === 'auth')?.[1] as AuthManager;
  await plugin.start(ctx);
  for (const h of handlers.get('kernel:ready') ?? []) await h();

  const http = new MockHttp();
  registerSettingsRoutes(http, svc, { contextFromRequest: () => ({ ...ADMIN_CTX }) });
  const save: Rig['save'] = async (body, transport = {}) => {
    const out = { status: 200, body: undefined as any };
    const res: IHttpResponse = {
      json: vi.fn((data: any) => { out.body = data; }) as any,
      send: vi.fn() as any,
      status: vi.fn((code: number) => { out.status = code; return res; }) as any,
      header: vi.fn(() => res) as any,
    };
    const req: IHttpRequest = {
      params: { namespace: 'auth' },
      query: {},
      body,
      headers: transport.headers ?? {},
      method: 'PUT',
      path: '/api/settings/auth',
      ...(transport.remoteAddress ? { remoteAddress: transport.remoteAddress } : {}),
    };
    await http.routes.get('PUT /api/settings/:namespace')!(req, res);
    return out;
  };
  return { svc, manager, save };
}


const running = (manager: AuthManager): AuthManagerOptions => (manager as any).config;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const DAY = 86_400;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('#30312 the restore table covers every key the auth pass applies', () => {
  it('names exactly the shipped auth manifest keys', () => {
    const manifestKeys = ((authManifest as any).specifiers as Array<{ key?: string }>)
      .flatMap((specifier) => (specifier.key ? [specifier.key] : []))
      .sort();
    expect(manifestKeys.length).toBeGreaterThan(30);
    expect(Object.keys(AUTH_SETTING_RESTORE).sort()).toEqual(manifestKeys);
  });
});

describe('#30312 a cleared plain option returns to the declaration in the same pass', () => {
  it('lockout and concurrent sessions: the measured case, with and without a declaration', async () => {
    const { svc, manager } = await boot({ plugin: { lockoutThreshold: 7 } });
    expect(running(manager).lockoutThreshold).toBe(7);
    await svc.setMany('auth', { lockout_threshold: 3, max_concurrent_sessions_per_user: 2 }, {});
    await vi.waitFor(() => expect(running(manager).maxConcurrentSessions).toBe(2));
    expect(running(manager).lockoutThreshold).toBe(3);

    await svc.setMany('auth', { lockout_threshold: null, max_concurrent_sessions_per_user: null }, {});
    expect((await svc.get('auth', 'lockout_threshold', {})).source).toBe('default');
    await vi.waitFor(() => expect(running(manager).lockoutThreshold).toBe(7));
    expect(running(manager).maxConcurrentSessions).toBeUndefined();
  });

  it('password policy and API-key lifetime fields', async () => {
    const { svc, manager } = await boot({ plugin: { passwordMinClasses: 2, apiKeyMaxExpiryDays: 30 } });
    await svc.setMany('auth', { password_min_classes: 4, api_key_max_expiry_days: 400 }, {});
    await vi.waitFor(() => expect(running(manager).apiKeyMaxExpiryDays).toBe(400));
    expect(running(manager).passwordMinClasses).toBe(4);

    await svc.setMany('auth', { password_min_classes: null, api_key_max_expiry_days: null }, {});
    await vi.waitFor(() => expect(running(manager).apiKeyMaxExpiryDays).toBe(30));
    expect(running(manager).passwordMinClasses).toBe(2);
  });

  it('a key the store never gave a value is left alone by a pass about another key', async () => {
    const { svc, manager } = await boot({ plugin: { lockoutThreshold: 7 } });
    const applied = vi.spyOn(manager, 'applyConfigPatch');
    await svc.set('auth', 'max_concurrent_sessions_per_user', 2, {});
    await vi.waitFor(() => expect(running(manager).maxConcurrentSessions).toBe(2));
    expect(running(manager).lockoutThreshold).toBe(7);
    // Only the stored key's option travels: no piece re-applies (and so no
    // refusable block re-judges) a declaration nobody cleared.
    expect(applied.mock.calls.map(([piece]) => Object.keys(piece))).toEqual([['maxConcurrentSessions']]);
  });
});

describe('#30312 refusable pieces restore through the piece a save travels', () => {
  it('emailAndPassword fields return to the declared block', async () => {
    const { svc, manager } = await boot({ plugin: { emailAndPassword: { enabled: true, minPasswordLength: 12 } } });
    await svc.setMany('auth', { password_min_length: 20, signup_enabled: false }, {});
    await vi.waitFor(() => expect(running(manager).emailAndPassword?.minPasswordLength).toBe(20));
    expect(running(manager).emailAndPassword?.disableSignUp).toBe(true);

    await svc.setMany('auth', { password_min_length: null, signup_enabled: null }, {});
    await vi.waitFor(() => expect(running(manager).emailAndPassword?.minPasswordLength).toBe(12));
    expect(running(manager).emailAndPassword?.disableSignUp).toBeUndefined();
    expect(running(manager).emailAndPassword?.enabled).toBe(true);
  });

  it('breached-password rejection returns to the declared plugin flag', async () => {
    const { svc, manager } = await boot();
    await svc.set('auth', 'password_reject_breached', true, {});
    await vi.waitFor(() => expect((running(manager).plugins as any)?.passwordRejectBreached).toBe(true));

    await svc.set('auth', 'password_reject_breached', null, {});
    await vi.waitFor(() => expect((running(manager).plugins as any)?.passwordRejectBreached).toBeUndefined());
  });

  it('mfa_required cleared returns to a declared off, and enrolled factors stay verifiable', async () => {
    const { svc, manager } = await boot();
    await svc.set('auth', 'mfa_required', true, {});
    await vi.waitFor(() => expect(running(manager).mfaRequired).toBe(true));
    expect((running(manager).plugins as any)?.twoFactor).toBe(true);

    await svc.set('auth', 'mfa_required', null, {});
    await vi.waitFor(() => expect(running(manager).mfaRequired).toBeUndefined());
    // As a save of off: the requirement goes, the enrollment path stays.
    expect((running(manager).plugins as any)?.twoFactor).toBe(true);
  });

  it('mfa_required cleared returns to a declared on as one piece with its enrollment path', async () => {
    const { svc, manager } = await boot({ plugin: { mfaRequired: true } });
    await svc.set('auth', 'mfa_required', false, {});
    await vi.waitFor(() => expect(running(manager).mfaRequired).toBe(false));

    await svc.set('auth', 'mfa_required', null, {});
    await vi.waitFor(() => expect(running(manager).mfaRequired).toBe(true));
    expect((running(manager).plugins as any)?.twoFactor).toBe(true);
  });

  it('a cleared email_password_enabled is judged as the off it returns to, and refused with no other way in', async () => {
    const { manager, save } = await boot({
      plugin: {
        emailAndPassword: { enabled: false },
        socialProviders: { google: { clientId: 'cid', clientSecret: 'secret' } },
      },
    });
    expect((await save({ email_password_enabled: true })).status).toBe(200);
    await vi.waitFor(() => expect(running(manager).emailAndPassword?.enabled).toBe(true));
    expect((await save({ google_enabled: false })).status).toBe(200);
    await vi.waitFor(() => expect(running(manager).socialProviders?.google).toBeUndefined());

    const refused = await save({ email_password_enabled: null });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('SETTINGS_VALIDATION');
    expect(refused.body.error.details.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'email_password_enabled', code: 'invalid_value' })]),
    );
    await settle();
    expect(running(manager).emailAndPassword?.enabled).toBe(true);
  });

  it('the same clear saves and applies when another way in stands (preservation)', async () => {
    const { manager, save } = await boot({
      plugin: {
        emailAndPassword: { enabled: false },
        socialProviders: { google: { clientId: 'cid', clientSecret: 'secret' } },
      },
    });
    expect((await save({ email_password_enabled: true })).status).toBe(200);
    await vi.waitFor(() => expect(running(manager).emailAndPassword?.enabled).toBe(true));

    expect((await save({ email_password_enabled: null })).status).toBe(200);
    await vi.waitFor(() => expect(running(manager).emailAndPassword?.enabled).toBe(false));
    expect(running(manager).socialProviders?.google).toBeDefined();
  });
});

describe('#30312 keys that rule one runtime value together restore together', () => {
  it('session lifetime: a stored field overrides its declared twin, a cleared one returns to it', async () => {
    const { svc, manager } = await boot({ plugin: { session: { expiresIn: 10 * DAY, updateAge: DAY } } });
    await svc.set('auth', 'session_expiry_days', 3, {});
    await vi.waitFor(() => expect(running(manager).session?.expiresIn).toBe(3 * DAY));
    expect(running(manager).session?.updateAge).toBe(DAY);

    await svc.set('auth', 'session_expiry_days', null, {});
    await vi.waitFor(() => expect(running(manager).session?.expiresIn).toBe(10 * DAY));
    expect(running(manager).session?.updateAge).toBe(DAY);
  });

  it('the rate-limit pair returns to the declaration once neither is stored', async () => {
    const { svc, manager } = await boot();
    await svc.setMany('auth', { rate_limit_max: 5, rate_limit_window_seconds: 30 }, {});
    await vi.waitFor(() => expect(running(manager).rateLimit?.max).toBe(5));

    await svc.set('auth', 'rate_limit_max', null, {});
    await vi.waitFor(() => expect(running(manager).rateLimit?.max).toBe(10));
    expect(running(manager).rateLimit?.window).toBe(30);

    await svc.set('auth', 'rate_limit_window_seconds', null, {});
    await vi.waitFor(() => expect(running(manager).rateLimit).toBeUndefined());
  });

  it('Google returns to the declared provider once no google key is stored', async () => {
    const { svc, manager } = await boot({
      plugin: { socialProviders: { google: { clientId: 'cid', clientSecret: 'secret' } } },
    });
    await svc.set('auth', 'google_enabled', false, {});
    await vi.waitFor(() => expect(running(manager).socialProviders?.google).toBeUndefined());

    await svc.set('auth', 'google_enabled', null, {});
    await vi.waitFor(() => expect(running(manager).socialProviders?.google?.clientId).toBe('cid'));
  });

  it('the audience returns whole to the declared posture once no audience key is stored', async () => {
    const { svc, manager } = await boot();
    await svc.setMany('auth', {
      audience_posture: 'email_domain',
      audience_allowed_email_domains: 'example.com',
      audience_self_registration_permission_set: 'member_default',
    }, {});
    await vi.waitFor(() => expect(manager.getAudience().posture).toBe('email_domain'));

    await svc.setMany('auth', {
      audience_posture: null,
      audience_allowed_email_domains: null,
      audience_self_registration_permission_set: null,
    }, {});
    await vi.waitFor(() => expect(manager.getAudience().posture).toBe('invite_only'));
  });
});

describe('#30312 the audience follows its posture', () => {
  it('a cleared posture returns to the declared one while a sibling is still stored', async () => {
    const { svc, manager } = await boot();
    await svc.setMany('auth', {
      audience_posture: 'email_domain',
      audience_allowed_email_domains: 'example.com',
      audience_self_registration_permission_set: 'member_default',
    }, {});
    await vi.waitFor(() => expect(manager.getAudience().posture).toBe('email_domain'));

    await svc.set('auth', 'audience_posture', null, {});
    await vi.waitFor(() => expect(manager.getAudience().posture).toBe('invite_only'));
  });
});

describe('#30312 restoring the namespace defaults restores every family at once', () => {
  it('reset hands plain, refusable and grouped keys back to the declaration', async () => {
    const { svc, manager } = await boot({
      plugin: { lockoutThreshold: 7, emailAndPassword: { enabled: true, minPasswordLength: 12 } },
    });
    await svc.setMany('auth', {
      lockout_threshold: 3,
      password_min_length: 20,
      session_idle_timeout_minutes: 15,
      rate_limit_max: 5,
    }, {});
    await vi.waitFor(() => expect(running(manager).rateLimit?.max).toBe(5));

    await svc.resetNamespace('auth', {});
    await vi.waitFor(() => expect(running(manager).lockoutThreshold).toBe(7));
    expect(running(manager).emailAndPassword?.minPasswordLength).toBe(12);
    expect(running(manager).sessionIdleTimeoutMinutes).toBeUndefined();
    expect(running(manager).rateLimit).toBeUndefined();
  });

  it('an env-pinned key keeps its env value through a reset', async () => {
    const { svc, manager } = await boot({ env: { OS_AUTH_LOCKOUT_THRESHOLD: '5' } });
    await vi.waitFor(() => expect(running(manager).lockoutThreshold).toBe(5));
    await svc.set('auth', 'max_concurrent_sessions_per_user', 2, {});
    await vi.waitFor(() => expect(running(manager).maxConcurrentSessions).toBe(2));

    await svc.resetNamespace('auth', {});
    await vi.waitFor(() => expect(running(manager).maxConcurrentSessions).toBeUndefined());
    expect(running(manager).lockoutThreshold).toBe(5);
  });
});
