// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25907] A sorted, paged cube query over a group whose `sum` aggregand is
 * NULL in every row answers the same page on every dialect, and that page
 * agrees with the `0` the group answers.
 *
 * ## The shape this closes
 *
 * The #21042 fold rewrote a NULL `sum` to `0` (`emptyGroupValueFor`) in
 * JavaScript, AFTER the statement had ordered and paged on the NULL. SQLite
 * sorts NULL lowest and PostgreSQL highest, so `order { total: 'asc' },
 * limit 2` over the groups below answered, at `AnalyticsService.query` on the
 * native face:
 *
 * | | native SQLite | native PostgreSQL 16 | ObjectQL face, both |
 * |:--|:--|:--|:--|
 * | `total asc, limit 2` | `c 0`, `d -3` (a `0` before a `-3`) | `d -3`, `a 5` (`c` cut from the page) | `d -3`, `c 0` |
 *
 * The identity now lives in the statement — `COALESCE(SUM(…), 0)` — so the
 * `ORDER BY` and the window read the value the group answers. An aggregate
 * with no identity (`avg`, `min`, `max`) keeps its NULL, and so does a NULL
 * dimension value; on SQLite and PostgreSQL the `ORDER BY` states their
 * placement, `NULLS LAST` in both directions, the package's one comparator
 * rule (`applyOrdering`, which the ObjectQL face and the dataset door's
 * post-pass apply).
 *
 * ## The cells, and what each one's evidence is
 *
 *   - **sqlite → EXECUTED** (better-sqlite3), every run.
 *   - **postgres → EXECUTED** where `OS_TEST_POSTGRES_URL` is set, a named skip
 *     otherwise. CI provisions that variable for this package in the Temporal
 *     Conformance job's step "Run the non-SQL temporal backends under the
 *     skewed process zone" (`.github/workflows/ci.yml`), so the live cell is
 *     red-capable and runs in CI; the PR that landed this file carries its
 *     local PostgreSQL 16 run.
 *   - **unknown (no `sqlDialect` hook) → EXECUTED** on both engines above for
 *     the `sum` page, which needs no placement: `COALESCE` parses everywhere.
 *     The NULL placement of a no-identity key is the driver's there, stated
 *     as such: no one spelling of it parses on every dialect `unknown` covers.
 *   - **mysql → NOT MEASURED.** Asserted as text only: no MySQL server is
 *     provisionable in this container; MySQL has no `NULLS LAST`, so its
 *     placement stays the driver's.
 *
 * Every executed cell holds the native face to the ObjectQL face, row for row,
 * over every order key, both directions and four windows, and to literal
 * pages for the card's rows.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { NativeSQLStrategy, orderClauseSql } from '../strategies/native-sql-strategy.js';
import type { DatasetScopedStrategyContext } from '../strategies/types.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const LEDGER = 'os25907_ledger';

const LEDGER_OBJECT = {
  name: LEDGER,
  label: 'Empty sum order ledger',
  fields: {
    grp: { name: 'grp', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    score: { name: 'score', type: 'number' as const },
  },
};

// Inserted out of every order, so an answer in order is the statement's.
// Group `c` holds a NULL `amount` and `score` in every row; one group has a
// NULL `grp`.
const ROWS = [
  { id: 'r1', grp: 'b', amount: 4, score: 3.5 },
  { id: 'r2', grp: 'c', amount: null, score: null },
  { id: 'r3', grp: null, amount: 7, score: 3 },
  { id: 'r4', grp: 'd', amount: -3, score: 1 },
  { id: 'r5', grp: 'b', amount: 6, score: 4.5 },
  { id: 'r6', grp: 'a', amount: 5, score: 2 },
  { id: 'r7', grp: 'c', amount: null, score: null },
] as const;

const CUBE = 'os25907_cube';
const CUBES = [
  {
    name: CUBE,
    title: 'Empty sum order cube',
    sql: LEDGER,
    public: true,
    measures: {
      total: { type: 'sum', sql: 'amount', label: 'Total' },
      avg_score: { type: 'avg', sql: 'score', label: 'Average score' },
      min_score: { type: 'min', sql: 'score', label: 'Lowest score' },
    },
    dimensions: { grp: { type: 'string', sql: 'grp', label: 'Group' } },
  },
] as unknown as Cube[];

const DATASET = {
  name: 'os25907_ds',
  label: 'Empty sum order dataset',
  object: LEDGER,
  dimensions: [{ name: 'grp', field: 'grp', type: 'string' }],
  measures: [
    { name: 'total', aggregate: 'sum', field: 'amount' },
    { name: 'avg_score', aggregate: 'avg', field: 'score' },
  ],
};

const MEASURES = ['total', 'avg_score', 'min_score'] as const;
const COLUMNS = ['grp', ...MEASURES] as const;
const BASE = { cube: CUBE, measures: [...MEASURES], dimensions: ['grp'] };

/** Each group's answer: `[grp, total, avg_score, min_score]`. */
const A = ['a', 5, 2, 2];
const B = ['b', 10, 4, 3.5];
const C = ['c', 0, null, null];
const D = ['d', -3, 1, 1];
const E = [null, 7, 3, 3];

/** The card's pages and the placements this change states, literally. */
const PAGES: ReadonlyArray<readonly [string, Record<string, unknown>, unknown[][]]> = [
  ['total asc, limit 2: the folded 0 sorts after -3, on the page', { order: { total: 'asc' }, limit: 2 }, [D, C]],
  ['total asc, limit 2 offset 1', { order: { total: 'asc' }, limit: 2, offset: 1 }, [C, A]],
  ['total desc, offset 3 (no limit)', { order: { total: 'desc' }, offset: 3 }, [C, D]],
  ['total desc, every group', { order: { total: 'desc' } }, [B, E, A, C, D]],
  ['avg_score asc: the NULL group last', { order: { avg_score: 'asc' } }, [D, A, E, B, C]],
  ['avg_score desc: the NULL group last too', { order: { avg_score: 'desc' } }, [B, E, A, D, C]],
  ['min_score desc, limit 4: the NULL group off the page', { order: { min_score: 'desc' }, limit: 4 }, [B, E, A, D]],
  ['grp asc: the NULL dimension value last', { order: { grp: 'asc' } }, [A, B, C, D, E]],
  ['grp desc: the NULL dimension value last too', { order: { grp: 'desc' } }, [D, C, B, A, E]],
];

const WINDOWS: ReadonlyArray<Record<string, number>> = [{}, { limit: 2 }, { limit: 2, offset: 1 }, { offset: 3 }];

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

const FACES = ['native', 'objectql'] as const;
type Face = (typeof FACES)[number];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

type Row = Record<string, unknown>;

/** Rows as tuples of the named columns, in arrival order; a numeric cell reads as a number on every dialect. */
const tuples = (rows: unknown, columns: readonly string[]) =>
  (rows as Row[]).map((row) => columns.map((c) => (typeof row[c] === 'number' || /^-?\d+(\.\d+)?$/.test(String(row[c])) ? Number(row[c]) : row[c])));

describe('[#25907] orderClauseSql — the ORDER BY clause per dialect', () => {
  it('SQLite and PostgreSQL state NULLS LAST on every key, in both directions', () => {
    for (const dialect of ['sqlite', 'postgres'] as const) {
      expect(orderClauseSql({ total: 'asc', grp: 'desc' }, dialect), dialect)
        .toBe(' ORDER BY "total" ASC NULLS LAST, "grp" DESC NULLS LAST');
    }
  });

  it('MySQL (NOT MEASURED, text only) and an unnamed dialect keep the driver placement: no spelling parses on all of them', () => {
    for (const dialect of ['mysql', 'unknown'] as const) {
      expect(orderClauseSql({ total: 'asc', grp: 'desc' }, dialect), dialect).toBe(' ORDER BY "total" ASC, "grp" DESC');
    }
  });

  it('CONTROL: no order, no clause', () => {
    expect(orderClauseSql(undefined, 'sqlite')).toBe('');
    expect(orderClauseSql({}, 'postgres')).toBe('');
  });
});

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#25907] an all-NULL sum group sorts and pages as its 0 on the native face (${cell.label})${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: any;
      let engine: ObjectQL;
      /** Every raw statement the engine ran, in order. */
      const executed: string[] = [];
      const reads = { aggregate: 0 };
      const services: Partial<Record<Face, AnalyticsService>> = {};

      const dropTables = async () => {
        if (cell.id !== 'pg') return;
        await driver?.execute(`drop table if exists ${LEDGER}`).catch(() => {});
      };

      /** One `query()` on one face, with the statements and aggregates it caused. */
      const ask = async (face: Face, query: Record<string, unknown>) => {
        const before = { statements: executed.length, aggregate: reads.aggregate };
        const res = await services[face]!.query(query as any);
        return { res, statements: executed.slice(before.statements), aggregate: reads.aggregate - before.aggregate };
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTables();
        engine = new ObjectQL({ logger: quiet } as any);
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(LEDGER_OBJECT as any);
        await engine.syncSchemas();
        // A real `single` install's Default Organization: the system writes below
        // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
        await installDefaultOrganization(engine);
        for (const row of ROWS) await engine.insert(LEDGER, { ...row } as any);

        const realExecute = (engine as any).execute.bind(engine);
        (engine as any).execute = (sql: unknown, opts?: unknown) => {
          executed.push(String(sql));
          return realExecute(sql, opts);
        };
        const realAggregate = engine.aggregate.bind(engine);
        (engine as any).aggregate = (...args: unknown[]) => {
          reads.aggregate += 1;
          return (realAggregate as any)(...args);
        };

        for (const [face, caps] of [
          ['native', undefined],
          ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
        ] as const) {
          const registered: Record<string, unknown> = {};
          await new AnalyticsServicePlugin({ cubes: CUBES, debugSql: true, ...(caps ? { queryCapabilities: caps } : {}) } as any).init({
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
        await dropTables();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      for (const [title, window, page] of PAGES) {
        it(`${title}: both faces answer the literal page`, async () => {
          const native = await ask('native', { ...BASE, ...window });
          expect(native.statements, 'the native face ran ONE statement').toHaveLength(1);
          expect(native.aggregate, 'the native face asked no engine aggregate').toBe(0);
          expect(tuples(native.res.rows, COLUMNS), `native face\n${native.statements[0]}`).toEqual(page);

          const objectql = await ask('objectql', { ...BASE, ...window });
          expect(objectql.statements, 'the ObjectQL face ran no statement').toEqual([]);
          expect(tuples(objectql.res.rows, COLUMNS), 'ObjectQL face').toEqual(page);
        });
      }

      it('every order key, both directions, four windows: the native page is the ObjectQL page', async () => {
        for (const key of COLUMNS) {
          for (const dir of ['asc', 'desc'] as const) {
            for (const window of WINDOWS) {
              const query = { ...BASE, order: { [key]: dir }, ...window };
              const label = JSON.stringify({ order: query.order, ...window });
              const native = await ask('native', query);
              const objectql = await ask('objectql', query);
              expect(tuples(native.res.rows, COLUMNS), label).toEqual(tuples(objectql.res.rows, COLUMNS));
            }
          }
        }
      });

      it('the statement carries the identity and the placement, and the echo is the statement that ran', async () => {
        const query = { ...BASE, order: { total: 'asc', avg_score: 'desc' }, limit: 2 };
        const { res, statements } = await ask('native', query);
        expect(statements).toHaveLength(1);
        const [sql] = statements;
        expect(sql).toMatch(/COALESCE\(SUM\(.*?\), 0\) AS "total"/);
        // No identity: the NULL stays the answer.
        expect(sql).toMatch(/, AVG\(.*?\) AS "avg_score"/);
        expect(sql).not.toMatch(/COALESCE\((AVG|MIN)\(/);
        expect(sql.endsWith('ORDER BY "total" ASC NULLS LAST, "avg_score" DESC NULLS LAST LIMIT 2'), sql).toBe(true);
        expect(res.sql).toBe(sql);
        const dryRun = await services.native!.generateSql!(query as any);
        expect(dryRun.sql).toBe(sql);
      });

      it('the dataset door pushes the order and window down, and both faces answer the same page', async () => {
        for (const face of FACES) {
          const before = executed.length;
          const res = await services[face]!.queryDataset(DATASET as any, {
            dimensions: ['grp'],
            measures: ['total', 'avg_score'],
            order: { total: 'asc' },
            limit: 2,
          } as any);
          expect(tuples(res.rows, ['grp', 'total', 'avg_score']), face).toEqual([D.slice(0, 3), C.slice(0, 3)]);
          if (face === 'native') {
            const ran = executed.slice(before);
            expect(ran.some((sql) => sql.endsWith('ORDER BY "total" ASC NULLS LAST LIMIT 2')), ran.join('\n')).toBe(true);
          }
        }
      });

      it('a host that wires no sqlDialect hook (the `unknown` arm) answers the same sum page', async () => {
        const strategy = new NativeSQLStrategy();
        // The plugin's own raw-SQL bridge, restated: `$N` → `?`, the object as
        // the driver-selection key, `{ rows }` or an array back. No `sqlDialect`.
        const ctx = {
          getCube: (name: string) => (name === CUBE ? CUBES[0] : undefined),
          queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
          executeRawSql: async (object: string, sql: string, params: unknown[]) => {
            const result = await (engine as any).execute(sql.replace(/\$(\d+)/g, '?'), { args: params, object });
            return Array.isArray(result) ? result : (result as { rows: Row[] }).rows;
          },
        } as unknown as DatasetScopedStrategyContext;
        const query = { cube: CUBE, measures: ['total'], dimensions: ['grp'], order: { total: 'asc' }, limit: 2 };
        const { sql } = await strategy.generateSql(query as any, ctx);
        expect(sql.endsWith('ORDER BY "total" ASC LIMIT 2'), sql).toBe(true);
        const res = await strategy.execute(query as any, ctx);
        expect(tuples(res.rows, ['grp', 'total'])).toEqual([D.slice(0, 2), C.slice(0, 2)]);
      });
    },
  );
}
