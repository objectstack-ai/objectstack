// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  DatasourceConnectionService,
  isDatasourceAddressed,
  type ConnectableDatasource,
  type ConnectionEngineLike,
} from '../datasource-connection-service.js';
import type { IDatasourceDriverFactory } from '../contracts/datasource-driver-factory.js';
import type { DatasourceConnectPolicy } from '../contracts/connect-policy.js';

/** A fake engine recording driver registration + schema syncs. */
function fakeEngine() {
  const drivers = new Map<string, { name?: string }>();
  const defs: Array<{ name: string; schemaMode?: string }> = [];
  const synced: string[] = [];
  const engine: ConnectionEngineLike & { drivers: typeof drivers; defs: typeof defs; synced: string[] } = {
    drivers,
    defs,
    synced,
    registerDriver: (driver: any) => {
      if (drivers.has(driver.name)) return; // mirror engine's skip-if-present
      drivers.set(driver.name, driver);
    },
    registerDatasourceDef: (def) => {
      defs.push(def);
    },
    getDriverByName: (name) => drivers.get(name),
    syncObjectSchema: async (name) => {
      synced.push(name);
    },
  };
  return engine;
}

/** A fake factory that builds a trivial connectable handle. */
function fakeFactory(opts: { supports?: (id: string) => boolean; connectThrows?: boolean } = {}): IDatasourceDriverFactory {
  return {
    supports: opts.supports ?? (() => true),
    create: vi.fn(async () => {
      const driver: any = { name: 'com.fake.driver' };
      return {
        driver,
        connect: opts.connectThrows
          ? async () => {
              throw new Error('connection refused');
            }
          : async () => {
              driver.connected = true;
            },
      };
    }),
  };
}

function svc(over: {
  factory?: IDatasourceDriverFactory | undefined;
  engine?: ConnectionEngineLike | undefined;
  policy?: DatasourceConnectPolicy;
  secrets?: { resolve?: (ref: string) => Promise<string | undefined> };
} = {}) {
  const engine = over.engine === undefined ? fakeEngine() : over.engine;
  const factory = over.factory === undefined ? fakeFactory() : over.factory;
  const service = new DatasourceConnectionService({
    factory: () => factory ?? undefined,
    engine: () => engine ?? undefined,
    policy: over.policy,
    secrets: over.secrets,
  });
  return { service, engine: engine as ReturnType<typeof fakeEngine> | undefined, factory };
}

const externalDs: ConnectableDatasource = {
  name: 'warehouse',
  driver: 'sqlite',
  schemaMode: 'external',
  config: { filename: '/tmp/w.db' },
  external: { allowWrites: false, validation: { onMismatch: 'warn' } },
};

describe('isDatasourceAddressed (ADR-0062 D2 gate)', () => {
  it('connects external datasources (a)', () => {
    expect(isDatasourceAddressed({ name: 'x', schemaMode: 'external' }, { objects: [] })).toBe(true);
    expect(isDatasourceAddressed({ name: 'x', schemaMode: 'validate-only' }, { objects: [] })).toBe(true);
  });

  it('connects when an object explicitly binds via object.datasource (b)', () => {
    expect(
      isDatasourceAddressed({ name: 'reporting', schemaMode: 'managed' }, { objects: [{ name: 'o', datasource: 'reporting' }] }),
    ).toBe(true);
  });

  it('connects when autoConnect:true (c)', () => {
    expect(isDatasourceAddressed({ name: 'x', schemaMode: 'managed', autoConnect: true }, { objects: [] })).toBe(true);
  });

  it('does NOT connect a managed datasource that is only mapped / unrouted (app-crm byte-for-byte unchanged)', () => {
    // app-crm: crm_primary is managed + referenced by datasourceMapping only,
    // crm_analytics is managed + unrouted. Neither has an object binding.
    expect(isDatasourceAddressed({ name: 'crm_primary', schemaMode: 'managed' }, { objects: [] })).toBe(false);
    expect(isDatasourceAddressed({ name: 'crm_analytics', schemaMode: 'managed' }, { objects: [] })).toBe(false);
    // An object bound to a DIFFERENT datasource must not flip the gate.
    expect(
      isDatasourceAddressed({ name: 'crm_primary', schemaMode: 'managed' }, { objects: [{ name: 'acct', datasource: 'default' }] }),
    ).toBe(false);
  });
});

describe('DatasourceConnectionService.connect', () => {
  it('builds, connects, stamps the datasource name, and registers the driver + def', async () => {
    const { service, engine, factory } = svc();
    const result = await service.connect(externalDs, { objects: ['ext_customer'] });
    expect(result.status).toBe('connected');
    expect(factory.create).toHaveBeenCalledOnce();
    // Driver registered under the DATASOURCE name (engine routes by driver.name).
    expect(engine!.drivers.has('warehouse')).toBe(true);
    expect(engine!.drivers.get('warehouse')!.name).toBe('warehouse');
    // Datasource definition recorded for the write gate.
    expect(engine!.defs).toEqual([{ name: 'warehouse', schemaMode: 'external', external: externalDs.external }]);
    // Bound external objects got read metadata synced (DDL-free).
    expect(engine!.synced).toEqual(['ext_customer']);
  });

  it('is idempotent — an already-registered driver is skipped (onEnable escape hatch)', async () => {
    const { service, engine, factory } = svc();
    engine!.drivers.set('warehouse', { name: 'warehouse' }); // pretend onEnable registered it
    const result = await service.connect(externalDs, { objects: ['ext_customer'] });
    expect(result.status).toBe('already-registered');
    expect(factory.create).not.toHaveBeenCalled();
    expect(engine!.synced).toEqual([]); // no double sync
  });

  it('resolves external.credentialsRef via the secret resolver before building', async () => {
    const resolve = vi.fn(async () => 's3cr3t');
    const create = vi.fn(async () => ({ driver: { name: 'd' }, connect: async () => {} }));
    const factory: IDatasourceDriverFactory = { supports: () => true, create };
    const { service } = svc({ factory, secrets: { resolve } });
    await service.connect({ ...externalDs, external: { ...externalDs.external, credentialsRef: 'secret:wh/pw' } });
    expect(resolve).toHaveBeenCalledWith('secret:wh/pw');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ secret: 's3cr3t' }));
  });

  it('respects a deny policy — left unconnected, metadata-only', async () => {
    const policy: DatasourceConnectPolicy = { canConnect: () => ({ allow: false, reason: 'egress blocked' }) };
    const { service, engine, factory } = svc({ policy });
    const result = await service.connect(externalDs);
    expect(result.status).toBe('skipped-policy');
    expect(result.reason).toBe('egress blocked');
    expect(factory.create).not.toHaveBeenCalled();
    expect(engine!.drivers.size).toBe(0);
  });

  it('treats a throwing policy as a denial (fail-closed)', async () => {
    const policy: DatasourceConnectPolicy = {
      canConnect: () => {
        throw new Error('policy backend down');
      },
    };
    const { service, engine } = svc({ policy });
    const result = await service.connect(externalDs);
    expect(result.status).toBe('skipped-policy');
    expect(engine!.drivers.size).toBe(0);
  });

  it('degrades (no throw) when there is no factory / engine', async () => {
    const noFactory = new DatasourceConnectionService({ factory: () => undefined, engine: () => fakeEngine() });
    expect((await noFactory.connect(externalDs)).status).toBe('skipped-no-infra');
    const noEngine = new DatasourceConnectionService({ factory: () => fakeFactory(), engine: () => undefined });
    expect((await noEngine.connect(externalDs)).status).toBe('skipped-no-infra');
  });

  describe('D5 connect-failure policy', () => {
    const failExternal: ConnectableDatasource = {
      ...externalDs,
      external: { allowWrites: false, validation: { onMismatch: 'fail' } },
    };

    it('fail-fast: a declared-auto external + onMismatch:fail re-throws (bricks boot)', async () => {
      const { service } = svc({ factory: fakeFactory({ connectThrows: true }) });
      await expect(
        service.connect(failExternal, { context: { trigger: 'declared-auto' } }),
      ).rejects.toThrow(/fail-fast/);
    });

    it('degrade: the SAME datasource connected via runtime-admin never bricks the server', async () => {
      const { service } = svc({ factory: fakeFactory({ connectThrows: true }) });
      const result = await service.connect(failExternal, { context: { trigger: 'runtime-admin' } });
      expect(result.status).toBe('failed-degraded');
    });

    it('degrade: external + onMismatch:warn degrades even at boot', async () => {
      const { service } = svc({ factory: fakeFactory({ connectThrows: true }) });
      const result = await service.connect(externalDs, { context: { trigger: 'declared-auto' } });
      expect(result.status).toBe('failed-degraded');
    });
  });
});

describe('DatasourceConnectionService.connectDeclared', () => {
  it('connects only the gated datasources and syncs each one’s bound objects', async () => {
    const { service, engine, factory } = svc();
    const datasources: ConnectableDatasource[] = [
      externalDs, // external → connect
      { name: 'crm_primary', driver: 'sqlite', schemaMode: 'managed', config: { filename: ':memory:' } }, // managed+unrouted → skip
      { name: 'reporting', driver: 'sqlite', schemaMode: 'managed', config: {} }, // managed but object-bound → connect
    ];
    const objects = [
      { name: 'ext_customer', datasource: 'warehouse' },
      { name: 'report_row', datasource: 'reporting' },
      { name: 'account', datasource: 'default' }, // routes to default → no effect
    ];
    const results = await service.connectDeclared({ datasources, objects });
    const byName = Object.fromEntries(results.map((r) => [r.name, r.status]));
    expect(byName).toEqual({ warehouse: 'connected', reporting: 'connected' });
    expect(engine!.drivers.has('crm_primary')).toBe(false); // unchanged
    expect(engine!.drivers.has('warehouse')).toBe(true);
    expect(engine!.drivers.has('reporting')).toBe(true);
    expect(engine!.synced.sort()).toEqual(['ext_customer', 'report_row']);
    expect(factory.create).toHaveBeenCalledTimes(2);
  });

  it('skips inactive datasources', async () => {
    const { service, engine } = svc();
    const results = await service.connectDeclared({
      datasources: [{ ...externalDs, active: false }],
      objects: [],
    });
    expect(results).toEqual([]);
    expect(engine!.drivers.size).toBe(0);
  });
});
