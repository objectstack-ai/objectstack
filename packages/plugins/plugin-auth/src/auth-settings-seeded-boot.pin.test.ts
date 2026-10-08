// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A seeded boot reads the `auth` settings AFTER the settings engine binds
 * (#22257).
 *
 * ## The defect
 *
 * `SettingsServicePlugin` binds its data engine from a `kernel:ready` hook it
 * registers in `start()`. `AuthPlugin` declares
 * `optionalDependencies: ['com.objectstack.service.settings']`, so its own
 * `kernel:ready` hooks are registered later and fire after the bind
 * (`auth-settings-ordering.pin.test.ts`). That edge orders HOOKS and nothing
 * else. `AppPlugin.start()` emits `app:seeded` when its inline seed lands, and
 * on `os serve` / `os dev` the app plugin starts after the auth plugin, so the
 * event arrives during Phase 2 — and the ADR-0093 D6 backfill's `app:seeded`
 * handler went `runBackfill` → `ensureAuthSettingsBound` → `bindAuthSettings` →
 * `getNamespace('auth')` while the engine was still unbound. Measured on the
 * showcase (`os dev --seed-admin --fresh`): one `[SettingsService] Pre-bind READ
 * of namespace 'auth'` on every boot, logged between the seed's completion and
 * the `kernel:ready` trigger, and the auth binding computed from the manifest
 * defaults. `check:settings-bind-window` walks `kernel:ready` handlers only, so
 * an `app:seeded` handler was outside its population.
 *
 * ## The composition
 *
 * The cheapest real one that reproduces it: a real `ObjectKernel`, a real
 * ObjectQL engine on in-memory SQLite, the REAL `SettingsServicePlugin` (its
 * bind hook and its reporter are the subject), the real `AuthPlugin` used
 * BEFORE the settings plugin (the `os serve` order), and an app plugin in
 * `AppPlugin`'s place: it starts after the auth plugin, writes the row a
 * previous boot persisted, and emits `app:seeded` from its own `start()`.
 *
 * It awaits the event, which `AppPlugin` does not. That is the stricter form:
 * the handler's whole chain then runs inside Phase 2, so a read it makes cannot
 * slip past the bind by timing.
 *
 * ## What is asserted
 *
 *  1. the window is real in this composition — at the moment `app:seeded`
 *     fires, the settings engine is NOT bound. Without it the next assertion
 *     could pass vacuously;
 *  2. no `Pre-bind READ` is reported (the card's Done-when);
 *  3. the first `getNamespace('auth')` the auth plugin issues answers the
 *     PERSISTED value, and the one-time pass decides under it — the value is
 *     observable, so the pin names it rather than inferring it from silence.
 *
 * The control case forces a pre-bind read of `auth` in the same composition
 * and expects exactly one report: proof that the logger spy here sees the
 * reporter at all. The reporter's own suite
 * (`settings-prebind-read-warning.test.ts`) keeps pinning its text.
 *
 * ## Resolution
 *
 * `AuthPlugin` is imported from SOURCE (relative). `@objectstack/service-settings`
 * is aliased to its `src/` in this package's `vitest.config.ts`, so the
 * reporter and the bind hook are the checkout's too. `ObjectKernel`,
 * `ObjectQLPlugin` and `SqlDriver` are the fixed instruments, read from `dist/`
 * as this package's other kernel tests read them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  InMemoryCryptoProvider,
  SettingsService,
  SettingsServicePlugin,
} from '@objectstack/service-settings';
import { AuthPlugin } from './auth-plugin.js';

vi.mock('./membership-backfill-ledger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./membership-backfill-ledger.js')>();
  return {
    ...actual,
    runOneTimeMembershipBackfill: vi.fn(actual.runOneTimeMembershipBackfill),
  };
});

import { runOneTimeMembershipBackfill } from './membership-backfill-ledger.js';

const backfillSpy = vi.mocked(runOneTimeMembershipBackfill);

const SYS = { isSystem: true } as const;

/**
 * The persisted value. The manifest default for `auth.membership_policy` is
 * `auto`, so a read answered from the in-memory fallback cannot produce this.
 */
const PERSISTED_POLICY = 'invite-only';

/** Env the auth settings read or the backfill branches on; cleared per case. */
const ENV_KEYS = [
  'OS_AUTH_MEMBERSHIP_POLICY',
  'OS_SKIP_MEMBERSHIP_BACKFILL',
  'OS_TENANCY_POSTURE',
  'OS_MULTI_ORG_ENABLED',
] as const;

/** Publishes an in-memory SQLite driver the way a datasource plugin does. */
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

/** What the app plugin saw at the moment it emitted `app:seeded`. */
interface SeedObservation {
  /** Whether `SettingsService` had its data engine bound at that instant. */
  engineBound?: boolean;
}

/**
 * An app plugin in `AppPlugin`'s place: it starts after the auth plugin (no
 * edge between them, registered later), and its `start()` writes rows and then
 * emits `app:seeded`, as `AppPlugin.start()` does when its inline seed lands.
 *
 * The row is the `auth.membership_policy` a previous boot persisted — the
 * `global` rung, so `sys_platform_setting` (ADR-0131 D7).
 *
 * `forcePreBindRead` is the control: the same plugin reads the `auth`
 * namespace itself, inside the window.
 */
function seedingAppPlugin(seen: SeedObservation, opts: { forcePreBindRead?: boolean } = {}): Plugin {
  return {
    name: 'com.example.seeded-app',
    type: 'app',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init() {},
    async start(ctx: PluginContext) {
      const ql = ctx.getService<{ insert(o: string, d: unknown, opts?: unknown): Promise<unknown> }>('objectql');
      await ql.insert(
        'sys_platform_setting',
        { namespace: 'auth', key: 'membership_policy', value: PERSISTED_POLICY, encrypted: false, locked: false },
        { context: SYS },
      );
      const settings = ctx.getService<SettingsService>('settings');
      // Reaching into the private field on purpose, as the reporter's own suite
      // does: "was the engine bound at this instant" is the fact the window is
      // defined by, and there is no public spelling of it.
      seen.engineBound = Boolean((settings as unknown as { engine?: unknown }).engine);
      if (opts.forcePreBindRead) await settings.getNamespace('auth');
      await ctx.trigger('app:seeded', { appId: 'com.example.seeded-app', overBudget: false });
    },
  };
}

describe('a seeded boot reads the auth settings after the settings engine binds (#22257)', () => {
  let kernel: ObjectKernel | undefined;
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    backfillSpy.mockClear();
  });

  afterEach(async () => {
    try {
      await kernel?.shutdown();
    } catch {
      /* a refused boot leaves the kernel stopped */
    }
    kernel = undefined;
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.restoreAllMocks();
  });

  /**
   * Boot the composition. The kernel logger's `warn` is spied on the INSTANCE:
   * `SettingsServicePlugin.init` stores `ctx.logger`, which is that same object,
   * so this is what the reporter really calls.
   */
  async function boot(opts: { forcePreBindRead?: boolean } = {}) {
    const namespaceReads = vi.spyOn(SettingsService.prototype, 'getNamespace');
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    const kernelLogger = (kernel as unknown as {
      logger: { warn: (message: string, meta?: unknown) => void };
    }).logger;
    const warn = vi.spyOn(kernelLogger, 'warn').mockImplementation(() => {});

    const seen: SeedObservation = {};
    await kernel.use(sqliteDriverPlugin());
    await kernel.use(new ObjectQLPlugin());
    // `os serve` uses the auth plugin before its capability loop registers the
    // settings plugin; the declared edge, not this order, puts settings first.
    await kernel.use(new AuthPlugin({ secret: 'test-secret-at-least-32-chars-long', baseUrl: 'http://localhost:3000' }));
    await kernel.use(new SettingsServicePlugin({ registerRoutes: false, cryptoProvider: new InMemoryCryptoProvider() }));
    await kernel.use(seedingAppPlugin(seen, opts));
    await kernel.bootstrap();

    const preBindReads = () =>
      warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('Pre-bind READ'));
    return { seen, preBindReads, namespaceReads };
  }

  it('reports no Pre-bind READ, and the auth binding and the one-time pass read the persisted value', async () => {
    const { seen, preBindReads, namespaceReads } = await boot();

    // 1. The window is real here: `app:seeded` fired before the bind.
    expect(seen.engineBound, 'app:seeded must fire inside the pre-bind window, or this case measures nothing').toBe(false);

    // 2. The card's Done-when.
    expect(preBindReads()).toEqual([]);

    // 3. The value the auth binding saw is the persisted one, not the default.
    const authReadIndex = namespaceReads.mock.calls.findIndex(([namespace]) => namespace === 'auth');
    expect(authReadIndex, 'the auth plugin never read the auth namespace').toBeGreaterThanOrEqual(0);
    const firstAuthRead = (await namespaceReads.mock.results[authReadIndex]!.value) as {
      values: Record<string, { value?: unknown; source?: unknown }>;
    };
    expect(firstAuthRead.values.membership_policy).toMatchObject({ value: PERSISTED_POLICY, source: 'global' });

    // …and the one-time membership pass decided under it, on every run.
    expect(backfillSpy).toHaveBeenCalled();
    expect(backfillSpy.mock.calls.map(([, deps]) => deps.policy)).toEqual(
      backfillSpy.mock.calls.map(() => PERSISTED_POLICY),
    );
  }, 30_000);

  it('control: a pre-bind read forced in the same composition IS reported, once, for auth', async () => {
    const { seen, preBindReads } = await boot({ forcePreBindRead: true });

    expect(seen.engineBound).toBe(false);
    const reports = preBindReads();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("Pre-bind READ of namespace 'auth'");
  }, 30_000);
});
