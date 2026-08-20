// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { IDatasourceAdminService, IDatasourceDriverFactory } from '../contracts/index.js';
import type { DatasourceAdminService } from '../datasource-admin-service.js';
import {
  DatasourceAdminServicePlugin,
  type DatasourceAdminServicePluginOptions,
} from '../datasource-admin-plugin.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at MODULE
// LOAD. Each is reached below through a dynamic `import()` inside an `it()` body or a
// hook -- both of which vitest clocks, while collection is clocked against nothing. See
// `scripts/check-test-source-alias.mjs` (the clocked-window rule) and #10115 / PR #10120,
// where the same shape cost 30 ejected merge-queue builds in one night.
import '@objectstack/spec/kernel';

/**
 * Minimal PluginContext + in-memory metadata service. Boots the plugin and
 * returns the registered `datasource-admin` service so we can exercise the
 * plugin's glue (probe via factory, fail-closed secret) end to end.
 */
async function boot(opts: DatasourceAdminServicePluginOptions & {
  services?: Record<string, unknown>;
} = {}) {
  const registry = new Map<string, Map<string, unknown>>();
  const metadata = {
    get: async (t: string, n: string) => registry.get(t)?.get(n),
    list: async (t: string) => [...(registry.get(t)?.values() ?? [])],
    register: async (t: string, n: string, d: unknown) => {
      if (!registry.has(t)) registry.set(t, new Map());
      registry.get(t)!.set(n, d);
    },
    unregister: async (t: string, n: string) => {
      registry.get(t)?.delete(n);
    },
    listObjects: async () => [...(registry.get('object')?.values() ?? [])],
  };

  const services: Record<string, unknown> = { metadata, ...(opts.services ?? {}) };
  let registered: IDatasourceAdminService | undefined;
  const ctx: any = {
    getService: (name: string) => {
      if (name in services) return services[name];
      throw new Error(`no service ${name}`);
    },
    registerService: (name: string, svc: unknown) => {
      if (name === 'datasource-admin') registered = svc as IDatasourceAdminService;
    },
    trigger: async () => {},
    logger: { warn() {}, info() {} },
  };

  const { services: _omit, ...pluginOpts } = opts;
  const plugin = new DatasourceAdminServicePlugin(pluginOpts);
  await plugin.init(ctx);
  return { service: registered!, registry, metadata, plugin, ctx };
}

/** A driver factory whose handle records connect/ping/disconnect calls. */
function fakeFactory(over?: Partial<IDatasourceDriverFactory> & { onProbe?: () => void }): IDatasourceDriverFactory {
  return {
    supports: (id: string) => id === 'postgres',
    create: async (spec) => ({
      connect: async () => {},
      ping: async () => {
        over?.onProbe?.();
        // expose the secret the factory received for assertions
        (globalThis as any).__lastProbeSecret = spec.secret;
      },
      disconnect: async () => {},
      serverVersion: async () => 'PostgreSQL 16.1',
    }),
    ...over,
  };
}

describe('DatasourceAdminServicePlugin: probe', () => {
  it('tests a connection through the driver factory (latency + version)', async () => {
    const { service } = await boot({
      driverFactory: fakeFactory(),
    });
    const res = await service.testConnection(
      { name: 'reporting', driver: 'postgres', config: { host: 'db', database: 'analytics' } },
      { value: 's3cret' },
    );
    expect(res.ok).toBe(true);
    expect(res.serverVersion).toBe('PostgreSQL 16.1');
    expect(typeof res.latencyMs).toBe('number');
    expect((globalThis as any).__lastProbeSecret).toBe('s3cret');
  });

  it('returns ok:false when no factory supports the driver', async () => {
    const { service } = await boot({ driverFactory: fakeFactory() });
    const res = await service.testConnection({ name: 'x', driver: 'oracle', config: {} });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no driver factory supports/i);
  });

  it('returns ok:false when no factory is registered at all', async () => {
    const { service } = await boot();
    const res = await service.testConnection({ name: 'x', driver: 'postgres', config: { database: 'analytics' } });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no driver factory is registered/i);
  });
});

describe('DatasourceAdminServicePlugin: secret fail-closed', () => {
  it('refuses to create a secret-bearing datasource without a secret binder', async () => {
    const { service, registry } = await boot({ driverFactory: fakeFactory() });
    await expect(
      service.createDatasource(
        { name: 'reporting', driver: 'postgres', config: { database: 'analytics' } },
        { value: 'pw' },
      ),
    ).rejects.toThrow(/no secret store configured/i);
    // nothing persisted
    expect(registry.get('datasource')?.size ?? 0).toBe(0);
  });

  it('persists a credentialsRef (not cleartext) when a binder is wired', async () => {
    const bound: string[] = [];
    const { service, registry } = await boot({
      driverFactory: fakeFactory(),
      secrets: {
        bind: async (input, hint) => {
          bound.push(input.value);
          return `sys_secret://datasource/${hint.name}#1`;
        },
      },
    });
    await service.createDatasource(
      { name: 'reporting', driver: 'postgres', config: { database: 'analytics' } },
      { value: 'pw' },
    );
    const rec = registry.get('datasource')?.get('reporting') as any;
    expect(rec.origin).toBe('runtime');
    expect(rec.external?.credentialsRef).toBe('sys_secret://datasource/reporting#1');
    expect(JSON.stringify(rec)).not.toContain('pw');
    expect(bound).toEqual(['pw']);
  });
});

describe('DatasourceAdminServicePlugin: credential re-homing wiring (#8155)', () => {
  /** Seed a legacy row straight into the registry — post-#8078 no door writes one. */
  const seedLegacy = async (metadata: { register: (t: string, n: string, d: unknown) => Promise<void> }) =>
    metadata.register('datasource', 'warehouse', {
      name: 'warehouse',
      driver: 'postgres',
      origin: 'runtime',
      config: { host: 'db.internal', database: 'app', username: 'app', password: 'hunter2' },
    });

  it('re-homes through the host binder when it can bind AND resolve', async () => {
    const store = new Map<string, string>();
    const { service, metadata, registry } = await boot({
      driverFactory: fakeFactory(),
      secrets: {
        bind: async (input, hint) => {
          const ref = `sys_secret://datasource/${hint.name}#1`;
          store.set(ref, input.value);
          return ref;
        },
        resolve: async (ref) => store.get(ref),
      },
    });
    await seedLegacy(metadata);

    const result = await service.migrateCredential('warehouse');

    expect(result).toMatchObject({ status: 'migrated', migratedKey: 'password' });
    const rec = registry.get('datasource')?.get('warehouse') as any;
    expect(rec.config).not.toHaveProperty('password');
    expect(store.get(rec.external.credentialsRef)).toBe('hunter2');
  });

  it('refuses when the host binder cannot READ a secret back', async () => {
    // A binder with `bind` but no `resolve` is exactly the wiring that would
    // produce a ref the connect path refuses (ADR-0062 D3 is fail-closed), so
    // the migration must not write one. Fail-CLOSED, not fail-open: the
    // cleartext stays and the operator is told what to wire.
    const { service, metadata, registry } = await boot({
      driverFactory: fakeFactory(),
      secrets: { bind: async () => 'sys_secret://datasource/warehouse#1' },
    });
    await seedLegacy(metadata);

    const result = await service.migrateCredential('warehouse');

    expect(result.status).toBe('refused');
    expect(result.reason).toContain('readable secret store');
    const rec = registry.get('datasource')?.get('warehouse') as any;
    expect(rec.config.password).toBe('hunter2');
    expect(rec.external?.credentialsRef).toBeUndefined();
  });

  it('contributes the operator-facing Setup action that targets the route', async () => {
    const { getMetadataTypeActions } = await import('@objectstack/spec/kernel');
    await boot({ driverFactory: fakeFactory() });
    const action = getMetadataTypeActions('datasource').find((a) => a.name === 'migrate_credential');
    expect(action).toBeDefined();
    expect(action!.target).toBe('/api/v1/datasources/${ctx.recordId}/migrate-credential');
    expect(action!.method).toBe('POST');
    // The row it acts on CHANGES, so the record must be re-read afterwards —
    // which is also what recomputes the `_diagnostics` badge the operator is
    // working from. Its sibling `test_connection` deliberately does not refresh.
    expect(action!.refreshAfter).toBe(true);
  });
});

describe('DatasourceAdminServicePlugin: boot rehydration', () => {
  /** Fake engine ('data') that records hot-registered drivers. */
  function fakeEngine() {
    const drivers: any[] = [];
    return {
      drivers,
      registerDriver: (d: any) => drivers.push(d),
      registerDatasourceDef: () => {},
      getDriverByName: (n: string) => drivers.find((d) => d.name === n),
    };
  }

  /** Factory that records the spec (incl. resolved secret) of each create(). */
  function recordingFactory() {
    const specs: any[] = [];
    const factory: IDatasourceDriverFactory = {
      supports: (id: string) => id === 'postgres',
      create: async (spec) => {
        specs.push(spec);
        return { connect: async () => {}, disconnect: async () => {} };
      },
    };
    return { factory, specs };
  }

  it('rebuilds runtime pools at start(), decrypting the credentialsRef', async () => {
    const engine = fakeEngine();
    const { factory, specs } = recordingFactory();
    const resolved: string[] = [];

    const { plugin, ctx, registry } = await boot({
      driverFactory: factory,
      services: { data: engine },
      secrets: {
        bind: async () => 'sys_secret:abc',
        resolve: async (ref) => {
          resolved.push(ref);
          return ref === 'sys_secret:abc' ? 'super-secret-pw' : undefined;
        },
      },
    });

    // Simulate a persisted (DB-backed) runtime datasource that survived a restart.
    registry.set(
      'datasource',
      new Map<string, unknown>([
        ['crm_primary', { name: 'crm_primary', driver: 'sqlite', origin: 'code' }],
        [
          'reporting',
          {
            name: 'reporting',
            driver: 'postgres',
            origin: 'runtime',
            active: true,
            config: { host: 'db', database: 'analytics' },
            external: { credentialsRef: 'sys_secret:abc' },
          },
        ],
        [
          'archived',
          { name: 'archived', driver: 'postgres', origin: 'runtime', active: false },
        ],
      ]),
    );

    await plugin.start(ctx);

    // Only the active runtime datasource is rehydrated — not the code one, not the inactive one.
    expect(engine.drivers.map((d) => d.name)).toEqual(['reporting']);
    // The credentialsRef was dereferenced and the cleartext handed to the factory.
    expect(resolved).toEqual(['sys_secret:abc']);
    expect(specs).toHaveLength(1);
    expect(specs[0].secret).toBe('super-secret-pw');
    expect(specs[0].name).toBe('reporting');
  });

  it('does not block boot when nothing is persisted (dev: in-memory store)', async () => {
    const engine = fakeEngine();
    const { factory } = recordingFactory();
    const { plugin, ctx } = await boot({ driverFactory: factory, services: { data: engine } });
    await expect(plugin.start(ctx)).resolves.toBeUndefined();
    expect(engine.drivers).toHaveLength(0);
  });
});

describe('DatasourceAdminServicePlugin: persistence + bound count', () => {
  it('lists code (artefact) + runtime records with origin, blocks remove while bound', async () => {
    const { service, registry } = await boot({ driverFactory: fakeFactory() });
    // seed an artefact (code) datasource lacking explicit origin
    registry.set('datasource', new Map([['crm_primary', { name: 'crm_primary', driver: 'sqlite' }]]));
    // seed an object bound to a runtime datasource
    registry.set('object', new Map([['lead', { name: 'lead', datasource: 'reporting' }]]));

    await service.createDatasource({ name: 'reporting', driver: 'postgres', config: { database: 'analytics' } });

    const list = await service.listDatasources();
    expect(list.find((d) => d.name === 'crm_primary')?.origin).toBe('code');
    expect(list.find((d) => d.name === 'reporting')?.origin).toBe('runtime');

    await expect(service.removeDatasource('reporting')).rejects.toThrow(/1 object\(s\)/);
  });
});

describe('DatasourceAdminServicePlugin: runtime datasource durability', () => {
  /** In-memory `sys_metadata` engine shared across two boots (a "restart"). */
  function fakeSysMetadataEngine() {
    const rows: Array<Record<string, unknown>> = [];
    return {
      rows,
      registerDriver() {},
      registerDatasourceDef() {},
      getDriverByName() { return undefined; },
      findOne: async (_o: string, q: { where?: Record<string, unknown> }) => {
        const w = q.where ?? {};
        return rows.find((r) => Object.entries(w).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }));
      },
      find: async (_o: string, q: { where?: Record<string, unknown> }) => {
        const w = q.where ?? {};
        return rows.filter((r) => Object.entries(w).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }));
      },
      insert: async (_o: string, row: Record<string, unknown>) => { rows.push({ ...row }); },
      update: async (_o: string, row: Record<string, unknown>, opts: { where: Record<string, unknown> }) => {
        const i = rows.findIndex((r) => r.id === opts.where.id);
        if (i >= 0) rows[i] = { ...rows[i], ...row };
      },
      delete: async (_o: string, opts: { where: Record<string, unknown> }) => {
        const i = rows.findIndex((r) => r.id === opts.where.id);
        if (i >= 0) rows.splice(i, 1);
      },
    };
  }

  it('persists a UI-created datasource to sys_metadata and restores it after a restart', async () => {
    const data = fakeSysMetadataEngine();

    // Boot #1: create a runtime sqlite datasource (no secret needed).
    const b1 = await boot({ services: { data } });
    await b1.service.createDatasource({ name: 'demo_ext', driver: 'sqlite', config: { filename: '/tmp/x.db' } });
    // It is durably written to sys_metadata (not just the in-memory registry).
    expect(data.rows.filter((r) => r.type === 'datasource' && r.name === 'demo_ext')).toHaveLength(1);

    // Boot #2 = "restart": fresh in-memory registry, SAME sys_metadata engine.
    const b2 = await boot({ services: { data } });
    // Before restore, the fresh registry is empty.
    expect(await b2.service.listDatasources()).toHaveLength(0);
    // start() restores runtime rows from sys_metadata into the registry.
    await b2.plugin.start(b2.ctx);
    const after = await b2.service.listDatasources();
    expect(after.map((d) => d.name)).toContain('demo_ext');
    expect(after.find((d) => d.name === 'demo_ext')?.origin).toBe('runtime');
  });

  // #4456 — this restore path is a stored-row rehydration seam (ADR-0087 D2
  // addendum, #3903): it reads sys_metadata directly, so it must replay the
  // conversion chain itself. A row persisted before the #4410 config gate may
  // carry the legacy spellings the factory's deleted `??` fallbacks used to
  // tolerate; without the replay, a sqlite `file:` row would silently fall
  // back to `:memory:` — the data-loss shape the conversion exists to prevent.
  it('restores a pre-#4410 row with legacy config keys CANONICAL (conversion chain replayed)', async () => {
    const data = fakeSysMetadataEngine();
    const now = new Date().toISOString();
    for (const [name, driver, config] of [
      ['legacy_sqlite', 'sqlite', { file: '/tmp/legacy.db' }],
      ['legacy_pg', 'postgres', { connectionString: 'postgresql://db.internal/analytics', user: 'analyst' }],
      ['legacy_mongo', 'mongo', { uri: 'mongodb://mongo.internal:27017/events' }],
    ] as const) {
      data.rows.push({
        id: `meta_${name}`,
        name,
        type: 'datasource',
        scope: 'platform',
        metadata: JSON.stringify({ name, driver, config, origin: 'runtime' }),
        state: 'active',
        version: 1,
        created_at: now,
        updated_at: now,
      });
    }

    const b = await boot({ services: { data } });
    await b.plugin.start(b.ctx);
    // The list DTO is a summary; `getDatasource` (concrete service) is the
    // config-bearing read the admin routes serve.
    const svc = b.service as unknown as DatasourceAdminService;
    expect((await svc.getDatasource('legacy_sqlite'))?.config).toEqual({ filename: '/tmp/legacy.db' });
    expect((await svc.getDatasource('legacy_pg'))?.config).toEqual({
      url: 'postgresql://db.internal/analytics',
      username: 'analyst',
    });
    expect((await svc.getDatasource('legacy_mongo'))?.config).toEqual({
      url: 'mongodb://mongo.internal:27017/events',
    });
  });

  it('removes the durable sys_metadata row when a datasource is deleted', async () => {
    const data = fakeSysMetadataEngine();
    const b = await boot({ services: { data } });
    await b.service.createDatasource({ name: 'gone', driver: 'sqlite', config: { filename: '/tmp/y.db' } });
    expect(data.rows.some((r) => r.name === 'gone')).toBe(true);
    await b.service.removeDatasource('gone');
    expect(data.rows.some((r) => r.name === 'gone')).toBe(false);
  });
});
