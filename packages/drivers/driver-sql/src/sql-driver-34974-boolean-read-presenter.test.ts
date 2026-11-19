// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34974] `distinct()` and an `aggregate()` group key present a declared
 * `Field.boolean` the way `find()` presents it: the stored `0` / `'0'` /
 * `'false'` read as `false`, and `1` / `'1'` / `'true'` as `true`.
 *
 * `presentReadValue`'s `'boolean'` arm was `Boolean(value)`, while the row read
 * (`formatOutput`) has read the text spellings as their boolean since #34916.
 * On a column with TEXT affinity (one whose type changed to boolean without a
 * rebuild) the boot's storage convergence rewrites a legacy `'false'` to `0`,
 * which the affinity stores as the text `'0'`, and it leaves a `'0'` alone
 * because it already reads as `false` on a row. `Boolean('0')` is `true`, so
 * `distinct()` answered `[true]` for a column of un-ticked rows and a group-by
 * put every row in a `true` bucket.
 *
 * Two columns: an INTEGER-form boolean column the driver creates (with the
 * pre-#34916 text `'true'` / `'false'` written past the driver, the form a
 * boot that has not converged it yet still holds), and a TEXT-affinity column
 * after a boot.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';

const INT_TABLE = 'bool_presenter_int_34974';
const TXT_TABLE = 'bool_presenter_txt_34974';

function sqliteDriver(): SqlDriver {
  return new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
}

/** The group-by answer as `[flag, count]` pairs, sorted by the flag's text. */
async function groupCounts(driver: SqlDriver, table: string, groupBy: DriverQuery['groupBy'], key: string): Promise<Array<[unknown, number]>> {
  const rows = (await driver.aggregate(table, {
    groupBy,
    aggregations: [{ function: 'count', field: 'id', alias: 'n' }],
  } as DriverQuery)) as Array<Record<string, unknown>>;
  return rows
    .map((r): [unknown, number] => [r[key], Number(r.n)])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

describe('[#34974] driver-sql — distinct and aggregate present an INTEGER boolean column as find() does (sqlite)', () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = sqliteDriver();
    await driver.initObjects([{ name: INT_TABLE, fields: { label: { type: 'string' }, flag: { type: 'boolean' } } }]);
    const knex = (driver as any).knex;
    // Written past the driver, after the table was created: the convergence
    // has not seen these rows, so the text spellings are still text.
    await knex(INT_TABLE).insert([
      { id: 'int_one', label: 'int_one', flag: 1 },
      { id: 'text_true', label: 'text_true', flag: 'true' },
      { id: 'text_false', label: 'text_false', flag: 'false' },
    ]);
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  it('the fixture: the column holds the integer 1 and the text true / false', async () => {
    const rows = await (driver as any).knex.raw(`select id, typeof(flag) as t from ${INT_TABLE} order by id`);
    expect(Object.fromEntries(rows.map((r: any) => [r.id, r.t]))).toEqual({ int_one: 'integer', text_false: 'text', text_true: 'text' });
  });

  it('find() is the reference: the text false reads as false', async () => {
    const rows = (await driver.find(INT_TABLE, { orderBy: [{ field: 'id', order: 'asc' }] } as DriverQuery)) as any[];
    expect(rows.map((r) => [r.id, r.flag])).toEqual([['int_one', true], ['text_false', false], ['text_true', true]]);
  });

  it('distinct() answers false and true, not true alone', async () => {
    const values = await driver.distinct(INT_TABLE, 'flag');
    expect([...values].sort()).toEqual([false, true]);
  });

  it('an aggregate group key presents the text false as false', async () => {
    // The stored values stay three groups (SQL groups the raw cells); each presents as find() does.
    expect(await groupCounts(driver, INT_TABLE, ['flag'], 'flag')).toEqual([[false, 1], [true, 1], [true, 1]]);
  });

  it('an aliased group key presents the same way', async () => {
    expect(await groupCounts(driver, INT_TABLE, [{ field: 'flag', alias: 'ticked' }] as any, 'ticked'))
      .toEqual([[false, 1], [true, 1], [true, 1]]);
  });
});

describe('[#34974] driver-sql — distinct and aggregate present a TEXT-affinity boolean column as find() does (sqlite)', () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = sqliteDriver();
    const knex = (driver as any).knex;
    // A column whose type changed to boolean without a rebuild keeps TEXT
    // affinity (a `text` field retyped to `boolean` boots onto the same column).
    await knex.raw(`create table ${TXT_TABLE} (id varchar(255) primary key, label varchar(255), flag text)`);
    await knex(TXT_TABLE).insert([
      { id: 'canon_zero', label: 'canon_zero', flag: '0' },
      { id: 'legacy_false_a', label: 'legacy_false_a', flag: 'false' },
      { id: 'legacy_false_b', label: 'legacy_false_b', flag: 'false' },
      { id: 'legacy_true', label: 'legacy_true', flag: 'true' },
    ]);
    // The boot: the storage convergence rewrites the legacy text to `1` / `0`,
    // which this affinity stores as the text '1' / '0'.
    await driver.initObjects([{ name: TXT_TABLE, fields: { label: { type: 'string' }, flag: { type: 'boolean' } } }]);
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  it('the fixture: after the boot, every cell is the text 0 or 1', async () => {
    const rows = await (driver as any).knex.raw(`select id, flag, typeof(flag) as t from ${TXT_TABLE} order by id`);
    expect(rows.map((r: any) => [r.id, r.flag, r.t])).toEqual([
      ['canon_zero', '0', 'text'],
      ['legacy_false_a', '0', 'text'],
      ['legacy_false_b', '0', 'text'],
      ['legacy_true', '1', 'text'],
    ]);
  });

  it('find() is the reference: the text 0 reads as false', async () => {
    const rows = (await driver.find(TXT_TABLE, { orderBy: [{ field: 'id', order: 'asc' }] } as DriverQuery)) as any[];
    expect(rows.map((r) => [r.id, r.flag])).toEqual([
      ['canon_zero', false], ['legacy_false_a', false], ['legacy_false_b', false], ['legacy_true', true],
    ]);
  });

  it('distinct() answers false and true, not true alone', async () => {
    const values = await driver.distinct(TXT_TABLE, 'flag');
    expect([...values].sort()).toEqual([false, true]);
  });

  it('an aggregate group key counts three false and one true', async () => {
    expect(await groupCounts(driver, TXT_TABLE, ['flag'], 'flag')).toEqual([[false, 3], [true, 1]]);
  });

  it('an aliased group key presents the same way', async () => {
    expect(await groupCounts(driver, TXT_TABLE, [{ field: 'flag', alias: 'ticked' }] as any, 'ticked'))
      .toEqual([[false, 3], [true, 1]]);
  });
});
