// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
// [#5855] The fake engine's `update` routes through the producer's OWN dispatch
// predicate (#5480), so this double cannot accept a call `ObjectQL.update`
// refuses. Imported from `@objectstack/metadata-core` (already a `dependencies`
// entry here) and not from `@objectstack/objectql`, which depends on this
// package — that import would close a dependency cycle turbo rejects, and is
// why this file's `update` entry sat in the gate's DEBT ledger until #5619 sank
// the predicate into a package that depends on neither side.
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { PlatformObjectsPlugin } from './plugin.js';
import { SysMetadataActivation, SysMigration, SysMigrationJournal, SysSecret } from './system/index.js';

/**
 * Hand-rolled fake PluginContext (mirrors the service-plugin tests) — this
 * package has no kernel dependency and the plugin is structurally typed, so
 * booting a real kernel here would buy nothing.
 */
function makeCtx() {
  const services = new Map<string, any>();
  const hooks: Array<() => Promise<void> | void> = [];
  const byEvent: Record<string, Array<() => Promise<void> | void>> = {};
  const logs: { info: string[]; warn: string[] } = { info: [], warn: [] };
  const ctx: any = {
    logger: {
      info: (m: string) => { logs.info.push(String(m)); },
      warn: (m: string) => { logs.warn.push(String(m)); },
    },
    _logs: logs,
    registerService: (name: string, svc: any) => { services.set(name, svc); },
    getService: <T>(name: string): T => {
      const s = services.get(name);
      if (!s) throw new Error(`service '${name}' not registered`);
      return s as T;
    },
    hook: (event: string, fn: () => Promise<void> | void) => {
      (byEvent[event] ??= []).push(fn);
      if (event === 'kernel:ready') hooks.push(fn);
    },
    _flushReady: async () => { for (const h of hooks) await h(); },
    _flush: async (event: string) => { for (const h of byEvent[event] ?? []) await h(); },
    _events: () => Object.keys(byEvent),
  };
  return ctx;
}

describe('PlatformObjectsPlugin: platform-infrastructure object registration (#4243, #4270)', () => {
  it('registers SysMigration, SysMigrationJournal and SysSecret through the manifest service', async () => {
    const ctx = makeCtx();
    const manifests: any[] = [];
    ctx.registerService('manifest', { register: (m: any) => manifests.push(m) });

    await new PlatformObjectsPlugin().init(ctx);

    const infra = manifests.find((m) => m.id === 'com.objectstack.platform-objects');
    expect(infra).toBeDefined();
    expect(infra.scope).toBe('system');
    expect(infra.objects).toEqual([SysMigration, SysMigrationJournal, SysSecret]);
    expect(infra.objects.map((o: any) => o.name)).toEqual([
      'sys_migration',
      // ADR-0119 D2 (#4617). Registered UNCONDITIONALLY, alongside the flag
      // ledger rather than by the migration CLI that writes it: recovery has
      // to be discoverable with zero host wiring, and a journal some kernels
      // compose and others do not is a journal a boot scanner cannot rely on.
      'sys_migration_journal',
      'sys_secret',
    ]);
    // ⛔ The three above must NOT acquire the ledger's routing triple. They
    // ride the project database today; moving them is a different question.
    expect(infra.defaultDatasource).toBeUndefined();
  });

  /**
   * [#12359 ruling, 2026-08-26 — 「同意」] ADR-0126 §4's activation ledger.
   * Registration follows the DECLARATION: the object is declared in this
   * package, so this plugin registers it. Until the ruling its only registrant
   * was the automation service's manifest — which made packaged-ACTION
   * disable, whose consult and write path live on the ObjectQL engine,
   * unavailable in every actions-and-no-automation composition (measured on a
   * real boot: 503 SERVICE_UNAVAILABLE on the flip).
   */
  it('registers SysMetadataActivation under its OWN manifest, carrying the routing verbatim', async () => {
    const ctx = makeCtx();
    const manifests: any[] = [];
    ctx.registerService('manifest', { register: (m: any) => manifests.push(m) });

    await new PlatformObjectsPlugin().init(ctx);

    const ledger = manifests.find((m) => m.objects?.some((o: any) => o.name === 'sys_metadata_activation'));
    expect(ledger, 'no manifest registers sys_metadata_activation').toBeDefined();
    expect(ledger.objects).toEqual([SysMetadataActivation]);

    // The load-bearing half. `ObjectQL.resolveDatasourceBinding` step 4 routes
    // an object by its OWNING PACKAGE's `defaultDatasource`, so a registrar
    // carries the table's datasource with it. The ledger table already exists
    // in live databases; dropping this triple would leave its rows in one
    // database and start reading another on any deployment that registers a
    // `cloud` datasource — every disabled artifact silently re-arming, which is
    // the ADR-0126 §6 wall 3 failure through an unwatched door. Measured on a
    // real engine: owner `com.objectstack.service-automation` resolves 'cloud',
    // owner `com.objectstack.platform-objects` resolves undefined (the global
    // default driver — a different database).
    expect(ledger.scope).toBe('system');
    expect(ledger.namespace).toBe('sys');
    expect(ledger.defaultDatasource).toBe('cloud');

    // Exactly one manifest claims it. Two would not be a duplicate, it would be
    // a boot FAILURE — `registerObject` throws `Object "…" is already owned by
    // package "…"` (ADR-0029 D3 single owner). Measured, because the triage
    // that raised #12359 left it as the open question.
    expect(
      manifests.filter((m) => m.objects?.some((o: any) => o.name === 'sys_metadata_activation')),
    ).toHaveLength(1);
  });

  /**
   * #4270 pin: the engine's secret-field write path is fail-CLOSED — with no
   * `sys_secret` store it throws, and its error message tells the operator to
   * "Ensure the platform-objects (sys_secret) are registered". This plugin is
   * what makes that sentence true; dropping SysSecret from the registration
   * would fail any kernel composed without service-settings (and even with
   * it — settings no longer registers the object either).
   */
  it('sys_secret is registered HERE, so the engine fail-closed error names the right package', async () => {
    const ctx = makeCtx();
    const manifests: any[] = [];
    ctx.registerService('manifest', { register: (m: any) => manifests.push(m) });

    await new PlatformObjectsPlugin().init(ctx);

    const names = manifests.flatMap((m: any) => m.objects.map((o: any) => o.name));
    expect(names).toContain('sys_secret');
  });

  it('degrades silently without a manifest service (lean/i18n-only kernels)', async () => {
    const plugin = new PlatformObjectsPlugin();
    const ctx = makeCtx();

    await expect(plugin.init(ctx)).resolves.toBeUndefined();
    await plugin.start(ctx);
    await expect(ctx._flushReady()).resolves.toBeUndefined();
  });
});

describe('PlatformObjectsPlugin: fresh-datastore attestation (#3438, ADR-0104)', () => {
  /** Engine fake with a `sys_migration` table and a settable newness verdict. */
  function engineWith(createdFromEmpty: boolean | undefined) {
    const rows: Array<Record<string, unknown>> = [];
    const engine: any = {
      getObject: (name: string) => (name === 'sys_migration' ? { name } : undefined),
      find: async (_object: string, options: any) =>
        rows.filter((r) => options?.where?.id === undefined || r.id === options.where.id),
      insert: async (_object: string, data: any) => {
        rows.push({ ...data });
        return data;
      },
      // `attestFreshDatastore` never overwrites an existing flag row, so no
      // path this suite drives reaches `update` — the assert comes first
      // anyway, so the day one does, the double refuses what a real server
      // refuses instead of silently accepting it (#4434).
      update: async (_object: string, data: any, options?: Record<string, unknown>) => {
        assertEngineUpdateDispatch(data, options);
        return {};
      },
      rows,
    };
    if (createdFromEmpty !== undefined) {
      engine.wasDatastoreCreatedFromEmpty = () => createdFromEmpty;
    }
    return engine;
  }

  async function boot(engine: unknown) {
    const plugin = new PlatformObjectsPlugin();
    const ctx = makeCtx();
    ctx.registerService('objectql', engine);
    await plugin.init(ctx);
    await plugin.start(ctx);
    await ctx._flushReady();
  }

  it('attests a store this boot created from empty', async () => {
    const engine = engineWith(true);

    await boot(engine);

    expect(engine.rows.map((r: any) => r.id).sort()).toEqual([
      'adr-0104-file-references',
      'adr-0104-value-shapes',
    ]);
    for (const row of engine.rows) {
      expect(row.verified_at).toBeTruthy();
      expect(row.blocking).toBe(0);
    }
  });

  /**
   * The property the whole design rests on: a store that was FOUND — an
   * upgrade, a restart, anything with history — attests nothing and keeps
   * producing its evidence by scan.
   */
  it('attests nothing on a store that already existed', async () => {
    const engine = engineWith(false);

    await boot(engine);

    expect(engine.rows).toHaveLength(0);
  });

  it('attests nothing when the engine cannot say (older engine)', async () => {
    const engine = engineWith(undefined);

    await boot(engine);

    expect(engine.rows).toHaveLength(0);
  });

  it('a failing attestation never breaks the boot', async () => {
    const engine = engineWith(true);
    engine.insert = async () => {
      throw new Error('disk full');
    };

    await expect(boot(engine)).resolves.toBeUndefined();
  });

  it('invalidates the engine memo after attesting (fast-boot race)', async () => {
    const engine = engineWith(true);
    let invalidated = 0;
    engine.invalidateDataMigrationFlags = () => { invalidated++; };

    await boot(engine);

    expect(invalidated).toBe(1);
  });

  /**
   * #4769 — the attestation has to run after the boot's own data has landed.
   * `kernel:ready` alone was too early for a deployment that seeds: the
   * certificate went in while rows contradicting it were still being written,
   * and the next boot enforced it against them.
   */
  describe('timing: after this boot has finished writing (#4769)', () => {
    it('subscribes to app:seeded, the settle point for this boot own seed', async () => {
      const plugin = new PlatformObjectsPlugin();
      const ctx = makeCtx();
      ctx.registerService('objectql', engineWith(true));

      await plugin.init(ctx);
      await plugin.start(ctx);

      expect(ctx._events()).toContain('app:seeded');
    });

    it('attests when the seed settles, without waiting for kernel:ready', async () => {
      const engine = engineWith(true);
      const plugin = new PlatformObjectsPlugin();
      const ctx = makeCtx();
      ctx.registerService('objectql', engine);
      await plugin.init(ctx);
      await plugin.start(ctx);

      await ctx._flush('app:seeded');

      expect(engine.rows.map((r: any) => r.id).sort()).toEqual([
        'adr-0104-file-references',
        'adr-0104-value-shapes',
      ]);
    });

    it('the two passes are one idempotent call — kernel:ready adds nothing after app:seeded', async () => {
      const engine = engineWith(true);
      const plugin = new PlatformObjectsPlugin();
      const ctx = makeCtx();
      ctx.registerService('objectql', engine);
      await plugin.init(ctx);
      await plugin.start(ctx);

      await ctx._flush('app:seeded');
      await ctx._flushReady();

      expect(engine.rows).toHaveLength(2);
    });

    /**
     * The seed's counterexample reaches the attestation through the engine,
     * so a boot that wrote an off-shape value certifies nothing — the
     * end-to-end shape of the #4769 repro, one layer up from the engine's own
     * tests.
     */
    it('a boot whose seed wrote a violating value attests nothing for that gate', async () => {
      const engine = engineWith(true);
      engine.valueShapeViolationsAdmitted = () => ({
        'adr-0104-file-references': {
          count: 10,
          first: { object: 'showcase_task', field: 'cover', type: 'image', detail: 'Expected an opaque sys_file id' },
        },
      });
      const plugin = new PlatformObjectsPlugin();
      const ctx = makeCtx();
      ctx.registerService('objectql', engine);
      await plugin.init(ctx);
      await plugin.start(ctx);

      await ctx._flush('app:seeded');
      await ctx._flushReady();

      expect(engine.rows.map((r: any) => r.id)).toEqual(['adr-0104-value-shapes']);
    });
  });

  /**
   * #4795 — `app:seeded` and `kernel:ready` can arrive in EITHER order.
   *
   * When the inline seed overruns `OS_INLINE_SEED_BUDGET_MS` the runtime hands
   * it to the background, so `kernel:ready` lands first and the #4769 backstop
   * fired mid-seed: it certified the store, flipped the gates to strict, and
   * the tail of the same seed run met a contract its head never saw — one
   * boot, two contracts. Measured on a showcase cold boot at
   * `OS_INLINE_SEED_BUDGET_MS=1`: attestation +0.470s, seed settled +3.617s.
   *
   * The fix asks the published `seed-settlement` contract instead of guessing
   * from the runtime's internal `seed-datasets` array — see the contract's own
   * TSDoc for why an array's presence cannot answer this.
   */
  describe('defers while this boot own seed is still landing (#4795)', () => {
    /** Fake `seed-settlement` service over mutable state a test can advance. */
    function seedSettlementFake(state: {
      inFlight?: number;
      suppressed?: Array<'multi-tenant-replay' | 'skip-seed-data'>;
    }) {
      return {
        snapshot: () => ({
          pending: (state.inFlight ?? 0) + (state.suppressed?.length ?? 0),
          inFlight: state.inFlight ?? 0,
          suppressed: [...(state.suppressed ?? [])],
        }),
      };
    }

    async function bootWithSeed(engine: unknown, state: Parameters<typeof seedSettlementFake>[0]) {
      const plugin = new PlatformObjectsPlugin();
      const ctx = makeCtx();
      ctx.registerService('objectql', engine);
      ctx.registerService('seed-settlement', seedSettlementFake(state));
      await plugin.init(ctx);
      await plugin.start(ctx);
      return ctx;
    }

    /**
     * The nail for this issue: at `kernel:ready` the background seed is still
     * writing, so nothing may be certified yet — and once it settles, the
     * certificate lands normally. One contract for the whole seed run.
     */
    it('kernel:ready writes no attestation while a seed source is still in flight', async () => {
      const engine = engineWith(true);
      const state = { inFlight: 1 };

      const ctx = await bootWithSeed(engine, state);
      await ctx._flushReady();

      expect(engine.rows).toHaveLength(0);

      // The background seed finishes and the runtime emits `app:seeded`.
      state.inFlight = 0;
      await ctx._flush('app:seeded');

      expect(engine.rows.map((r: any) => r.id).sort()).toEqual([
        'adr-0104-file-references',
        'adr-0104-value-shapes',
      ]);
    });

    /**
     * `app:seeded` fires once per config app, so the FIRST one is not the
     * settle point for the boot. Guarding only `kernel:ready` would move the
     * same split-contract window onto multi-app bundles.
     */
    it('an app:seeded from one config app does not certify while another is still writing', async () => {
      const engine = engineWith(true);
      const state = { inFlight: 2 };

      const ctx = await bootWithSeed(engine, state);

      state.inFlight = 1; // app A settled; app B still writing
      await ctx._flush('app:seeded');
      expect(engine.rows).toHaveLength(0);

      state.inFlight = 0; // app B settled
      await ctx._flush('app:seeded');
      expect(engine.rows).toHaveLength(2);
    });

    /**
     * The #4795 ruling (2026-08-06), pinned: a deployment whose seed never runs
     * at boot does not self-certify — it waits for `os migrate`. Falls out of
     * the same predicate rather than needing a branch of its own.
     */
    it.each([
      ['multi-tenant', 'multi-tenant-replay' as const],
      ['skipSeedData', 'skip-seed-data' as const],
    ])('%s: attests nothing at boot, without erroring', async (_label, reason) => {
      const engine = engineWith(true);

      const ctx = await bootWithSeed(engine, { suppressed: [reason] });
      await expect(ctx._flushReady()).resolves.toBeUndefined();

      expect(engine.rows).toHaveLength(0);
    });

    it('says why it stood down, and names the command that closes the gate', async () => {
      const engine = engineWith(true);

      const ctx = await bootWithSeed(engine, { suppressed: ['multi-tenant-replay'] });
      await ctx._flushReady();

      const said = ctx._logs.info.join('\n');
      expect(said).toContain('multi-tenant-replay');
      expect(said).toContain('os migrate value-shapes --apply');
      // A posture that is correct by design must not spend the level that
      // means "something you trusted did not persist" (AGENTS.md).
      expect(ctx._logs.warn.join('\n')).not.toContain('not attesting');
    });

    it('an in-flight deferral says it will be picked up on app:seeded', async () => {
      const engine = engineWith(true);

      const ctx = await bootWithSeed(engine, { inFlight: 1 });
      await ctx._flushReady();

      expect(ctx._logs.info.join('\n')).toContain('app:seeded');
    });

    /**
     * Regression guard for the two paths this change must leave untouched:
     * a seed that fits inside its budget (settled before `kernel:ready`), and
     * a kernel with no seed pipeline at all — the backstop #4769 kept for
     * exactly that case, which is the same moment as before for it.
     */
    it('a settled seed attests at kernel:ready exactly as before', async () => {
      const engine = engineWith(true);

      const ctx = await bootWithSeed(engine, { inFlight: 0 });
      await ctx._flushReady();

      expect(engine.rows.map((r: any) => r.id).sort()).toEqual([
        'adr-0104-file-references',
        'adr-0104-value-shapes',
      ]);
    });

    it('a kernel with no seed pipeline still attests on the kernel:ready backstop', async () => {
      const engine = engineWith(true);
      const plugin = new PlatformObjectsPlugin();
      const ctx = makeCtx();
      ctx.registerService('objectql', engine); // no `seed-settlement` service
      await plugin.init(ctx);
      await plugin.start(ctx);

      await ctx._flushReady();

      expect(engine.rows).toHaveLength(2);
    });

    /**
     * A store that was FOUND was never going to be attested, so announcing a
     * deferral over it would explain a decision nobody was making.
     */
    it('says nothing about deferral on a store that already existed', async () => {
      const ctx = await bootWithSeed(engineWith(false), { inFlight: 1 });
      await ctx._flushReady();

      expect(ctx._logs.info.join('\n')).not.toContain('attestation deferred');
    });
  });
});
