// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20335] `having` `$in` / `$eq` on `count` / `count_distinct` / `sum` /
 * `avg` keep the same groups on the native and the rows path, through
 * `engine.aggregate` and `POST /api/v1/data/:object/query`, over a real
 * `SqlDriver` — and the response carries those aggregates as JSON numbers.
 *
 * Measured on the base (`26daf0b036`), `groupBy` customer, four groups c1–c4:
 *
 * | `having` | SQLite (both paths), PG rows, MySQL rows | PostgreSQL native | MySQL native |
 * |:--|:--|:--|:--|
 * | `{ n: { $in: [2] } }` | c1, c2 | no group | c1, c2 |
 * | `{ total: { $in: [500, 20] } }` | c1, c4 | no group | no group |
 * | `{ mean: { $in: [250, 600] } }` | c1, c2 | no group | no group |
 * | `{ n: { $lt: 'not-a-date' } }` | no group | c1–c4 | no group |
 * | `{ total: { $lt: 'not-a-date' } }` | no group | c1–c4 | c1–c4 |
 *
 * [#20351] The two string rows are refused now, `INVALID_FILTER` / 400 before
 * any read, by the engine's number-comparand door (the `REFUSED` table below).
 *
 * The native path handed the SQL client's strings through (`"n": "2"`,
 * `"total": "500.000000000000000000000000000000"`); `SqlDriver.aggregate` now
 * presents them as numbers (`sql-driver-20335-aggregate-numeric-presentation.test.ts`
 * pins the value on every dialect cell of `driver-sql`'s live matrix).
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL and MySQL cells run where
 * `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` are set and are a named skip
 * otherwise; no CI job provisions them for this package today (the live
 * servers are attached to `driver-sql`'s suite, where the value pins live).
 * Each live cell owns one table, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { EngineAggregateOptions, FilterCondition } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rest_agg_20335';

const LEDGER = {
  name: OBJECT,
  label: 'Ledger 20335',
  fields: {
    customer_id: { name: 'customer_id', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    note: { name: 'note', type: 'text' as const },
  },
};

const ROWS = [
  { id: 'o1', customer_id: 'c1', amount: 100, note: 'a' },
  { id: 'o2', customer_id: 'c1', amount: 400, note: 'b' },
  { id: 'o3', customer_id: 'c2', amount: 900, note: 'c' },
  { id: 'o4', customer_id: 'c2', amount: 300, note: 'd' },
  { id: 'o5', customer_id: 'c3', amount: 50, note: 'e' },
  { id: 'o6', customer_id: 'c4', amount: 20, note: 'f' },
];

interface Cell {
  label: string;
  env: string | null;
  config: () => Record<string, unknown> | null;
}

const CELLS: readonly Cell[] = [
  { label: 'sqlite', env: null, config: () => ({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) },
  {
    label: 'live postgres',
    env: 'OS_TEST_POSTGRES_URL',
    config: () => (process.env.OS_TEST_POSTGRES_URL ? { client: 'pg', connection: process.env.OS_TEST_POSTGRES_URL } : null),
  },
  {
    label: 'live mysql',
    env: 'OS_TEST_MYSQL_URL',
    config: () => (process.env.OS_TEST_MYSQL_URL ? { client: 'mysql2', connection: process.env.OS_TEST_MYSQL_URL } : null),
  },
];

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

type Path = 'native' | 'rows';

/**
 * `native`: SqlDriver aggregates and the engine applies `having` to its
 * answer. `rows`: a filtered aggregation sends the engine to the rows path,
 * where it aggregates `find()` rows itself and then applies `having`.
 */
function grouped(path: Path, having?: Record<string, unknown>): EngineAggregateOptions {
  const aggregations: NonNullable<EngineAggregateOptions['aggregations']> = [
    { function: 'count', alias: 'n' },
    { function: 'count_distinct', field: 'note', alias: 'nd' },
    { function: 'sum', field: 'amount', alias: 'total' },
    { function: 'avg', field: 'amount', alias: 'mean' },
  ];
  if (path === 'rows') aggregations.push({ function: 'count', alias: 'fb', filter: { customer_id: { $ne: '' } } });
  return { groupBy: ['customer_id'], aggregations, ...(having ? { having: having as FilterCondition } : {}) };
}

const groupsOf = (rows: any[]) => rows.map((r) => r.customer_id).sort();

// having · groups kept, on every path, door and dialect
const KEPT: ReadonlyArray<readonly [string, Record<string, unknown>, string[]]> = [
  ['count $in', { n: { $in: [2] } }, ['c1', 'c2']],
  ['count $eq', { n: { $eq: 2 } }, ['c1', 'c2']],
  ['count_distinct $in', { nd: { $in: [2] } }, ['c1', 'c2']],
  ['count_distinct $eq', { nd: { $eq: 1 } }, ['c3', 'c4']],
  ['sum $in', { total: { $in: [500, 20] } }, ['c1', 'c4']],
  ['sum $eq', { total: { $eq: 1200 } }, ['c2']],
  ['avg $in', { mean: { $in: [250, 600] } }, ['c1', 'c2']],
  ['avg $eq', { mean: { $eq: 50 } }, ['c3']],
];

// [#20351] having · the refused key path — a string that names no number, on a
// numeric column. These kept no group (c1–c4 on PostgreSQL's native path)
// before the number-comparand door; they are refused now, before any read, on
// every path, door and dialect.
const REFUSED: ReadonlyArray<readonly [string, Record<string, unknown>, string]> = [
  ['a string $lt on count', { n: { $lt: 'not-a-date' } }, 'having.n.$lt'],
  ['a string $lt on sum', { total: { $lt: 'not-a-date' } }, 'having.total.$lt'],
  ['an extended-year ISO $gt on avg', { mean: { $gt: '+010000-01-01T00:00:00.000Z' } }, 'having.mean.$gt'],
];

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#20335] having on count / sum / avg — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      let driver: any;
      let post: (body: Record<string, unknown>) => Promise<any>;

      beforeAll(async () => {
        driver = new SqlDriver(config as never);
        if (cell.env) await driver.execute(`drop table if exists ${OBJECT}`).catch(() => {});
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(LEDGER as any);
        await engine.syncSchemas();
        // One row per call: MySQL answers no RETURNING for a batch insert.
        for (const row of ROWS) await engine.insert(OBJECT, row as any);

        const protocol = new ObjectStackProtocolImplementation(engine as any);
        const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
        (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
        rest.registerRoutes();
        const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
        expect(route).toBeDefined();
        post = async (body) => {
          const res = makeRes();
          // What the wire carries: JSON, both ways.
          await route!.handler({ params: { object: OBJECT }, body: JSON.parse(JSON.stringify(body)) } as any, res);
          if (res._json !== undefined) res._json = JSON.parse(JSON.stringify(res._json));
          return res;
        };
      });

      afterAll(async () => {
        if (cell.env) await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      it('the response carries count / count_distinct / sum / avg as JSON numbers, equal on both paths', async () => {
        const answers: Record<string, unknown> = {};
        for (const path of ['native', 'rows'] as const) {
          const res = await post(grouped(path) as Record<string, unknown>);
          expect(res._status ?? 200, JSON.stringify(res._json)).toBe(200);
          const byGroup = Object.fromEntries(
            res._json.records.map((r: any) => [r.customer_id, { n: r.n, nd: r.nd, total: r.total, mean: r.mean }]),
          );
          answers[path] = byGroup;
          expect(byGroup.c1, `REST, ${path}`).toStrictEqual({ n: 2, nd: 2, total: 500, mean: 250 });
          expect(byGroup.c2, `REST, ${path}`).toStrictEqual({ n: 2, nd: 2, total: 1200, mean: 600 });
          expect(byGroup.c3, `REST, ${path}`).toStrictEqual({ n: 1, nd: 1, total: 50, mean: 50 });
          expect(byGroup.c4, `REST, ${path}`).toStrictEqual({ n: 1, nd: 1, total: 20, mean: 20 });
        }
        expect(answers.native).toStrictEqual(answers.rows);
      });

      for (const [name, having, at] of REFUSED) {
        it(`${name}: INVALID_FILTER / 400 at ${at} — engine and REST, native and rows`, async () => {
          for (const path of ['native', 'rows'] as const) {
            const err = await engine.aggregate(OBJECT, grouped(path, having)).then(() => null, (e: any) => e);
            expect({ code: err?.code, status: err?.status }, `engine, ${path}`).toEqual({ code: 'INVALID_FILTER', status: 400 });
            const res = await post(grouped(path, having) as Record<string, unknown>);
            expect(res._status, JSON.stringify(res._json)).toBe(400);
            expect(res._json.code, `REST, ${path}`).toBe('INVALID_FILTER');
            expect(res._json.error, `REST, ${path}`).toContain(at);
          }
        });
      }

      for (const [name, having, kept] of KEPT) {
        it(`${name}: keeps ${kept.join(', ') || 'no group'} — engine and REST, native and rows`, async () => {
          for (const path of ['native', 'rows'] as const) {
            expect(groupsOf(await engine.aggregate(OBJECT, grouped(path, having))), `engine, ${path}`).toEqual(kept);
            const res = await post(grouped(path, having) as Record<string, unknown>);
            expect(res._status ?? 200, JSON.stringify(res._json)).toBe(200);
            expect(groupsOf(res._json.records), `REST, ${path}`).toEqual(kept);
          }
        });
      }
    },
  );
}
