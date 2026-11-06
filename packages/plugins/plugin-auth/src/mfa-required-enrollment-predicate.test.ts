// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The global `auth.mfa_required` switch cannot be saved on while
 * `OS_AUTH_TWO_FACTOR` pins enrollment off (`mfa-required-enrollment-predicate.ts`).
 *
 * Through the REAL settings service (`@objectstack/service-settings`) and the
 * real `AuthPlugin` / `AuthManager`: the plugin registers the predicate when it
 * binds the `auth` namespace, and a save goes through `setMany`, or through the
 * real `PUT /api/settings/:ns` route for the envelope. No data engine is
 * composed; the settings service keeps its in-memory store.
 *
 * Pinned:
 *   1. under `OS_AUTH_TWO_FACTOR=false`, turning the switch on is refused
 *      before anything is written: the stored value, the batch it rode in, the
 *      runtime requirement and `features.twoFactor` all stay as they were;
 *   2. the HTTP door answers 400 `SETTINGS_VALIDATION` at the key, in the
 *      caller's language;
 *   3. controls: with the env var unset or on, the same save is accepted and
 *      the pass turns the requirement and enrollment on; turning it off is
 *      never refused;
 *   4. a switch stored on before the check is not re-judged: saving it again
 *      passes, and the gate's own reading stays off.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import {
  SettingsService,
  SettingsValidationError,
  builtinSettingsManifests,
  registerSettingsRoutes,
} from '@objectstack/service-settings';
import { AuthPlugin } from './auth-plugin.js';
import type { AuthManager } from './auth-manager.js';
import {
  MFA_REQUIRED_ENROLLMENT_COPY,
  mfaRequiredEnrollmentPredicate,
  registerMfaRequiredEnrollmentPredicate,
} from './mfa-required-enrollment-predicate.js';

const SECRET = 'test-secret-at-least-32-chars-long';
const ENV = 'OS_AUTH_TWO_FACTOR';

/** The error `setMany` refused with, or a failure naming what happened instead. */
async function refusalOf(write: Promise<unknown>): Promise<SettingsValidationError> {
  const outcome = await write.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(outcome, 'the save went through').toBeInstanceOf(SettingsValidationError);
  return outcome as SettingsValidationError;
}

describe('the global mfa_required switch needs two-factor enrollment', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[ENV];
    delete process.env[ENV];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  });

  const makeSettings = () => {
    const settings = new SettingsService({ env: {} });
    for (const manifest of builtinSettingsManifests) {
      if (manifest.namespace === 'auth') settings.registerManifest(manifest);
    }
    return settings;
  };

  /** Boot as a host does: init → start → kernel:ready (the auth namespace binds there). */
  const boot = async (settings: SettingsService = makeSettings()) => {
    const hooks = new Map<string, Array<() => Promise<void>>>();
    const warn = vi.fn();
    const ctx = {
      registerService: vi.fn(),
      getService: vi.fn((name: string) => {
        if (name === 'manifest') return { register: vi.fn() };
        if (name === 'settings') return settings;
        return undefined;
      }),
      getServices: vi.fn(() => new Map()),
      hook: vi.fn((name: string, handler: () => Promise<void>) => {
        if (!hooks.has(name)) hooks.set(name, []);
        hooks.get(name)!.push(handler);
      }),
      trigger: vi.fn(),
      logger: { info: vi.fn(), error: vi.fn(), warn, debug: vi.fn() },
      getKernel: vi.fn(),
    } as unknown as PluginContext;
    const plugin = new AuthPlugin({ secret: SECRET, baseUrl: 'http://localhost:3000' });
    await plugin.init(ctx);
    const manager = (ctx.registerService as any).mock.calls.find(([name]: [string]) => name === 'auth')?.[1] as AuthManager;
    await plugin.start(ctx);
    for (const handler of hooks.get('kernel:ready') ?? []) await handler();
    return { settings, manager, warn };
  };

  const required = (manager: AuthManager) => ((manager as any).config.mfaRequirement ?? 'off') !== 'off';

  // ── 1. The refusal ──────────────────────────────────────────────────────────

  it('OS_AUTH_TWO_FACTOR=false: turning it on is refused; nothing in the batch is written', async () => {
    process.env[ENV] = 'false';
    const { settings, manager } = await boot();

    const refusal = await refusalOf(settings.setMany('auth', { mfa_required: 'everyone', mfa_grace_period_days: 3 }));
    expect(refusal.code).toBe('SETTINGS_VALIDATION');
    expect(refusal.fields).toEqual([
      expect.objectContaining({
        field: 'mfa_required',
        code: 'invalid_value',
        constraint: { twoFactor: false, overriddenBy: 'OS_AUTH_TWO_FACTOR' },
      }),
    ]);

    expect(await settings.get('auth', 'mfa_required')).toMatchObject({ value: 'off', source: 'default' });
    expect(await settings.get('auth', 'mfa_grace_period_days')).toMatchObject({ source: 'default' });
    expect(required(manager)).toBe(false);
    expect(manager.isTwoFactorEnabled()).toBe(false);
    expect(manager.getPublicConfig().features.twoFactor).toBe(false);
    // Off, or the value in force, is never refused.
    await expect(settings.setMany('auth', { mfa_required: 'off' })).resolves.toBeDefined();
  });

  it('the settings PUT door answers 400 SETTINGS_VALIDATION at the key, in the caller language', async () => {
    process.env[ENV] = '0';
    const { settings } = await boot();
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
      body: { mfa_required: 'everyone' },
      headers: { 'accept-language': 'zh-CN,zh;q=0.9' },
      method: 'PUT',
      path: '/api/settings/auth',
    } as unknown as IHttpRequest;
    await routes.get('PUT /api/settings/:namespace')!(req, res);

    expect(state.status).toBe(400);
    expect(state.body.error.code).toBe('SETTINGS_VALIDATION');
    const [field] = state.body.error.details.fields;
    expect(field).toMatchObject({ field: 'mfa_required', code: 'invalid_value' });
    expect(field.message).toBe(MFA_REQUIRED_ENROLLMENT_COPY['zh-CN']);
  });

  // ── 3. Controls ─────────────────────────────────────────────────────────────

  it.each([
    ['unset', undefined],
    ['on', 'true'],
  ])('control: OS_AUTH_TWO_FACTOR %s — the save is accepted and the pass turns enrollment on with it', async (_label, value) => {
    if (value !== undefined) process.env[ENV] = value;
    const { settings, manager } = await boot();

    await settings.setMany('auth', { mfa_required: 'administrators' });
    expect(await settings.get('auth', 'mfa_required')).toMatchObject({ value: 'administrators' });
    await vi.waitFor(() => expect(required(manager)).toBe(true));
    expect(manager.isTwoFactorEnabled()).toBe(true);
    expect(manager.getPublicConfig().features.twoFactor).toBe(true);
  });

  // ── 4. A switch stored on before the check ──────────────────────────────────

  it('a switch stored on before the check is not re-judged, and the gate still reads enrollment off', async () => {
    const settings = makeSettings();
    await settings.setMany('auth', { mfa_required: 'administrators' });
    process.env[ENV] = 'false';
    const { manager } = await boot(settings);

    // The value in force: the settings service asks no predicate about it.
    await expect(settings.setMany('auth', { mfa_required: 'administrators' })).resolves.toBeDefined();
    // Read as on, enforced by nobody: `features.twoFactor` is what says so.
    expect(required(manager)).toBe(true);
    expect(manager.isTwoFactorEnabled()).toBe(false);
    expect(manager.getPublicConfig().features.twoFactor).toBe(false);
  });

  // ── The predicate and its registration, alone ───────────────────────────────

  it('judges a change to on only, and only while enrollment stays off', () => {
    const off = mfaRequiredEnrollmentPredicate(() => false);
    expect(off({ next: 'everyone', current: 'off' })?.constraint).toEqual({ twoFactor: false, overriddenBy: 'OS_AUTH_TWO_FACTOR' });
    expect(off({ next: 'administrators', current: 'off' })).toBeDefined();
    // A move between the two levels turns nothing on that is not already on.
    expect(off({ next: 'everyone', current: 'administrators' })).toBeUndefined();
    expect(off({ next: 'off', current: 'everyone' })).toBeUndefined();
    // Stored toggles read as `bindAuthSettings` reads them.
    expect(off({ next: 'true', current: null })).toBeDefined();
    expect(off({ next: 1, current: undefined })).toBeDefined();
    expect(off({ next: false, current: true })).toBeUndefined();
    expect(off({ next: null, current: true })).toBeUndefined();
    expect(off({ next: true, current: 'true' })).toBeUndefined();
    expect(mfaRequiredEnrollmentPredicate(() => true)({ next: 'everyone', current: 'off' })).toBeUndefined();
    // A language off the platform locale table falls back to English; French is on it.
    expect(off({ next: 'everyone', current: 'off', locale: 'sw-KE' })?.message).toBe(MFA_REQUIRED_ENROLLMENT_COPY.en);
    expect(off({ next: 'everyone', current: 'off', locale: 'fr-FR' })?.message).toBe(MFA_REQUIRED_ENROLLMENT_COPY.fr);
  });

  it('a settings service without write predicates is said at warn, only while the pin makes it matter', () => {
    const warn = vi.fn();
    registerMfaRequiredEnrollmentPredicate({}, { warn });
    expect(warn).not.toHaveBeenCalled();
    process.env[ENV] = 'false';
    registerMfaRequiredEnrollmentPredicate({}, { warn });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/OS_AUTH_TWO_FACTOR/);
  });
});
