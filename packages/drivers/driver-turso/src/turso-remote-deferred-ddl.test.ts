// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Deferred schema DDL on the Turso REMOTE face — refused loudly, measured first.
 *
 * `os migrate plan` / `apply` / `duplicates` / `account-issuer` /
 * `multi-value-columns` boot with `deferSchemaDdl: true`, which arms the
 * driver through `setDeferredDdl(true)` and then reads
 * `previewDeferredSchemaWork()` for the plan. This file replays, against a
 * `TursoDriver` over a real SQLite database wearing the `@libsql/client`
 * interface, the exact driver calls that boot makes:
 *
 *   1. `setDeferredDdl(true)` — `DeferSchemaDdlPlugin.init`;
 *   2. `syncSchemasBatch(...)` — `ObjectQLPlugin.start()`'s boot sync, which
 *      takes the batch door whenever `supports.batchSchemaSync` is true and the
 *      method exists (both hold for this driver, asserted below);
 *   3. `syncSchema(...)` — the composed-host coverage pass
 *      (`engine.syncObjectSchema`) on a `plan`/`apply` boot;
 *   4. `previewDeferredSchemaWork()` / `flushDeferredSchemaDdl()` — what the
 *      plan prints and what `apply` performs after its confirm prompt.
 *
 * Every statement the transport sends is recorded, so "did DDL run" and "did a
 * row get rewritten" are read off the wire and off the disk, not inferred.
 *
 * ## The three predictions, as measured BEFORE the refusal existed
 *
 * The first commit of this file pinned the unrefused behaviour as it stood on
 * origin/main; the refusal then replaced those assertions with the ones below.
 *
 * | prediction | door | verdict |
 * |:--|:--|:--|
 * | (a) the dry run performs DDL | `syncSchemasBatch` (engine boot sync) | MEASURED — `CREATE TABLE "fresh"`, `ALTER TABLE "probe" ADD COLUMN "why"` |
 * | (a) | `syncSchema` / `initObjects` (coverage pass, direct) | MEASURED — the same CREATE/ALTER |
 * | (b) the dry run rewrites rows (canonical temporal backfill) | `syncSchemasBatch` | REFUTED — no row write on this door (since #19844 this door runs the backfill too; the row records the measurement as taken) |
 * | (b) | `syncSchema` / `initObjects` | MEASURED — `update "probe" set "at" = …`, the naive value is rewritten on disk |
 * | (c) the plan reports no pending work | every door | MEASURED — `previewDeferredSchemaWork()` and `flushDeferredSchemaDdl()` both answer `[]` |
 *
 * No door emitted a destructive statement (no `DROP`, no type change); the
 * backfill rewrites a value's spelling, not the instant it names.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';
import { replicaFiles } from './replica-file.testkit.js';

// A replica is a local FILE: the constructor refuses one on `:memory:`.
const replicaFileUrls = replicaFiles();
afterAll(() => replicaFileUrls.removeAll());

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/**
 * The refusal's opening sentence — the operator contract, since the CLI prints
 * the driver's message verbatim. Spelled out here rather than imported: a test
 * that imports the string it asserts pins nothing about the wording. The rest
 * of the message is prose that may be improved without a test edit.
 */
const REFUSAL_FIRST_SENTENCE =
  "Deferred schema DDL is not supported by the Turso REMOTE transport (this datasource's " +
  'transport mode is `remote`), so a command that promises a dry run or a confirmation before ' +
  'any schema change cannot keep that promise against it.';

/** A pre-existing table missing one declared column, holding a non-canonical datetime. */
const PROBE = {
  name: 'probe',
  fields: { at: { type: 'datetime' }, why: { type: 'string' } },
};
/** A declared object with no table yet. */
const FRESH = {
  name: 'fresh',
  fields: { label: { type: 'string' } },
};

const NAIVE = '2025-07-28 00:00:00';
const PROBE_DDL = `create table "probe" ("id" TEXT PRIMARY KEY, "created_at" TEXT, "updated_at" TEXT, "at" TEXT)`;
const PROBE_ROW = `insert into probe (id, at) values ('naive', '${NAIVE}')`;

const sqlOf = (stmt: unknown): string =>
  typeof stmt === 'string' ? stmt : String((stmt as { sql?: unknown }).sql ?? '');

const DDL = /^\s*(create|alter|drop)\b/i;
const ROW_WRITE = /^\s*(insert|update|delete|replace)\b/i;

interface Recorder {
  client: unknown;
  statements: string[];
  ddl(): string[];
  rowWrites(): string[];
}

/** Wrap the stub so every statement the transport sends is recorded. */
function record(stub: LibsqlSqliteStub): Recorder {
  const statements: string[] = [];
  const client = {
    async execute(stmt: unknown) {
      statements.push(sqlOf(stmt));
      return stub.execute(stmt);
    },
    async batch(stmts: unknown[]) {
      for (const s of stmts) statements.push(sqlOf(s));
      return stub.batch(stmts);
    },
    close() {
      stub.close();
    },
  };
  return {
    client,
    statements,
    ddl: () => statements.filter((s) => DDL.test(s)),
    rowWrites: () => statements.filter((s) => ROW_WRITE.test(s)),
  };
}

/** The remote database as it stands before the migration command runs. */
function seededRemote(): LibsqlSqliteStub {
  const stub = makeLibsqlSqliteStub();
  stub.raw.prepare(PROBE_DDL).run();
  stub.raw.prepare(PROBE_ROW).run();
  return stub;
}

const tablesOf = (stub: LibsqlSqliteStub) =>
  (stub.raw.prepare(`select name from sqlite_master where type='table' order by name`).all() as Array<{
    name: string;
  }>).map((r) => r.name);

const columnsOf = (stub: LibsqlSqliteStub, table: string) =>
  (stub.raw.prepare(`pragma table_info("${table}")`).all() as Array<{ name: string }>).map((r) => r.name);

const atOf = (stub: LibsqlSqliteStub) =>
  (stub.raw.prepare(`select at from probe where id = 'naive'`).all() as Array<{ at: string }>)[0]?.at;

async function remoteDriver(rec: Recorder): Promise<TursoDriver> {
  const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: rec.client as never });
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  return driver;
}

/** The driver calls a deferred-DDL `os migrate` boot makes, in its order. */
async function deferredBoot(driver: TursoDriver) {
  driver.setDeferredDdl(true);
  await driver.syncSchemasBatch([
    { object: 'probe', schema: PROBE },
    { object: 'fresh', schema: FRESH },
  ]);
  await driver.syncSchema('probe', PROBE);
  return driver.previewDeferredSchemaWork();
}

async function failureOf(work: () => unknown): Promise<WireBearingError | null> {
  try {
    await work();
    return null;
  } catch (err) {
    return err as WireBearingError;
  }
}

describe('remote face — arming the deferral is refused loudly', () => {
  it('the engine boot sync takes the batch door on this driver', async () => {
    const stub = seededRemote();
    const driver = await remoteDriver(record(stub));
    // `ObjectQLPlugin.syncRegisteredSchemas` ANDs exactly these two.
    expect(driver.supports.batchSchemaSync).toBe(true);
    expect(typeof driver.syncSchemasBatch).toBe('function');
    stub.close();
  });

  it('refuses with the NOT_IMPLEMENTED / 501 envelope and names the remote mode', async () => {
    const stub = seededRemote();
    const driver = await remoteDriver(record(stub));

    const failure = await failureOf(() => driver.setDeferredDdl(true));

    expect(failure).toBeInstanceOf(Error);
    expect(failure!.code).toBe('NOT_IMPLEMENTED');
    expect(failure!.status).toBe(501);
    expect(failure!.message.startsWith(REFUSAL_FIRST_SENTENCE)).toBe(true);
    stub.close();
  });

  it('a deferred boot against remote pending schema work performs NOTHING', async () => {
    const stub = seededRemote();
    const rec = record(stub);
    const driver = await remoteDriver(rec);

    const failure = await failureOf(() => deferredBoot(driver));

    expect(failure?.code).toBe('NOT_IMPLEMENTED');
    expect(failure?.status).toBe(501);
    // Nothing reached the wire — so zero DDL and zero row writes by construction…
    expect(rec.statements).toEqual([]);
    expect(rec.ddl()).toEqual([]);
    expect(rec.rowWrites()).toEqual([]);
    // …and the database is exactly as the command found it.
    expect(tablesOf(stub)).toEqual(['probe']);
    expect(columnsOf(stub, 'probe')).toEqual(['id', 'created_at', 'updated_at', 'at']);
    expect(atOf(stub)).toBe(NAIVE);
    stub.close();
  });

  it('disarming is accepted and sends nothing', async () => {
    const stub = seededRemote();
    const rec = record(stub);
    const driver = await remoteDriver(rec);

    expect(() => driver.setDeferredDdl(false)).not.toThrow();
    expect(rec.statements).toEqual([]);
    stub.close();
  });
});

describe('lit control — remote ordinary boot sync (deferral NOT armed) still performs its DDL and backfill', () => {
  it('a refused arm leaves the driver un-armed: the batch door still creates and alters', async () => {
    const stub = seededRemote();
    const rec = record(stub);
    const driver = await remoteDriver(rec);
    expect((await failureOf(() => driver.setDeferredDdl(true)))?.code).toBe('NOT_IMPLEMENTED');

    await driver.syncSchemasBatch([
      { object: 'probe', schema: PROBE },
      { object: 'fresh', schema: FRESH },
    ]);

    expect(rec.ddl()).toEqual([
      expect.stringMatching(/^CREATE TABLE "fresh"/),
      'ALTER TABLE "probe" ADD COLUMN "why" TEXT',
    ]);
    expect(tablesOf(stub)).toEqual(['fresh', 'probe']);
    expect(columnsOf(stub, 'probe')).toContain('why');
    stub.close();
  });

  it('the syncSchema door still runs the canonical backfill, rewriting the stored row', async () => {
    const stub = seededRemote();
    const rec = record(stub);
    const driver = await remoteDriver(rec);

    await driver.syncSchema('probe', PROBE);

    expect(rec.ddl()).toEqual(['ALTER TABLE "probe" ADD COLUMN "why" TEXT']);
    expect(rec.rowWrites().length).toBeGreaterThan(0);
    expect(rec.rowWrites().every((s) => /^\s*update "probe" set "at"/i.test(s))).toBe(true);
    expect(atOf(stub)).toBe('2025-07-28T00:00:00.000Z');
    stub.close();
  });
});

describe.each([
  {
    mode: 'local',
    make: (client: unknown) => {
      void client;
      return new TursoDriver({ url: ':memory:' });
    },
  },
  {
    mode: 'replica',
    make: (client: unknown) =>
      new TursoDriver({
        url: replicaFileUrls.next(),
        syncUrl: 'libsql://primary.turso.io',
        authToken: 'token',
        client: client as never,
        sync: { onConnect: false },
      }),
  },
])('lit control — the $mode face keeps deferring exactly as before', ({ mode, make }) => {
  const tablesIn = async (driver: TursoDriver) =>
    ((await driver.execute(`select name from sqlite_master where type='table'`)) as Array<{ name: string }>)
      .map((r) => r.name);
  const columnsIn = async (driver: TursoDriver, table: string) =>
    ((await driver.execute(`pragma table_info("${table}")`)) as Array<{ name: string }>).map((r) => r.name);

  it('arms, records instead of performing, previews the work, and flushes it on confirm', async () => {
    const stub = makeLibsqlSqliteStub();
    const rec = record(stub);
    const driver = make(rec.client);
    expect(driver.transportMode).toBe(mode);
    await driver.connect();
    await driver.execute(PROBE_DDL);
    await driver.execute(PROBE_ROW);

    const pending = await deferredBoot(driver);

    // Recorded, not performed.
    expect(driver.deferredSchemaObjectCount).toBe(2);
    expect(await tablesIn(driver)).not.toContain('fresh');
    expect(await columnsIn(driver, 'probe')).not.toContain('why');
    expect(pending).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: 'fresh', kind: 'create_table', columns: ['label'] }),
        expect.objectContaining({ table: 'probe', kind: 'add_columns', columns: ['why'] }),
      ]),
    );

    // `apply`, after the operator said yes.
    const performed = await driver.flushDeferredSchemaDdl();
    expect(performed).toEqual(pending);
    expect(await tablesIn(driver)).toContain('fresh');
    expect(await columnsIn(driver, 'probe')).toContain('why');

    // These faces sync through Knex; the libsql client carried no schema work.
    expect(rec.ddl()).toEqual([]);
    await driver.disconnect();
    stub.close();
  });
});
