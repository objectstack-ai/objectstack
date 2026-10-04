// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21316] The ObjectQL face applies a query's `order`, then its `offset` and
 * `limit`, to the aggregated answer — the statement its echoed `sql` and
 * `/analytics/sql` render, and the clauses the native face compiles from the
 * same three keys.
 *
 * ## The shape this closes
 *
 * Measured through `POST /api/v1/analytics/query` on the real dispatcher route
 * at `origin/main` `97239c3c8`, SQLite and PostgreSQL 16.14, the ObjectQL face
 * (every bucketed query on the default composition, since the native face
 * declines `granularity`):
 *
 * | query | SQLite | PostgreSQL |
 * |:--|:--|:--|
 * | `timeDimensions [closed_on, month]`, `order { closed_on: desc }`, `limit 1` | every month, ascending | every month, 04, 03, 05 |
 * | `dimensions [note]`, `order { note: desc }` | the groups unordered | the groups unordered |
 * | `order { amount_sum: desc }`, `limit 2`, `offset 1` | every group | every group |
 *
 * The echoed `sql` rendered `ORDER BY … LIMIT … OFFSET …` for each.
 *
 * The dataset door pushes a single query's window down and then windowed the
 * answer again, so `offset` applied twice: `limit 2, offset 1` over five groups
 * answered one row on the native face. The ObjectQL face answered right only
 * because it dropped the window; the last block pins both faces.
 *
 * ## What "equal to the native face" covers
 *
 * The face orders with the package's one row comparator (`applyOrdering`).
 * The native face's `ORDER BY` follows the driver: SQLite sorts NULL lowest and
 * PostgreSQL highest, and text follows the column collation. The fixtures
 * below therefore carry no NULL, no `''`, no numeric text and no mixed case in
 * an ordered column, which is where the two faces agree on both drivers.
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL cell runs where
 * `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise; CI provisions
 * that variable for this package in the Temporal Conformance job's step
 * "Run the non-SQL temporal backends under the skewed process zone"
 * (`.github/workflows/ci.yml`), so the live cell is red-capable and runs in
 * CI, and the PR that landed this file carries its local
 * PostgreSQL 16 run. The live cell owns its tables, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const PERSON = 'os21316_person';
const DEAL = 'os21316_deal';

const PERSON_OBJECT = {
  name: PERSON,
  label: 'Order window person',
  fields: { email: { name: 'email', type: 'text' as const } },
};

const DEAL_OBJECT = {
  name: DEAL,
  label: 'Order window deal',
  fields: {
    note: { name: 'note', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    closed_on: { name: 'closed_on', type: 'date' as const },
    owner: { name: 'owner', type: 'lookup' as const, reference: PERSON },
  },
};

const PEOPLE = [
  { id: 'p1', email: 'a@x' },
  { id: 'p2', email: 'b@x' },
  { id: 'p3', email: 'c@x' },
] as const;

// By note: w 7 (1 row), x 15 (2), y 20 (1), z 1 (1). By month: 03 (2 rows,
// 15), 04 (1), 05 (20), 06 (7). By owner: a@x 15, b@x 21, c@x 7. SQLite
// answers a grouping in ascending key order, so every ordered pin below asks
// for an order, and a window, that ascending key order does not already give.
const DEALS = [
  { id: 'd1', note: 'x', amount: 10, closed_on: '2026-03-01', owner: 'p1' },
  { id: 'd2', note: 'x', amount: 5, closed_on: '2026-03-02', owner: 'p1' },
  { id: 'd3', note: 'y', amount: 20, closed_on: '2026-05-03', owner: 'p2' },
  { id: 'd4', note: 'z', amount: 1, closed_on: '2026-04-01', owner: 'p2' },
  { id: 'd5', note: 'w', amount: 7, closed_on: '2026-06-01', owner: 'p3' },
] as const;

/** It declares NO join, so `owner.email` is served by FK-expand on the ObjectQL face and by a JOIN on the native face. */
const CUBE = 'os21316_cube';
const CUBES = [
  {
    name: CUBE,
    title: 'Order window cube',
    sql: DEAL,
    public: true,
    measures: {
      count: { type: 'count', sql: '*', label: 'Rows' },
      amount_sum: { type: 'sum', sql: 'amount', label: 'Amount' },
    },
    dimensions: {
      note: { type: 'string', sql: 'note', label: 'Note' },
      closed_on: { type: 'time', sql: 'closed_on', label: 'Closed on' },
    },
  },
] as unknown as Cube[];

/** The same object as a dataset, for the dataset door's pushed-down page. */
const DATASET = {
  name: 'os21316_ds',
  label: 'Order window dataset',
  object: DEAL,
  dimensions: [
    { name: 'note', field: 'note', type: 'string' },
    { name: 'closed_on', field: 'closed_on', type: 'date' },
  ],
  measures: [{ name: 'amount_sum', aggregate: 'sum', field: 'amount' }],
};

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

/** Rows as tuples of the named columns, in the order they arrived; a numeric cell reads as a number on every dialect. */
const tuples = (rows: unknown, columns: readonly string[]) =>
  (rows as Row[]).map((row) => columns.map((c) => (typeof row[c] === 'number' || /^-?\d+(\.\d+)?$/.test(String(row[c])) ? Number(row[c]) : row[c])));

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#21316] the ObjectQL face applies order, offset and limit (${cell.label})${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: any;
      let engine: ObjectQL;
      /** Raw-SQL statements and engine aggregates, on any object, and the last aggregate's raw answer. */
      const reads = { rawSql: 0, aggregate: 0, lastAggregate: [] as Row[] };
      /** `native`: the plugin's own capabilities. `objectql`: narrowed to the engine-aggregate path. */
      const services: Partial<Record<Face, AnalyticsService>> = {};

      const dropTables = async () => {
        if (cell.id !== 'pg') return;
        for (const table of [DEAL, PERSON]) await driver?.execute(`drop table if exists ${table}`).catch(() => {});
      };

      /** One `query()` on one face, with the reads it caused. */
      const ask = async (face: Face, query: Record<string, unknown>) => {
        const before = { ...reads };
        const res = await services[face]!.query(query as any);
        return { res, rawSql: reads.rawSql - before.rawSql, aggregate: reads.aggregate - before.aggregate };
      };

      /** The ObjectQL face answers `query` exactly as the native face does, served by the engine aggregate. */
      const equalToNative = async (query: Record<string, unknown>, columns: readonly string[], expected: unknown[][]) => {
        const native = await ask('native', query);
        expect(native.rawSql, 'the native face ran its statement').toBeGreaterThan(0);
        expect(tuples(native.res.rows, columns), 'native face').toEqual(expected);
        const objectql = await ask('objectql', query);
        expect(objectql.rawSql, 'the ObjectQL face ran no statement').toBe(0);
        expect(objectql.aggregate, 'the ObjectQL face ran the engine aggregate').toBeGreaterThan(0);
        expect(tuples(objectql.res.rows, columns), 'ObjectQL face').toEqual(expected);
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTables();
        engine = new ObjectQL({ logger: quiet } as any);
        engine.registerDriver(driver, true);
        await engine.init();
        for (const object of [PERSON_OBJECT, DEAL_OBJECT]) engine.registry.registerObject(object as any);
        await engine.syncSchemas();
        for (const row of PEOPLE) await engine.insert(PERSON, { ...row } as any);
        for (const row of DEALS) await engine.insert(DEAL, { ...row } as any);

        const realExecute = (engine as any).execute.bind(engine);
        (engine as any).execute = (sql: unknown, opts?: unknown) => {
          reads.rawSql += 1;
          return realExecute(sql, opts);
        };
        const realAggregate = engine.aggregate.bind(engine);
        (engine as any).aggregate = async (...args: unknown[]) => {
          reads.aggregate += 1;
          const rows = await (realAggregate as any)(...args);
          reads.lastAggregate = (rows as Row[]).map((row) => ({ ...row }));
          return rows;
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

      describe('a bucketed time dimension, which lands on the ObjectQL face on every composition', () => {
        it("the card's row: ordered desc and limited to 1, it answers the newest bucket alone", async () => {
          const query = {
            cube: CUBE,
            measures: ['count'],
            timeDimensions: [{ dimension: 'closed_on', granularity: 'month' }],
            order: { closed_on: 'desc' },
            limit: 1,
          };
          for (const face of FACES) {
            const { res, rawSql } = await ask(face, query);
            expect(rawSql, `${face}: the native face declines granularity`).toBe(0);
            expect(tuples(res.rows, ['closed_on', 'count']), face).toEqual([['2026-06', 1]]);
          }
        });

        it('ordered desc with offset 1 and limit 2, it answers the second and third newest buckets', async () => {
          const { res } = await ask('objectql', {
            cube: CUBE,
            measures: ['amount_sum'],
            timeDimensions: [{ dimension: 'closed_on', granularity: 'month' }],
            order: { closed_on: 'desc' },
            offset: 1,
            limit: 2,
          });
          expect(tuples(res.rows, ['closed_on', 'amount_sum'])).toEqual([['2026-05', 20], ['2026-04', 1]]);
        });
      });

      describe('where both faces answer, the ObjectQL face answers what the native face does', () => {
        it("the card's row: a selected dimension ordered desc", async () => {
          await equalToNative(
            { cube: CUBE, measures: ['count'], dimensions: ['note'], order: { note: 'desc' } },
            ['note', 'count'],
            [['z', 1], ['y', 1], ['x', 2], ['w', 1]],
          );
        });

        it('a selected measure ordered desc, with offset 1 and limit 2', async () => {
          await equalToNative(
            { cube: CUBE, measures: ['amount_sum'], dimensions: ['note'], order: { amount_sum: 'desc' }, offset: 1, limit: 2 },
            ['note', 'amount_sum'],
            [['x', 15], ['w', 7]],
          );
        });

        it('two order keys, the first one most significant', async () => {
          await equalToNative(
            { cube: CUBE, measures: ['count'], dimensions: ['note'], order: { count: 'desc', note: 'asc' } },
            ['note', 'count'],
            [['x', 2], ['w', 1], ['y', 1], ['z', 1]],
          );
        });

        it('limit 0 answers no rows, as LIMIT 0 does', async () => {
          await equalToNative(
            { cube: CUBE, measures: ['count'], dimensions: ['note'], order: { note: 'asc' }, limit: 0 },
            ['note', 'count'],
            [],
          );
        });

        it('the cross-object path: a relationship-path dimension, ordered by a measure and limited', async () => {
          await equalToNative(
            { cube: CUBE, measures: ['amount_sum'], dimensions: ['owner.email'], order: { amount_sum: 'desc' }, limit: 2 },
            ['owner.email', 'amount_sum'],
            [['b@x', 21], ['a@x', 15]],
          );
        });

        it('the cross-object path: ordered by the relationship-path dimension itself, with offset 1 and limit 2', async () => {
          await equalToNative(
            { cube: CUBE, measures: ['amount_sum'], dimensions: ['owner.email'], order: { 'owner.email': 'desc' }, offset: 1, limit: 2 },
            ['owner.email', 'amount_sum'],
            [['b@x', 21], ['a@x', 15]],
          );
        });
      });

      it('the echoed sql, run on the same driver, answers the rows the ObjectQL face answered', async () => {
        const query = { cube: CUBE, measures: ['amount_sum'], dimensions: ['note'], order: { amount_sum: 'desc' }, offset: 1, limit: 2 };
        const { res } = await ask('objectql', query);
        expect(res.sql).toContain('ORDER BY "amount_sum" DESC LIMIT 2 OFFSET 1');
        const ran = (await driver.execute(res.sql)) as unknown;
        const echoed = Array.isArray(ran) ? ran : (ran as { rows: Row[] }).rows;
        expect(tuples(res.rows, ['note', 'amount_sum'])).toEqual(tuples(echoed, ['note', 'amount_sum']));
        expect(tuples(res.rows, ['note', 'amount_sum'])).toEqual([['x', 15], ['w', 7]]);
      });

      describe('CONTROL with no order, offset or limit the answer is the engine aggregate, unchanged', () => {
        it('a selected dimension', async () => {
          const { res } = await ask('objectql', { cube: CUBE, measures: ['amount_sum'], dimensions: ['note'] });
          expect(res.rows.length).toBe(4);
          expect(tuples(res.rows, ['note', 'amount_sum'])).toEqual(tuples(reads.lastAggregate, ['note', 'amount_sum']));
        });

        it('a bucketed time dimension', async () => {
          const { res } = await ask('objectql', {
            cube: CUBE,
            measures: ['count'],
            timeDimensions: [{ dimension: 'closed_on', granularity: 'month' }],
          });
          expect(res.rows.length).toBe(4);
          expect(tuples(res.rows, ['closed_on', 'count'])).toEqual(tuples(reads.lastAggregate, ['closed_on', 'count']));
        });
      });

      describe('the dataset door windows a pushed-down page once, on both faces', () => {
        it('a selected dimension ordered by a measure, offset 1 and limit 2', async () => {
          for (const face of FACES) {
            const res = await services[face]!.queryDataset(DATASET as any, {
              dimensions: ['note'],
              measures: ['amount_sum'],
              order: { amount_sum: 'desc' },
              offset: 1,
              limit: 2,
            } as any);
            expect(tuples(res.rows, ['note', 'amount_sum']), face).toEqual([['x', 15], ['w', 7]]);
          }
        });

        it('a month-bucketed dimension ordered desc, offset 1 and limit 2', async () => {
          for (const face of FACES) {
            const res = await services[face]!.queryDataset(DATASET as any, {
              dimensions: ['closed_on'],
              measures: ['amount_sum'],
              dateGranularity: 'month',
              order: { closed_on: 'desc' },
              offset: 1,
              limit: 2,
            } as any);
            expect(tuples(res.rows, ['closed_on', 'amount_sum']), face).toEqual([['2026-05', 20], ['2026-04', 1]]);
          }
        });
      });
    },
  );
}
