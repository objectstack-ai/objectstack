// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
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
      if (event === 'kernel:ready') hooks.push(fn);
    },
    _flushReady: async () => { for (const h of hooks) await h(); },
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
      update: async () => ({}),
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
});
