// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20889] A measure the analytics response declares `number` answers a JS
 * NUMBER on the native-SQL path, on every dialect — the value SQLite and the
 * ObjectQL path already answered.
 *
 * `NativeSQLStrategy` hands its statement to the host's raw-SQL bridge and used
 * to return the client's rows as they came. node-postgres parses `bigint`
 * (`count`, `sum` over an integer column) and `numeric` (`sum` / `avg` over the
 * exact-decimal column, `avg` over an integer column, `min` / `max` over a
 * decimal column) to STRINGS, so on PostgreSQL the same response that declared
 * `{ name: 'row_count', type: 'number' }` carried `row_count: "2"`.
 *
 * ## Measured on the base, through these doors
 *
 * The cube read (`AnalyticsService.query`, what `POST /api/v1/analytics/query`
 * relays verbatim) and the dataset door (`AnalyticsService.queryDataset`), both
 * answered by `NativeSQLStrategy` (one raw statement, no engine aggregate):
 *
 * | measure | SQLite | PostgreSQL 16.13 |
 * |:--|:--|:--|
 * | `count(*)`, `count(note)`, `count_distinct(note)` | `2` | `"2"` |
 * | `sum` / `avg` over `rating` (an integer column) | `7` / `3.5` | `"7"` / `"3.5000000000000000"` |
 * | `sum` / `avg` over `number` (the exact-decimal column) | `500` / `250` | `"500.000000000000000000000000000000"` / `"250.0…"` |
 * | `min(number)`, `max(currency)` | `100`, `20.5` | `"100.0…"`, `"20.500000000000000000000000000000"` |
 * | a dataset's `row_count` | `2` | `"2"` |
 *
 * On PostgreSQL's dataset door one column mixed both types: a measure-scoped
 * `filtered_count` read `"1"` in the groups the statement answered and the
 * number `0` in the group the executor filled.
 *
 * ## What the fix does, and what these pins hold
 *
 * `NativeSQLStrategy.execute` presents each measure column whose declared
 * aggregate function answers a number (`AGGREGATE_ANSWER_KIND`, `@objectstack/
 * core`), and `min` / `max` over a declared numeric column, through the same
 * `presentAsNumber` `driver-sql`'s own `aggregate()` applies (#20335). It is
 * keyed on the measure's declared function, never on whether a value looks
 * numeric: the text dimension below holds numeric-looking text and stays text.
 * [#21044] The `max` over a text column this file used to serve as the
 * second half of that control no longer reaches the presenter: the cube door
 * refuses the pair by the aggregate × field-type table before any statement
 * runs, and the case below now pins that refusal instead.
 *
 * The fixture's values are dyadic fractions and its groups hold 1, 2 or 4 rows,
 * so a JS double holds every sum and average EXACTLY and the expected values
 * are computed from the rows with JS arithmetic and asserted with `toBe`: a
 * string, a boolean or a rounding difference each fail. The precision case
 * holds #20335's one-double policy — a total beyond a double answers the
 * nearest double, equal to SQLite and to the ObjectQL face. The SUM / AVG
 * accumulation of non-dyadic fractions (`0.1 + 0.2`, `11 / 9`) is a different
 * question — what the statement adds, not how its answer is presented — and is
 * pinned beside this file in `native-sql-aggregate-policies.test.ts` (#21042).
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL cell runs where
 * `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise. CI provisions
 * that variable for this package in the Temporal Conformance job's step
 * "Run the non-SQL temporal backends under the skewed process zone"
 * (`.github/workflows/ci.yml`), so the live cell is red-capable and runs in
 * CI; the PR that landed this file carries its local PostgreSQL
 * 16 run. `@objectstack/core`'s `aggregate-answer.test.ts` pins the presenter
 * itself in CI. The live cell owns its table, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const OBJECT = 'os20889_measure_ledger';

const LEDGER = {
  name: OBJECT,
  label: 'Measure number presentation ledger',
  fields: {
    category: { name: 'category', type: 'text' as const },
    note: { name: 'note', type: 'text' as const },
    code: { name: 'code', type: 'text' as const },
    stars: { name: 'stars', type: 'rating' as const },
    amount: { name: 'amount', type: 'number' as const },
    price: { name: 'price', type: 'currency' as const },
    frac: { name: 'frac', type: 'number' as const },
  },
};

interface Row {
  id: string;
  category: string;
  note: string;
  code: string;
  stars: number;
  amount: number;
  price: number;
  frac: number;
}

/** Groups of 2, 1 and 4 rows; every value a dyadic fraction. `code` is numeric-looking TEXT. */
const ROWS: readonly Row[] = [
  { id: 'a1', category: 'a', note: 'x', code: '10', stars: 3, amount: 100, price: 10.25, frac: 0.25 },
  { id: 'a2', category: 'a', note: 'y', code: '9', stars: 4, amount: 400, price: 20.5, frac: 0.5 },
  { id: 'b1', category: 'b', note: 'x', code: '42', stars: 5, amount: 900, price: 30.75, frac: 0.125 },
  { id: 'c1', category: 'c', note: 'n0', code: '1', stars: 1, amount: 1, price: 1.5, frac: 0.75 },
  { id: 'c2', category: 'c', note: 'n1', code: '2', stars: 1, amount: 2, price: 2.25, frac: 0.75 },
  { id: 'c3', category: 'c', note: 'n2', code: '3', stars: 2, amount: 4.5, price: 0.75, frac: 0.75 },
  { id: 'c4', category: 'c', note: 'n0', code: '4', stars: 2, amount: 0.5, price: 1, frac: 0.75 },
];

const GROUPS = ['a', 'b', 'c'] as const;

const CUBE: Cube = {
  name: 'os20889_measure_cube',
  title: 'Measure number presentation cube',
  sql: OBJECT,
  public: true,
  measures: {
    row_count: { type: 'count', sql: '*', label: 'Rows' },
    cnt_note: { type: 'count', sql: 'note', label: 'Notes' },
    nd_note: { type: 'count_distinct', sql: 'note', label: 'Distinct notes' },
    sum_stars: { type: 'sum', sql: 'stars', label: 'Stars (integer column)' },
    avg_stars: { type: 'avg', sql: 'stars', label: 'Average stars' },
    sum_amount: { type: 'sum', sql: 'amount', label: 'Amount (exact-decimal column)' },
    avg_amount: { type: 'avg', sql: 'amount', label: 'Average amount' },
    min_amount: { type: 'min', sql: 'amount', label: 'Smallest amount' },
    max_price: { type: 'max', sql: 'price', label: 'Largest price' },
    sum_frac: { type: 'sum', sql: 'frac', label: 'Fractions' },
    avg_frac: { type: 'avg', sql: 'frac', label: 'Average fraction' },
    max_code: { type: 'max', sql: 'code', label: 'Largest code (text)' },
  },
  dimensions: {
    category: { type: 'string', sql: 'category', label: 'Category' },
    code: { type: 'string', sql: 'code', label: 'Code' },
  },
} as Cube;

/** Every measure that answers a number, and the value the rows give it. */
const NUMBER_MEASURES = [
  'row_count', 'cnt_note', 'nd_note',
  'sum_stars', 'avg_stars', 'sum_amount', 'avg_amount',
  'min_amount', 'max_price', 'sum_frac', 'avg_frac',
] as const;
type NumberMeasure = (typeof NUMBER_MEASURES)[number];

const byGroup = (g: string) => ROWS.filter((r) => r.category === g);
const sumOf = (rows: readonly Row[], f: 'stars' | 'amount' | 'frac') => rows.reduce((a, r) => a + r[f], 0);

function expected(g: string): Record<NumberMeasure, number> {
  const rows = byGroup(g);
  return {
    row_count: rows.length,
    cnt_note: rows.length,
    nd_note: new Set(rows.map((r) => r.note)).size,
    sum_stars: sumOf(rows, 'stars'),
    avg_stars: sumOf(rows, 'stars') / rows.length,
    sum_amount: sumOf(rows, 'amount'),
    avg_amount: sumOf(rows, 'amount') / rows.length,
    min_amount: Math.min(...rows.map((r) => r.amount)),
    max_price: Math.max(...rows.map((r) => r.price)),
    sum_frac: sumOf(rows, 'frac'),
    avg_frac: sumOf(rows, 'frac') / rows.length,
  };
}

const DATASET = {
  name: 'os20889_measure_ds',
  label: 'Measure number presentation dataset',
  object: OBJECT,
  dimensions: [{ name: 'category', field: 'category', type: 'string' }],
  measures: [
    { name: 'row_count', aggregate: 'count' },
    { name: 'nd_note', aggregate: 'count_distinct', field: 'note' },
    { name: 'sum_stars', aggregate: 'sum', field: 'stars' },
    { name: 'avg_stars', aggregate: 'avg', field: 'stars' },
    { name: 'sum_amount', aggregate: 'sum', field: 'amount' },
    { name: 'avg_amount', aggregate: 'avg', field: 'amount' },
    { name: 'min_amount', aggregate: 'min', field: 'amount' },
    { name: 'max_price', aggregate: 'max', field: 'price' },
    // Group `c` holds no `x` note: the executor fills that group.
    { name: 'filtered_count', aggregate: 'count', filter: { note: 'x' } },
  ],
};
const DATASET_MEASURES = DATASET.measures.map((m) => m.name);

interface Cell {
  id: 'sqlite' | 'pg';
  label: string;
  env: string | null;
  config: () => Record<string, unknown> | null;
}

const CELLS: readonly Cell[] = [
  { id: 'sqlite', label: 'sqlite', env: null, config: () => ({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) },
  {
    id: 'pg',
    label: 'live postgres',
    env: 'OS_TEST_POSTGRES_URL',
    config: () => (process.env.OS_TEST_POSTGRES_URL ? { client: 'pg', connection: process.env.OS_TEST_POSTGRES_URL } : null),
  },
];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

type Answer = Record<string, unknown>;
const byCategory = (rows: readonly Answer[]) => new Map(rows.map((r) => [String(r.category), r]));

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#20889] analytics native SQL — measures declared number answer numbers (${cell.label})${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: any;
      let engine: ObjectQL;
      /** Raw-SQL statements and engine aggregates that read THIS object. */
      const reads = { rawSql: 0, aggregate: 0 };
      /** `native`: the plugin's own capabilities. `objectql`: narrowed to the engine-aggregate path. */
      const services: Partial<Record<'native' | 'objectql', AnalyticsService>> = {};

      const dropTable = async () => {
        if (cell.id === 'pg') await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
      };

      /** The cube read on one face, with the strategy that answered it counted. */
      const cubeRead = async (face: 'native' | 'objectql', measures: readonly string[], dimensions: readonly string[]) => {
        const before = { ...reads };
        const res = await services[face]!.query({ cube: CUBE.name, measures: [...measures], dimensions: [...dimensions] } as any);
        return {
          rows: res.rows as Answer[],
          fields: res.fields as Array<{ name: string; type: string }>,
          rawSql: reads.rawSql - before.rawSql,
          aggregate: reads.aggregate - before.aggregate,
        };
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTable();
        engine = new ObjectQL({ logger: quiet } as any);
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(LEDGER as any);
        await engine.syncSchemas();
        for (const row of ROWS) await engine.insert(OBJECT, { ...row } as any);

        const realExecute = (engine as any).execute.bind(engine);
        (engine as any).execute = (sql: unknown, opts?: { object?: string }) => {
          if (opts?.object === OBJECT) reads.rawSql += 1;
          return realExecute(sql, opts);
        };
        const realAggregate = engine.aggregate.bind(engine);
        (engine as any).aggregate = (object: string, ...rest: unknown[]) => {
          if (object === OBJECT) reads.aggregate += 1;
          return (realAggregate as any)(object, ...rest);
        };

        // The plugin's own composition over the real engine: both auto-bridges.
        for (const [face, caps] of [
          ['native', undefined],
          ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
        ] as const) {
          const registered: Record<string, unknown> = {};
          await new AnalyticsServicePlugin({ cubes: [CUBE], ...(caps ? { queryCapabilities: caps } : {}) } as any).init({
            getService: (name: string) => (name === 'data' ? engine : registered[name]),
            registerService: (name: string, svc: unknown) => { registered[name] = svc; },
            replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
            hook: () => {},
            logger: quiet,
          } as never);
          services[face] = registered.analytics as AnalyticsService;
        }
      });

      afterAll(async () => {
        await dropTable();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      it('the cube read: every measure declared number is a number, equal to the rows, and the native strategy answered it', async () => {
        const res = await cubeRead('native', NUMBER_MEASURES, ['category']);
        expect(res.rawSql, 'one raw statement: NativeSQLStrategy answered').toBe(1);
        expect(res.aggregate, 'no engine aggregate').toBe(0);
        for (const m of NUMBER_MEASURES) {
          expect(res.fields.find((f) => f.name === m)?.type, `fields[] declares ${m} number`).toBe('number');
        }
        const answers = byCategory(res.rows);
        expect([...answers.keys()].sort()).toEqual([...GROUPS]);
        for (const g of GROUPS) {
          const a = answers.get(g)!;
          const want = expected(g);
          for (const m of NUMBER_MEASURES) {
            expect(typeof a[m], `${g} ${m} is a number, never ${JSON.stringify(a[m])}`).toBe('number');
            expect(a[m], `${g} ${m}`).toBe(want[m]);
          }
        }
      });

      it('keyed on the declared function, never on the value: a text dimension stays text, and max over a text column is refused before it is read', async () => {
        // [#21044] Flipped, not deleted: this half used to read the column's
        // text back. The aggregate × field-type table refuses `max` over `text`,
        // and the cube door now asks it ahead of the strategy.
        const before = { ...reads };
        const refused = await services.native!.query({ cube: CUBE.name, measures: ['max_code'], dimensions: ['category'] } as any).then(
          () => undefined,
          (e: Error & { code?: string; status?: number }) => e,
        );
        expect(refused?.code, refused?.message).toBe('INVALID_FIELD');
        expect(refused?.status).toBe(400);
        expect(reads.rawSql - before.rawSql, 'no statement ran').toBe(0);

        const byCode = await cubeRead('native', ['row_count'], ['code']);
        expect(byCode.rawSql).toBe(1);
        const groups = byCode.rows.map((r) => [r.code, r.row_count]).sort(([x], [y]) => String(x).localeCompare(String(y)));
        expect(groups).toEqual(
          [...ROWS.map((r) => r.code)].sort((x, y) => x.localeCompare(y)).map((code) => [code, 1]),
        );
      });

      it('the dataset door: row_count and every measure are numbers in every group, the executor-filled group included', async () => {
        const before = { ...reads };
        const res = await services.native!.queryDataset(DATASET as any, { measures: DATASET_MEASURES, dimensions: ['category'] } as any);
        expect(reads.rawSql - before.rawSql, 'NativeSQLStrategy answered').toBeGreaterThanOrEqual(1);
        expect(reads.aggregate - before.aggregate, 'no engine aggregate').toBe(0);
        const answers = byCategory(res.rows as Answer[]);
        expect([...answers.keys()].sort()).toEqual([...GROUPS]);
        for (const g of GROUPS) {
          const a = answers.get(g)!;
          const want = expected(g);
          for (const m of DATASET_MEASURES) {
            expect(typeof a[m], `${g} ${m} is a number, never ${JSON.stringify(a[m])}`).toBe('number');
          }
          for (const m of ['row_count', 'nd_note', 'sum_stars', 'avg_stars', 'sum_amount', 'avg_amount', 'min_amount', 'max_price'] as const) {
            expect(a[m], `${g} ${m}`).toBe(want[m]);
          }
          expect(a.filtered_count, `${g} filtered_count`).toBe(byGroup(g).filter((r) => r.note === 'x').length);
        }
      });

      it('dyadic fractions: the native face and the ObjectQL face answer the same numbers', async () => {
        const native = await cubeRead('native', NUMBER_MEASURES, ['category']);
        const objectql = await cubeRead('objectql', NUMBER_MEASURES, ['category']);
        expect(native.rawSql).toBe(1);
        expect(objectql.rawSql, 'the ObjectQL face ran no raw statement').toBe(0);
        expect(objectql.aggregate, 'the ObjectQL face asked the engine').toBeGreaterThanOrEqual(1);
        const n = byCategory(native.rows);
        const o = byCategory(objectql.rows);
        for (const g of GROUPS) {
          for (const m of NUMBER_MEASURES) expect(n.get(g)![m], `${g} ${m}`).toBe(o.get(g)![m]);
        }
      });

      it('precision policy: a total a double cannot hold answers the nearest double, equal to the ObjectQL face', async () => {
        // Written by SQL, not by the engine: a JS number could not carry these
        // values in the first place. The literals are numeric, so PostgreSQL's
        // exact-decimal column stores them exactly (SQLite's column rounds on write).
        const EXACT = ['9007199254740993', '12345678901234567.123456789'];
        for (const [i, literal] of EXACT.entries()) {
          await driver.execute(`insert into ${OBJECT} (id, category, amount) values ('p${i}', 'p${i}', ${literal})`);
        }
        const native = byCategory((await cubeRead('native', ['sum_amount', 'avg_amount', 'min_amount'], ['category'])).rows);
        const objectql = byCategory((await cubeRead('objectql', ['sum_amount', 'avg_amount', 'min_amount'], ['category'])).rows);
        for (const [i, literal] of EXACT.entries()) {
          const a = native.get(`p${i}`)!;
          for (const m of ['sum_amount', 'avg_amount', 'min_amount'] as const) {
            expect(typeof a[m], `${m} over ${literal} is a number, never ${JSON.stringify(a[m])}`).toBe('number');
            expect(a[m], `${m} over ${literal}`).toBe(Number(literal));
            expect(a[m], `${m} over ${literal} equals the ObjectQL face`).toBe(objectql.get(`p${i}`)![m]);
          }
        }
      });
    },
  );
}
