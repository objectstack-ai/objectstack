// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: SQLite introspection must report EVERY member of a composite primary
 * key, in DECLARED KEY ORDER.
 *
 * `PRAGMA table_info` does not report `pk` as a boolean. It reports the
 * column's **1-based position within the primary key** — `0` for "not part of
 * the key", `1` for the first key column, `2` for the second, and so on.
 * `introspectPrimaryKeys` previously filtered on `pk === 1`, which kept only
 * the first member of a composite key and silently dropped the rest.
 *
 * Both output signals were wrong together and for the same reason:
 * `introspectSchema` derives `col.primaryKey` FROM `primaryKeys`
 * (`if (primaryKeys.includes(col.name)) col.primaryKey = true`), so a consumer
 * could not recover the missing member by cross-checking the two. Both are
 * asserted here.
 *
 * `SqliteWasmDriver` and `TursoDriver` extend `SqlDriver` and override neither
 * `introspectPrimaryKeys` nor `introspectSchema`, so they inherit this arm.
 * Only the better-sqlite3 binding is executed here.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

/**
 * The consumer-visible consequence, modelled locally: comparing a DECLARED
 * composite key against what introspection recovered. This is what
 * schema-drift comparison and the federated `external_catalog` addressing key
 * do with `primaryKeys` — an under-reported member reads as drift.
 *
 * Order-sensitive on purpose: `pk` is an ordinal, so a key reported in column
 * order rather than declared-key order is a different key for addressing and
 * upsert-conflict-target purposes.
 */
function compareDeclaredKey(declared: string[], introspected: string[]): string[] {
  const findings: string[] = [];
  for (const col of declared) {
    if (!introspected.includes(col)) findings.push(`missing_key_member:${col}`);
  }
  for (const col of introspected) {
    if (!declared.includes(col)) findings.push(`unexpected_key_member:${col}`);
  }
  if (findings.length === 0 && declared.join(',') !== introspected.join(',')) {
    findings.push(`key_order_mismatch:${declared.join(',')}!=${introspected.join(',')}`);
  }
  return findings;
}

describe('SqlDriver composite primary-key introspection (SQLite)', () => {
  let driver: SqlDriver;
  let knexInstance: any;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    knexInstance = (driver as any).knex;
  });

  afterEach(async () => {
    await knexInstance.destroy();
  });

  it('pins the SQLite fact this repair rests on: `pk` is a 1-based ordinal, not a boolean', async () => {
    await knexInstance.schema.createTable('order_lines', (t: any) => {
      t.string('order_id').notNullable();
      t.integer('line_no').notNullable();
      t.string('sku');
      t.primary(['order_id', 'line_no']);
    });

    const rows: any[] = await knexInstance.raw('PRAGMA table_info(order_lines)');
    const pkByName = Object.fromEntries(rows.map((r) => [r.name, r.pk]));

    // If SQLite ever reported `pk` as a boolean, the fix below would be wrong.
    expect(pkByName).toEqual({ order_id: 1, line_no: 2, sku: 0 });
  });

  it('reports every member of a composite key, and derives primaryKey for all of them', async () => {
    await knexInstance.schema.createTable('order_lines', (t: any) => {
      t.string('order_id').notNullable();
      t.integer('line_no').notNullable();
      t.string('sku');
      t.primary(['order_id', 'line_no']);
    });

    const schema = await driver.introspectSchema();
    const table = schema.tables['order_lines'];

    // Signal 1: the table-level list. `line_no` was dropped before the fix.
    expect(table.primaryKeys).toEqual(['order_id', 'line_no']);

    // Signal 2: the per-column flag, derived FROM signal 1 — repaired with it.
    const primaryKeyByName = Object.fromEntries(table.columns.map((c) => [c.name, c.primaryKey === true]));
    expect(primaryKeyByName).toEqual({ order_id: true, line_no: true, sku: false });
  });

  it('orders primaryKeys by pk ordinal, not by column position', async () => {
    // Declared key order (shipment_id, carrier_code) deliberately differs from
    // column order (carrier_code, shipment_id, leg_seq): iterating table_info
    // rows in row order would yield the columns in the wrong key order.
    await knexInstance.schema.createTable('shipment_legs', (t: any) => {
      t.string('carrier_code').notNullable();
      t.string('shipment_id').notNullable();
      t.integer('leg_seq');
      t.primary(['shipment_id', 'carrier_code']);
    });

    const rows: any[] = await knexInstance.raw('PRAGMA table_info(shipment_legs)');
    // Row order is column order; the ordinals run against it.
    expect(rows.map((r) => [r.name, r.pk])).toEqual([
      ['carrier_code', 2],
      ['shipment_id', 1],
      ['leg_seq', 0],
    ]);

    const schema = await driver.introspectSchema();
    expect(schema.tables['shipment_legs'].primaryKeys).toEqual(['shipment_id', 'carrier_code']);
  });

  it('reads as NO drift when a declared composite key is compared against introspection', async () => {
    await knexInstance.schema.createTable('order_lines', (t: any) => {
      t.string('order_id').notNullable();
      t.integer('line_no').notNullable();
      t.string('sku');
      t.primary(['order_id', 'line_no']);
    });

    const schema = await driver.introspectSchema();
    const introspected = schema.tables['order_lines'].primaryKeys;

    expect(compareDeclaredKey(['order_id', 'line_no'], introspected)).toEqual([]);

    // Negative control: the comparison above is a real detector, not a
    // vacuously-empty one. A genuinely different declared key still drifts.
    expect(compareDeclaredKey(['order_id', 'warehouse_id'], introspected)).toEqual([
      'missing_key_member:warehouse_id',
      'unexpected_key_member:line_no',
    ]);
    expect(compareDeclaredKey(['line_no', 'order_id'], introspected)).toEqual([
      'key_order_mismatch:line_no,order_id!=order_id,line_no',
    ]);
  });

  it('still reports a single-column key exactly, and an unkeyed table as empty', async () => {
    await knexInstance.schema.createTable('widgets', (t: any) => {
      t.string('id').primary();
      t.string('name');
    });

    // No primary key at all: every `pk` is 0. Guards the repair against
    // becoming `pk >= 0`, which would report every column as a key member.
    await knexInstance.schema.createTable('audit_lines', (t: any) => {
      t.string('actor');
      t.string('action');
    });

    const schema = await driver.introspectSchema();

    expect(schema.tables['widgets'].primaryKeys).toEqual(['id']);
    expect(schema.tables['audit_lines'].primaryKeys).toEqual([]);

    const auditPrimary = schema.tables['audit_lines'].columns.map((c) => c.primaryKey === true);
    expect(auditPrimary).toEqual([false, false]);
  });
});
