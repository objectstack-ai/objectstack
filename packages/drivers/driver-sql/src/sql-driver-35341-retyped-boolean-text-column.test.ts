// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35341] On SQLite, a `text` field retyped to `boolean` keeps its TEXT
 * column, and the driver's own boolean writes landed there as the text
 * `'1.0'` / `'0.0'`: knex binds a JS boolean as `Number(b)`, better-sqlite3
 * binds a JS number as a REAL, and TEXT affinity keeps the REAL as text. The
 * row read presented both as `true` (`presentStoredBoolean('0.0')` is
 * `Boolean('0.0')`), so a stored `false` read as `true` through `find()` and
 * `distinct()`, while the `= false` comparand, bound the same way, matched
 * `'0.0'` and missed the `'0'` rows the boot convergence writes on that column.
 *
 * The write and the comparand now bind `sqliteBooleanBinding`'s `'1'` / `'0'`,
 * which a TEXT-affinity column keeps as that text and the NUMERIC affinity of a
 * column the driver created folds into the INTEGER `1` / `0`; the boot
 * convergence rewrites the `'1.0'` / `'0.0'` rows already stored. Three
 * describes: the retyped column's new writes, its existing rows across a
 * boot, and the CONTROL — an INTEGER-form boolean column the driver created,
 * whose stored form and answers do not change.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';

const RETYPED = 'bool_retyped_35341';
const EXISTING = 'bool_retyped_existing_35341';
const CONTROL = 'bool_integer_35341';

interface Logged { msg: string; meta?: any }

function sqliteDriver(): SqlDriver {
  return new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
}

const asText = (name: string) => ({ name, fields: { label: { type: 'string' }, flag: { type: 'text' } } });
const asBoolean = (name: string) => ({ name, fields: { label: { type: 'string' }, flag: { type: 'boolean' } } });

/** The rows every write door leaves, by id: which boolean each one was last written as. */
const WRITTEN: Record<string, boolean> = {
  bulk_false: false, bulk_true: true, bulkupd_false: false, create_false: false, create_true: true,
  many_false: false, update_false: false, upsert_false: false,
};

/** Write `WRITTEN` through every door: create, update, upsert, bulkCreate, bulkUpdate, updateMany. */
async function writeThroughEveryDoor(driver: SqlDriver, table: string): Promise<void> {
  await driver.create(table, { id: 'create_false', label: 'x', flag: false });
  await driver.create(table, { id: 'create_true', label: 'x', flag: true });
  await driver.create(table, { id: 'update_false', label: 'x', flag: true });
  await driver.update(table, 'update_false', { flag: false });
  await driver.upsert(table, { id: 'upsert_false', label: 'x', flag: false });
  await driver.bulkCreate(table, [{ id: 'bulk_false', label: 'x', flag: false }, { id: 'bulk_true', label: 'x', flag: true }]);
  await driver.create(table, { id: 'bulkupd_false', label: 'x', flag: true });
  await driver.bulkUpdate(table, [{ id: 'bulkupd_false', data: { flag: false } }]);
  await driver.create(table, { id: 'many_false', label: 'x', flag: true });
  await driver.updateMany(table, { where: { id: 'many_false' } } as DriverQuery, { flag: false });
}

async function stored(driver: SqlDriver, table: string): Promise<Array<[string, unknown, string]>> {
  const rows = await (driver as any).knex.raw(`select id, flag, typeof(flag) as t from ${table} order by id`);
  return rows.map((r: any) => [r.id, r.flag, r.t]);
}

async function presented(driver: SqlDriver, table: string): Promise<Record<string, unknown>> {
  const rows = (await driver.find(table, {} as DriverQuery)) as Array<{ id: string; flag: unknown }>;
  return Object.fromEntries(rows.map((r) => [r.id, r.flag]));
}

async function idsWhere(driver: SqlDriver, table: string, where: Record<string, unknown>): Promise<string[]> {
  const rows = (await driver.find(table, { where } as DriverQuery)) as Array<{ id: string }>;
  return rows.map((r) => r.id).sort();
}

const idsWritten = (value: boolean, rows: Record<string, boolean>) =>
  Object.keys(rows).filter((id) => rows[id] === value).sort();

describe('[#35341] driver-sql — a boolean retyped from text: every write door stores 1 / 0 the reads and filters agree on (sqlite)', () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = sqliteDriver();
    await driver.initObjects([asText(RETYPED)]);
    await driver.initObjects([asBoolean(RETYPED)]);
    await writeThroughEveryDoor(driver, RETYPED);
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  it('the fixture: the retyped column is still TEXT', async () => {
    const cols = await (driver as any).knex.raw(`select type from pragma_table_info('${RETYPED}') where name = 'flag'`);
    expect(cols).toEqual([{ type: 'TEXT' }]);
  });

  it('every write door stores the text 1 / 0, never 1.0 / 0.0', async () => {
    expect(await stored(driver, RETYPED)).toEqual(
      Object.keys(WRITTEN).sort().map((id) => [id, WRITTEN[id] ? '1' : '0', 'text']),
    );
  });

  it('find() presents each row as the boolean it was written as', async () => {
    expect(await presented(driver, RETYPED)).toEqual(WRITTEN);
  });

  it('distinct() answers false and true', async () => {
    expect([...(await driver.distinct(RETYPED, 'flag'))].sort()).toEqual([false, true]);
  });

  it('= false and = true select exactly the rows find() presents as false and true', async () => {
    expect(await idsWhere(driver, RETYPED, { flag: false })).toEqual(idsWritten(false, WRITTEN));
    expect(await idsWhere(driver, RETYPED, { flag: true })).toEqual(idsWritten(true, WRITTEN));
  });

  it('$ne and $in agree too', async () => {
    expect(await idsWhere(driver, RETYPED, { flag: { $ne: true } })).toEqual(idsWritten(false, WRITTEN));
    expect(await idsWhere(driver, RETYPED, { flag: { $in: [false] } })).toEqual(idsWritten(false, WRITTEN));
  });
});

describe('[#35341] driver-sql — a boot converges the 1.0 / 0.0 an older build stored on a retyped column (sqlite)', () => {
  let driver: SqlDriver;
  let pendingBeforeBoot: unknown;
  const info: Logged[] = [];
  const warn: Logged[] = [];
  const OLD: Record<string, boolean> = { old_false: false, old_true: true, old_zero: false };

  beforeAll(async () => {
    driver = sqliteDriver();
    await driver.initObjects([asText(EXISTING)]);
    const knex = (driver as any).knex;
    // What the driver's own writes stored on this column before the fix, and
    // the '0' an earlier convergence of a text 'false' left.
    await knex(EXISTING).insert([
      { id: 'old_false', label: 'x', flag: '0.0' },
      { id: 'old_true', label: 'x', flag: '1.0' },
      { id: 'old_zero', label: 'x', flag: '0' },
    ]);
    (driver as any).logger = {
      info: (msg: string, meta?: any) => { info.push({ msg, meta }); },
      warn: (msg: string, meta?: any) => { warn.push({ msg, meta }); },
    };
    driver.setDeferredDdl(true);
    await driver.initObjects([asBoolean(EXISTING)]);
    pendingBeforeBoot = (await driver.previewDeferredSchemaWork()).filter((p) => p.kind === 'normalize_boolean_storage');
    driver.setDeferredDdl(false);
    await driver.initObjects([asBoolean(EXISTING)]);
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  it('os migrate plan counts the 1.0 / 0.0 rows as normalize_boolean_storage', () => {
    expect(pendingBeforeBoot).toEqual([{ table: EXISTING, kind: 'normalize_boolean_storage', columns: ['flag'], rows: 2 }]);
  });

  it('the boot rewrites them to the text 1 / 0, withholds nothing, and says so', async () => {
    expect(await stored(driver, EXISTING)).toEqual([
      ['old_false', '0', 'text'], ['old_true', '1', 'text'], ['old_zero', '0', 'text'],
    ]);
    expect(warn.filter((l) => l.msg.includes('unconverted'))).toEqual([]);
    const converted = info.filter((l) => l.msg.includes('canonicalised boolean storage'));
    expect(converted.map((l) => [l.meta.field, l.meta.rowsConverted])).toEqual([['flag', 2]]);
  });

  it('find(), distinct() and = false then agree on every row', async () => {
    expect(await presented(driver, EXISTING)).toEqual(OLD);
    expect([...(await driver.distinct(EXISTING, 'flag'))].sort()).toEqual([false, true]);
    expect(await idsWhere(driver, EXISTING, { flag: false })).toEqual(idsWritten(false, OLD));
  });
});

describe('[#35341] driver-sql — CONTROL: a boolean column the driver created stores and answers as before (sqlite)', () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = sqliteDriver();
    await driver.initObjects([asBoolean(CONTROL)]);
    await writeThroughEveryDoor(driver, CONTROL);
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  it('every write door stores the INTEGER 1 / 0', async () => {
    expect(await stored(driver, CONTROL)).toEqual(
      Object.keys(WRITTEN).sort().map((id) => [id, WRITTEN[id] ? 1 : 0, 'integer']),
    );
  });

  it('find(), distinct() and = false / = true agree', async () => {
    expect(await presented(driver, CONTROL)).toEqual(WRITTEN);
    expect([...(await driver.distinct(CONTROL, 'flag'))].sort()).toEqual([false, true]);
    expect(await idsWhere(driver, CONTROL, { flag: false })).toEqual(idsWritten(false, WRITTEN));
    expect(await idsWhere(driver, CONTROL, { flag: true })).toEqual(idsWritten(true, WRITTEN));
  });
});
