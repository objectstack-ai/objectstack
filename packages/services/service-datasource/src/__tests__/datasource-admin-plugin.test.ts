// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import type { IDatasourceAdminService, IDatasourceDriverFactory } from '../contracts/index.js';
import type { DatasourceAdminService } from '../datasource-admin-service.js';
import {
  DatasourceAdminServicePlugin,
  type DatasourceAdminServicePluginOptions,
} from '../datasource-admin-plugin.js';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';
import { ENTITLED_CREDENTIAL, createSessionAuthService, createGrantsEngine } from './entitled-caller.fixture.js';

import { assertEngineFindOnePredicate, hashSpec } from '@objectstack/metadata-core';

// [#10126] Pay the first transform of these dist-resolved workspace deps at MODULE
// LOAD. Each is reached below through a dynamic `import()` inside an `it()` body or a
// hook -- both of which vitest clocks, while collection is clocked against nothing. See
// `scripts/check-test-source-alias.mjs` (the clocked-window rule) and #10115 / PR #10120,
// where the same shape cost 30 ejected merge-queue builds in one night.
//
// Order is NO LONGER load-bearing (#12555 landed). The import regex in
// check-test-source-alias used to swallow a bare side-effect import whenever an
// `import … from …` followed it later in the file, so this statement had to stay BELOW
// every `from` import or the clocked-window rule reported this file as unpaid while the
// line it asks for was already here. That clause capture is now bounded to one
// statement, and both orderings read correctly — pinned by that gate's `--self-test`,
// which is what guards this file now rather than the position of the line below.
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

/** The admin door, mounted the way `os serve` mounts it, over a booted service. */
function adminDoor(service: unknown) {
  const server = new HonoHttpServer(0);
  const authService = createSessionAuthService();
  const grantsEngine = createGrantsEngine();
  registerDatasourceAdminRoutes(server, {
    getService: (name: string) =>
      name === 'auth' ? authService : name === 'objectql' || name === 'data' ? grantsEngine : service,
  } as any, '/api/v1');
  return (method: string, path: string, body?: unknown) =>
    server.getRawApp().fetch(new Request(`http://local/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: ENTITLED_CREDENTIAL },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
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
    // [#21923] An artefact (code) datasource is code because the host registers
    // its name from code — the code-datasource set the runtime fills, as it
    // does for every datasource an artifact declares — never because its
    // record lacks an explicit `origin`.
    const { service, registry } = await boot({
      driverFactory: fakeFactory(),
      services: { 'code-datasource-names': new Set(['crm_primary']) },
    });
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
        assertEngineFindOnePredicate(_o, q);
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

  // [#21922 / #21944] Code wins on collision at the boot restore. The host's
  // code-datasource set (the kernel service the runtime fills in Phase 1) is
  // what decides "code" — never the stored row's own `origin`, which the shadow
  // rows below deliberately assert as `runtime`, the shape an earlier
  // `/meta` save could leave. That fixture choice is load-bearing: were the row
  // registered, the slot would read `origin: 'runtime'` and the admin door would
  // let the edit through, so the refusal below cannot be green by the admin
  // read's own `origin ?? 'code'` default.
  describe('[#21922] a stored row never displaces a code datasource at the restore', () => {
    const CODE_NAMES = 'code-datasource-names';
    const now = new Date().toISOString();
    const storedRow = (name: string, body: Record<string, unknown>) => ({
      id: `meta_${name}`,
      name,
      type: 'datasource',
      scope: 'platform',
      metadata: JSON.stringify({ name, ...body }),
      state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    });
    /** The code twin's stored shadow: another label, another connection, `origin: 'runtime'`. */
    const SHADOW = { label: 'Shadow', driver: 'postgres', origin: 'runtime', active: true, config: { host: 'shadow-host', database: 'shadow' } };
    /** What the runtime registered from code, as `AppPlugin.start()` stamps it. */
    const CODE = { name: 'crm_wh', label: 'Code warehouse', driver: 'postgres', origin: 'code', config: { host: 'code-host', database: 'wh' } };

    /** `sys_metadata` plus a driver registry, and a factory recording each pool it builds. */
    const harness = async (opts: { codeNames?: Set<string>; codeSlotFirst: boolean; withOptionsLogger?: boolean }) => {
      const data = Object.assign(fakeSysMetadataEngine(), {
        drivers: [] as any[],
      });
      (data as any).registerDriver = (d: any) => data.drivers.push(d);
      (data as any).getDriverByName = (n: string) => data.drivers.find((d) => d.name === n);
      data.rows.push(storedRow('crm_wh', SHADOW));
      data.rows.push(storedRow('rt_wh', { label: 'Runtime', driver: 'postgres', origin: 'runtime', active: true, config: { host: 'rt-host', database: 'rt' } }));
      const built: any[] = [];
      const factory: IDatasourceDriverFactory = {
        supports: (id: string) => id === 'postgres',
        create: async (spec) => {
          built.push(spec);
          return { connect: async () => {}, disconnect: async () => {} };
        },
      };
      const optionsWarn = vi.fn();
      const b = await boot({
        driverFactory: factory,
        ...(opts.withOptionsLogger ? { logger: { warn: optionsWarn, info: () => {} } } : {}),
        services: { data, ...(opts.codeNames ? { [CODE_NAMES]: opts.codeNames } : {}) },
      });
      const ctxWarn = vi.fn();
      b.ctx.logger = { warn: ctxWarn, info: () => {} };
      // `AppPlugin.start()` registering the code definition before this
      // plugin's start(), or after it — the kernel orders the two by
      // insertion alone, so both must hold.
      if (opts.codeSlotFirst) await b.metadata.register('datasource', CODE.name, CODE);
      await b.plugin.start(b.ctx);
      return { ...b, data, built, optionsWarn, ctxWarn };
    };

    it('keeps the code definition served, refuses the admin edit, keeps the row, names it, and opens no pool from it', async () => {
      const b = await harness({ codeNames: new Set(['crm_wh']), codeSlotFirst: true });

      expect(await b.metadata.get('datasource', 'crm_wh')).toEqual(CODE);
      const listed = await b.service.listDatasources();
      expect(listed.find((d) => d.name === 'crm_wh')).toMatchObject({ origin: 'code', label: 'Code warehouse' });

      const patch = await adminDoor(b.service)('PATCH', '/datasources/crm_wh', { label: 'Edited at runtime' });
      const answer = (await patch.json()) as { error?: { code?: string; message?: string } };
      expect({ status: patch.status, code: answer.error?.code }).toEqual({ status: 400, code: 'DATASOURCE_ADMIN_ERROR' });
      expect(String(answer.error?.message).startsWith("Datasource 'crm_wh' is code-defined"), answer.error?.message).toBe(true);

      // Kept, not dropped: it is the repair target the `/meta` door removes.
      expect(b.data.rows.filter((r) => r.name === 'crm_wh')).toHaveLength(1);
      expect(b.ctxWarn).toHaveBeenCalledTimes(1);
      expect(String(b.ctxWarn.mock.calls[0][0])).toContain("stored row for 'crm_wh'");
      expect(String(b.ctxWarn.mock.calls[0][0])).toContain('DELETE /api/v1/meta/datasource/crm_wh');

      // No pool was built from the shadow's connection; the runtime row's was.
      expect(b.built.map((s) => s.name)).toEqual(['rt_wh']);
      expect(b.data.drivers.map((d) => d.name)).toEqual(['rt_wh']);
    });

    it('holds when the code registration lands AFTER the restore: the row is still not registered and no pool opens from it', async () => {
      const b = await harness({ codeNames: new Set(['crm_wh']), codeSlotFirst: false });

      expect(await b.metadata.get('datasource', 'crm_wh')).toBeUndefined();
      expect(b.built.map((s) => s.name)).toEqual(['rt_wh']);
      expect(b.data.rows.filter((r) => r.name === 'crm_wh')).toHaveLength(1);
    });

    it('a runtime datasource with no code twin still restores, with its pool', async () => {
      const b = await harness({ codeNames: new Set(['crm_wh']), codeSlotFirst: true });

      expect(await b.metadata.get('datasource', 'rt_wh')).toMatchObject({ name: 'rt_wh', origin: 'runtime', label: 'Runtime' });
      expect((await b.service.listDatasources()).find((d) => d.name === 'rt_wh')).toMatchObject({ origin: 'runtime' });
      expect(b.data.drivers.map((d) => d.name)).toContain('rt_wh');
    });

    it('the warning goes to the host-passed logger when there is one', async () => {
      const b = await harness({ codeNames: new Set(['crm_wh']), codeSlotFirst: true, withOptionsLogger: true });

      expect(b.optionsWarn).toHaveBeenCalledWith(expect.stringContaining("stored row for 'crm_wh'"));
      expect(b.ctxWarn).not.toHaveBeenCalled();
    });

    it('a host that registers no code-datasource set restores every stored row, as before', async () => {
      const b = await harness({ codeSlotFirst: false });

      expect(await b.metadata.get('datasource', 'crm_wh')).toMatchObject({ origin: 'runtime', label: 'Shadow' });
      expect(b.ctxWarn).not.toHaveBeenCalled();
    });
  });

  // [#21923] The admin door's origin comes from PROVENANCE — the host's
  // code-datasource set — never from the record, and a datasource the `/meta`
  // door writes reaches this door in the same boot. The `/meta` door's write
  // is simulated the way it lands: a row in `sys_metadata`, then the protocol's
  // awaited `datasource` mutation projector, which is exactly what the plugin
  // registers (the real door and repository are pinned over the showcase in
  // `packages/qa/dogfood/test/datasource-meta-door-reaches-admin-door.dogfood.test.ts`).
  describe('[#21923] origin from provenance; the /meta door reaches the admin door in the same boot', () => {
    const CODE_NAMES = 'code-datasource-names';
    const now = new Date().toISOString();
    /** A row the `/meta` door's repository writes: the author's body as given, with its checksum. */
    const metaRow = (name: string, body: Record<string, unknown>) => ({
      id: `meta_${name}`,
      name,
      type: 'datasource',
      metadata: JSON.stringify({ name, ...body }),
      checksum: hashSpec({ name, ...body }, 'datasource'),
      state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    });
    const pg = (host: string) => ({ driver: 'postgres', config: { host, database: 'db' } });
    /** What `AppPlugin.start()` registers for a code datasource. */
    const CODE = { name: 'crm_wh', label: 'Code warehouse', driver: 'postgres', origin: 'code', config: { host: 'code-host', database: 'wh' } };

    /** One host: `sys_metadata` + a driver registry, a recording factory, the protocol's projector slot. */
    const host = async (opts: { codeNames?: Set<string> } = {}) => {
      const data = Object.assign(fakeSysMetadataEngine(), { drivers: [] as any[], evicted: [] as string[] });
      (data as any).registerDriver = (d: any) => data.drivers.push(d);
      (data as any).getDriverByName = (n: string) => data.drivers.find((d) => d.name === n);
      (data as any).unregisterDriver = (n: string) => {
        data.evicted.push(n);
        const i = data.drivers.findIndex((d) => d.name === n);
        if (i >= 0) data.drivers.splice(i, 1);
        return i >= 0;
      };
      const built: any[] = [];
      const factory: IDatasourceDriverFactory = {
        supports: (id: string) => id === 'postgres',
        create: async (spec) => {
          built.push(spec);
          return { connect: async () => {}, disconnect: async () => {} };
        },
      };
      const projectors = new Map<string, (evt: unknown) => Promise<void>>();
      const protocol = {
        registerMutationProjector: (type: string, projector: (evt: unknown) => Promise<void>) => {
          projectors.set(type, projector);
        },
      };
      const b = await boot({
        driverFactory: factory,
        services: { data, protocol, ...(opts.codeNames ? { [CODE_NAMES]: opts.codeNames } : {}) },
      });
      await b.metadata.register('datasource', CODE.name, CODE);
      await b.plugin.start(b.ctx);
      /** The `/meta` door's post-persistence step: the awaited projection, with the event it sends. */
      const metaDoorWrote = (name: string, state: 'active' | 'draft' | 'deleted') =>
        projectors.get('datasource')!({ type: 'datasource', name, state, organizationId: null });
      const listed = async (name: string) => (await b.service.listDatasources()).find((d) => d.name === name);
      const builtFor = (name: string) => built.filter((s) => s.name === name);
      return { ...b, data, built, builtFor, projectors, metaDoorWrote, listed };
    };

    it('serves code only for a name in the code-datasource set, and runtime for every other, whatever the record says', async () => {
      const b = await host({ codeNames: new Set(['crm_wh']) });
      await b.metadata.register('datasource', 'crm_wh', { ...CODE, origin: 'runtime' });
      await b.metadata.register('datasource', 'rt_none', { name: 'rt_none', label: 'No origin', ...pg('a') });
      await b.metadata.register('datasource', 'rt_code', { name: 'rt_code', label: 'Asserts code', origin: 'code', ...pg('b') });

      expect((await b.listed('crm_wh'))?.origin).toBe('code');
      expect((await b.listed('rt_none'))?.origin).toBe('runtime');
      expect((await b.listed('rt_code'))?.origin).toBe('runtime');
      const svc = b.service as unknown as DatasourceAdminService;
      expect((await svc.getDatasource('crm_wh'))?.origin).toBe('code');
      expect((await svc.getDatasource('rt_none'))?.origin).toBe('runtime');
      expect((await svc.getDatasource('rt_code'))?.origin).toBe('runtime');

      // Editable as runtime, both of them; the code name stays refused.
      await expect(b.service.updateDatasource('rt_none', { label: 'Edited' })).resolves.toMatchObject({ origin: 'runtime' });
      await expect(b.service.updateDatasource('rt_code', { label: 'Edited' })).resolves.toMatchObject({ origin: 'runtime' });
      const patch = await adminDoor(b.service)('PATCH', '/datasources/crm_wh', { label: 'Edited at runtime' });
      const answer = (await patch.json()) as { error?: { code?: string; message?: string } };
      expect({ status: patch.status, code: answer.error?.code }).toEqual({ status: 400, code: 'DATASOURCE_ADMIN_ERROR' });
      expect(String(answer.error?.message).startsWith("Datasource 'crm_wh' is code-defined"), answer.error?.message).toBe(true);
    });

    it('registers the datasource projector on the protocol at start()', async () => {
      const b = await host();
      expect([...b.projectors.keys()]).toEqual(['datasource']);
    });

    it('a /meta save is listed and editable here in the same boot, with a live pool, whatever origin its body asserts', async () => {
      const b = await host({ codeNames: new Set(['crm_wh']) });
      b.data.rows.push(metaRow('meta_none', { label: 'Meta none', ...pg('h1') }));
      b.data.rows.push(metaRow('meta_code', { label: 'Meta code', origin: 'code', ...pg('h2') }));
      await b.metaDoorWrote('meta_none', 'active');
      await b.metaDoorWrote('meta_code', 'active');

      expect(await b.listed('meta_none')).toMatchObject({ origin: 'runtime', label: 'Meta none' });
      expect(await b.listed('meta_code')).toMatchObject({ origin: 'runtime', label: 'Meta code' });
      expect(b.builtFor('meta_none').map((s) => s.config)).toEqual([{ host: 'h1', database: 'db' }]);
      expect(b.builtFor('meta_code').map((s) => s.config)).toEqual([{ host: 'h2', database: 'db' }]);
      await expect(b.service.updateDatasource('meta_code', { label: 'Edited here' })).resolves.toMatchObject({ origin: 'runtime' });
    });

    it('a /meta edit rebuilds the pool from the new row; a /meta delete leaves this door and evicts the pool', async () => {
      const b = await host();
      b.data.rows.push(metaRow('meta_ds', { label: 'v1', ...pg('h1') }));
      await b.metaDoorWrote('meta_ds', 'active');

      const i = b.data.rows.findIndex((r) => r.name === 'meta_ds');
      b.data.rows[i] = metaRow('meta_ds', { label: 'v2', ...pg('h2') });
      await b.metaDoorWrote('meta_ds', 'active');
      expect(await b.listed('meta_ds')).toMatchObject({ origin: 'runtime', label: 'v2' });
      expect(b.builtFor('meta_ds').map((s) => s.config.host)).toEqual(['h1', 'h2']);

      b.data.rows.splice(b.data.rows.findIndex((r) => r.name === 'meta_ds'), 1);
      await b.metaDoorWrote('meta_ds', 'deleted');
      expect(await b.listed('meta_ds')).toBeUndefined();
      expect(b.data.evicted).toContain('meta_ds');
    });

    it('a /meta write under a code name — the repair DELETE of a stored shadow included — leaves the code definition served and opens no pool', async () => {
      const b = await host({ codeNames: new Set(['crm_wh']) });
      b.data.rows.push(metaRow('crm_wh', { label: 'Shadow', origin: 'runtime', ...pg('shadow-host') }));
      await b.metaDoorWrote('crm_wh', 'active');
      expect(await b.metadata.get('datasource', 'crm_wh')).toEqual(CODE);

      b.data.rows.splice(b.data.rows.findIndex((r) => r.name === 'crm_wh'), 1);
      await b.metaDoorWrote('crm_wh', 'deleted');
      expect(await b.metadata.get('datasource', 'crm_wh')).toEqual(CODE);
      expect((await b.listed('crm_wh'))?.origin).toBe('code');
      expect(b.builtFor('crm_wh')).toEqual([]);
      expect(b.data.evicted).toEqual([]);
    });

    it('a peer signal pools a stored row by provenance: never one under a code name, and a /meta row with no origin as runtime', async () => {
      const b = await host({ codeNames: new Set(['crm_wh']) });
      const handlers: Array<(msg: { payload: unknown }) => void> = [];
      const bus = {
        publish: async () => {},
        subscribe: (_channel: string, handler: (msg: { payload: unknown }) => void) => {
          handlers.push(handler);
          return () => {};
        },
      };
      (b.service as unknown as DatasourceAdminService).attachDatasourceMutationPubSub(bus as never, 'node-b');
      b.data.rows.push(metaRow('crm_wh', { label: 'Shadow', origin: 'runtime', ...pg('shadow-host') }));
      b.data.rows.push(metaRow('peer_meta', { label: 'Peer meta', ...pg('peer-host') }));

      for (const name of ['crm_wh', 'peer_meta']) for (const h of handlers) h({ payload: { originNode: 'node-a', name } });
      await new Promise((r) => setTimeout(r, 0));

      expect(b.builtFor('crm_wh')).toEqual([]);
      expect(b.builtFor('peer_meta').map((s) => s.config.host)).toEqual(['peer-host']);
    });

    it('an admin-written row carries the checksum the /meta door\'s repository stamps on the body it stores', async () => {
      const b = await host();
      await b.service.createDatasource({ name: 'ck_ds', label: 'v1', driver: 'postgres', config: { host: 'h', database: 'db' } });
      const row = () => b.data.rows.find((r) => r.name === 'ck_ds')!;
      expect(row().checksum).toBe(hashSpec(JSON.parse(row().metadata as string), 'datasource'));

      await b.service.updateDatasource('ck_ds', { label: 'v2' });
      expect(JSON.parse(row().metadata as string).label).toBe('v2');
      expect(row().checksum).toBe(hashSpec(JSON.parse(row().metadata as string), 'datasource'));
    });
  });
});
