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
});
