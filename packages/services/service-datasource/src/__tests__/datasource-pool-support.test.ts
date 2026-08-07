// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5714 — `datasource.pool` was honoured by the `postgres` / `mysql` / `mongo`
// arms and DROPPED IN SILENCE by `sqlite` / `sqlite-wasm`, which take no pool
// option at all. Measured on `origin/main` before this change:
//
//   sqlite   + pool{min:3,max:9}  knex.client.config.pool {"createTimeoutMillis":15000}  live {min:1,max:1}
//   postgres + pool{min:3,max:9}  knex config.pool {"min":3,"max":9}                     live {min:3,max:9}
//
// The maintainer ruling (2026-08-06, option B) is that a declaration either
// takes effect or is rejected out loud — never dropped. These tests pin the
// rejection at each door it can come in through, and pin that the arms which
// DO honour the block still do.

import { describe, it, expect, vi } from 'vitest';
import {
  POOL_UNSUPPORTED_DRIVER_IDS,
  driverReadsDeclaredPool,
  unsupportedPoolIssue,
  assertDatasourcePoolSupported,
} from '../datasource-pool-support.js';
import { createDefaultDatasourceDriverFactory } from '../default-datasource-driver-factory.js';
import {
  DatasourceConnectionService,
  type ConnectableDatasource,
  type ConnectionEngineLike,
} from '../datasource-connection-service.js';
import { DatasourceAdminService, type StoredDatasource } from '../datasource-admin-service.js';
import type { IDatasourceDriverFactory } from '../contracts/datasource-driver-factory.js';

describe('#5714 — which driver arms read a declared `pool`', () => {
  it('names exactly the two sqlite arms as unable to honour it', () => {
    expect([...POOL_UNSUPPORTED_DRIVER_IDS]).toEqual(['sqlite', 'sqlite-wasm']);
  });

  it('rejects every spelling of the sqlite arms, case-insensitively', () => {
    for (const id of ['sqlite', 'sqlite3', 'better-sqlite3', 'SQLite', 'sqlite-wasm', 'wasm-sqlite']) {
      expect(driverReadsDeclaredPool(id), id).toBe(false);
    }
  });

  it('leaves the pooled built-ins alone', () => {
    for (const id of ['postgres', 'pg', 'postgresql', 'mysql', 'mysql2', 'mariadb', 'mongo', 'mongodb']) {
      expect(driverReadsDeclaredPool(id), id).toBe(true);
    }
  });

  // The same boundary the `datasource.config` gate draws (#4410): we judge what
  // we can construct. A plugin driver may well pool, and rejecting a key
  // against a contract we do not ship would be worse than the silence.
  it('does not judge a driver id the platform ships no contract for', () => {
    expect(driverReadsDeclaredPool('com.vendor.snowflake')).toBe(true);
    expect(unsupportedPoolIssue({ driver: 'com.vendor.snowflake', pool: { min: 3, max: 9 } })).toBeUndefined();
  });

  // Deliberate, and filed rather than silently widened: `memory` reads no pool
  // either, but the #5714 ruling authorised this tightening for the sqlite arms
  // only. #5931 carries the decision.
  it('leaves `memory` out of the rejected set (#5931), deliberately', () => {
    expect(driverReadsDeclaredPool('memory')).toBe(true);
  });

  it('treats an absent or empty block as no declaration', () => {
    expect(unsupportedPoolIssue({ driver: 'sqlite' })).toBeUndefined();
    expect(unsupportedPoolIssue({ driver: 'sqlite', pool: {} })).toBeUndefined();
    expect(unsupportedPoolIssue({ driver: 'sqlite', pool: undefined })).toBeUndefined();
  });

  it('names the datasource and the one edit that fixes it', () => {
    const msg = unsupportedPoolIssue({ driver: 'sqlite', pool: { min: 1, max: 5 }, name: 'crm_primary' });
    expect(msg).toContain(`Datasource 'crm_primary'`);
    expect(msg).toMatch(/Remove `pool` from this datasource declaration/);
    expect(msg).toMatch(/postgres \/ mysql \/ mongo/);
  });

  // #5794's lesson: a fix instruction, never an escape-hatch instruction. An
  // authoring mistake has a correction; suggesting an env var that boots past
  // it (or a different driver) sends the author away from the fix.
  it('offers no escape hatch and no "use another driver" advice', () => {
    const msg = unsupportedPoolIssue({ driver: 'sqlite-wasm', pool: { max: 9 }, name: 'ds' }) ?? '';
    expect(msg).not.toMatch(/OS_ALLOW_DRIVER_CONNECT_FAILURE/);
    expect(msg).not.toMatch(/OS_[A-Z_]*=1/);
    expect(msg).not.toMatch(/switch|instead use|change the driver/i);
  });

  it('assert throws exactly when the issue is reported', () => {
    expect(() => assertDatasourcePoolSupported({ driver: 'sqlite', pool: { max: 5 } })).toThrow(/does not read it/);
    expect(() => assertDatasourcePoolSupported({ driver: 'postgres', pool: { max: 5 } })).not.toThrow();
  });
});

// ── Door 1: the driver factory — the site that dropped it ────────────────────
describe('#5714 — the driver factory rejects a pool it cannot honour', () => {
  const factory = () => createDefaultDatasourceDriverFactory({ dev: false });

  function knexConfigOf(driver: any): any {
    return driver?.config ?? driver?.knexConfig ?? driver?.options ?? {};
  }

  it('sqlite + pool is rejected instead of built with the block dropped', async () => {
    await expect(
      factory().create({
        name: 'crm_primary',
        driver: 'sqlite',
        config: { filename: ':memory:' },
        pool: { min: 3, max: 9 },
      }),
    ).rejects.toThrow(/Datasource 'crm_primary' declares a `pool` block/);
  });

  it('sqlite-wasm + pool is rejected the same way', async () => {
    await expect(
      factory().create({
        name: 'wasm_ds',
        driver: 'sqlite-wasm',
        config: { filename: ':memory:' },
        pool: { max: 9 },
      }),
    ).rejects.toThrow(/does not read it/);
  });

  it('sqlite WITHOUT a pool still builds exactly as before', async () => {
    const handle: any = await factory().create({
      name: 'crm_primary',
      driver: 'sqlite',
      config: { filename: ':memory:' },
    });
    const driver = handle.driver ?? handle;
    expect(driver?.constructor?.name).toMatch(/SqlDriver$/);
    try { await handle.disconnect?.(); } catch { /* pool never opened */ }
  });

  // The regression nails for the arms that DO honour it — the half of the
  // contract this change must not disturb.
  it('postgres still receives the declared pool', async () => {
    const handle: any = await factory().create({
      driver: 'postgres',
      config: { host: 'db.internal', database: 'analytics' },
      pool: { min: 3, max: 9, idleTimeoutMillis: 45_000 },
    });
    expect(knexConfigOf(handle.driver ?? handle).pool).toMatchObject({ min: 3, max: 9, idleTimeoutMillis: 45_000 });
    try { await handle.disconnect?.(); } catch { /* pool never opened */ }
  });

  it('mysql still receives the declared pool', async () => {
    const handle: any = await factory().create({
      driver: 'mysql',
      config: { url: 'mysql://user:pw@localhost:3306/db' },
      pool: { min: 3, max: 9 },
    });
    expect(knexConfigOf(handle.driver ?? handle).pool).toMatchObject({ min: 3, max: 9 });
    try { await handle.disconnect?.(); } catch { /* pool never opened */ }
  });
});

// ── Door 2: boot-time auto-connect ───────────────────────────────────────────
function fakeEngine() {
  const drivers = new Map<string, { name?: string }>();
  const engine: ConnectionEngineLike & { drivers: typeof drivers } = {
    drivers,
    registerDriver: (driver: any) => { drivers.set(driver.name, driver); },
    registerDatasourceDef: () => {},
    getDriverByName: (name) => drivers.get(name),
  };
  return engine;
}

function fakeFactory(): IDatasourceDriverFactory {
  return {
    supports: () => true,
    create: vi.fn(async () => {
      const driver: any = { name: 'com.fake.driver' };
      return { driver, connect: async () => { driver.connected = true; } };
    }),
  };
}

function svc() {
  const engine = fakeEngine();
  const factory = fakeFactory();
  const warnings: string[] = [];
  const service = new DatasourceConnectionService({
    factory: () => factory,
    engine: () => engine,
    logger: { warn: (msg: string) => { warnings.push(msg); } },
  });
  return { service, engine, factory, warnings };
}

const sqliteWithPool: ConnectableDatasource = {
  name: 'crm_primary',
  driver: 'sqlite',
  config: { filename: ':memory:' },
  pool: { min: 1, max: 5 },
};

describe('#5714 — boot refuses a declared pool the driver cannot honour', () => {
  it('throws before anything is connected, even for a datasource the D2 gate would skip', async () => {
    const { service, factory, engine } = svc();
    // Managed + nothing bound: `isDatasourceAddressed` is false, so this
    // datasource never reaches a connect. Its `pool` block is exactly as
    // dropped as a connected one's — which is the app-crm specimen's shape.
    await expect(service.connectDeclared({ datasources: [sqliteWithPool], objects: [] }))
      .rejects.toThrow(/Datasource 'crm_primary' declares a `pool` block/);
    expect((factory.create as any).mock.calls.length).toBe(0);
    expect(engine.drivers.size).toBe(0);
  });

  // The verdict is about the metadata, not about the world, so the D5
  // degradation policy must not be able to swallow it.
  it('is an authoring verdict, not a connect failure: no degradation escape hatch', async () => {
    const { service } = svc();
    const err = await service
      .connectDeclared({ datasources: [sqliteWithPool], objects: [] })
      .then(() => undefined, (e: Error) => e);
    expect(err?.message).not.toMatch(/OS_ALLOW_DRIVER_CONNECT_FAILURE/);
    expect(err?.message).not.toMatch(/connect failed/);
  });

  it('names every offender in one throw', async () => {
    const { service } = svc();
    const err = await service
      .connectDeclared({
        datasources: [sqliteWithPool, { name: 'wasm_ds', driver: 'sqlite-wasm', pool: { max: 4 } }],
        objects: [],
      })
      .then(() => undefined, (e: Error) => e);
    expect(err?.message).toMatch(/2 declared datasource\(s\)/);
    expect(err?.message).toContain(`Datasource 'crm_primary'`);
    expect(err?.message).toContain(`Datasource 'wasm_ds'`);
  });

  // `active: false` is the operator's way to take a misconfigured datasource
  // out of service. A boot that refuses to start over one already switched off
  // would break the remedy itself.
  it('skips a datasource that is switched off', async () => {
    const { service } = svc();
    await expect(
      service.connectDeclared({ datasources: [{ ...sqliteWithPool, active: false }], objects: [] }),
    ).resolves.toEqual([]);
  });

  it('leaves a sqlite datasource with no pool block connecting as before', async () => {
    const { service, engine } = svc();
    const results = await service.connectDeclared({
      datasources: [{ name: 'crm_primary', driver: 'sqlite', config: { filename: ':memory:' }, autoConnect: true }],
      objects: [],
    });
    expect(results.map((r) => r.status)).toEqual(['connected']);
    expect(engine.drivers.has('crm_primary')).toBe(true);
  });

  it('leaves a postgres datasource WITH a pool block connecting as before', async () => {
    const { service, engine } = svc();
    const results = await service.connectDeclared({
      datasources: [{
        name: 'reporting',
        driver: 'postgres',
        config: { host: 'db.internal', database: 'analytics' },
        pool: { min: 3, max: 9 },
        autoConnect: true,
      }],
      objects: [],
    });
    expect(results.map((r) => r.status)).toEqual(['connected']);
    expect(engine.drivers.has('reporting')).toBe(true);
  });

  // The runtime-admin path (`registerPool`) calls `connect()` directly rather
  // than through the boot pre-pass, so it carries its own guard.
  it('rejects on the direct connect() path too, without registering anything', async () => {
    const { service, engine, factory } = svc();
    await expect(
      service.connect(sqliteWithPool, { context: { origin: 'runtime', trigger: 'runtime-admin' } }),
    ).rejects.toThrow(/declares a `pool` block/);
    expect((factory.create as any).mock.calls.length).toBe(0);
    expect(engine.drivers.size).toBe(0);
  });
});

// ── Door 3: the Setup wizard (runtime authoring) ─────────────────────────────
function adminHarness(seed: StoredDatasource[] = []) {
  const records: StoredDatasource[] = seed.map((r) => ({ ...r }));
  const registered: string[] = [];
  const service = new DatasourceAdminService({
    probe: async () => ({ ok: true }),
    listDatasourceRecords: async () => records.map((r) => ({ ...r })),
    getDatasourceRecord: async (n) => {
      const r = records.find((x) => x.name === n);
      return r ? { ...r } : undefined;
    },
    putDatasourceRecord: async (record) => {
      const idx = records.findIndex((r) => r.name === record.name && r.origin === 'runtime');
      if (idx >= 0) records[idx] = { ...record };
      else records.push({ ...record });
    },
    deleteDatasourceRecord: async () => {},
    writeSecret: async () => 'sys_secret://x#1',
    countBoundObjects: async () => 0,
    registerPool: (record) => { registered.push(record.name); },
  });
  return { service, records, registered };
}

describe('#5714 — the Setup wizard rejects it before the record is stored', () => {
  it('create: a sqlite draft carrying a pool never reaches the store', async () => {
    const { service, records, registered } = adminHarness();
    await expect(
      service.createDatasource({
        name: 'local_cache',
        driver: 'sqlite',
        config: { filename: ':memory:' },
        pool: { min: 1, max: 5 },
      }),
    ).rejects.toThrow(/declares a `pool` block/);
    expect(records).toHaveLength(0);
    expect(registered).toHaveLength(0);
  });

  it('create: a postgres draft carrying a pool is stored as before', async () => {
    const { service, records } = adminHarness();
    await service.createDatasource({
      name: 'reporting',
      driver: 'postgres',
      config: { database: 'analytics' },
      pool: { min: 3, max: 9 },
    });
    expect(records[0]?.pool).toEqual({ min: 3, max: 9 });
  });

  it('update: patching a pool onto a stored sqlite datasource is rejected', async () => {
    const { service } = adminHarness([
      { name: 'local_cache', driver: 'sqlite', config: { filename: ':memory:' }, origin: 'runtime' },
    ]);
    await expect(
      service.updateDatasource('local_cache', { pool: { min: 1, max: 5 } }),
    ).rejects.toThrow(/declares a `pool` block/);
  });

  it('update: switching a pooled datasource TO sqlite is rejected on the merged record', async () => {
    const { service } = adminHarness([
      { name: 'reporting', driver: 'postgres', config: {}, pool: { min: 3, max: 9 }, origin: 'runtime' },
    ]);
    await expect(
      service.updateDatasource('reporting', { driver: 'sqlite', config: { filename: ':memory:' } }),
    ).rejects.toThrow(/declares a `pool` block/);
  });

  // A record written before this gate must stay editable — including the
  // `active: false` that takes it out of service. Same carve-out the #4410
  // config gate makes, for the same reason.
  it('update: a write that touches neither pool nor driver is not re-judged', async () => {
    const { service } = adminHarness([
      {
        name: 'local_cache',
        driver: 'sqlite',
        config: { filename: ':memory:' },
        pool: { min: 1, max: 5 },
        origin: 'runtime',
      },
    ]);
    const summary = await service.updateDatasource('local_cache', { active: false });
    expect(summary.active).toBe(false);
  });
});
