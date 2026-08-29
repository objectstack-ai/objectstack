// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Deferred schema DDL (#3917).
 *
 * `os migrate plan` promises a dry run and `os migrate apply` promises a
 * confirmation prompt, but boot schema-sync used to run create-table /
 * add-column DDL against the target database before either promise was kept.
 * With the deferral armed, `initObjects` must register everything drift
 * detection depends on and change nothing physical until it is flushed.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from './sql-driver.js';

function makeDriver() {
  return new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
}

const WIDGET = {
  name: 'widgets',
  fields: {
    sku: { type: 'text' },
    qty: { type: 'number' },
  },
};

describe('SqlDriver deferred schema DDL (#3917)', () => {
  let driver: SqlDriver;

  afterEach(async () => {
    await driver.disconnect();
  });

  it('creates nothing while deferred, and still registers drift metadata', async () => {
    driver = makeDriver();
    driver.setDeferredDdl(true);
    await driver.initObjects([WIDGET]);

    const k = (driver as any).knex;
    expect(await k.schema.hasTable('widgets')).toBe(false);
    // The authoritative field set drift detection diffs against is populated —
    // deferring the DDL must not blind `detectManagedDrift`.
    expect((driver as any).managedObjectFields.has('widgets')).toBe(true);
    expect(driver.deferredSchemaObjectCount).toBe(1);
  });

  it('previews a missing table as create_table without creating it', async () => {
    driver = makeDriver();
    driver.setDeferredDdl(true);
    await driver.initObjects([WIDGET]);

    const pending = await driver.previewDeferredSchemaWork();
    expect(pending).toEqual([
      { table: 'widgets', kind: 'create_table', columns: ['sku', 'qty'] },
    ]);
    expect(await (driver as any).knex.schema.hasTable('widgets')).toBe(false);
  });

  it('previews only the MISSING columns of an existing table', async () => {
    driver = makeDriver();
    // Table exists with `sku` only.
    await driver.initObjects([{ name: 'widgets', fields: { sku: { type: 'text' } } }]);

    driver.setDeferredDdl(true);
    await driver.initObjects([WIDGET]);

    expect(await driver.previewDeferredSchemaWork()).toEqual([
      { table: 'widgets', kind: 'add_columns', columns: ['qty'] },
    ]);
    const info = await (driver as any).knex('widgets').columnInfo();
    expect(Object.keys(info)).not.toContain('qty');
  });

  it('reports nothing pending when the database already matches metadata', async () => {
    driver = makeDriver();
    await driver.initObjects([WIDGET]);

    driver.setDeferredDdl(true);
    await driver.initObjects([WIDGET]);

    expect(await driver.previewDeferredSchemaWork()).toEqual([]);
  });

  it('flush performs the deferred work, reports it, and disarms the deferral', async () => {
    driver = makeDriver();
    driver.setDeferredDdl(true);
    await driver.initObjects([WIDGET]);

    const performed = await driver.flushDeferredSchemaDdl();
    expect(performed).toEqual([
      { table: 'widgets', kind: 'create_table', columns: ['sku', 'qty'] },
    ]);

    const k = (driver as any).knex;
    expect(await k.schema.hasTable('widgets')).toBe(true);
    expect(Object.keys(await k('widgets').columnInfo()).sort())
      .toEqual(['created_at', 'id', 'qty', 'sku', 'updated_at']);
    expect(driver.deferredSchemaObjectCount).toBe(0);

    // Disarmed: a later sync goes straight through again.
    await driver.initObjects([{ name: 'gadgets', fields: { label: { type: 'text' } } }]);
    expect(await k.schema.hasTable('gadgets')).toBe(true);
  });

  it('flush is a no-op when nothing was deferred', async () => {
    driver = makeDriver();
    driver.setDeferredDdl(true);
    expect(await driver.flushDeferredSchemaDdl()).toEqual([]);
  });

  it('holds back the auto_number sequences table too', async () => {
    driver = makeDriver();
    driver.setDeferredDdl(true);
    await driver.initObjects([
      { name: 'invoices', fields: { no: { type: 'auto_number', format: '{0000}' } } },
    ]);

    const k = (driver as any).knex;
    // `ensureSequencesTable` is DDL and rode outside the per-object loop —
    // deferral has to cover it or "nothing is written" is a lie.
    expect(await k.schema.hasTable('_objectstack_sequences')).toBe(false);

    await driver.flushDeferredSchemaDdl();
    expect(await k.schema.hasTable('_objectstack_sequences')).toBe(true);
  });

  it('leaves the default (undeferred) path exactly as before', async () => {
    driver = makeDriver();
    await driver.initObjects([WIDGET]);
    expect(await (driver as any).knex.schema.hasTable('widgets')).toBe(true);
    expect(driver.deferredSchemaObjectCount).toBe(0);
    expect(await driver.previewDeferredSchemaWork()).toEqual([]);
  });

  // ── #3978: the plan may only promise work the flush can deliver ───────────
  //
  // The mirror image of #3954. That one closed "the plan understates what apply
  // does"; this closes "the plan promises what apply cannot do". `createColumn`
  // returns early for a virtual `formula` field — no column is ever created —
  // but the preview listed every declared field name regardless, so a formula
  // field showed up as pending `add_columns` that `apply` reported as performed
  // without doing anything, and the next `plan` reported it again, forever.
  // Both sides must answer "does this field become a column?" the same way.
  describe('virtual fields are never promised as pending work (#3978)', () => {
    const CONTACT = {
      name: 'contacts',
      fields: {
        first_name: { type: 'text' },
        last_name: { type: 'text' },
        // Virtual — computed on read, no physical column (see createColumn).
        full_name: { type: 'formula', expression: 'record.first_name' },
        // `multiple` is NOT virtual: it materializes as a JSON column.
        tags: { type: 'text', multiple: true },
      },
    };

    it('omits the formula field from a create_table preview, keeps the JSON column', async () => {
      driver = makeDriver();
      driver.setDeferredDdl(true);
      await driver.initObjects([CONTACT]);

      expect(await driver.previewDeferredSchemaWork()).toEqual([
        { table: 'contacts', kind: 'create_table', columns: ['first_name', 'last_name', 'tags'] },
      ]);
    });

    it('omits it from an add_columns preview too', async () => {
      driver = makeDriver();
      await driver.initObjects([{ name: 'contacts', fields: { first_name: { type: 'text' } } }]);

      driver.setDeferredDdl(true);
      await driver.initObjects([CONTACT]);

      expect(await driver.previewDeferredSchemaWork()).toEqual([
        { table: 'contacts', kind: 'add_columns', columns: ['last_name', 'tags'] },
      ]);
    });

    it('converges: after a flush the next preview is empty', async () => {
      // The defect proper. Pre-fix the second preview still reported
      // `add_columns: ['full_name']` — a freshly-applied database looking
      // permanently un-migrated, with no apply able to clear it.
      driver = makeDriver();
      driver.setDeferredDdl(true);
      await driver.initObjects([CONTACT]);
      await driver.flushDeferredSchemaDdl();

      driver.setDeferredDdl(true);
      await driver.initObjects([CONTACT]);
      expect(await driver.previewDeferredSchemaWork()).toEqual([]);
    });

    it('what flush REPORTS having done matches the columns it actually created', async () => {
      driver = makeDriver();
      driver.setDeferredDdl(true);
      await driver.initObjects([CONTACT]);

      const performed = await driver.flushDeferredSchemaDdl();
      const create = performed.find((p) => p.kind === 'create_table')!;
      const physical = new Set(Object.keys(await (driver as any).knex('contacts').columnInfo()));

      // Every promised column exists...
      for (const c of create.columns) expect(physical.has(c)).toBe(true);
      // ...and the virtual one was neither promised nor created.
      expect(create.columns).not.toContain('full_name');
      expect(physical.has('full_name')).toBe(false);
    });
  });
});

/**
 * #13028 — a deferred `initObjects` does not ensure the database EXISTS either.
 *
 * `ensureDatabaseExists()` is the one line in `initObjects` that can write
 * while nothing else does: it `mkdir -p`s a sqlite parent directory and, on
 * Postgres/MySQL, issues `SELECT 1` and CREATEs the database when that comes
 * back `3D000` / `ER_BAD_DB_ERROR`. Under the deferral every DDL branch is
 * skipped in favour of recording the work, so there is no DDL for a database
 * to exist for — and #6743's promise ("a plan must not bring a database into
 * existence") was only being kept for sqlite, by the CLI, one layer up.
 *
 * The cost half is why it is measured rather than merely tidied: `os migrate
 * plan` on a composed control plane registers ~80 objects one call at a time,
 * and a `SELECT 1` per call is ~80 round-trips against a database the command
 * is never going to touch.
 */
describe('deferred initObjects does not ensure the database exists (#13028)', () => {
  let driver: SqlDriver;

  afterEach(async () => {
    await driver.disconnect();
  });

  it('skips the probe while deferred', async () => {
    driver = makeDriver();
    const calls: string[] = [];
    (driver as any).ensureDatabaseExists = async () => { calls.push('ensure'); };

    driver.setDeferredDdl(true);
    await driver.initObjects([WIDGET]);

    expect(calls).toEqual([]);
    // …and the registration the deferral exists to preserve still happened.
    expect((driver as any).managedObjectFields.has('widgets')).toBe(true);
    expect(driver.deferredSchemaObjectCount).toBe(1);
  });

  it('still runs it on a NON-deferred sync — the guarantee for real DDL is unchanged', async () => {
    driver = makeDriver();
    const calls: string[] = [];
    const real = (driver as any).ensureDatabaseExists.bind(driver);
    (driver as any).ensureDatabaseExists = async () => { calls.push('ensure'); await real(); };

    await driver.initObjects([WIDGET]);

    expect(calls).toEqual(['ensure']);
    expect(await (driver as any).knex.schema.hasTable('widgets')).toBe(true);
  });

  it('runs it on the FLUSH, before the first CREATE TABLE', async () => {
    driver = makeDriver();
    driver.setDeferredDdl(true);
    await driver.initObjects([WIDGET]);

    // Instrumented only now, so what it records is about the flush alone.
    const order: string[] = [];
    const realEnsure = (driver as any).ensureDatabaseExists.bind(driver);
    (driver as any).ensureDatabaseExists = async () => {
      // Recorded together with the state of the world at that moment: "before
      // the first CREATE TABLE" is the claim, and the table's absence here is
      // what proves it rather than call ORDER alone.
      order.push(`ensure(table=${await (driver as any).knex.schema.hasTable('widgets')})`);
      await realEnsure();
    };

    await driver.flushDeferredSchemaDdl();

    expect(order).toEqual(['ensure(table=false)']);
    expect(await (driver as any).knex.schema.hasTable('widgets')).toBe(true);
  });
});
