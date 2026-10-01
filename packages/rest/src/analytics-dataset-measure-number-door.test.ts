// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20889] `POST /api/v1/analytics/dataset/query` answers every measure the
 * response declares `number` as a JSON number, on SQLite and on PostgreSQL —
 * over a real `SqlDriver`, through the native-SQL strategy.
 *
 * ## Measured on the base, through this door
 *
 * An inline dataset over three categories (2, 1 and 4 rows), its measures
 * answered by `NativeSQLStrategy` (one raw statement per query, no engine
 * aggregate):
 *
 * | measure | SQLite | PostgreSQL 16 |
 * |:--|:--|:--|
 * | `row_count` (`count`), `nd_note` (`count_distinct`) | numbers | strings (`"2"`) |
 * | `sum` / `avg` over a `rating` (an integer column) | numbers | strings (`"7"`, `"3.5000000000000000"`) |
 * | `sum` / `avg` / `min` over a `number`, `max` over a `currency` | numbers | strings (`"500.000000000000000000000000000000"`) |
 * | a measure-scoped `filtered_count` | numbers | `"1"` in the groups the statement answered, the number `0` in the group the executor filled |
 *
 * `fields[]` declared `number` for every one of them on both dialects. The
 * cube read of the same object (`POST /api/v1/analytics/query`, served by
 * `@objectstack/runtime`'s dispatcher, which relays `AnalyticsService.query`'s
 * result verbatim) answered the same strings; the strategy-level pin is
 * `@objectstack/service-analytics`' `native-sql-measure-number-presentation.test.ts`.
 *
 * The fixture's values are dyadic fractions and its groups hold 1, 2 or 4 rows,
 * so a JS double holds every sum and average EXACTLY: the expected values are
 * computed from the rows and asserted with `toBe`.
 *
 * ## The composition, and the dialect axis of THIS file
 *
 * The analytics service is the one `AnalyticsServicePlugin` composes over a
 * real `ObjectQL` engine — both auto-bridges live, so `NativeSQLStrategy`
 * answers on a SQL driver. The SQLite cell always runs. The PostgreSQL cell
 * runs where `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise; no
 * CI step provisions that variable for this package, so the live cell is
 * red-capable and un-run in CI, and the PR that landed this file carries its
 * local PostgreSQL 16 run. The live cell owns its table, dropped before and
 * after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AnalyticsServicePlugin, type AnalyticsService } from '@objectstack/service-analytics';
import { RestServer } from './rest-server';

const OBJECT = 'rest_dataset_measure_number_ledger';

const LEDGER = {
  name: OBJECT,
  label: 'Dataset measure number ledger',
  fields: {
    category: { name: 'category', type: 'text' as const },
    note: { name: 'note', type: 'text' as const },
    stars: { name: 'stars', type: 'rating' as const },
    amount: { name: 'amount', type: 'number' as const },
    price: { name: 'price', type: 'currency' as const },
  },
};

interface Row {
  id: string;
  category: string;
  note: string;
  stars: number;
  amount: number;
  price: number;
}

const ROWS: readonly Row[] = [
  { id: 'a1', category: 'a', note: 'x', stars: 3, amount: 100, price: 10.25 },
  { id: 'a2', category: 'a', note: 'y', stars: 4, amount: 400, price: 20.5 },
  { id: 'b1', category: 'b', note: 'x', stars: 5, amount: 900, price: 30.75 },
  { id: 'c1', category: 'c', note: 'n0', stars: 1, amount: 1, price: 1.5 },
  { id: 'c2', category: 'c', note: 'n1', stars: 1, amount: 2, price: 2.25 },
  { id: 'c3', category: 'c', note: 'n2', stars: 2, amount: 4.5, price: 0.75 },
  { id: 'c4', category: 'c', note: 'n0', stars: 2, amount: 0.5, price: 1 },
];

const GROUPS = ['a', 'b', 'c'] as const;

/** The inline dataset the request carries — as a Studio preview or a widget posts it. */
const DATASET = {
  name: 'measure_number_inline',
  label: 'Measure number inline',
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
const MEASURES = DATASET.measures.map((m) => m.name);

const byGroup = (g: string) => ROWS.filter((r) => r.category === g);
const sumOf = (rows: readonly Row[], f: 'stars' | 'amount') => rows.reduce((a, r) => a + r[f], 0);

function expected(g: string): Record<string, number> {
  const rows = byGroup(g);
  return {
    row_count: rows.length,
    nd_note: new Set(rows.map((r) => r.note)).size,
    sum_stars: sumOf(rows, 'stars'),
    avg_stars: sumOf(rows, 'stars') / rows.length,
    sum_amount: sumOf(rows, 'amount'),
    avg_amount: sumOf(rows, 'amount') / rows.length,
    min_amount: Math.min(...rows.map((r) => r.amount)),
    max_price: Math.max(...rows.map((r) => r.price)),
    filtered_count: rows.filter((r) => r.note === 'x').length,
  };
}

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

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function mockProtocol() {
  return {
    getDiscovery: async () => ({ version: 'v0', routes: { data: '', metadata: '' } }),
    getMetaTypes: async () => [],
    getMetaItems: async () => [],
  };
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    header: () => res,
    status: (code: number) => { res.statusCode = code; return res; },
    json: (body: unknown) => { res.body = body; return res; },
    end: () => res,
  };
  return res;
}

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#20889] POST /api/v1/analytics/dataset/query — measures declared number answer JSON numbers — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: any;
      let engine: ObjectQL;
      /** Raw-SQL statements and engine aggregates that read THIS object. */
      const reads = { rawSql: 0, aggregate: 0 };
      let query: (selection: Record<string, unknown>) => Promise<{ status: number; body: any }>;

      const dropTable = async () => {
        if (cell.id === 'pg') await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
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
        const registered: Record<string, unknown> = {};
        await new AnalyticsServicePlugin().init({
          getService: (name: string) => (name === 'data' ? engine : registered[name]),
          registerService: (name: string, svc: unknown) => { registered[name] = svc; },
          replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
          hook: () => {},
          logger: quiet,
        } as never);
        const service = registered.analytics as AnalyticsService;

        const rest = new RestServer(
          createMockServer() as any, mockProtocol() as any, { api: { requireAuth: false } } as any,
          undefined, undefined, undefined, undefined, undefined, undefined, undefined,
          undefined, undefined, undefined, undefined,
          async () => service,
        );
        (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
        rest.registerRoutes();
        const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/analytics/dataset/query');
        expect(route).toBeDefined();
        query = async (selection) => {
          const res = makeRes();
          // What the wire carries: JSON, both ways.
          const body = JSON.parse(JSON.stringify({ dataset: DATASET, selection }));
          await route!.handler({ method: 'POST', params: {}, headers: {}, body, query: {} } as any, res);
          return { status: res.statusCode, body: JSON.parse(JSON.stringify(res.body)) };
        };
      });

      afterAll(async () => {
        await dropTable();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      it('every measure is a JSON number in every group, equal to the rows; fields[] declares each one number', async () => {
        const before = { ...reads };
        const res = await query({ measures: MEASURES, dimensions: ['category'] });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(reads.rawSql - before.rawSql, 'NativeSQLStrategy answered').toBeGreaterThanOrEqual(1);
        expect(reads.aggregate - before.aggregate, 'no engine aggregate').toBe(0);
        const fields = res.body.fields as Array<{ name: string; type: string }>;
        for (const m of MEASURES) expect(fields.find((f) => f.name === m)?.type, `fields[] declares ${m}`).toBe('number');

        const rows = res.body.rows as Array<Record<string, unknown>>;
        expect(rows.map((r) => r.category).sort()).toEqual([...GROUPS]);
        for (const r of rows) {
          // The dimension is text and stays text.
          expect(typeof r.category).toBe('string');
          const want = expected(String(r.category));
          for (const m of MEASURES) {
            expect(typeof r[m], `${String(r.category)} ${m} is a number, never ${JSON.stringify(r[m])}`).toBe('number');
            expect(r[m], `${String(r.category)} ${m}`).toBe(want[m]);
          }
        }
      });
    },
  );
}
