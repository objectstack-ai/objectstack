// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21409] `POST /api/v1/analytics/dataset/query` — a dataset measure that
 * aggregates the row wildcard `'*'` under any aggregate other than `count` is
 * refused at the route's parse with `400 VALIDATION_FAILED`, before any
 * strategy or driver runs; `count` over `'*'` still runs, on both strategies.
 *
 * ## The cell this pins, and what it answered before
 *
 * `'*'` is what a `count` aggregates (`COUNT(*)`), reading no field value. The
 * contract admitted it in a dataset measure's `field` under ANY aggregate, so
 * `{ aggregate: 'sum', field: '*' }` parsed and the strategies passed it on
 * verbatim. Measured on this route before the narrowing, over a real
 * better-sqlite3 `SqlDriver`: `500 DATABASE_ERROR` on the native-SQL strategy
 * (`SUM(*)`) and on the ObjectQL strategy (the engine aggregate over `'*'`).
 * A server fault for an authoring mistake the contract admitted.
 *
 * Now `DatasetMeasureSchema` refuses it at `measures.N.field`, and this route
 * parses every dataset it is handed — inline or saved by name — through
 * `DatasetSchema` before calling `queryDataset`, so the cell answers the
 * route's own `400 VALIDATION_FAILED` naming the path. Nothing reaches a
 * strategy, so nothing reaches the driver: the read counters below stay at 0.
 *
 * The SAVED branch is the stored-document half of the same question: a dataset
 * stored before the narrowing is read back as stored (the metadata read path
 * does not re-validate it) and is refused HERE, at its first query, with the
 * same 400 — fail closed, never a stand-down.
 *
 * ## The controls
 *
 * `count` over `'*'` — spelled out, and as a count with no `field` (which the
 * dataset compiler lowers to the same `'*'`) — answers 200 with the row count
 * on BOTH strategies, and the counters prove which strategy answered.
 *
 * This file exercises the BUILT `@objectstack/spec` (the route imports
 * `@objectstack/spec/ui` through its `exports`, so `dist/`), the built
 * `@objectstack/service-analytics`, `@objectstack/objectql` and
 * `@objectstack/driver-sql`: mutating the spec source without rebuilding proves
 * nothing here.
 *
 * Assertion set (ADR-0112): the route's own envelope `code` and HTTP status,
 * plus the parse's issue `code` and `path` read out of `detail` — never the
 * prescription prose, which no consumer of this route parses.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AnalyticsServicePlugin, type AnalyticsService } from '@objectstack/service-analytics';
import { RestServer } from './rest-server';

const OBJECT = 'rest_dataset_row_wildcard_ledger';

const LEDGER = {
  name: OBJECT,
  label: 'Dataset row wildcard ledger',
  fields: {
    category: { name: 'category', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
  },
};

const ROWS = [
  { id: 'a1', category: 'a', amount: 100 },
  { id: 'a2', category: 'a', amount: 400 },
  { id: 'b1', category: 'b', amount: 900 },
] as const;

/** The non-count aggregates a dataset measure declares — each one over `'*'` is the refused cell. */
const NON_COUNT_AGGREGATES = ['sum', 'avg', 'min', 'max', 'count_distinct'] as const;

/** An inline dataset whose measure `wildcard` aggregates `'*'` under `aggregate`, beside two count controls. */
const datasetWith = (aggregate: string) => ({
  name: 'row_wildcard_inline',
  label: 'Row wildcard inline',
  object: OBJECT,
  dimensions: [{ name: 'category', field: 'category', type: 'string' }],
  measures: [
    { name: 'row_count', aggregate: 'count' },
    { name: 'star_count', aggregate: 'count', field: '*' },
    { name: 'wildcard', aggregate, field: '*' },
  ],
});

/** The same dataset with only the two count controls — what the 200 cells post. */
const COUNT_ONLY = {
  name: 'row_wildcard_counts',
  label: 'Row wildcard counts',
  object: OBJECT,
  dimensions: [{ name: 'category', field: 'category', type: 'string' }],
  measures: [
    { name: 'row_count', aggregate: 'count' },
    { name: 'star_count', aggregate: 'count', field: '*' },
  ],
};

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

/** `saved` is what the route's `body.datasetName` branch loads from metadata, as stored. */
function mockProtocol(saved: unknown[]) {
  return {
    getDiscovery: async () => ({ version: 'v0', routes: { data: '', metadata: '' } }),
    getMetaTypes: async () => [],
    getMetaItems: async () => saved,
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

/** The stored copies the saved branch reads back — one per refused aggregate, plus the count control. */
const SAVED = [
  ...NON_COUNT_AGGREGATES.map((aggregate) => ({ ...datasetWith(aggregate), name: `stored_star_${aggregate}` })),
  COUNT_ONLY,
];

for (const strategy of ['native', 'objectql'] as const) {
  describe(`[#21409] POST /api/v1/analytics/dataset/query — '*' runs only under count — ${strategy} strategy`, () => {
    let engine: ObjectQL;
    /** Raw-SQL statements (native strategy) and engine aggregates (ObjectQL strategy) that read THIS object. */
    const reads = { rawSql: 0, aggregate: 0 };
    let post: (body: Record<string, unknown>) => Promise<{ status: number; body: any }>;

    beforeAll(async () => {
      engine = new ObjectQL({ logger: quiet } as any);
      engine.registerDriver(
        new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any),
        true,
      );
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

      // The plugin's own composition over the real engine. The ObjectQL cell
      // states the capability probe the native cell lets the plugin derive.
      const registered: Record<string, unknown> = {};
      await new AnalyticsServicePlugin(
        strategy === 'objectql'
          ? { queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }) }
          : {},
      ).init({
        getService: (name: string) => (name === 'data' ? engine : registered[name]),
        registerService: (name: string, svc: unknown) => { registered[name] = svc; },
        replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
        hook: () => {},
        logger: quiet,
      } as never);
      const service = registered.analytics as AnalyticsService;

      const rest = new RestServer(
        createMockServer() as any, mockProtocol(SAVED) as any, { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined,
        async () => service,
      );
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
      rest.registerRoutes();
      const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/analytics/dataset/query');
      expect(route).toBeDefined();
      post = async (body) => {
        const res = makeRes();
        // What the wire carries: JSON, both ways.
        await route!.handler({ method: 'POST', params: {}, headers: {}, body: JSON.parse(JSON.stringify(body)), query: {} } as any, res);
        return { status: res.statusCode, body: JSON.parse(JSON.stringify(res.body ?? null)) };
      };
    });

    afterAll(async () => {
      try { await engine?.destroy(); } catch { /* noop */ }
    });

    const expectRefusedBeforeAnyRead = (res: { status: number; body: any }, before: typeof reads, label: string) => {
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code, label).toBe('VALIDATION_FAILED');
      // The parse's issue, at the measure's own `field` (`detail` is the
      // issue list, cut at 1000 characters — read, not re-parsed).
      expect(res.body.detail, label).toMatch(/"code":\s*"custom"/);
      expect(res.body.detail, label).toMatch(/"path":\s*\[\s*"measures",\s*2,\s*"field"\s*\]/);
      // Refused at the door: no strategy ran, so nothing read the object.
      expect(reads.rawSql - before.rawSql, `${label}: no raw SQL`).toBe(0);
      expect(reads.aggregate - before.aggregate, `${label}: no engine aggregate`).toBe(0);
    };

    it.each(NON_COUNT_AGGREGATES)("an INLINE dataset measure aggregating '*' under %s → 400 VALIDATION_FAILED at measures.2.field, nothing read", async (aggregate) => {
      const before = { ...reads };
      const res = await post({ dataset: datasetWith(aggregate), selection: { measures: ['wildcard'], dimensions: ['category'] } });
      expectRefusedBeforeAnyRead(res, before, aggregate);
    });

    it.each(NON_COUNT_AGGREGATES)("a SAVED dataset (body.datasetName) stored with '*' under %s → the same 400 when the query selects that measure, nothing read", async (aggregate) => {
      const before = { ...reads };
      const res = await post({ datasetName: `stored_star_${aggregate}`, selection: { measures: ['wildcard'], dimensions: ['category'] } });
      expectRefusedBeforeAnyRead(res, before, `stored ${aggregate}`);
    });

    // Fail closed, never a stand-down: the route parses the whole stored
    // definition, so a query that selects only the dataset's healthy count —
    // which answered 200 before the narrowing — is refused too, until the
    // member is fixed. The blast radius is the dataset, by design.
    it.each(NON_COUNT_AGGREGATES)("a SAVED dataset stored with '*' under %s → 400 even when the query selects only its count", async (aggregate) => {
      const before = { ...reads };
      const res = await post({ datasetName: `stored_star_${aggregate}`, selection: { measures: ['row_count'], dimensions: ['category'] } });
      expectRefusedBeforeAnyRead(res, before, `stored ${aggregate}, count selected`);
    });

    it("CONTROL: count over '*' and a count with no field both answer the row count — 200, through this strategy", async () => {
      const before = { ...reads };
      const res = await post({ dataset: COUNT_ONLY, selection: { measures: ['row_count', 'star_count'], dimensions: ['category'] } });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = [...(res.body.rows as Array<Record<string, unknown>>)].sort((x, y) => String(x.category).localeCompare(String(y.category)));
      expect(rows).toEqual([
        { category: 'a', row_count: 2, star_count: 2 },
        { category: 'b', row_count: 1, star_count: 1 },
      ]);
      if (strategy === 'native') {
        expect(reads.rawSql - before.rawSql, 'NativeSQLStrategy answered').toBeGreaterThanOrEqual(1);
        expect(reads.aggregate - before.aggregate, 'no engine aggregate').toBe(0);
      } else {
        expect(reads.aggregate - before.aggregate, 'ObjectQLStrategy answered').toBeGreaterThanOrEqual(1);
        expect(reads.rawSql - before.rawSql, 'no raw SQL').toBe(0);
      }
    });

    it("CONTROL: the SAVED count-only dataset answers the same 200", async () => {
      const res = await post({ datasetName: COUNT_ONLY.name, selection: { measures: ['star_count'] } });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.rows).toEqual([{ star_count: 3 }]);
    });
  });
}
