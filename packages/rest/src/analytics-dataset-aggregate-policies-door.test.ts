// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21042] `POST /api/v1/analytics/dataset/query` answers each aggregate with
 * the engine's own aggregate policies, so the route gives one number whichever
 * strategy serves it — over a real `SqlDriver`, on SQLite and on PostgreSQL.
 *
 * ## Measured on the base, through this door
 *
 * An inline dataset over three groups, each measure asked alone, the route
 * mounted twice: once over the analytics service `AnalyticsServicePlugin`
 * composes by default (`NativeSQLStrategy` answers, one raw statement per
 * query), once narrowed to the ObjectQL strategy (`engine.aggregate`).
 *
 * | measure | PostgreSQL 16, native | PostgreSQL 16, ObjectQL | SQLite, both |
 * |:--|:--|:--|:--|
 * | `sum` / `avg` over a `number` holding 0.1 and 0.2 | `0.3` / `0.15` | `0.30000000000000004` / `0.15000000000000002` | the ObjectQL answer |
 * | `avg` over a `rating` of seven 1s and two 2s | `1.222222222222222` | `1.2222222222222223` | the ObjectQL answer |
 * | `sum` / `avg` / `min` / `max` over a `boolean` | `500` | numbers | numbers |
 *
 * A group whose aggregand is NULL in every row answered `sum` `0` at this door
 * on both faces already — `DatasetExecutor` fills it — and still does: the
 * native face now folds it too, and the fill is idempotent on a folded row.
 *
 * The expected values are the engine's arithmetic over the fixture rows (JS
 * doubles, in row order), with the card's literals pinned beside them.
 *
 * ## The composition, and the dialect axis of THIS file
 *
 * The analytics service is the one `AnalyticsServicePlugin` composes over a
 * real `ObjectQL` engine. The SQLite cell always runs. The PostgreSQL cell runs
 * where `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise; no CI step
 * provisions that variable for this package, so the live cell is red-capable
 * and un-run in CI, and the PR that landed this file carries its local
 * PostgreSQL 16 run. The live cell owns its table, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AnalyticsServicePlugin, type AnalyticsService } from '@objectstack/service-analytics';
import { RestServer } from './rest-server';

const OBJECT = 'rest_dataset_policy_ledger';

const LEDGER = {
  name: OBJECT,
  label: 'Dataset aggregate policy ledger',
  fields: {
    grp: { name: 'grp', type: 'text' as const },
    frac: { name: 'frac', type: 'number' as const },
    stars: { name: 'stars', type: 'rating' as const },
    flag: { name: 'flag', type: 'boolean' as const },
  },
};

interface Row {
  id: string;
  grp: string;
  frac: number | null;
  stars: number | null;
  flag: boolean | null;
}

const ROWS: readonly Row[] = [
  { id: 'f1', grp: 'f', frac: 0.1, stars: 1, flag: true },
  { id: 'f2', grp: 'f', frac: 0.2, stars: 2, flag: false },
  ...[1, 1, 1, 1, 1, 1, 1, 2, 2].map((stars, k) => ({ id: `i${k}`, grp: 'i', frac: 1, stars, flag: k < 7 })),
  ...[0, 1, 2].map((k) => ({ id: `n${k}`, grp: 'n', frac: null, stars: null, flag: null })),
];

const GROUPS = ['f', 'i', 'n'] as const;
type Group = (typeof GROUPS)[number];

/** The inline dataset the request carries — as a Studio preview or a widget posts it. */
const DATASET = {
  name: 'aggregate_policy_inline',
  label: 'Aggregate policy inline',
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
  ],
};
type Measure = (typeof DATASET.measures)[number]['name'];

/** The rows path's arithmetic: JS doubles, added in row order. */
function engineAnswer(measure: Measure, g: Group): number | null {
  const rows = ROWS.filter((r) => r.grp === g);
  if (measure === 'cnt') return rows.length;
  const column = measure.endsWith('frac') ? 'frac' : measure.endsWith('stars') ? 'stars' : 'flag';
  const values = rows.map((r) => r[column]).filter((v) => v !== null).map(Number);
  const sum = values.reduce((a, b) => a + b, 0);
  if (measure.startsWith('sum')) return sum;
  if (values.length === 0) return null;
  if (measure.startsWith('avg')) return sum / values.length;
  return measure.startsWith('min') ? Math.min(...values) : Math.max(...values);
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

type Face = 'native' | 'objectql';

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

describe('[#21042] the oracle reads the card', () => {
  it('the engine arithmetic above answers the card literals', () => {
    expect(engineAnswer('sum_frac', 'f')).toBe(0.30000000000000004);
    expect(engineAnswer('avg_frac', 'f')).toBe(0.15000000000000002);
    expect(engineAnswer('avg_stars', 'i')).toBe(1.2222222222222223);
    expect(engineAnswer('sum_flag', 'i')).toBe(7);
    expect(engineAnswer('avg_flag', 'i')).toBe(0.7777777777777778);
    expect(engineAnswer('sum_frac', 'n')).toBe(0);
    expect(engineAnswer('avg_frac', 'n')).toBeNull();
  });
});

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#21042] POST /api/v1/analytics/dataset/query — one number whichever strategy serves it — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: any;
      let engine: ObjectQL;
      /** Raw-SQL statements and engine aggregates that read THIS object. */
      const reads = { rawSql: 0, aggregate: 0 };
      const routes: Partial<Record<Face, (selection: Record<string, unknown>) => Promise<{ status: number; body: any }>>> = {};

      const dropTable = async () => {
        if (cell.id === 'pg') await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
      };

      const ask = async (face: Face, measure: Measure) => {
        const before = { ...reads };
        const res = await routes[face]!({ measures: [measure], dimensions: ['grp'] });
        return { ...res, rawSql: reads.rawSql - before.rawSql, aggregate: reads.aggregate - before.aggregate };
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
          routes[face] = async (selection) => {
            const res = makeRes();
            // What the wire carries: JSON, both ways.
            const body = JSON.parse(JSON.stringify({ dataset: DATASET, selection }));
            await route!.handler({ method: 'POST', params: {}, headers: {}, body, query: {} } as any, res);
            return { status: res.statusCode, body: JSON.parse(JSON.stringify(res.body ?? null)) };
          };
        }
      });

      afterAll(async () => {
        await dropTable();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      for (const { name: measure } of DATASET.measures) {
        it(`${measure}: both strategies answer 200 and the engine's number in every group`, async () => {
          const native = await ask('native', measure);
          const objectql = await ask('objectql', measure);
          expect(native.status, `native: ${JSON.stringify(native.body)}`).toBe(200);
          expect(objectql.status, `objectql: ${JSON.stringify(objectql.body)}`).toBe(200);
          expect(native.rawSql, 'NativeSQLStrategy served the native route').toBeGreaterThanOrEqual(1);
          expect(native.aggregate, 'the native route asked no engine aggregate').toBe(0);
          expect(objectql.rawSql, 'the ObjectQL route ran no raw statement').toBe(0);
          expect(objectql.aggregate, 'the ObjectQL route asked the engine').toBeGreaterThanOrEqual(1);
          const n = new Map((native.body.rows as Array<Record<string, unknown>>).map((r) => [String(r.grp), r]));
          const o = new Map((objectql.body.rows as Array<Record<string, unknown>>).map((r) => [String(r.grp), r]));
          expect([...n.keys()].sort()).toEqual([...GROUPS]);
          expect([...o.keys()].sort()).toEqual([...GROUPS]);
          for (const g of GROUPS) {
            const want = engineAnswer(measure, g);
            expect(n.get(g)![measure], `${g}: native answers ${want}, never ${JSON.stringify(n.get(g)![measure])}`).toBe(want);
            expect(o.get(g)![measure], `${g}: objectql answers ${want}`).toBe(want);
          }
        });
      }
    },
  );
}
