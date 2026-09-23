// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Deferred schema DDL on the Turso REMOTE face — the MEASUREMENT.
 *
 * `os migrate plan` / `apply` / `duplicates` / `account-issuer` /
 * `multi-value-columns` boot with `deferSchemaDdl: true`, which arms the
 * driver through the inherited `SqlDriver.setDeferredDdl(true)` and then reads
 * `previewDeferredSchemaWork()` for the plan. This file replays, against a
 * remote-mode `TursoDriver` over a real SQLite database wearing the
 * `@libsql/client` interface, the exact driver calls that boot makes:
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
 * ## The three predictions, as measured on origin/main
 *
 * | prediction | door | verdict |
 * |:--|:--|:--|
 * | (a) the dry run performs DDL | `syncSchemasBatch` (engine boot sync) | MEASURED — `CREATE TABLE "fresh"`, `ALTER TABLE "probe" ADD COLUMN "why"` |
 * | (a) | `syncSchema` / `initObjects` (coverage pass, direct) | MEASURED — the same CREATE/ALTER |
 * | (b) the dry run rewrites rows (canonical temporal backfill) | `syncSchemasBatch` | REFUTED — no row write on this door |
 * | (b) | `syncSchema` / `initObjects` | MEASURED — `update "probe" set "at" = …`, the naive value is rewritten on disk |
 * | (c) the plan reports no pending work | every door | MEASURED — `previewDeferredSchemaWork()` and `flushDeferredSchemaDdl()` both answer `[]` |
 *
 * No door emitted a destructive statement (no `DROP`, no type change); the
 * backfill rewrites a value's spelling, not the instant it names.
 */

import { describe, it, expect } from 'vitest';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

/** A pre-existing remote table missing one declared column, holding a non-canonical datetime. */
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
  stub.raw
    .prepare(
      `create table "probe" ("id" TEXT PRIMARY KEY, "created_at" TEXT, "updated_at" TEXT, "at" TEXT)`,
    )
    .run();
  stub.raw.prepare(`insert into probe (id, at) values ('naive', ?)`).run(NAIVE);
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

describe('measured on origin/main: a deferred-DDL boot against a REMOTE TursoDriver', () => {
  it('the engine boot sync takes the batch door on this driver', async () => {
    const stub = seededRemote();
    const driver = await remoteDriver(record(stub));
    // `ObjectQLPlugin.syncRegisteredSchemas` ANDs exactly these two.
    expect(driver.supports.batchSchemaSync).toBe(true);
    expect(typeof driver.syncSchemasBatch).toBe('function');
    stub.close();
  });

  it('prediction (a) DDL — MEASURED: arming is accepted and the boot sync still issues CREATE/ALTER', async () => {
    const stub = seededRemote();
    const rec = record(stub);
    const driver = await remoteDriver(rec);

    expect(() => driver.setDeferredDdl(true)).not.toThrow();
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

  it('prediction (b) backfill — batch door: REFUTED (no row rewrite on the engine boot path)', async () => {
    const stub = seededRemote();
    const rec = record(stub);
    const driver = await remoteDriver(rec);

    driver.setDeferredDdl(true);
    await driver.syncSchemasBatch([{ object: 'probe', schema: PROBE }]);

    expect(rec.rowWrites()).toEqual([]);
    expect(atOf(stub)).toBe(NAIVE);
    stub.close();
  });

  it('prediction (b) backfill — syncSchema door: MEASURED (the coverage pass rewrites stored rows)', async () => {
    const stub = seededRemote();
    const rec = record(stub);
    const driver = await remoteDriver(rec);

    driver.setDeferredDdl(true);
    await driver.syncSchema('probe', PROBE);

    expect(rec.ddl()).toEqual(['ALTER TABLE "probe" ADD COLUMN "why" TEXT']);
    expect(rec.rowWrites().length).toBeGreaterThan(0);
    expect(rec.rowWrites().every((s) => /^\s*update "probe" set "at"/i.test(s))).toBe(true);
    expect(atOf(stub)).not.toBe(NAIVE);
    stub.close();
  });

  it('prediction (b) backfill — initObjects door: MEASURED', async () => {
    const stub = seededRemote();
    const rec = record(stub);
    const driver = await remoteDriver(rec);

    driver.setDeferredDdl(true);
    await driver.initObjects([PROBE]);

    expect(rec.ddl()).toEqual(['ALTER TABLE "probe" ADD COLUMN "why" TEXT']);
    expect(rec.rowWrites().length).toBeGreaterThan(0);
    expect(atOf(stub)).not.toBe(NAIVE);
    stub.close();
  });

  it('prediction (c) no pending work — MEASURED: preview and flush both answer nothing', async () => {
    const stub = seededRemote();
    const rec = record(stub);
    const driver = await remoteDriver(rec);

    driver.setDeferredDdl(true);
    await driver.syncSchemasBatch([
      { object: 'probe', schema: PROBE },
      { object: 'fresh', schema: FRESH },
    ]);
    await driver.syncSchema('probe', PROBE);

    expect(driver.deferredSchemaObjectCount).toBe(0);
    expect(await driver.previewDeferredSchemaWork()).toEqual([]);
    // What `apply` reports as performed after its confirm prompt — the work
    // it confirmed had already happened during boot.
    expect(await driver.flushDeferredSchemaDdl()).toEqual([]);
    expect(rec.ddl().length).toBeGreaterThan(0);
    stub.close();
  });
});
