// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21042] The native-SQL strategy answers an aggregate with the engine's own
 * aggregate policies, so one query gives one number whichever strategy serves
 * it — at the cube door (`AnalyticsService.query`, what
 * `POST /api/v1/analytics/query` relays verbatim) and at the dataset door
 * (`AnalyticsService.queryDataset`).
 *
 * ## Measured on the base, through these doors
 *
 * The native face skipped three policies `driver-sql`'s own `aggregate()`
 * applies, and the engine and the ObjectQL face therefore answered otherwise:
 *
 * | policy | native face | ObjectQL face / `engine.aggregate` |
 * |:--|:--|:--|
 * | #20387, double accumulation (PostgreSQL) | `sum` of 0.1 and 0.2 `0.3`, their `avg` `0.15`; `avg` of seven 1s and two 2s `1.222222222222222` | `0.30000000000000004`, `0.15000000000000002`, `1.2222222222222223` |
 * | #11635, the boolean-aggregand cast (PostgreSQL) | `sum` / `avg` / `min` / `max` over a boolean: `500` (`function sum(boolean) does not exist`) | numbers, per #11152's ruling |
 * | #15546, the empty-sum fold (every dialect) | a group whose aggregand is NULL in every row, and a measure-scoped `sum` with no admitted row, answer `sum` `null` at the cube door | `0` (the dataset door's `DatasetExecutor` fill also answered `0`) |
 *
 * `avg` / `min` / `max` over nothing stay `null` on every face, as ruled.
 *
 * ## What the fix does, and what these pins hold
 *
 * The policies live once, in `@objectstack/core` (`utils/aggregate-answer.ts`),
 * and both faces read them: the native compile wraps each measure's column with
 * the operand the policy names for its aggregate, its column's declared class
 * and the dialect, and the native shaping point folds a `null` answer to
 * `emptyGroupValueFor` (`@objectstack/spec`) for every measure, measure-scoped
 * ones included, before the number presenter.
 *
 * Each measure is asked on its own, on each face and at each door, and every
 * group's answer is held to the value the engine computes for those rows — so
 * a policy one face skips fails exactly that measure's case, and a face that
 * errors fails it too. At the dataset door a measure rides with the base
 * `cnt`, so the executor's main statement reports every group: a selection of
 * measure-scoped measures alone reports only the groups their filter admits. The two faces are also held equal to each other, cell for cell.
 * One cell is NOT held to a value: at the dataset door a measure-scoped `avg`
 * is absent from a group its supplementary query reported no row for, on both
 * faces (no divergence, and no ruled answer); that cell is held only to "both
 * faces agree".
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs; there, the fold is the policy that diverged. The
 * PostgreSQL cell runs where `OS_TEST_POSTGRES_URL` is set and is a named skip
 * otherwise; CI provisions that variable for this package in the
 * Temporal Conformance job's step
 * "Run the non-SQL temporal backends under the skewed process zone"
 * (`.github/workflows/ci.yml`), so the live cell is red-capable and runs in
 * CI, and the PR that landed this file carries
 * its local PostgreSQL 16 run. The operand the PostgreSQL / MySQL cells rely on
 * is pinned per dialect in CI by `@objectstack/core`'s `aggregate-answer.test.ts`
 * and by `driver-sql`'s move proof. MySQL is not a cell here. The live cell owns
 * its table, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const OBJECT = 'os21042_policy_ledger';

const LEDGER = {
  name: OBJECT,
  label: 'Aggregate policy ledger',
  fields: {
    grp: { name: 'grp', type: 'text' as const },
    tag: { name: 'tag', type: 'text' as const },
    // An exact-decimal column (`numeric(65,30)` on PostgreSQL): a FRACTIONAL class.
    frac: { name: 'frac', type: 'number' as const },
    // An integer column: `sum` keeps the exact total, `avg` accumulates in double.
    stars: { name: 'stars', type: 'rating' as const },
    flag: { name: 'flag', type: 'boolean' as const },
  },
};

interface Row {
  id: string;
  grp: string;
  tag: string;
  frac: number | null;
  stars: number | null;
  flag: boolean | null;
}

const NINE_STARS = [1, 1, 1, 1, 1, 1, 1, 2, 2];

const ROWS: readonly Row[] = [
  // `f`: `0.1 + 0.2` — two addends, so no summation order can move the last place.
  { id: 'f1', grp: 'f', tag: 'x', frac: 0.1, stars: 1, flag: true },
  { id: 'f2', grp: 'f', tag: 'x', frac: 0.2, stars: 2, flag: false },
  // `i`: 11 / 9 over an integer column; 7 / 9 over a boolean; no `x` tag.
  ...NINE_STARS.map((stars, k) => ({ id: `i${k}`, grp: 'i', tag: 'y', frac: 1, stars, flag: k < 7 })),
  // `n`: every aggregand NULL in every row.
  ...[0, 1, 2].map((k) => ({ id: `n${k}`, grp: 'n', tag: 'z', frac: null, stars: null, flag: null })),
];

const GROUPS = ['f', 'i', 'n'] as const;
type Group = (typeof GROUPS)[number];

/**
 * The dataset both doors read. The cube door reaches its measure-scoped
 * filters through the compiled dataset the service registered under its name.
 */
const DATASET = {
  name: 'os21042_policy_ds',
  label: 'Aggregate policy dataset',
  object: OBJECT,
  dimensions: [{ name: 'grp', field: 'grp', type: 'string' }],
  measures: [
    { name: 'cnt', aggregate: 'count' },
    { name: 'sum_frac', aggregate: 'sum', field: 'frac' },
    { name: 'avg_frac', aggregate: 'avg', field: 'frac' },
    { name: 'sum_stars', aggregate: 'sum', field: 'stars' },
    { name: 'avg_stars', aggregate: 'avg', field: 'stars' },
    { name: 'sum_flag', aggregate: 'sum', field: 'flag' },
    { name: 'avg_flag', aggregate: 'avg', field: 'flag' },
    { name: 'min_flag', aggregate: 'min', field: 'flag' },
    { name: 'max_flag', aggregate: 'max', field: 'flag' },
    // Measure-scoped: only `f` holds an `x` tag.
    { name: 'x_cnt', aggregate: 'count', filter: { tag: 'x' } },
    { name: 'x_sum_frac', aggregate: 'sum', field: 'frac', filter: { tag: 'x' } },
    { name: 'x_avg_frac', aggregate: 'avg', field: 'frac', filter: { tag: 'x' } },
  ],
};
const MEASURES = DATASET.measures.map((m) => m.name);
type Measure = (typeof MEASURES)[number];

/** The rows path's own arithmetic: JS doubles, added in row order (two addends at most differ nowhere). */
function engineAnswer(measure: Measure, g: Group): number | null {
  const all = ROWS.filter((r) => r.grp === g);
  const admitted = measure.startsWith('x_') ? all.filter((r) => r.tag === 'x') : all;
  const column = measure.endsWith('frac') ? 'frac' : measure.endsWith('stars') ? 'stars' : 'flag';
  const values = admitted.map((r) => r[column]).filter((v) => v !== null).map(Number);
  const sum = values.reduce((a, b) => a + b, 0);
  if (measure === 'cnt' || measure === 'x_cnt') return admitted.length;
  if (measure.startsWith('sum') || measure === 'x_sum_frac') return sum;
  if (values.length === 0) return null;
  if (measure.startsWith('avg') || measure === 'x_avg_frac') return sum / values.length;
  if (measure === 'min_flag') return Math.min(...values);
  return Math.max(...values);
}

/** The card's literals, so the oracle above cannot drift with them. */
const LITERALS: ReadonlyArray<readonly [Measure, Group, number | null]> = [
  ['sum_frac', 'f', 0.30000000000000004],
  ['avg_frac', 'f', 0.15000000000000002],
  ['avg_stars', 'i', 1.2222222222222223],
  ['avg_flag', 'i', 0.7777777777777778],
  ['sum_flag', 'i', 7],
  ['min_flag', 'i', 0],
  ['max_flag', 'i', 1],
  ['sum_frac', 'n', 0],
  ['sum_stars', 'n', 0],
  ['sum_flag', 'n', 0],
  ['avg_frac', 'n', null],
  ['max_flag', 'n', null],
  ['cnt', 'n', 3],
  ['x_sum_frac', 'i', 0],
  ['x_cnt', 'i', 0],
];

/** The one cell a value is not held for: the dataset door omits it (see the header). */
const datasetDoorOmits = (measure: Measure, g: Group) => measure === 'x_avg_frac' && g !== 'f';

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

type Face = 'native' | 'objectql';
type Door = 'cube' | 'dataset';

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

describe('[#21042] the oracle reads the card', () => {
  it('the engine arithmetic above answers the card literals', () => {
    for (const [m, g, want] of LITERALS) expect(engineAnswer(m, g), `${m} ${g}`).toBe(want);
  });
});

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#21042] analytics native SQL applies the engine's aggregate policies (${cell.label})${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: any;
      let engine: ObjectQL;
      /** Raw-SQL statements and engine aggregates that read THIS object. */
      const reads = { rawSql: 0, aggregate: 0 };
      const services: Partial<Record<Face, AnalyticsService>> = {};

      const dropTable = async () => {
        if (cell.id === 'pg') await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
      };

      /** One measure, on one face, at one door: the answer per group, and which strategy served it. */
      const read = async (face: Face, door: Door, measure: Measure) => {
        const before = { ...reads };
        const measures = door === 'dataset' && measure !== 'cnt' ? ['cnt', measure] : [measure];
        const selection = { measures, dimensions: ['grp'] };
        const outcome = await (door === 'cube'
          ? services[face]!.query({ cube: DATASET.name, ...selection } as any)
          : services[face]!.queryDataset(DATASET as any, selection as any)
        ).then(
          (res) => ({ rows: res.rows as Array<Record<string, unknown>>, err: undefined as (Error & { code?: string }) | undefined }),
          (err) => ({ rows: [] as Array<Record<string, unknown>>, err: err as Error & { code?: string } }),
        );
        return {
          ...outcome,
          byGroup: new Map(outcome.rows.map((r) => [String(r.grp), r])),
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

        // The plugin's own composition over the real engine. `native`: both
        // auto-bridges live, so NativeSQLStrategy answers. `objectql`: narrowed
        // to the engine-aggregate path.
        for (const [face, caps] of [
          ['native', undefined],
          ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
        ] as const) {
          const registered: Record<string, unknown> = {};
          await new AnalyticsServicePlugin({ ...(caps ? { queryCapabilities: caps } : {}) } as any).init({
            getService: (name: string) => (name === 'data' ? engine : registered[name]),
            registerService: (name: string, svc: unknown) => { registered[name] = svc; },
            replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
            hook: () => {},
            logger: quiet,
          } as never);
          const service = registered.analytics as AnalyticsService;
          // The configuration door: the cube door reads the dataset's measure filters by name.
          service.registerDataset(DATASET as any);
          services[face] = service;
        }
      });

      afterAll(async () => {
        await dropTable();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      for (const door of ['cube', 'dataset'] as const) {
        for (const measure of MEASURES) {
          it(`${door} door, ${measure}: both faces answer the engine's number in every group`, async () => {
            const native = await read('native', door, measure);
            const objectql = await read('objectql', door, measure);
            expect(native.err, `native: ${native.err?.code} ${native.err?.message}`).toBeUndefined();
            expect(objectql.err, `objectql: ${objectql.err?.code} ${objectql.err?.message}`).toBeUndefined();
            expect(native.rawSql, 'NativeSQLStrategy served the native face').toBeGreaterThanOrEqual(1);
            expect(native.aggregate, 'the native face asked no engine aggregate').toBe(0);
            expect(objectql.rawSql, 'the ObjectQL face ran no raw statement').toBe(0);
            expect(objectql.aggregate, 'the ObjectQL face asked the engine').toBeGreaterThanOrEqual(1);
            expect([...native.byGroup.keys()].sort(), 'native groups').toEqual([...GROUPS]);
            expect([...objectql.byGroup.keys()].sort(), 'objectql groups').toEqual([...GROUPS]);
            for (const g of GROUPS) {
              const n = native.byGroup.get(g)![measure];
              const o = objectql.byGroup.get(g)![measure];
              expect(n, `${g}: the native face equals the ObjectQL face`).toBe(o);
              if (door === 'dataset' && datasetDoorOmits(measure, g)) continue;
              expect(n, `${g}: native answers the engine's number, never ${JSON.stringify(n)}`).toBe(engineAnswer(measure, g));
              expect(o, `${g}: objectql answers the engine's number`).toBe(engineAnswer(measure, g));
            }
          });
        }
      }
    },
  );
}
