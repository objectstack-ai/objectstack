// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20203] An epoch-millisecond NUMBER compared against a `date` field is read
 * as the UTC calendar day of its instant — by `@objectstack/core`'s
 * `temporalStorageForm`, the rule `toDateOnly` / `temporalFilterValue` call —
 * on every dialect this driver speaks.
 *
 * Measured on the base through `find()` (and through the engine and
 * `POST /api/v1/data/:object/query`, which reach the same coercion), on this
 * file's fixture, with `where: { placed_on: { $gt: 1769940000000 } }`
 * (2026-02-01T10:00:00.000Z):
 *
 * | dialect | base | why |
 * |:--|:--|:--|
 * | SQLite | 6 of 6 | the number was bound as INTEGER, and SQLite orders every INTEGER below every TEXT |
 * | PostgreSQL | `DATABASE_ERROR` (500 at REST) | the server's date input parser refused the bind, `22008` "date/time field value out of range" |
 *
 * and every other operator split the same way (SQLite: `$gte` / `$ne` / `$nin`
 * 6, the rest 0; PostgreSQL: a refusal on each, on an empty table too), while
 * the same number on a `datetime` field — the control — was read as its
 * instant on both. `driver-memory` answered 0 (its own suite pins it).
 *
 * The number now names the same day a `Date` of the same value names, so each
 * row below asserts three things on one cell: the number's answer, the `Date`
 * twin's answer (identical), and the `datetime` control.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'os20203_ledger';
const EMPTY = 'os20203_ledger_empty';
const WRITES = 'os20203_ledger_writes';

const shape = (name: string) => ({
  name,
  fields: { placed_on: { type: 'date' }, opened_at: { type: 'datetime' } },
}) as any;

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

const NO_AUDIT = { bypassTenantAudit: true } as any;

function measure(cell: DialectCell): void {
  describe(`[#20203] an epoch-ms number on a date field — ${cell.label}`, () => {
    let driver: SqlDriver;
    const ids = async (table: string, where: Record<string, unknown>) =>
      ((await driver.find(table, { where }, NO_AUDIT)) as any[]).map((r) => r.id).sort();

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      for (const t of [TABLE, EMPTY, WRITES]) await driver.execute(`drop table if exists ${t}`).catch(() => {});
      await driver.initObjects([shape(TABLE), shape(EMPTY), shape(WRITES)]);
      for (const row of ROWS) await driver.create(TABLE, { ...row }, NO_AUDIT);
    });

    afterAll(async () => {
      for (const t of [TABLE, EMPTY, WRITES]) await driver.execute(`drop table if exists ${t}`).catch(() => {});
      await driver.disconnect();
    });

    for (const [op, comparand, onDate, onDatetime] of OPERATORS) {
      it(`${op}: the UTC calendar day of the instant — ${onDate.join(', ')}; its Date agrees; the datetime control reads the instant`, async () => {
        expect(await ids(TABLE, { placed_on: comparand(asNumber) }), 'number on date').toEqual(onDate);
        expect(await ids(TABLE, { placed_on: comparand(asDate) }), 'the Date twin on date').toEqual(onDate);
        expect(await ids(TABLE, { opened_at: comparand(asNumber) }), 'datetime control').toEqual(onDatetime);
      });

      it(`${op}: an empty table answers no row, not a refusal`, async () => {
        expect(await ids(EMPTY, { placed_on: comparand(asNumber) })).toEqual([]);
      });
    }

    it('the write path stores the same UTC calendar day — create and update', async () => {
      await driver.create(WRITES, { id: 'w1', placed_on: N }, NO_AUDIT);
      await driver.create(WRITES, { id: 'w2', placed_on: -1 }, NO_AUDIT); // one ms before the epoch
      const read = async (id: string) => ((await driver.findOne(WRITES, { where: { id } }, NO_AUDIT)) as any)?.placed_on;
      expect(await read('w1')).toBe('2026-02-01');
      expect(await read('w2')).toBe('1969-12-31');
      await driver.update(WRITES, 'w1', { placed_on: N_JAN10 }, NO_AUDIT);
      expect(await read('w1')).toBe('2026-01-10');
    });
  });
}

for (const cell of DIALECT_CELLS) declareDialectCell(cell, 'epoch-ms date comparand', measure);
