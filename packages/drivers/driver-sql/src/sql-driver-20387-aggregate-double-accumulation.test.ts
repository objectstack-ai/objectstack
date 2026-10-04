// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20387] `sum` / `avg` from `SqlDriver.aggregate` accumulate in double on
 * every dialect: the arithmetic the engine's rows path (`objectql`'s
 * `in-memory-aggregation.ts`) and SQLite already use, under the one-double
 * policy `AGGREGATE_ANSWER_KIND` states (`sql-driver.ts`,
 * `AGGREGATE_ACCUMULATION`).
 *
 * Measured on the base (`75b216924`) through `engine.aggregate` and
 * `POST /api/v1/data/:object/query`, a `number` column holding `0.1` and `0.2`:
 *
 * | face | `sum` | `avg` | `having { s: { $eq: 0.3 } }` |
 * |:--|:--|:--|:--|
 * | PostgreSQL 16.13 native (`numeric`) | `0.3` | `0.15` | keeps the group |
 * | MySQL 8.0.46 native (`DECIMAL`) | `0.3` | `0.15` | keeps the group |
 * | SQLite native (REAL) | `0.30000000000000004` | `0.15000000000000002` | keeps no group |
 * | the rows path, every dialect | `0.30000000000000004` | `0.15000000000000002` | keeps no group |
 *
 * `avg` over an integer-valued column diverged as well: MySQL answered
 * `1.6667` for a `rating` of 1, 2, 2 (every other face `5 / 3`), and
 * PostgreSQL's `numeric` average of nine ratings summing to 11 answered
 * `1.2222222222222222` (JS `11 / 9` is `1.2222222222222223`).
 *
 * `having` is evaluated by the engine, over the value this door answers
 * (`having-filter.ts`: `$eq` compares the value with `==`), so the value pinned
 * here is what decides `having` `$eq` / `$in` on every face. The expected
 * values are computed from `find()`'s own rows, added in row order
 * ({@link rowsPathSum}), plus the literal the triage named, so a decimal
 * answer or a string each fail. Over these fixtures — two addends, and
 * integer-valued columns within 2^53 — that sum is also the rows path's, which
 * adds with compensation since #20489: the two folds cannot differ there.
 *
 * What stays as it was, pinned too: `count` / `min` / `max`, and a `sum` over
 * an integer-valued column, which keeps the database's exact total (above 2^53
 * that is not what adding doubles gives, and the policy declares that bound).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'os20387_agg_double';

/** The rows path's `toNumber` (`in-memory-aggregation.ts`): a number as-is, null as 0, else `Number()`. */
function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** `values.reduce((a, b) => a + toNumber(b), 0)`, in row order: the rows path's `sum` over this file's fixtures (see the header). */
const rowsPathSum = (values: readonly unknown[]) => values.reduce<number>((a, b) => a + toNumber(b), 0);

/** The non-null values' {@link rowsPathSum}, divided by how many there are: the rows path's `avg` over this file's fixtures. */
function rowsPathAvg(values: readonly unknown[]): number | null {
  const defined = values.filter((v) => v != null);
  return defined.length === 0 ? null : rowsPathSum(defined) / defined.length;
}

interface Row {
  id: string;
  g: string;
  w?: number;
  price?: number;
  legacy?: number;
  stars?: number;
  flag?: boolean;
}

const ROWS: readonly Row[] = [
  // The triage's pin: `0.1 + 0.2`. Two addends, so no summation order or
  // compensation scheme can move the last place.
  { id: 'p1', g: 'pin', w: 0.1, price: 0.1, legacy: 0.1, stars: 1, flag: true },
  { id: 'p2', g: 'pin', w: 0.2, price: 0.2, legacy: 0.2, stars: 2, flag: false },
  // `avg` over integer-valued columns: 5 / 3 (MySQL's `DECIMAL` average rounds
  // it to 1.6667) and 1 / 3.
  { id: 't1', g: 'three', stars: 1, flag: true },
  { id: 't2', g: 'three', stars: 2, flag: false },
  { id: 't3', g: 'three', stars: 2, flag: false },
  // 11 / 9: PostgreSQL's `numeric` average rounds it to 16 places first.
  ...[1, 1, 1, 1, 1, 1, 1, 2, 2].map((stars, i) => ({ id: `n${i}`, g: 'nine', stars })),
];

type Aggregation = NonNullable<DriverQuery['aggregations']>[number];
const agg = (fn: Aggregation['function'], field: string, alias: string): Aggregation => ({ function: fn, field, alias });

function declareCell(cell: DialectCell): void {
  describe(`[#20387] driver-sql — sum / avg accumulate in double (${cell.label})`, () => {
    let driver: SqlDriver;

    async function answer(g: string, aggregations: Aggregation[]) {
      const query: DriverQuery = { where: { g }, groupBy: ['g'], aggregations };
      const rows = (await driver.aggregate(TABLE, query)) as Array<Record<string, unknown>>;
      expect(rows, `one group for ${g}`).toHaveLength(1);
      return rows[0];
    }

    async function column(g: string, field: string): Promise<unknown[]> {
      const rows = (await driver.find(TABLE, { where: { g }, orderBy: [{ field: 'id', order: 'asc' }] })) as Array<
        Record<string, unknown>
      >;
      return rows.map((r) => r[field]);
    }

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.initObjects([
        {
          name: TABLE,
          fields: {
            g: { type: 'text' },
            w: { type: 'number' },
            price: { type: 'currency' },
            // A `number` column as a table created before the exact-decimal
            // columns carries it: binary32 `real` / `FLOAT` (retyped below).
            legacy: { type: 'number' },
            stars: { type: 'rating' },
            flag: { type: 'boolean' },
            // The driver's `integer` alias — how an introspected `bigint`
            // reaches it (retyped to `bigint` below on the servers).
            big: { type: 'integer' },
          },
        },
      ] as never);
      if (cell.id === 'pg') {
        await driver.execute(`alter table ${TABLE} alter column legacy type real`);
        await driver.execute(`alter table ${TABLE} alter column big type bigint`);
      } else if (cell.id === 'mysql') {
        await driver.execute(`alter table ${TABLE} modify legacy float(8,2)`);
        await driver.execute(`alter table ${TABLE} modify big bigint`);
      }
      for (const row of ROWS) await driver.create(TABLE, { ...row }, { bypassTenantAudit: true });
      // Written by SQL: a JS number cannot carry 2^53 + 1 to the column.
      await driver.execute(`insert into ${TABLE} (id, g, big) values ('b1', 'big', 9007199254740993)`);
      await driver.execute(`insert into ${TABLE} (id, g, big) values ('b2', 'big', 1)`);
    });

    afterAll(async () => {
      await driver?.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver?.disconnect();
    });

    it('the pin: sum / avg over 0.1 and 0.2 answer 0.1 + 0.2 and its half, as the rows path adds them', async () => {
      const a = await answer('pin', [
        agg('sum', 'w', 's'),
        agg('avg', 'w', 'a'),
        agg('sum', 'price', 'sp'),
        agg('avg', 'price', 'ap'),
      ]);
      const w = await column('pin', 'w');
      expect(w, 'find() reads the numbers written').toStrictEqual([0.1, 0.2]);
      expect(a.s, 'sum(number)').toBe(rowsPathSum(w));
      expect(a.a, 'avg(number)').toBe(rowsPathAvg(w));
      expect(a.sp, 'sum(currency)').toBe(rowsPathSum(await column('pin', 'price')));
      expect(a.ap, 'avg(currency)').toBe(rowsPathAvg(await column('pin', 'price')));
      // The literal the triage named, so the oracle above cannot drift with it.
      expect(a.s).toBe(0.30000000000000004);
      expect(a.a).toBe(0.15000000000000002);
      // `having { s: { $eq: 0.3 } }` / `{ $in: [0.3] }` therefore keep no group
      // here, as on SQLite and the rows path; `0.1 + 0.2` keeps it everywhere.
      expect(a.s == 0.3, 'having s $eq 0.3').toBe(false);
      expect([0.3].some((t) => a.s == t), 'having s $in [0.3]').toBe(false);
      expect(a.a == 0.15, 'having a $eq 0.15').toBe(false);
      expect(a.s == 0.1 + 0.2, 'having s $eq 0.1 + 0.2').toBe(true);
    });

    it('a binary32 column is added as the client reads it, not as its widened binary value', async () => {
      // `find()` reads `0.1`; a plain cast to double would add
      // 0.10000000149011612 (sum 0.30000000447034836) on PostgreSQL `real`
      // and MySQL `FLOAT`. The text of the column is what the rows path adds.
      const a = await answer('pin', [agg('sum', 'legacy', 's'), agg('avg', 'legacy', 'a')]);
      const legacy = await column('pin', 'legacy');
      expect(legacy, 'find() reads the numbers written').toStrictEqual([0.1, 0.2]);
      expect(a.s, 'sum(legacy)').toBe(rowsPathSum(legacy));
      expect(a.a, 'avg(legacy)').toBe(rowsPathAvg(legacy));
    });

    it('avg over an integer-valued column is the double quotient, as the rows path divides', async () => {
      for (const g of ['three', 'nine']) {
        const a = await answer(g, [agg('avg', 'stars', 'as'), agg('avg', 'flag', 'af')]);
        expect(a.as, `${g} avg(rating)`).toBe(rowsPathAvg(await column(g, 'stars')));
        const flags = (await column(g, 'flag')).map((f) => (f == null ? null : Number(f)));
        expect(a.af, `${g} avg(boolean)`).toBe(rowsPathAvg(flags));
      }
      expect((await answer('three', [agg('avg', 'stars', 'as')])).as).toBe(5 / 3);
      expect((await answer('nine', [agg('avg', 'stars', 'as')])).as).toBe(11 / 9);
    });

    it('sum over an integer-valued column keeps the exact total, rounded once', async () => {
      const a = await answer('big', [agg('sum', 'big', 's')]);
      // 2^53 + 1 + 1 = 2^53 + 2, a double. Adding the doubles would answer
      // 2^53: the bound the one-double policy declares, not taken here.
      expect(a.s).toBe(9007199254740994);
      const three = await answer('three', [agg('sum', 'stars', 's')]);
      expect(three.s, 'sum(rating)').toBe(5);
    });

    it('count, min and max are untouched', async () => {
      const a = await answer('pin', [
        { function: 'count', alias: 'n' },
        agg('count', 'w', 'nw'),
        agg('min', 'w', 'mn'),
        agg('max', 'w', 'mx'),
        agg('min', 'stars', 'smn'),
        agg('max', 'stars', 'smx'),
      ]);
      expect(a).toMatchObject({ n: 2, nw: 2, mn: 0.1, mx: 0.2, smn: 1, smx: 2 });
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'aggregate double accumulation (#20387)', declareCell);
}
