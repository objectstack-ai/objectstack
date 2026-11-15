// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33698] A per-aggregation `filter` (`AggregationNodeSchema.filter`, #10576)
 * compiles to a conditional aggregate — `fn(CASE WHEN (pred) THEN arg END)`,
 * and `count(CASE WHEN (pred) THEN 1 END)` for `count(*)` — with the predicate
 * from the same where compiler (`applyFilters`) a `where` goes through. This
 * driver advertises it as `supports.aggregationFilter`.
 *
 * Before this, the compiler refused the key (`NOT_IMPLEMENTED` / 501) and the
 * engine answered every filtered measure in memory. The answer each function
 * must give is the in-memory path's: the rows a `find()` with the filter as its
 * `where` reads, aggregated in JS ({@link reference}), and a group the filter
 * empties answering what that aggregate answers over nothing
 * (`emptyGroupValueFor`: `sum` and both counts `0`, `avg` / `min` / `max`
 * `null`). Every function is pinned against that reference AND a hand-written
 * literal, so a broken reference cannot carry a broken compile with it.
 *
 * `count(*)` is the shape that has a wrong spelling that LOOKS right:
 * `count(CASE WHEN … THEN 1 ELSE 0 END)` counts every row (`count` counts
 * non-NULL, and `0` is not NULL). The `won` count over group `b`, whose rows
 * are all `open`, is `0` only with no `ELSE`.
 *
 * Every live cell runs where the suite provisions it (`OS_TEST_POSTGRES_URL`,
 * `OS_TEST_MYSQL_URL`); SQLite always runs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'os33698_measure_filter';

interface Row {
  id: string;
  g: string;
  stage?: string | null;
  amount?: number | null;
  qty?: number | null;
  tag?: string | null;
}

const ROWS: readonly Row[] = [
  { id: 'a1', g: 'a', stage: 'won', amount: 10, qty: 1, tag: 'x' },
  { id: 'a2', g: 'a', stage: 'won', amount: 30, qty: 2, tag: 'x' },
  { id: 'a3', g: 'a', stage: 'won', amount: null, qty: 3, tag: 'y' },
  { id: 'a4', g: 'a', stage: 'open', amount: 100, qty: 4, tag: 'z' },
  { id: 'b1', g: 'b', stage: 'open', amount: 5, qty: 5, tag: 'x' },
  { id: 'b2', g: 'b', stage: 'open', amount: 7, qty: null, tag: null },
  // A NULL stage: rejected by `stage = 'won'` (the measure filter is a WHERE,
  // three-valued), and by the reference's `find()` alike.
  { id: 'c1', g: 'c', stage: null, amount: 1, qty: 1, tag: 'x' },
  { id: 'c2', g: 'c', stage: 'won', amount: 2, qty: 2, tag: 'q' },
];

type Aggregation = NonNullable<DriverQuery['aggregations']>[number];
type Fn = Aggregation['function'];
const FUNCTIONS: readonly Fn[] = ['count', 'sum', 'avg', 'min', 'max', 'count_distinct'];
const FIELD_OF: Record<Fn, string | undefined> = {
  count: undefined, sum: 'amount', avg: 'amount', min: 'amount', max: 'amount', count_distinct: 'tag',
} as Record<Fn, string | undefined>;

/** What the in-memory path answers for `fn(field)` over `values` (the rows the filter keeps). */
function reference(fn: Fn, rows: Array<Record<string, unknown>>, field: string | undefined): number | null {
  if (fn === 'count') return field ? rows.filter((r) => r[field] != null).length : rows.length;
  const values = rows.map((r) => r[field!]).filter((v) => v != null);
  if (fn === 'count_distinct') return new Set(values.map((v) => String(v))).size;
  const nums = values.map(Number);
  if (fn === 'sum') return nums.reduce((a, b) => a + b, 0);
  if (nums.length === 0) return null;
  if (fn === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (fn === 'min') return Math.min(...nums);
  return Math.max(...nums);
}

/** Hand-written answers for `stage = 'won'`, per group. */
const WON: Record<string, Record<Fn, number | null>> = {
  a: { count: 3, sum: 40, avg: 20, min: 10, max: 30, count_distinct: 2 } as Record<Fn, number | null>,
  b: { count: 0, sum: 0, avg: null, min: null, max: null, count_distinct: 0 } as Record<Fn, number | null>,
  c: { count: 1, sum: 2, avg: 2, min: 2, max: 2, count_distinct: 1 } as Record<Fn, number | null>,
};

function declareCell(cell: DialectCell): void {
  describe(`[#33698] driver-sql — a measure filter compiles to a conditional aggregate (${cell.label})`, () => {
    let driver: SqlDriver;

    const byGroup = async (query: DriverQuery) => {
      const rows = (await driver.aggregate(TABLE, query)) as Array<Record<string, unknown>>;
      return Object.fromEntries(rows.map((r) => [String(r.g), r]));
    };
    const keptRows = async (g: string, filter: Record<string, unknown>) =>
      (await driver.find(TABLE, { where: { $and: [{ g }, filter] } } as DriverQuery)) as Array<Record<string, unknown>>;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.initObjects([
        {
          name: TABLE,
          fields: {
            g: { type: 'text' },
            stage: { type: 'text' },
            amount: { type: 'number' },
            qty: { type: 'number' },
            tag: { type: 'text' },
          },
        },
      ] as never);
      for (const row of ROWS) await driver.create(TABLE, { ...row }, { bypassTenantAudit: true });
    });

    afterAll(async () => {
      await driver?.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver?.disconnect();
    });

    it('advertises the capability', () => {
      expect(driver.supports.aggregationFilter).toBe(true);
    });

    for (const fn of FUNCTIONS) {
      it(`${fn}: answers the in-memory path's number, per group, a group the filter empties included`, async () => {
        const field = FIELD_OF[fn];
        const filter = { stage: 'won' };
        const got = await byGroup({
          groupBy: ['g'],
          aggregations: [
            { function: fn, ...(field ? { field } : {}), alias: 'won', filter },
            // The unfiltered measure beside it: the filter narrows ONE measure, never the statement.
            { function: fn, ...(field ? { field } : {}), alias: 'all' },
          ],
        } as DriverQuery);
        expect(Object.keys(got).sort()).toEqual(['a', 'b', 'c']);
        for (const g of ['a', 'b', 'c']) {
          expect(got[g].won, `${fn} won, group ${g} (hand-written)`).toEqual(WON[g][fn]);
          expect(got[g].won, `${fn} won, group ${g} (find + aggregate)`).toEqual(reference(fn, await keptRows(g, filter), field));
          expect(got[g].all, `${fn} all, group ${g}`).toEqual(reference(fn, await keptRows(g, {}), field));
        }
      });
    }

    it('count(field) skips the NULLs the filter keeps; count(*) does not', async () => {
      const got = await byGroup({
        groupBy: ['g'],
        aggregations: [
          { function: 'count', field: 'amount', alias: 'priced_won', filter: { stage: 'won' } },
          { function: 'count', alias: 'won', filter: { stage: 'won' } },
        ],
      } as DriverQuery);
      expect(got.a).toMatchObject({ priced_won: 2, won: 3 });
    });

    it('binds in text order: a where, two measure filters with comparands, and the aggregand', async () => {
      const got = await byGroup({
        where: { qty: { $ne: 3 } },
        groupBy: ['g'],
        aggregations: [
          { function: 'sum', field: 'amount', alias: 'big', filter: { amount: { $gte: 10 }, stage: { $in: ['won', 'open'] } } },
          { function: 'max', field: 'qty', alias: 'small_qty', filter: { $or: [{ amount: { $lt: 6 } }, { tag: 'q' }] } },
          { function: 'count', alias: 'n' },
        ],
      } as DriverQuery);
      // a: a3 is outside the where; big = 10 + 30 + 100; no amount < 6 and no tag q.
      expect(got.a).toMatchObject({ big: 140, small_qty: null, n: 3 });
      // b: `$ne` is null-safe, so b2 (qty NULL) stays in the where; neither
      // amount reaches 10, and only b1's amount is below 6.
      expect(got.b).toMatchObject({ big: 0, small_qty: 5, n: 2 });
      expect(got.c).toMatchObject({ big: 0, small_qty: 2, n: 2 });
    });

    it('a NULL column fails an ordering comparison (null is not ordered)', async () => {
      const got = await byGroup({
        groupBy: ['g'],
        aggregations: [
          { function: 'count', alias: 'le0', filter: { amount: { $lte: 1000 } } },
          { function: 'count', alias: 'between', filter: { qty: { $between: [-1, 10] } } },
          { function: 'count', alias: 'none', filter: { amount: { $null: true } } },
        ],
      } as DriverQuery);
      expect(got.a).toMatchObject({ le0: 3, between: 4, none: 1 });
      expect(got.b).toMatchObject({ le0: 2, between: 1, none: 0 });
    });

    it('without groupBy: one row, the filter still narrows only its measure', async () => {
      const rows = (await driver.aggregate(TABLE, {
        aggregations: [
          { function: 'sum', field: 'amount', alias: 'won', filter: { stage: 'won' } },
          { function: 'sum', field: 'amount', alias: 'total' },
        ],
      } as DriverQuery)) as Array<Record<string, unknown>>;
      expect(rows).toEqual([{ won: 42, total: 155 }]);
    });

    it('control: an EMPTY filter object is vacuous (the where/having convention)', async () => {
      const rows = (await driver.aggregate(TABLE, {
        aggregations: [{ function: 'sum', field: 'amount', alias: 'total', filter: {} }],
      } as DriverQuery)) as Array<Record<string, unknown>>;
      expect(rows).toEqual([{ total: 155 }]);
    });

    it('a filter the where compiler refuses is refused the same way here (no second vocabulary)', async () => {
      const asWhere = await driver.find(TABLE, { where: { amount: { $nope: 1 } } } as never).then(() => null, (e: any) => e);
      const asMeasure = await driver
        .aggregate(TABLE, { aggregations: [{ function: 'count', alias: 'n', filter: { amount: { $nope: 1 } } }] } as never)
        .then(() => null, (e: any) => e);
      expect(asWhere?.code).toBeDefined();
      expect({ code: asMeasure?.code, status: asMeasure?.status }).toEqual({ code: asWhere.code, status: asWhere.status });
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'aggregate measure filter (#33698)', declareCell);
}

describe('[#33698] a measure filter under a tenant scope: the scope stays on the statement, the filter narrows inside it', () => {
  const T = 'os33698_tenant_measure';
  let driver: SqlDriver;
  const statements: string[] = [];

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.initObjects([
      { name: T, fields: { organization_id: { type: 'string' }, stage: { type: 'string' }, amount: { type: 'number' } } },
    ] as never);
    await driver.create(T, { id: 'a1', organization_id: 'org_a', stage: 'won', amount: 10 } as never);
    await driver.create(T, { id: 'a2', organization_id: 'org_a', stage: 'open', amount: 20 } as never);
    // Another organization's row the filter WOULD match.
    await driver.create(T, { id: 'b1', organization_id: 'org_b', stage: 'won', amount: 1000 } as never);
    (driver as unknown as { knex: { on(e: string, f: (d: { sql?: string }) => void): void } }).knex.on('query', (d) => {
      if (typeof d?.sql === 'string' && d.sql.includes(T)) statements.push(d.sql);
    });
  });

  afterAll(async () => {
    await driver?.disconnect();
  });

  it('each organization counts only its own rows, and the statement carries the tenant predicate once, outside the CASE', async () => {
    const query = {
      where: { amount: { $gt: 0 } },
      aggregations: [
        { function: 'sum', field: 'amount', alias: 'won', filter: { stage: 'won' } },
        { function: 'count', alias: 'n' },
      ],
    } as DriverQuery;
    expect(await driver.aggregate(T, query, { tenantId: 'org_a' } as never)).toEqual([{ won: 10, n: 2 }]);
    expect(await driver.aggregate(T, query, { tenantId: 'org_b' } as never)).toEqual([{ won: 1000, n: 1 }]);
    // No tenant (the admin / seed path): every row, as `find()` answers it.
    expect(await driver.aggregate(T, query)).toEqual([{ won: 1010, n: 3 }]);
    const scoped = statements.find((sql) => sql.includes('CASE WHEN') && sql.includes('organization_id'))!;
    expect(scoped).toBeDefined();
    // The CASE holds the measure filter alone; the tenant predicate is in the WHERE.
    const caseBody = scoped.slice(scoped.indexOf('CASE WHEN'), scoped.indexOf('END') + 3);
    expect(caseBody).toContain('stage');
    expect(caseBody).not.toContain('organization_id');
    expect(scoped.slice(scoped.indexOf(' where '))).toContain('organization_id');
  });
});

describe('[#33698] the lift guard: a predicate that cannot be isolated is refused, never guessed at', () => {
  /** A where compiler that leaves a literal `?` the bindings do not pair with. */
  class LiteralPlaceholderDriver extends SqlDriver {
    protected applyFilters(builder: any, filters: any, options?: any): void {
      super.applyFilters(builder, filters, options);
      builder.whereRaw(`stage <> '\\?'`);
    }
  }

  it('answers NOT_IMPLEMENTED / 501 naming the measure, before any statement runs', async () => {
    const driver = new LiteralPlaceholderDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.initObjects([{ name: 'deal', fields: { stage: { type: 'text' }, amount: { type: 'number' } } }] as never);
    const err = await driver
      .aggregate('deal', { aggregations: [{ function: 'count', alias: 'won_count', filter: { stage: 'won' } }] } as never)
      .then(() => null, (e: any) => e);
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'NOT_IMPLEMENTED', status: 501 });
    expect(String(err?.message)).toContain('Per-aggregation `filter` on "won_count" could not be compiled as a conditional aggregate');
    await driver.disconnect();
  });
});
