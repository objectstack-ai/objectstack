// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20203] An epoch-millisecond NUMBER compared against a `date` field is read
 * as the UTC calendar day of its instant — by `@objectstack/core`'s
 * `temporalStorageForm`, the rule `coerceTemporalValue` calls — the reading a
 * `Date` of the same value already had here.
 *
 * Measured on the base through this driver's `find()`, and through the engine
 * and `POST /api/v1/data/:object/query` over it (which reach the same
 * coercion): `where: { placed_on: { $gt: 1769940000000 } }` answered 0 of 6,
 * because the number reached mingo unchanged and mingo never matches a number
 * against the `YYYY-MM-DD` text the column holds. Every operator answered that
 * way — 0, or all 6 for `$ne` / `$nin` — while `driver-sql` answered 6 on
 * SQLite and a 500 on PostgreSQL (its suite pins it), and the same number on a
 * `datetime` field (the control) was read as its instant everywhere.
 *
 * Each row asserts three things: the number's answer, the `Date` twin's answer
 * (identical), and the `datetime` control.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';

const OBJECT = 'ledger_order';
const EMPTY = 'ledger_order_empty';
const WRITES = 'ledger_order_writes';
const FIELDS = { placed_on: { type: 'date' }, opened_at: { type: 'datetime' } };

const ROWS = [
  { id: 'o1', placed_on: '2026-01-10', opened_at: '2026-01-01T10:00:00.000Z' },
  { id: 'o2', placed_on: '2026-01-02', opened_at: '2026-01-02T10:00:00.000Z' },
  { id: 'o3', placed_on: '2026-03-01', opened_at: '2026-02-01T10:00:00.000Z' },
  { id: 'o4', placed_on: '2026-02-01', opened_at: '2026-02-05T10:00:00.000Z' },
  { id: 'o5', placed_on: '2026-01-15', opened_at: '2026-02-06T10:00:00.000Z' },
  { id: 'o6', placed_on: '2026-02-01', opened_at: '2026-03-01T10:00:00.000Z' },
];

const N = 1769940000000; //          2026-02-01T10:00:00.000Z — a time of day, not a UTC midnight
const N_JAN10 = 1768057200000; //    2026-01-10T15:00:00.000Z
const N_JAN02 = 1767394800000; //    2026-01-02T23:00:00.000Z — late in its UTC day
const N_MIDNIGHT = 1769904000000; // 2026-02-01T00:00:00.000Z

type As = (ms: number) => unknown;
const asNumber: As = (ms) => ms;
const asDate: As = (ms) => new Date(ms);

/** operator · the comparand, built from a number or its `Date` · `date` ids · `datetime` control ids */
const OPERATORS: ReadonlyArray<readonly [string, (v: As) => unknown, string[], string[]]> = [
  ['$gt', (v) => ({ $gt: v(N) }), ['o3'], ['o4', 'o5', 'o6']],
  ['$lt', (v) => ({ $lt: v(N) }), ['o1', 'o2', 'o5'], ['o1', 'o2']],
  ['$eq', (v) => ({ $eq: v(N) }), ['o4', 'o6'], ['o3']],
  ['$in', (v) => ({ $in: [v(N), v(N_JAN10)] }), ['o1', 'o4', 'o6'], ['o3']],
  ['$between', (v) => ({ $between: [v(N_JAN02), v(N)] }), ['o1', 'o2', 'o4', 'o5', 'o6'], ['o3']],
  ['$gte', (v) => ({ $gte: v(N) }), ['o3', 'o4', 'o6'], ['o3', 'o4', 'o5', 'o6']],
  ['$lte', (v) => ({ $lte: v(N) }), ['o1', 'o2', 'o4', 'o5', 'o6'], ['o1', 'o2', 'o3']],
  ['$ne', (v) => ({ $ne: v(N) }), ['o1', 'o2', 'o3', 'o5'], ['o1', 'o2', 'o4', 'o5', 'o6']],
  ['$nin', (v) => ({ $nin: [v(N), v(N_JAN10)] }), ['o2', 'o3', 'o5'], ['o1', 'o2', 'o4', 'o5', 'o6']],
  ['implicit equality', (v) => v(N), ['o4', 'o6'], ['o3']],
  ['$eq on a UTC midnight', (v) => ({ $eq: v(N_MIDNIGHT) }), ['o4', 'o6'], []],
];

describe('[#20203] an epoch-ms number on a date field reads as the UTC calendar day of its instant', () => {
  let driver: InMemoryDriver;
  const ids = async (object: string, where: FilterCondition) =>
    (await driver.find(object, { where })).map((r) => r.id).sort();

  beforeAll(async () => {
    driver = new InMemoryDriver({});
    await driver.connect();
    for (const name of [OBJECT, EMPTY, WRITES]) await driver.syncSchema(name, { name, fields: FIELDS });
    for (const row of ROWS) await driver.create(OBJECT, { ...row });
  });

  for (const [op, comparand, onDate, onDatetime] of OPERATORS) {
    it(`${op}: ${onDate.join(', ')}; its Date agrees; the datetime control reads the instant`, async () => {
      expect(await ids(OBJECT, { placed_on: comparand(asNumber) }), 'number on date').toEqual(onDate);
      expect(await ids(OBJECT, { placed_on: comparand(asDate) }), 'the Date twin on date').toEqual(onDate);
      expect(await ids(OBJECT, { opened_at: comparand(asNumber) }), 'datetime control').toEqual(onDatetime);
    });

    it(`${op}: an empty object answers no row`, async () => {
      expect(await ids(EMPTY, { placed_on: comparand(asNumber) })).toEqual([]);
    });
  }

  it('the write path stores the same UTC calendar day — create and update', async () => {
    await driver.create(WRITES, { id: 'w1', placed_on: N });
    await driver.create(WRITES, { id: 'w2', placed_on: -1 }); // one ms before the epoch
    const read = async (id: string) => (await driver.findOne(WRITES, { where: { id } }))?.placed_on;
    expect(await read('w1')).toBe('2026-02-01');
    expect(await read('w2')).toBe('1969-12-31');
    await driver.update(WRITES, 'w1', { placed_on: N_JAN10 });
    expect(await read('w1')).toBe('2026-01-10');
  });
});
