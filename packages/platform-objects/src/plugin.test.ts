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
import { SysMigration, SysMigrationJournal, SysSecret } from './system/index.js';

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

    expect(manifests).toHaveLength(1);
    expect(manifests[0].id).toBe('com.objectstack.platform-objects');
    expect(manifests[0].scope).toBe('system');
    expect(manifests[0].objects).toEqual([SysMigration, SysMigrationJournal, SysSecret]);
    expect(manifests[0].objects.map((o: any) => o.name)).toEqual([
      'sys_migration',
      // ADR-0119 D2 (#4617). Registered UNCONDITIONALLY, alongside the flag
      // ledger rather than by the migration CLI that writes it: recovery has
      // to be discoverable with zero host wiring, and a journal some kernels
      // compose and others do not is a journal a boot scanner cannot rely on.
      'sys_migration_journal',
      'sys_secret',
    ]);
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
});
