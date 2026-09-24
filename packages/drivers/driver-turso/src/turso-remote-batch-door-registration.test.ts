// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19844 — the REMOTE `syncSchemasBatch` door finishes the way its two sibling
 * remote doors do: field metadata registered, the table recorded as one this
 * driver created, and the canonical temporal backfill run.
 *
 * ## Why this door is the one that matters
 *
 * `ObjectQLPlugin.syncRegisteredSchemas` takes its batch branch whenever the
 * driver declares `supports.batchSchemaSync` and implements `syncSchemasBatch`.
 * Both hold for `TursoDriver`, so on a remote-Turso deployment this is the only
 * door the engine's boot sync goes through. Its remote arm used to return
 * straight after the DDL, while `syncSchema` and `initObjects` went on to fill
 * the read-coercion registries and run the backfill.
 *
 * Measured once before the fix: an `ObjectKernel` booted with `ObjectQLPlugin`
 * and a remote `TursoDriver` over the SQLite double used below. The boot called
 * `syncSchemasBatch` twice (phase 1 and phase 3) and no other schema door. A
 * declared boolean read back as `1` and a declared JSON field as its stored
 * text, through the driver and through the engine alike. `paginationTieBreaker`
 * answered `null`, and the datetime registry was empty, so the backfill had
 * nothing to converge. That boot is not kept as a test: `@objectstack/objectql`
 * is not a dependency of this package, and the cases below make the very call
 * the boot makes.
 *
 * ## What is pinned
 *
 * 1. All three halves on the batch door, with `syncSchema` and `initObjects`
 *    held to the same expectations as controls: one table, three doors, one
 *    answer. That includes the WRITE side: a `datetime` in a non-canonical
 *    spelling reaches disk in the canonical one.
 * 2. The batch door keys by `object`, never by a `schema.name` that differs.
 * 3. The backfill runs once per batch and converges a pre-existing legacy row.
 * 4. A DDL failure rejects before anything is registered or backfilled.
 */

import { describe, it, expect, vi, assert } from 'vitest';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, asLibsqlClient, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

/** The reproduction's object: one boolean, one JSON field, no `name`. */
const W_SCHEMA = { fields: { flag: { type: 'boolean' }, meta: { type: 'json' } } };

/** One declared `datetime`, for the write-side pin. */
const STAMP_SCHEMA = { fields: { at: { type: 'datetime' } } };

type Door = 'syncSchemasBatch' | 'syncSchema' | 'initObjects';

/** Each remote schema door, driven the way its real caller drives it. */
const DOORS: Record<Door, (driver: TursoDriver, object: string, schema: Record<string, any>) => Promise<void>> = {
  // `ObjectQLPlugin.syncRegisteredSchemas`' batch branch: `{ object: tableName, schema: obj }`.
  syncSchemasBatch: (driver, object, schema) => driver.syncSchemasBatch([{ object, schema }]),
  syncSchema: (driver, object, schema) => driver.syncSchema(object, schema),
  initObjects: (driver, object, schema) => driver.initObjects([{ ...schema, name: object }]),
};

async function remoteDriver(stub: LibsqlSqliteStub = makeLibsqlSqliteStub()) {
  const driver = new TursoDriver({ url: 'libsql://doors.turso.io', client: asLibsqlClient(stub) });
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  return { driver, stub };
}

/** The protected answer the remote read path asks before paging. */
const tieBreaker = (driver: TursoDriver, object: string) =>
  (driver as unknown as { paginationTieBreaker(o: string): string | null }).paginationTieBreaker(object);

const booleanFieldsOf = (driver: TursoDriver, object: string) =>
  (driver as unknown as { booleanFields: Record<string, string[] | undefined> }).booleanFields[object];

const isMarkedCanonical = (driver: TursoDriver, table: string, field: string) =>
  (driver as unknown as { canonicalDatetimeFields: Record<string, Set<string> | undefined> })
    .canonicalDatetimeFields[table]?.has(field) === true;

const tablesOf = (stub: LibsqlSqliteStub) =>
  (stub.raw.prepare(`select name from sqlite_master where type='table' order by name`).all() as Array<{
    name: string;
  }>).map((r) => r.name);

describe.each<Door>(['syncSchemasBatch', 'syncSchema', 'initObjects'])(
  'remote schema door `%s` — what a synced object reads back',
  (door) => {
    it('a declared boolean reads back as a boolean and a declared JSON field as an object', async () => {
      const { driver, stub } = await remoteDriver();
      await DOORS[door](driver, 'w', W_SCHEMA);

      const created = await driver.create('w', { flag: true, meta: { k: 1 } });
      const row = await driver.findOne('w', { where: { id: created.id } });

      assert(row !== null, 'findOne answered the not-found arm for the id create() returned');
      expect(row.flag).toBe(true);
      expect(row.meta).toEqual({ k: 1 });
      // Non-vacuous: the disk holds the storage forms, so the values above are
      // the driver's read coercion at work and not what SQLite handed back.
      expect(stub.raw.prepare(`select flag, meta from "w"`).all()).toEqual([{ flag: 1, meta: '{"k":1}' }]);

      await driver.disconnect();
    });

    it('a datetime written in a non-canonical spelling lands on disk in the canonical one', async () => {
      const { driver, stub } = await remoteDriver();
      await DOORS[door](driver, 'stamp', STAMP_SCHEMA);

      await driver.create('stamp', { id: 'offset', at: '2025-07-28T08:00:00+08:00' });

      // The raw cell, not a read: the write path canonicalises only a field it
      // has registered as a datetime, so this is the registration at work on
      // the WRITE side. Unregistered, the offset string is stored as sent.
      expect(stub.raw.prepare(`select at from "stamp" where id = 'offset'`).all()).toEqual([
        { at: '2025-07-28T00:00:00.000Z' },
      ]);

      await driver.disconnect();
    });

    it('records the table as one this driver created, so a paged read gets the `id` tie-breaker', async () => {
      const { driver } = await remoteDriver();
      expect(tieBreaker(driver, 'w')).toBeNull();

      await DOORS[door](driver, 'w', W_SCHEMA);

      expect(tieBreaker(driver, 'w')).toBe('id');
      await driver.disconnect();
    });
  },
);

describe('remote `syncSchemasBatch` — keying, backfill, and order', () => {
  it('keys by `object`, never by a `schema.name` that differs from it', async () => {
    const { driver } = await remoteDriver();
    await driver.syncSchemasBatch([{ object: 'w', schema: { name: 'legacy__w', ...W_SCHEMA } }]);

    expect(booleanFieldsOf(driver, 'w')).toEqual(['flag']);
    expect(tieBreaker(driver, 'w')).toBe('id');
    expect(booleanFieldsOf(driver, 'legacy__w')).toBeUndefined();
    expect(tieBreaker(driver, 'legacy__w')).toBeNull();

    await driver.disconnect();
  });

  it('runs the canonical backfill once for the whole batch and converges a legacy row', async () => {
    const stub = makeLibsqlSqliteStub();
    stub.raw
      .prepare(`create table "probe" ("id" TEXT PRIMARY KEY, "created_at" TEXT, "updated_at" TEXT, "at" TEXT)`)
      .run();
    stub.raw.prepare(`insert into probe (id, at) values ('naive', '2025-07-28 00:00:00')`).run();
    const { driver } = await remoteDriver(stub);
    const backfill = vi.spyOn(driver, 'backfillRemoteCanonicalTemporal');

    await driver.syncSchemasBatch([
      { object: 'probe', schema: { name: 'probe', fields: { at: { type: 'datetime' } } } },
      { object: 'fresh', schema: { name: 'fresh', fields: { at: { type: 'datetime' } } } },
    ]);

    expect(backfill).toHaveBeenCalledTimes(1);
    expect(stub.raw.prepare(`select at from probe where id = 'naive'`).all()).toEqual([
      { at: '2025-07-28T00:00:00.000Z' },
    ]);
    expect(isMarkedCanonical(driver, 'probe', 'at')).toBe(true);
    expect(isMarkedCanonical(driver, 'fresh', 'at')).toBe(true);

    await driver.disconnect();
  });

  it('a DDL failure rejects before anything is registered or backfilled', async () => {
    const INJECTED = new Error('injected: the DDL batch failed');
    const stub = makeLibsqlSqliteStub();
    const failing: LibsqlSqliteStub = {
      ...stub,
      async batch(stmts) {
        const sqls = stmts.map((s) => (typeof s === 'string' ? s : String((s as { sql?: unknown }).sql ?? '')));
        if (sqls.some((sql) => /^\s*(create|alter)\b/i.test(sql))) throw INJECTED;
        return stub.batch(stmts);
      },
    };
    const { driver } = await remoteDriver(failing);
    const backfill = vi.spyOn(driver, 'backfillRemoteCanonicalTemporal');

    await expect(driver.syncSchemasBatch([{ object: 'w', schema: W_SCHEMA }])).rejects.toBe(INJECTED);

    expect(tablesOf(stub)).not.toContain('w');
    expect(tieBreaker(driver, 'w')).toBeNull();
    expect(booleanFieldsOf(driver, 'w')).toBeUndefined();
    expect(backfill).not.toHaveBeenCalled();

    await driver.disconnect();
  });
});
