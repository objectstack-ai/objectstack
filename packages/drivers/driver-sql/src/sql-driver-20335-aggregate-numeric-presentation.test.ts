// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20335] `count` / `count_distinct` / `sum` / `avg` answer a JS NUMBER from
 * `SqlDriver.aggregate`, on every dialect — the value the engine's rows path
 * and SQLite already answered.
 *
 * Measured on the base (`26daf0b036`) through this door, `engine.aggregate` and
 * `POST /api/v1/data/:object/query`, `groupBy` customer, four groups:
 *
 * | dialect | `count` | `count_distinct` | `sum` / `avg` over number, currency, percent | `sum` / `avg` over rating (integer column) |
 * |:--|:--|:--|:--|:--|
 * | SQLite | number | number | number | number |
 * | PostgreSQL 16.13 | `"2"` | `"2"` | `"500.000000000000000000000000000000"` | `"7"` / `"3.5000000000000000"` |
 * | MySQL 8.0.46 | number | number | `"500.000000000000000000000000000000"` | `"7"` / `"3.5000"` |
 *
 * node-postgres parses `bigint` (OID 20) and `numeric` (OID 1700) to strings,
 * and mysql2 does the same for `DECIMAL`; `min` / `max` over a declared numeric
 * field were already numbers (the column's own `'number'` presentation, #16318)
 * and are unchanged. The engine's `having` then compared `"2"` against `2`:
 * `having { n: { $in: [2] } }` kept no group on PostgreSQL's native path and
 * c1, c2 everywhere else (pinned at the engine and REST doors in
 * `@objectstack/rest`'s `rest-aggregate-numeric-having.test.ts`).
 *
 * The fixture's values are dyadic fractions on purpose, so a JS double holds
 * every sum and average EXACTLY: the expected values below are computed from the
 * rows with JS arithmetic — the rows path's own arithmetic — and asserted with
 * `toBe`, so a string, a boolean or a rounding difference each fail.
 *
 * The precision policy (one JS double, the loss beyond a double's precision
 * declared — `AGGREGATE_ANSWER_KIND` in `sql-driver.ts`) is pinned by the last
 * case of each cell: a total the exact-decimal column holds but a double cannot
 * answers the nearest double, which is also what `find()` reads for the row.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'os20335_agg_numbers';

interface Row {
  id: string;
  customer_id: string;
  amount: number;
  price: number;
  rate: number;
  stars: number;
  flag: boolean;
  note: string;
}

const ROWS: readonly Row[] = [
  { id: 'o1', customer_id: 'c1', amount: 100, price: 10.25, rate: 0.25, stars: 3, flag: true, note: 'b' },
  { id: 'o2', customer_id: 'c1', amount: 400, price: 20.5, rate: 0.5, stars: 4, flag: false, note: 'a' },
  { id: 'o3', customer_id: 'c2', amount: 900, price: 30.75, rate: 0.75, stars: 5, flag: true, note: 'c' },
  { id: 'o4', customer_id: 'c2', amount: 300, price: 40, rate: 0.125, stars: 2, flag: true, note: 'c' },
  { id: 'o5', customer_id: 'c3', amount: 50, price: 5.5, rate: 0.5, stars: 1, flag: false, note: 'e' },
  { id: 'o6', customer_id: 'c4', amount: 20, price: 1.25, rate: 0.25, stars: 5, flag: false, note: 'f' },
];

/** number (integer-valued), currency, percent, and the one integer column of the family. */
const MEASURED = ['amount', 'price', 'rate', 'stars'] as const;
const GROUPS = ['c1', 'c2', 'c3', 'c4'] as const;

const byGroup = (g: string) => ROWS.filter((r) => r.customer_id === g);
const sumOf = (rows: readonly Row[], f: keyof Row) => rows.reduce((a, r) => a + Number(r[f]), 0);

function grouped(): DriverQuery {
  const aggregations: Array<Record<string, unknown>> = [
    { function: 'count', alias: 'n' },
    { function: 'count_distinct', field: 'note', alias: 'nd' },
    { function: 'sum', field: 'flag', alias: 'sum_flag' },
    { function: 'avg', field: 'flag', alias: 'avg_flag' },
    { function: 'sum', field: 'spare', alias: 'sum_spare' },
    { function: 'avg', field: 'spare', alias: 'avg_spare' },
    { function: 'min', field: 'note', alias: 'min_note' },
  ];
  for (const f of MEASURED) {
    for (const fn of ['count', 'sum', 'avg', 'min', 'max']) aggregations.push({ function: fn, field: f, alias: `${fn}_${f}` });
  }
  return { groupBy: ['customer_id'], aggregations } as DriverQuery;
}

function declareCell(cell: DialectCell): void {
  describe(`[#20335] driver-sql — aggregate counts and totals are numbers (${cell.label})`, () => {
    let driver: SqlDriver;
    let answers: Map<string, Record<string, unknown>>;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.initObjects([
        {
          name: TABLE,
          fields: {
            customer_id: { type: 'text' },
            amount: { type: 'number' },
            price: { type: 'currency' },
            rate: { type: 'percent' },
            stars: { type: 'rating' },
            flag: { type: 'boolean' },
            note: { type: 'text' },
            // NULL in every row: `sum` folds to 0 (#15546) and `avg` stays null.
            spare: { type: 'number' },
          },
        },
      ] as never);
      for (const row of ROWS) await driver.create(TABLE, { ...row }, { bypassTenantAudit: true });
      const rows = (await driver.aggregate(TABLE, grouped())) as Array<Record<string, unknown>>;
      answers = new Map(rows.map((r) => [String(r.customer_id), r]));
    });

    afterAll(async () => {
      await driver?.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver?.disconnect();
    });

    it('answers the four groups', () => {
      expect([...answers.keys()].sort()).toEqual([...GROUPS]);
    });

    it('count and count_distinct are numbers, equal to the rows', () => {
      for (const g of GROUPS) {
        const a = answers.get(g)!;
        const rows = byGroup(g);
        expect(a.n, `${g} count(*)`).toBe(rows.length);
        expect(a.nd, `${g} count_distinct(note)`).toBe(new Set(rows.map((r) => r.note)).size);
        for (const f of MEASURED) expect(a[`count_${f}`], `${g} count(${f})`).toBe(rows.length);
      }
    });

    it('sum and avg over number, currency, percent and rating are numbers, equal to the rows', () => {
      for (const g of GROUPS) {
        const a = answers.get(g)!;
        const rows = byGroup(g);
        for (const f of MEASURED) {
          expect(a[`sum_${f}`], `${g} sum(${f})`).toBe(sumOf(rows, f));
          expect(a[`avg_${f}`], `${g} avg(${f})`).toBe(sumOf(rows, f) / rows.length);
        }
      }
    });

    it('sum and avg over a boolean answer the #11152 numbers strictly', () => {
      for (const g of GROUPS) {
        const a = answers.get(g)!;
        const rows = byGroup(g);
        expect(a.sum_flag, `${g} sum(flag)`).toBe(sumOf(rows, 'flag'));
        expect(a.avg_flag, `${g} avg(flag)`).toBe(sumOf(rows, 'flag') / rows.length);
      }
    });

    it('an all-NULL aggregand: sum folds to the number 0, avg stays null', () => {
      for (const g of GROUPS) {
        expect(answers.get(g)!.sum_spare, `${g} sum(spare)`).toBe(0);
        expect(answers.get(g)!.avg_spare, `${g} avg(spare)`).toBeNull();
      }
    });

    it('min and max keep the column presentation — numbers for the numeric family, text for text', () => {
      for (const g of GROUPS) {
        const a = answers.get(g)!;
        const rows = byGroup(g);
        for (const f of MEASURED) {
          expect(a[`min_${f}`], `${g} min(${f})`).toBe(Math.min(...rows.map((r) => Number(r[f]))));
          expect(a[`max_${f}`], `${g} max(${f})`).toBe(Math.max(...rows.map((r) => Number(r[f]))));
        }
        expect(a.min_note, `${g} min(note)`).toBe([...rows.map((r) => r.note)].sort()[0]);
      }
    });

    it('precision policy: a total a double cannot hold answers the nearest double, as find() does', async () => {
      // Written by SQL, not by the driver: a JS number could not carry these
      // values in the first place, which is the whole point of the case. The
      // literals are numeric, so the exact-decimal column stores them exactly
      // on PostgreSQL and MySQL (SQLite's REAL column rounds on write).
      const EXACT = ['9007199254740993', '12345678901234567.123456789'];
      for (const [i, literal] of EXACT.entries()) {
        await driver.execute(`insert into ${TABLE} (id, customer_id, amount) values ('p${i}', 'p${i}', ${literal})`);
      }
      const rows = (await driver.aggregate(TABLE, {
        where: { customer_id: { $in: ['p0', 'p1'] } },
        groupBy: ['customer_id'],
        aggregations: [
          { function: 'sum', field: 'amount', alias: 'total' },
          { function: 'avg', field: 'amount', alias: 'mean' },
        ],
      } as DriverQuery)) as Array<Record<string, unknown>>;
      const found = (await driver.find(TABLE, { where: { customer_id: { $in: ['p0', 'p1'] } } })) as Array<
        Record<string, unknown>
      >;
      for (const [i, literal] of EXACT.entries()) {
        const row = rows.find((r) => r.customer_id === `p${i}`)!;
        expect(typeof row.total, `sum over ${literal} is a number, never a string`).toBe('number');
        expect(row.total, `sum over ${literal}`).toBe(Number(literal));
        expect(row.mean, `avg over ${literal}`).toBe(Number(literal));
        expect(row.total, `the same bound find() reads for ${literal}`).toBe(
          found.find((r) => r.customer_id === `p${i}`)!.amount,
        );
      }
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'aggregate numeric presentation (#20335)', declareCell);
}
