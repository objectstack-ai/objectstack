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
//
// #5931 — the SISTER ARM. `memory` dropped `pool` exactly as silently
// (`buildMemoryConfig` reads `spec.config` only, and `InMemoryDriver` has no
// pool concept whatsoever), but it was left out of the rejected set because
// #5714's ruling was scoped to the two sqlite arms. Measured the same way:
//
//   memory + pool{min:3,max:9}   driver config {"persistence":false}   pool undefined
//
// The maintainer ruling of 2026-08-07 folds it in, with its own explanation
// rather than SQLite's, and sets the default for the next sister arm (#6140).
// The pin that used to hold `memory` OUT of the set is flipped below, not
// deleted — it is the same fact, re-judged.

// #7243 — THE REMAINDER. #6214's ledger pass read every arm and found the two
// faces the rejected set could not cover, both still silent:
//
//   turso   + pool{min:3,max:9,idleTimeoutMillis:30000}  `spec.pool` never read by the arm
//   mongodb + pool{max:20,idleTimeoutMillis:30000,connectionTimeoutMillis:3000}
//                          → driver config {"url":…,"database":"orders","maxPoolSize":20}
//
// The mongodb line is the half-effective one: `max` landed, the timeouts did
// not, so the author's evidence that "my pool config works" was real and half
// wrong. Maintainer ruling 2026-08-11: `turso` joins the set WHOLE-ARM (no fork
// by url mode), and mongodb's two timeouts are REJECTED, not wired — MongoClient
// has `maxIdleTimeMS` / `connectTimeoutMS`, and wiring them with no measured
// consumer would be behaviour-surface expansion.
//
// ⚠️ Every case below asserts the message's CONTENT, never merely that
// something threw. On the turso arm a bare `.toThrow()` is green before the fix
// too: `@objectstack/driver-turso` is not installed in this package, so the
// unfixed arm throws the missing-package error a few lines further down.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DatasourceSchema } from '@objectstack/spec/data';
import {
  POOL_UNSUPPORTED_DRIVER_IDS,
  POOL_UNREAD_KEYS_BY_DRIVER,
  driverReadsDeclaredPool,
  unreadPoolKeys,
  unsupportedPoolIssue,
  unsupportedPoolMessage,
  unreadPoolKeysMessage,
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
  it('names the two sqlite arms, `memory` and `turso` as unable to honour it (#5931 / #7243)', () => {
    expect([...POOL_UNSUPPORTED_DRIVER_IDS]).toEqual(['memory', 'sqlite', 'sqlite-wasm', 'turso']);
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

  // THE FLIPPED PIN (#5931). This case used to assert the opposite — `memory`
  // deliberately OUT of the rejected set, pending a ruling — and #5954 left it
  // green on purpose so the hole would read as drawn rather than overlooked.
  // The ruling of 2026-08-07 folded the arm in, so the same fact now has the
  // opposite verdict. Every spelling, because `mingo` and `in-memory` build the
  // very same driver.
  it('rejects `memory` and every spelling of it (#5931 — the flipped pin)', () => {
    for (const id of ['memory', 'inmemory', 'in-memory', 'mingo', 'Memory', '  MEMORY  ']) {
      expect(driverReadsDeclaredPool(id), id).toBe(false);
    }
  });

  it('treats an absent or empty block as no declaration', () => {
    for (const driver of ['sqlite', 'memory']) {
      expect(unsupportedPoolIssue({ driver }), driver).toBeUndefined();
      expect(unsupportedPoolIssue({ driver, pool: {} }), driver).toBeUndefined();
      expect(unsupportedPoolIssue({ driver, pool: undefined }), driver).toBeUndefined();
    }
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
    for (const driver of ['sqlite-wasm', 'memory']) {
      const msg = unsupportedPoolIssue({ driver, pool: { max: 9 }, name: 'ds' }) ?? '';
      expect(msg, driver).not.toMatch(/OS_ALLOW_DRIVER_CONNECT_FAILURE/);
      expect(msg, driver).not.toMatch(/OS_[A-Z_]*=1/);
      expect(msg, driver).not.toMatch(/switch|instead use|change the driver/i);
    }
  });

  // #5931 — the memory arm gets its OWN explanation. The ruling was explicit
  // that SQLite's sentence must not be reused, and the reason is not style:
  // "the driver owns the connection strategy" would send the author looking for
  // a strategy knob, when the truth is that there is no connection to pool.
  it('explains `memory` in its own terms, never SQLite\'s (#5931)', () => {
    const msg = unsupportedPoolIssue({ driver: 'memory', pool: { min: 3, max: 9 }, name: 'scratch' }) ?? '';
    expect(msg).toContain(`Datasource 'scratch'`);
    expect(msg).toContain(`the 'memory' driver does not read it`);
    expect(msg).toMatch(/no pool to size, and no connection to pool/);
    expect(msg).toMatch(/plain data structure inside this process/);
    // …and not one part of SQLite's reasoning, which is about a DIFFERENT
    // failure (one datasource split across several stores).
    expect(msg).not.toMatch(/SQLite/);
    expect(msg).not.toMatch(/connection strategy is owned by the driver/);
    expect(msg).not.toMatch(/SEPARATE, empty database/);
    expect(msg).not.toMatch(/split one datasource's data/);
    // The shared frame survives: the one edit that fixes it, and where the key
    // stays meaningful.
    expect(msg).toMatch(/Remove `pool` from this datasource declaration/);
    expect(msg).toMatch(/postgres \/ mysql \/ mongo/);
  });

  it('quotes the spelling the author actually wrote, with the memory reason behind it', () => {
    const msg = unsupportedPoolIssue({ driver: 'mingo', pool: { max: 2 }, name: 'scratch' }) ?? '';
    expect(msg).toContain(`the 'mingo' driver does not read it`);
    expect(msg).toMatch(/no pool to size, and no connection to pool/);
  });

  // The two sqlite arms' text is UNCHANGED by #5931 — pinned whole, against the
  // literal as it stood on `origin/main` before this change, because "we only
  // added an arm" is a claim about bytes.
  // Byte-for-byte as #5714 wrote it, with ONE word changed: the closing clause
  // names the pooled drivers, and #6345 renamed the canonical mongo id to
  // `mongodb`. Naming the retired canon in an instruction the author is meant to
  // act on would send them to a spelling the catalog no longer publishes.
  it('leaves the sqlite arms\' message byte-for-byte as #5714 wrote it', () => {
    const expected =
      "Datasource 'crm_primary' declares a `pool` block, but the 'sqlite' driver does not read " +
      'it: a SQLite connection strategy is owned by the driver, not by the datasource — one ' +
      'connection per database, because a second connection to `:memory:` opens a SEPARATE, ' +
      "empty database. Sizing it here would therefore split one datasource's data across " +
      'several stores, so the block is rejected instead of dropped. Remove `pool` from this ' +
      'datasource declaration; it stays meaningful on the pooled drivers ' +
      '(postgres / mysql / mongodb).';
    expect(unsupportedPoolMessage('sqlite', 'crm_primary')).toBe(expected);
    expect(unsupportedPoolMessage('sqlite-wasm', 'crm_primary'))
      .toBe(expected.replace("the 'sqlite' driver", "the 'sqlite-wasm' driver"));
  });

  // Unreachable through `unsupportedPoolIssue` (nothing produces a message for a
  // driver that reads the block), but the helper is exported and takes a plain
  // string. The honest answer there is the part true of every rejected arm —
  // never another arm's specific reasoning.
  it('borrows no arm\'s reasoning for a driver that is not in the set', () => {
    const msg = unsupportedPoolMessage('postgres');
    expect(msg).toMatch(/nothing in the block reaches a connection/);
    expect(msg).not.toMatch(/SQLite/);
    expect(msg).not.toMatch(/plain data structure inside this process/);
  });

  it('assert throws exactly when the issue is reported', () => {
    expect(() => assertDatasourcePoolSupported({ driver: 'sqlite', pool: { max: 5 } })).toThrow(/does not read it/);
    expect(() => assertDatasourcePoolSupported({ driver: 'memory', pool: { max: 5 } })).toThrow(/does not read it/);
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

  // #5931 — the arm this file used to pin as deliberately unguarded. Before the
  // ruling this call RESOLVED, handing back an `InMemoryDriver` built from
  // `buildMemoryConfig(spec)` alone, with `pool` nowhere in it.
  it('memory + pool is rejected instead of built with the block dropped (#5931)', async () => {
    await expect(
      factory().create({
        name: 'scratch',
        driver: 'memory',
        config: {},
        pool: { min: 3, max: 9 },
      }),
    ).rejects.toThrow(/Datasource 'scratch' declares a `pool` block/);
  });

  it('rejects the `inmemory` alias too, and says why in memory terms', async () => {
    const err = await Promise.resolve(
      factory().create({ name: 'scratch', driver: 'inmemory', config: {}, pool: { max: 9 } }),
    ).then(() => undefined, (e: Error) => e);
    expect(err?.message).toMatch(/no pool to size, and no connection to pool/);
    expect(err?.message).not.toMatch(/SQLite/);
  });

  it('memory WITHOUT a pool still builds exactly as before', async () => {
    const handle: any = await factory().create({ name: 'scratch', driver: 'memory', config: {} });
    const driver = handle.driver ?? handle;
    expect(driver?.constructor?.name).toMatch(/InMemoryDriver$/);
    // The #4083 shape is untouched: ephemeral unless the author opts in.
    expect(driver.config?.persistence).toBe(false);
    try { await handle.disconnect?.(); } catch { /* never connected */ }
  });

  it('memory with an EMPTY pool block still builds — nothing was declared', async () => {
    const handle: any = await factory().create({ name: 'scratch', driver: 'memory', config: {}, pool: {} });
    expect((handle.driver ?? handle)?.constructor?.name).toMatch(/InMemoryDriver$/);
    try { await handle.disconnect?.(); } catch { /* never connected */ }
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

  // #5931 — the same door, the sister arm. A memory datasource carrying a pool
  // used to boot silently and run on a store no pool setting ever touched.
  it('refuses a memory datasource carrying a pool, before anything is connected (#5931)', async () => {
    const { service, factory, engine } = svc();
    await expect(
      service.connectDeclared({
        datasources: [{ name: 'scratch', driver: 'memory', config: {}, pool: { min: 3, max: 9 } }],
        objects: [],
      }),
    ).rejects.toThrow(/Datasource 'scratch' declares a `pool` block/);
    expect((factory.create as any).mock.calls.length).toBe(0);
    expect(engine.drivers.size).toBe(0);
  });

  it('names a memory offender alongside a sqlite one in the same throw', async () => {
    const { service } = svc();
    const err = await service
      .connectDeclared({
        datasources: [sqliteWithPool, { name: 'scratch', driver: 'memory', pool: { max: 4 } }],
        objects: [],
      })
      .then(() => undefined, (e: Error) => e);
    expect(err?.message).toMatch(/2 declared datasource\(s\)/);
    expect(err?.message).toContain(`Datasource 'crm_primary'`);
    expect(err?.message).toContain(`Datasource 'scratch'`);
    // Each offender keeps its own explanation in the aggregate.
    expect(err?.message).toMatch(/a SQLite connection strategy is owned by the driver/);
    expect(err?.message).toMatch(/no pool to size, and no connection to pool/);
  });

  it('leaves a memory datasource with no pool block connecting as before', async () => {
    const { service, engine } = svc();
    const results = await service.connectDeclared({
      datasources: [{ name: 'scratch', driver: 'memory', config: {}, autoConnect: true }],
      objects: [],
    });
    expect(results.map((r) => r.status)).toEqual(['connected']);
    expect(engine.drivers.has('scratch')).toBe(true);
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

  // #5931 — the wizard is the door an author is most likely to come through
  // with `driver: memory`, since it is the dev/test choice the Setup UI offers.
  it('create: a memory draft carrying a pool never reaches the store (#5931)', async () => {
    const { service, records, registered } = adminHarness();
    await expect(
      service.createDatasource({
        name: 'scratch',
        driver: 'memory',
        config: {},
        pool: { min: 1, max: 5 },
      }),
    ).rejects.toThrow(/no pool to size, and no connection to pool/);
    expect(records).toHaveLength(0);
    expect(registered).toHaveLength(0);
  });

  it('create: a memory draft with no pool is stored as before', async () => {
    const { service, records, registered } = adminHarness();
    await service.createDatasource({ name: 'scratch', driver: 'memory', config: {} });
    expect(records[0]?.name).toBe('scratch');
    expect(records[0]?.pool).toBeUndefined();
    expect(registered).toEqual(['scratch']);
  });

  it('update: switching a pooled datasource TO memory is rejected on the merged record (#5931)', async () => {
    const { service } = adminHarness([
      { name: 'reporting', driver: 'postgres', config: {}, pool: { min: 3, max: 9 }, origin: 'runtime' },
    ]);
    await expect(
      service.updateDatasource('reporting', { driver: 'memory', config: {} }),
    ).rejects.toThrow(/declares a `pool` block/);
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

// A rejection that RESOLVED is the failure this card is about — silently
// accepting a declaration nothing reads — so it must not surface as a confusing
// `undefined.message`. Reverse-verified: with the fix reverted, every caller of
// this helper fails with "…built it instead of rejecting", naming the cell.
// `IDatasourceDriverFactory.create` may answer synchronously, so this takes an
// `unknown` outcome rather than a `Promise` — a sync THROW still escapes to the
// call site, which fails the case with the real message either way.
async function rejectionOf(outcomeOrPromise: unknown): Promise<Error> {
  const outcome = await Promise.resolve(outcomeOrPromise).then(
    (value) => ({ value }),
    (error: Error) => ({ error }),
  );
  if ('error' in outcome) return outcome.error;
  throw new Error(
    `expected the declaration to be rejected, but it built it instead of rejecting: `
    + `${JSON.stringify(outcome.value)?.slice(0, 200)}`,
  );
}

// ── #7243, half one: `turso` joins the rejected set, whole-arm ───────────────
describe('#7243 — a declared `pool` on a turso datasource is rejected, not dropped', () => {
  it('answers `false` for every spelling of the arm, case-insensitively', () => {
    for (const id of ['turso', 'libsql', 'Turso', 'LibSQL', '  TURSO  ']) {
      expect(driverReadsDeclaredPool(id), id).toBe(false);
    }
  });

  it('explains turso in its own terms — both transports, neither pooled', () => {
    const msg = unsupportedPoolIssue({ driver: 'turso', pool: { min: 3, max: 9 }, name: 'edge' }) ?? '';
    expect(msg).toContain(`Datasource 'edge'`);
    expect(msg).toContain(`the 'turso' driver does not read it`);
    // The local mode's reason and the remote mode's reason are BOTH named: the
    // ruling was whole-arm precisely because the two differ, and an author on
    // `libsql://` told only about `:memory:` would think the message was about
    // somebody else's datasource.
    expect(msg).toMatch(/`file:` \/ `:memory:` url runs the local engine/);
    expect(msg).toMatch(/better-sqlite3/);
    expect(msg).toMatch(/`libsql:\/\/` url is a remote request transport/);
    expect(msg).toMatch(/capped by `config\.concurrency`/);
    expect(msg).toMatch(/`TursoDriverConfig` has no `min` \/ `max`/);
    // The shared frame survives.
    expect(msg).toMatch(/rejected instead of dropped/);
    expect(msg).toMatch(/Remove `pool` from this datasource declaration/);
  });

  it('quotes the `libsql` spelling the author wrote, with the turso reason behind it', () => {
    const msg = unsupportedPoolIssue({ driver: 'libsql', pool: { max: 9 }, name: 'edge' }) ?? '';
    expect(msg).toContain(`the 'libsql' driver does not read it`);
    expect(msg).toMatch(/neither libSQL transport has a connection pool to size/);
  });

  it('does not paraphrase SQLite\'s reasoning, though it names the shared engine', () => {
    const msg = unsupportedPoolMessage('turso', 'edge');
    expect(msg).not.toMatch(/opens a SEPARATE, empty database/);
    expect(msg).not.toMatch(/split one datasource's data/);
    expect(msg).not.toMatch(/connection strategy is owned by the driver/);
  });

  it('offers no escape hatch and no "use another driver" advice', () => {
    const msg = unsupportedPoolIssue({ driver: 'turso', pool: { max: 9 }, name: 'edge' }) ?? '';
    expect(msg).not.toMatch(/OS_[A-Z_]*=1/);
    expect(msg).not.toMatch(/switch|instead use|change the driver/i);
  });

  it('treats an absent or empty block as no declaration, as on every other arm', () => {
    expect(unsupportedPoolIssue({ driver: 'turso' })).toBeUndefined();
    expect(unsupportedPoolIssue({ driver: 'turso', pool: {} })).toBeUndefined();
    expect(unsupportedPoolIssue({ driver: 'libsql', pool: undefined })).toBeUndefined();
  });

  // The arm's `pool`-blindness is the premise of the whole-arm verdict, so it is
  // pinned against the source rather than remembered. If someone ever wires
  // `spec.pool` into `TursoDriver`, this fails and the verdict gets re-judged
  // instead of quietly contradicting the code.
  it('pins that the turso arm reads no `spec.pool` key at all', () => {
    const src = readFileSync(new URL('../default-datasource-driver-factory.ts', import.meta.url), 'utf8');
    const arm = src.slice(src.indexOf(`if (kind === 'turso')`), src.indexOf(`if (kind === 'memory')`));
    expect(arm.length).toBeGreaterThan(500);
    expect(arm).toContain('new TursoDriver(');
    // Only comment lines may mention it — the constructor call must not.
    const ctor = arm.slice(arm.indexOf('new TursoDriver('));
    expect(ctor).not.toMatch(/spec\.pool|pool\./);
  });
});

// ── #7243, half two: mongodb's two unread timeout keys ───────────────────────
describe('#7243 — mongodb reads `min` / `max` and rejects the two timeouts by name', () => {
  it('still reads the block, so the whole-block gate must not fire for it', () => {
    for (const id of ['mongo', 'mongodb', 'MongoDB']) {
      expect(driverReadsDeclaredPool(id), id).toBe(true);
    }
    expect(unsupportedPoolIssue({ driver: 'mongodb', pool: { min: 1, max: 20 }, name: 'orders' }))
      .toBeUndefined();
  });

  it('names exactly the two keys the arm never takes out of the block', () => {
    expect([...(POOL_UNREAD_KEYS_BY_DRIVER.mongodb ?? [])])
      .toEqual(['idleTimeoutMillis', 'connectionTimeoutMillis']);
  });

  it('reports only the keys actually declared, in table order', () => {
    expect(unreadPoolKeys('mongodb', { min: 1, max: 20 })).toEqual([]);
    expect(unreadPoolKeys('mongodb', { max: 20, idleTimeoutMillis: 30_000 }))
      .toEqual(['idleTimeoutMillis']);
    expect(unreadPoolKeys('mongodb', { connectionTimeoutMillis: 3000 }))
      .toEqual(['connectionTimeoutMillis']);
    // Author order does not change the message: one declaration, one text.
    expect(unreadPoolKeys('mongodb', { connectionTimeoutMillis: 3000, idleTimeoutMillis: 30_000 }))
      .toEqual(['idleTimeoutMillis', 'connectionTimeoutMillis']);
    expect(unreadPoolKeys('mongo', { idleTimeoutMillis: 30_000 })).toEqual(['idleTimeoutMillis']);
  });

  it('judges no arm but mongodb — the pooled ones read them, the rejected ones are the block gate\'s', () => {
    for (const driver of ['postgres', 'mysql', 'com.vendor.snowflake']) {
      expect(unreadPoolKeys(driver, { idleTimeoutMillis: 30_000, connectionTimeoutMillis: 3000 }), driver)
        .toEqual([]);
    }
    for (const driver of ['sqlite', 'memory', 'turso']) {
      expect(unreadPoolKeys(driver, { idleTimeoutMillis: 30_000 }), driver).toEqual([]);
    }
  });

  it('names the datasource, both keys and the edit that fixes it', () => {
    const msg = unsupportedPoolIssue({
      driver: 'mongodb',
      pool: { max: 20, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 3000 },
      name: 'orders',
    }) ?? '';
    expect(msg).toContain(`Datasource 'orders'`);
    expect(msg).toContain('`idleTimeoutMillis` and `connectionTimeoutMillis`');
    expect(msg).toContain(`the 'mongodb' driver does not read them`);
    expect(msg).toMatch(/maps them onto the MongoClient's `minPoolSize` \/ `maxPoolSize`/);
    expect(msg).toMatch(/This rejection is deliberate/);
    expect(msg).toMatch(/Remove `idleTimeoutMillis` and `connectionTimeoutMillis` from this datasource's `pool`/);
    // …and says what SURVIVES, which the whole-block message cannot: deleting
    // `pool` here would throw away two keys that are honoured.
    expect(msg).toMatch(/`min` \/ `max` stay meaningful here/);
    expect(msg).not.toMatch(/Remove `pool` from this datasource declaration/);
  });

  it('agrees in number for a single key', () => {
    const msg = unsupportedPoolIssue({ driver: 'mongodb', pool: { idleTimeoutMillis: 30_000 } }) ?? '';
    expect(msg).toContain('This datasource declares `idleTimeoutMillis` in its `pool` block');
    expect(msg).toContain(`the 'mongodb' driver does not read it`);
    expect(msg).not.toContain('and `connectionTimeoutMillis`');
  });

  it('offers no escape hatch and no "use another driver" advice', () => {
    const msg = unsupportedPoolIssue({
      driver: 'mongodb', pool: { idleTimeoutMillis: 1 }, name: 'orders',
    }) ?? '';
    expect(msg).not.toMatch(/OS_[A-Z_]*=1/);
    expect(msg).not.toMatch(/switch|instead use|change the driver/i);
  });

  it('borrows no arm\'s reasoning for a driver with no entry in the table', () => {
    const msg = unreadPoolKeysMessage('com.vendor.snowflake', ['idleTimeoutMillis']);
    expect(msg).toMatch(/nothing in the arm reads it/);
    expect(msg).toMatch(/the rest of the block is unaffected/);
    expect(msg).not.toMatch(/MongoClient/);
    // Not mongodb's "what survives" clause either — an arm with no entry has no
    // measured `min` / `max` behaviour to promise.
    expect(msg).not.toMatch(/`min` \/ `max` stay meaningful here/);
  });

  it('assert throws exactly when the issue is reported', () => {
    expect(() => assertDatasourcePoolSupported({ driver: 'mongodb', pool: { idleTimeoutMillis: 1 } }))
      .toThrow(/does not read it/);
    expect(() => assertDatasourcePoolSupported({ driver: 'mongodb', pool: { min: 1, max: 5 } }))
      .not.toThrow();
  });

  // THE ANTI-DRIFT PIN. The table is a claim about the factory arm's source and
  // about the spec's block, so it is re-derived from both rather than trusted:
  // every declared `pool` key is either read by the arm or listed as unread, and
  // never both. Wiring `maxIdleTimeMS` up later (the option the ruling deferred)
  // fails here until the key leaves the table — which is the point.
  it('covers the spec\'s pool block exactly: read ∪ rejected, disjoint', () => {
    const declared = Object.keys((DatasourceSchema.shape.pool as any).unwrap().shape);
    expect(declared).toEqual(['min', 'max', 'idleTimeoutMillis', 'connectionTimeoutMillis']);

    const src = readFileSync(new URL('../default-datasource-driver-factory.ts', import.meta.url), 'utf8');
    const arm = src.slice(src.indexOf(`if (kind === 'mongodb')`), src.indexOf(`if (kind === 'turso')`));
    const ctor = arm.slice(arm.indexOf('new MongoDBDriver('));
    const read = [...new Set([...ctor.matchAll(/pool\.([A-Za-z]+)/g)].map((m) => m[1]))].sort();
    expect(read).toEqual(['max', 'min']);

    const rejected = [...(POOL_UNREAD_KEYS_BY_DRIVER.mongodb ?? [])];
    expect(rejected.filter((k) => read.includes(k))).toEqual([]);
    expect([...read, ...rejected].sort()).toEqual([...declared].sort());
  });
});

// ── #7243 at all three doors ─────────────────────────────────────────────────
describe('#7243 — the factory rejects both remainders before it builds anything', () => {
  const factory = () => createDefaultDatasourceDriverFactory({ dev: false });

  // ⚠️ The assertion here is the MESSAGE, not the throw. `@objectstack/driver-turso`
  // is not installed in this package, so before the fix this same call threw the
  // missing-package error — a bare `.rejects.toThrow()` could not tell them apart.
  it('turso + pool is rejected by the pool gate, not by the missing-package arm', async () => {
    const err = await rejectionOf(
      factory().create({
        name: 'edge',
        driver: 'turso',
        config: { url: 'file::memory:' },
        pool: { min: 3, max: 9 },
      }),
    );
    expect(err.message).toContain(`Datasource 'edge' declares a \`pool\` block`);
    expect(err.message).toMatch(/neither libSQL transport has a connection pool to size/);
    // The gate runs BEFORE the dynamic import, so the author is told about their
    // declaration rather than about an optional package they may not need.
    expect(err.message).not.toMatch(/is not installed/);
    expect(err.message).not.toMatch(/npm install @objectstack\/driver-turso/);
  });

  it('a remote-mode turso datasource is rejected the same way', async () => {
    const err = await rejectionOf(
      factory().create({
        name: 'edge',
        driver: 'libsql',
        config: { url: 'libsql://my-db.turso.io', authToken: 'jwt' },
        pool: { max: 9 },
      }),
    );
    expect(err.message).toContain(`Datasource 'edge' declares a \`pool\` block`);
    expect(err.message).not.toMatch(/is not installed/);
  });

  it('mongodb + the two timeouts is rejected instead of built with them dropped', async () => {
    const err = await rejectionOf(
      factory().create({
        name: 'orders',
        driver: 'mongodb',
        config: { host: 'db.internal', database: 'orders' },
        pool: { max: 20, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 3000 },
      }),
    );
    expect(err.message).toContain(`Datasource 'orders' declares \`idleTimeoutMillis\` and \`connectionTimeoutMillis\``);
    expect(err.message).toMatch(/does not read them/);
  });

  // The half of the contract this change must not disturb — measured on
  // `origin/main` as `{"url":…,"database":"orders","maxPoolSize":20}`.
  it('mongodb + min/max still builds and still maps onto minPoolSize / maxPoolSize', async () => {
    const handle: any = await factory().create({
      name: 'orders',
      driver: 'mongodb',
      config: { host: 'db.internal', database: 'orders' },
      pool: { min: 2, max: 20 },
    });
    const driver = handle.driver ?? handle;
    expect(driver?.constructor?.name).toMatch(/MongoDBDriver$/);
    expect(driver.config).toMatchObject({ minPoolSize: 2, maxPoolSize: 20 });
    expect(driver.config).not.toHaveProperty('idleTimeoutMillis');
    try { await handle.disconnect?.(); } catch { /* never connected */ }
  });

  it('postgres keeps receiving both timeouts — this gate is mongodb\'s alone', async () => {
    const handle: any = await factory().create({
      driver: 'postgres',
      config: { host: 'db.internal', database: 'analytics' },
      pool: { min: 3, max: 9, idleTimeoutMillis: 45_000, connectionTimeoutMillis: 3000 },
    });
    const cfg = (handle.driver ?? handle)?.config ?? {};
    expect(cfg.pool).toMatchObject({ min: 3, max: 9, idleTimeoutMillis: 45_000, acquireTimeoutMillis: 3000 });
    try { await handle.disconnect?.(); } catch { /* pool never opened */ }
  });
});

describe('#7243 — boot and the Setup wizard refuse both remainders too', () => {
  it('boot: a turso datasource carrying a pool never reaches a connect', async () => {
    const { service, factory, engine } = svc();
    const err = await rejectionOf(
      service.connectDeclared({
        datasources: [{ name: 'edge', driver: 'turso', config: { url: 'libsql://x.turso.io' }, pool: { max: 9 } }],
        objects: [],
      }),
    );
    expect(err.message).toContain(`Datasource 'edge' declares a \`pool\` block`);
    expect(err.message).toMatch(/neither libSQL transport has a connection pool to size/);
    expect((factory.create as any).mock.calls.length).toBe(0);
    expect(engine.drivers.size).toBe(0);
  });

  it('boot: a mongodb datasource carrying the timeouts never reaches a connect', async () => {
    const { service, factory, engine } = svc();
    const err = await rejectionOf(
      service.connectDeclared({
        datasources: [{
          name: 'orders',
          driver: 'mongodb',
          config: { host: 'db.internal' },
          pool: { max: 20, idleTimeoutMillis: 30_000 },
        }],
        objects: [],
      }),
    );
    expect(err.message).toContain(`Datasource 'orders' declares \`idleTimeoutMillis\``);
    expect((factory.create as any).mock.calls.length).toBe(0);
    expect(engine.drivers.size).toBe(0);
  });

  it('boot: each offender keeps its own explanation in the aggregate', async () => {
    const { service } = svc();
    const err = await rejectionOf(
      service.connectDeclared({
        datasources: [
          { name: 'edge', driver: 'turso', config: { url: 'libsql://x.turso.io' }, pool: { max: 9 } },
          { name: 'orders', driver: 'mongodb', config: {}, pool: { idleTimeoutMillis: 30_000 } },
        ],
        objects: [],
      }),
    );
    expect(err.message).toMatch(/2 declared datasource\(s\)/);
    expect(err.message).toMatch(/neither libSQL transport has a connection pool to size/);
    expect(err.message).toMatch(/maps them onto the MongoClient's `minPoolSize` \/ `maxPoolSize`/);
  });

  it('boot: a mongodb datasource sizing only min/max connects as before', async () => {
    const { service, engine } = svc();
    const results = await service.connectDeclared({
      datasources: [{
        name: 'orders',
        driver: 'mongodb',
        config: { host: 'db.internal' },
        pool: { min: 2, max: 20 },
        autoConnect: true,
      }],
      objects: [],
    });
    expect(results.map((r) => r.status)).toEqual(['connected']);
    expect(engine.drivers.has('orders')).toBe(true);
  });

  it('wizard: a turso draft carrying a pool never reaches the store', async () => {
    const { service, records, registered } = adminHarness();
    const err = await rejectionOf(
      service.createDatasource({
        name: 'edge', driver: 'turso', config: { url: 'libsql://x.turso.io' }, pool: { max: 9 },
      }),
    );
    expect(err.message).toMatch(/neither libSQL transport has a connection pool to size/);
    expect(records).toHaveLength(0);
    expect(registered).toHaveLength(0);
  });

  it('wizard: a mongodb draft carrying a timeout never reaches the store', async () => {
    const { service, records, registered } = adminHarness();
    const err = await rejectionOf(
      service.createDatasource({
        name: 'orders',
        driver: 'mongodb',
        config: { host: 'db.internal', database: 'orders' },
        pool: { max: 20, connectionTimeoutMillis: 3000 },
      }),
    );
    expect(err.message).toContain('`connectionTimeoutMillis`');
    expect(err.message).toMatch(/does not read it/);
    expect(records).toHaveLength(0);
    expect(registered).toHaveLength(0);
  });

  it('wizard: a mongodb draft sizing only min/max is stored as before', async () => {
    const { service, records } = adminHarness();
    await service.createDatasource({
      name: 'orders',
      driver: 'mongodb',
      config: { host: 'db.internal', database: 'orders' },
      pool: { min: 2, max: 20 },
    });
    expect(records[0]?.pool).toEqual({ min: 2, max: 20 });
  });

  it('wizard: patching a timeout onto a stored mongodb datasource is rejected', async () => {
    const { service } = adminHarness([
      {
        name: 'orders',
        driver: 'mongodb',
        config: { host: 'db.internal', database: 'orders' },
        pool: { max: 20 },
        origin: 'runtime',
      },
    ]);
    await expect(
      service.updateDatasource('orders', { pool: { max: 20, idleTimeoutMillis: 30_000 } }),
    ).rejects.toThrow(/`idleTimeoutMillis`/);
  });

  it('wizard: switching a pooled datasource TO turso is rejected on the merged record', async () => {
    const { service } = adminHarness([
      { name: 'reporting', driver: 'postgres', config: {}, pool: { min: 3, max: 9 }, origin: 'runtime' },
    ]);
    await expect(
      service.updateDatasource('reporting', { driver: 'turso', config: { url: 'libsql://x.turso.io' } }),
    ).rejects.toThrow(/neither libSQL transport has a connection pool to size/);
  });

  // The same carve-out the block gate has: a record written before this gate
  // must stay editable, including the `active: false` that takes it out of
  // service. Otherwise the remedy for a bad declaration is itself blocked.
  it('wizard: a write touching neither pool nor driver is not re-judged', async () => {
    const { service } = adminHarness([
      {
        name: 'orders',
        driver: 'mongodb',
        config: { host: 'db.internal', database: 'orders' },
        pool: { max: 20, idleTimeoutMillis: 30_000 },
        origin: 'runtime',
      },
    ]);
    const summary = await service.updateDatasource('orders', { active: false });
    expect(summary.active).toBe(false);
  });
});
