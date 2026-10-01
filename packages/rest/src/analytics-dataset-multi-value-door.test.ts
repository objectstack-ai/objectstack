// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A dataset dimension on a MULTI-VALUE field, and a dataset `count_distinct`
 * measure over a `select` declared `multiple: true`, are refused at the
 * dataset door — `POST /api/v1/analytics/dataset/query` answers 400 before
 * any SQL is built — over a real `SqlDriver`; the single-value controls are
 * served unchanged.
 *
 * The cube face (`POST /api/v1/analytics/query`, an inferred
 * `FIELD_count_distinct` included) is served by `@objectstack/runtime`'s
 * dispatcher, not by this package; its rows are pinned at the service, on the
 * same two dialects, in
 * `packages/services/service-analytics/src/__tests__/json-stored-door-live-drivers.test.ts`.
 *
 * ## Measured without the refusal, through this door
 *
 * Four rows: `status` a, a, b, b; `tags_f` [a,b], [a,b], [b], [ab];
 * `multi_sel` (a `select` with `multiple: true`) [a,b], [a,b], [b], [b]:
 *
 * | the inline dataset's selection | SQLite | PostgreSQL 16 |
 * |:--|:--|:--|
 * | dimension `status_dim` (single-value select, the control) | 200, `A` 2 · `B` 2 (the option labels) | same |
 * | dimension `tag_dim` (`tags`) / `picked_dim` (`multi_sel`) | 200, one group per serialized array | 500 |
 * | measure `count_distinct` over `multi_sel` | 200, 2 | 500 |
 * | measure `count_distinct` over `status` (the control) | 200, 2 | same |
 *
 * ## The composition, and the dialect axis of THIS file
 *
 * The analytics service is the one `AnalyticsServicePlugin` composes over a
 * real `ObjectQL` engine — both auto-bridges live, so `NativeSQLStrategy`
 * answers on a SQL driver. The SQLite cell always runs. The PostgreSQL cell
 * runs where `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise; no
 * CI step provisions that variable for this package, so the live cell is
 * red-capable and un-run in CI. The live cell owns its table, dropped before
 * and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AnalyticsServicePlugin, type AnalyticsService } from '@objectstack/service-analytics';
import { RestServer } from './rest-server';

const OBJECT = 'rest_dataset_multi_value_ledger';
const OPTIONS = [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }];

const LEDGER = {
  name: OBJECT,
  label: 'Dataset multi-value door ledger',
  fields: {
    status: { name: 'status', type: 'select' as const, options: OPTIONS },
    tags_f: { name: 'tags_f', type: 'tags' as const },
    multi_sel: { name: 'multi_sel', type: 'select' as const, multiple: true, options: OPTIONS },
  },
};

const ROWS = [
  { id: 'r1', status: 'a', tags_f: ['a', 'b'], multi_sel: ['a', 'b'] },
  { id: 'r2', status: 'a', tags_f: ['a', 'b'], multi_sel: ['a', 'b'] },
  { id: 'r3', status: 'b', tags_f: ['b'], multi_sel: ['b'] },
  { id: 'r4', status: 'b', tags_f: ['ab'], multi_sel: ['b'] },
];

/** The inline dataset the request carries — as a Studio preview or a widget posts it. */
const dataset = (measures: unknown[]) => ({
  name: 'multi_value_inline',
  label: 'Multi-value inline',
  object: OBJECT,
  dimensions: [
    { name: 'status_dim', field: 'status', type: 'string' },
    { name: 'tag_dim', field: 'tags_f', type: 'string' },
    { name: 'picked_dim', field: 'multi_sel', type: 'string' },
  ],
  measures,
});
const ROW_COUNT = [{ name: 'row_count', aggregate: 'count' }];

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
    `a multi-value dataset dimension or distinct count at POST /api/v1/analytics/dataset/query — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: any;
      let engine: ObjectQL;
      /** Raw-SQL statements and engine aggregates that read THIS object. */
      const reads = { rawSql: 0, aggregate: 0 };
      let query: (measures: unknown[], selection: Record<string, unknown>) => Promise<{ status: number; body: any }>;

      const dropTable = async () => {
        if (cell.id === 'sqlite') return;
        await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
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
        query = async (measures, selection) => {
          const res = makeRes();
          // What the wire carries: JSON.
          const body = JSON.parse(JSON.stringify({ dataset: dataset(measures), selection }));
          await route!.handler({ method: 'POST', params: {}, headers: {}, body, query: {} } as any, res);
          return { status: res.statusCode, body: res.body };
        };
      });

      afterAll(async () => {
        await dropTable();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      it('a dataset dimension on a multi-value field answers 400 INVALID_FIELD naming the dataset dimension — no statement reaches the engine', async () => {
        const before = { ...reads };
        for (const [member, column, declared] of [
          ['tag_dim', 'tags_f', 'tags'],
          ['picked_dim', 'multi_sel', 'select with multiple: true'],
        ] as const) {
          const res = await query(ROW_COUNT, { measures: ['row_count'], dimensions: [member] });
          expect(res.status, JSON.stringify(res.body)).toBe(400);
          expect(res.body.code, member).toBe('INVALID_FIELD');
          expect(String(res.body.message), member).toContain(
            `Dimension '${member}' on cube 'multi_value_inline' groups by field '${column}', which object '${OBJECT}' declares as ${declared} — a multi-value field`,
          );
        }
        expect(reads, 'no raw SQL and no engine aggregate for the object').toEqual(before);
      });

      it('CONTROL a single-value select dimension is served unchanged: one group per option, counted under its label', async () => {
        const res = await query(ROW_COUNT, { measures: ['row_count'], dimensions: ['status_dim'] });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const groups = (res.body.rows as Array<{ status_dim: string; row_count: number | string }>)
          .map((r) => [r.status_dim, Number(r.row_count)] as const)
          .sort(([a], [b]) => a.localeCompare(b));
        expect(groups).toEqual([['A', 2], ['B', 2]]);
      });

      it('a dataset count_distinct over a select with multiple: true answers 400 DATASET_INVALID — no statement reaches the engine', async () => {
        const before = { ...reads };
        const res = await query(
          [{ name: 'picked_kinds', aggregate: 'count_distinct', field: 'multi_sel' }],
          { measures: ['picked_kinds'] },
        );
        expect(res.status, JSON.stringify(res.body)).toBe(400);
        expect(res.body.code).toBe('DATASET_INVALID');
        expect(String(res.body.message)).toContain('declares as `select` with `multiple: true`');
        expect(reads, 'no raw SQL and no engine aggregate for the object').toEqual(before);
      });

      it('CONTROL a dataset count_distinct over a single-value select is served', async () => {
        const res = await query(
          [{ name: 'status_kinds', aggregate: 'count_distinct', field: 'status' }],
          { measures: ['status_kinds'] },
        );
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(Number(res.body.rows[0].status_kinds)).toBe(2);
      });
    },
  );
}
