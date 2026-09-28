// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `auth` settings pass: a refused key does not take its accepted siblings
 * with it.
 *
 * `bindAuthSettings` maps the namespace onto `AuthManager.applyConfigPatch`,
 * and the manager validates a patch on entry wherever it carries a block it
 * judges: `emailAndPassword` (`assertAudienceConfig`, against the standing
 * audience posture) and `plugins` (`assertScimAdminCoherence`). When the
 * whole pass went out as ONE patch, one refused key dropped every other
 * setting in it — password policy, MFA, rate limits, session lifetime,
 * social providers — while the settings console kept showing all of them as
 * saved, and the only trace was a `warn`.
 *
 * Pinned here, through the settings channel (a stub namespace read feeding
 * the real `AuthPlugin` and `AuthManager`):
 *
 *   1. with a live refusing key in the pass, every sibling setting IS applied;
 *   2. the refusal is reported ONCE, at `error`, naming the refused key, and
 *      the old `warn` never fires;
 *   3. a clean pass still applies everything and reports nothing (control).
 *
 * The triggers are the refusals the manager can actually raise from this
 * pass: a console-stored `require_email_verification: false` under posture
 * `open` (reached with no stack config at all, by saving through the
 * console), the deployment's own `false` under `email_domain`, and the
 * SCIM/admin coherence refusal on the `plugins` block once `OS_SCIM_ENABLED`
 * appears after construction.
 *
 * Envelope note: these refusals are log-line refusals (the binding runs
 * inside `applySettings`, not on an HTTP surface), so the assertions pin the
 * logger level, the named key and the applied config.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { AuthPlugin } from './auth-plugin.js';
import { AuthManager } from './auth-manager.js';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/objectql';

const SECRET = 'test-secret-at-least-32-chars-long';

type SettingEntry = { value: unknown; source: string };

/** Minimal engine: enough for boot-time hooks (backfill sees zero users). */
function makeEngine() {
  return {
    insert: vi.fn(async (_object: string, row: any) => row),
    find: vi.fn(async () => []),
    findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => {
      assertEngineFindOnePredicate(object, query);
      return null;
    }),
  };
}

/** One sibling from every family the defect used to drop. */
const SIBLINGS: Record<string, SettingEntry> = {
  password_min_length: { value: 12, source: 'global' }, // password policy — same emailAndPassword block
  password_require_complexity: { value: true, source: 'global' },
  mfa_required: { value: true, source: 'global' }, // MFA (with its twoFactor plugin)
  rate_limit_max: { value: 5, source: 'global' }, // rate limits
  session_expiry_days: { value: 3, source: 'global' }, // session lifetime
  google_enabled: { value: true, source: 'global' }, // social providers
  google_client_id: { value: 'google-settings-client-id', source: 'global' },
  google_client_secret: { value: 'google-settings-client-secret', source: 'global' },
};

const OPEN = { posture: 'open', selfRegistrationPermissionSet: 'member_default' } as const;

const ENV_KEYS = ['OS_SCIM_ENABLED', 'OS_AUTH_GOOGLE_ENABLED', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const;

describe('auth settings pass — a refused key does not take its siblings with it', () => {
  let mockContext: PluginContext;
  let hookHandlers: Map<string, Array<() => Promise<void>>>;
  const settingsStore: { values: Record<string, SettingEntry>; readFails: boolean } = {
    values: {},
    readFails: false,
  };
  let subscribers: Array<() => void>;
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    settingsStore.values = {};
    settingsStore.readFails = false;
    subscribers = [];
    hookHandlers = new Map();
    mockContext = {
      registerService: vi.fn(),
      getService: vi.fn(),
      getServices: vi.fn(() => new Map()),
      hook: vi.fn((name: string, handler: () => Promise<void>) => {
        if (!hookHandlers.has(name)) hookHandlers.set(name, []);
        hookHandlers.get(name)!.push(handler);
      }),
      trigger: vi.fn(),
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      getKernel: vi.fn(),
    } as unknown as PluginContext;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  const makeSettings = () => ({
    getNamespace: vi.fn(async (namespace: string) => {
      if (settingsStore.readFails) throw new Error('settings store unavailable');
      return namespace === 'auth' ? { values: settingsStore.values } : { values: {} };
    }),
    subscribe: vi.fn((namespace: string, cb: () => void) => {
      if (namespace === 'auth') subscribers.push(cb);
    }),
  });

  /** Boot exactly as a host does: init → start → kernel:ready (settings bind there). */
  const boot = async (opts: {
    settings?: Record<string, SettingEntry>;
    pluginOptions?: Record<string, unknown>;
  } = {}) => {
    settingsStore.values = opts.settings ?? {};
    const engine = makeEngine();
    (mockContext.getService as any).mockImplementation((name: string) => {
      if (name === 'manifest') return { register: vi.fn() };
      if (name === 'settings') return makeSettings();
      if (name === 'data' || name === 'objectql') return engine;
      return undefined;
    });
    const plugin = new AuthPlugin({
      secret: SECRET,
      baseUrl: 'http://localhost:3000',
      ...(opts.pluginOptions ?? {}),
    });
    await plugin.init(mockContext);
    const manager = (mockContext.registerService as any).mock.calls.find(
      ([name]: [string]) => name === 'auth',
    )?.[1] as AuthManager;
    await plugin.start(mockContext);
    for (const h of hookHandlers.get('kernel:ready') ?? []) await h();
    return { manager };
  };

  /** A later save through the console: the subscription re-runs the pass. */
  const saveAndReapply = async (values: Record<string, SettingEntry>) => {
    settingsStore.values = values;
    expect(subscribers.length).toBeGreaterThan(0);
    for (const cb of subscribers) cb();
    // The pass awaits exactly one read, then applies synchronously.
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const errorLines = () => (mockContext.logger.error as any).mock.calls.map((c: any[]) => String(c[0]));
  const warnLines = () => (mockContext.logger.warn as any).mock.calls.map((c: any[]) => String(c[0]));
  const refusalLines = () => errorLines().filter((m: string) => m.includes('REFUSED'));

  const expectSiblingsApplied = (manager: AuthManager, sessionDays = 3) => {
    const cfg = (manager as any).config;
    expect(cfg.session?.expiresIn).toBe(sessionDays * 86_400);
    expect(cfg.emailAndPassword?.minPasswordLength).toBe(12);
    expect(cfg.passwordRequireComplexity).toBe(true);
    expect(cfg.mfaRequired).toBe(true);
    expect(cfg.plugins?.twoFactor).toBe(true);
    expect(cfg.rateLimit?.max).toBe(5);
    expect(cfg.socialProviders?.google?.clientId).toBe('google-settings-client-id');
  };

  // ── 1. The console door: no stack config at all ──────────────────────────

  it('a console-stored verification false under a console-opened posture is refused ALONE — the siblings saved with it apply', async () => {
    // Pass 1: the console opens the posture (verification stays forced on).
    const { manager } = await boot({
      settings: {
        audience_posture: { value: 'open', source: 'global' },
        audience_self_registration_permission_set: { value: 'member_default', source: 'global' },
      },
    });
    expect(manager.getAudience().posture).toBe('open');
    expect(refusalLines()).toEqual([]);

    // Pass 2: the admin saves verification OFF together with the siblings.
    await saveAndReapply({
      audience_posture: { value: 'open', source: 'global' },
      audience_self_registration_permission_set: { value: 'member_default', source: 'global' },
      require_email_verification: { value: false, source: 'global' },
      ...SIBLINGS,
    });

    expectSiblingsApplied(manager);
    // The refused key did not land: `open` keeps verification forced on.
    expect((manager as any).config.emailAndPassword?.requireEmailVerification).not.toBe(false);
    expect(manager.getPublicConfig().emailPassword.requireEmailVerification).toBe(true);
    expect(manager.getAudience().posture).toBe('open');

    // Reported ONCE, at error, naming the key, with the validator's remedy.
    const refused = refusalLines();
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain('require_email_verification');
    expect(refused[0]).toContain('unless the DEPLOYMENT turns it off');
    expect(warnLines().some((m: string) => m.includes('failed to apply auth settings'))).toBe(false);
  });

  // ── 2. The stack-config door: posture declared at boot ───────────────────

  it('stack-config open + a console-stored false at boot: the key is refused, every sibling applies', async () => {
    const { manager } = await boot({
      pluginOptions: { audience: OPEN },
      settings: {
        require_email_verification: { value: false, source: 'global' },
        ...SIBLINGS,
      },
    });

    expectSiblingsApplied(manager);
    expect(manager.getPublicConfig().emailPassword.requireEmailVerification).toBe(true);
    const refused = refusalLines();
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain('require_email_verification');
  });

  it('email_domain + the deployment env false: refused (no source may turn it off there), siblings apply', async () => {
    const { manager } = await boot({
      pluginOptions: {
        audience: {
          posture: 'email_domain',
          allowedEmailDomains: ['acme.com'],
          selfRegistrationPermissionSet: 'member_default',
        },
      },
      settings: {
        require_email_verification: { value: false, source: 'env' },
        ...SIBLINGS,
      },
    });

    expectSiblingsApplied(manager);
    expect(manager.getPublicConfig().emailPassword.requireEmailVerification).toBe(true);
    const refused = refusalLines();
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain('require_email_verification');
    expect(refused[0]).toContain("posture 'email_domain' opens self-registration");
  });

  // ── 3. The plugins block: SCIM/admin coherence ───────────────────────────

  it('a refused plugins block names each key it carried, keeps MFA with its enrollment plugin, and lets the rest apply', async () => {
    // Coherent at construction (no SCIM, admin declined); OS_SCIM_ENABLED
    // appearing afterwards makes every plugins patch refusable.
    const { manager } = await boot({ pluginOptions: { plugins: { admin: false } } });
    process.env.OS_SCIM_ENABLED = 'true';

    await saveAndReapply({
      password_reject_breached: { value: true, source: 'global' },
      mfa_required: { value: true, source: 'global' },
      session_expiry_days: { value: 7, source: 'global' },
      password_min_length: { value: 12, source: 'global' },
      rate_limit_max: { value: 5, source: 'global' },
    });

    const cfg = (manager as any).config;
    expect(cfg.session?.expiresIn).toBe(7 * 86_400);
    expect(cfg.emailAndPassword?.minPasswordLength).toBe(12);
    expect(cfg.rateLimit?.max).toBe(5);
    // Refused: the standing values keep ruling. MFA is NOT enforced without
    // the twoFactor plugin that lets a gated user enroll.
    expect(cfg.plugins?.passwordRejectBreached).toBeUndefined();
    expect(cfg.plugins?.twoFactor).toBeUndefined();
    expect(cfg.mfaRequired).toBeUndefined();

    const refused = refusalLines();
    expect(refused).toHaveLength(2);
    expect(refused.some((m: string) => m.includes('password_reject_breached') && m.includes('ADR-0134'))).toBe(true);
    expect(refused.some((m: string) => m.includes('mfa_required') && m.includes('ADR-0134'))).toBe(true);
    expect(warnLines().some((m: string) => m.includes('failed to apply auth settings'))).toBe(false);
  });

  // ── 4. Control: a clean pass applies everything and reports nothing ──────

  it('CONTROL — a clean pass applies every setting and reports no refusal', async () => {
    const { manager } = await boot({
      pluginOptions: { audience: OPEN },
      settings: {
        require_email_verification: { value: true, source: 'global' },
        ...SIBLINGS,
      },
    });

    expectSiblingsApplied(manager);
    expect((manager as any).config.emailAndPassword?.requireEmailVerification).toBe(true);
    expect(refusalLines()).toEqual([]);
    expect(warnLines().some((m: string) => m.includes('failed to apply auth settings'))).toBe(false);
  });

  // ── 5. A pass that could not read the namespace applied nothing ──────────

  it('a failed namespace read is reported at error: nothing in the stored namespace was applied', async () => {
    settingsStore.readFails = true;
    const { manager } = await boot({ settings: { session_expiry_days: { value: 3, source: 'global' } } });
    expect((manager as any).config.session?.expiresIn).toBeUndefined();
    const lines = errorLines().filter((m: string) => m.includes('auth settings NOT APPLIED'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('settings store unavailable');
    expect(warnLines().some((m: string) => m.includes('failed to apply auth settings'))).toBe(false);
  });
});
