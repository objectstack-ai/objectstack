// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A dataset dimension on a structured-JSON field is refused at the dataset
 * door — `POST /api/v1/analytics/dataset/query` answers `400 INVALID_FIELD`,
 * naming the dataset dimension the selection wrote, before any SQL is built —
 * over a real `SqlDriver`; and a `text` dimension (the control) is served
 * unchanged.
 *
 * The cube face of the same door (`POST /api/v1/analytics/query`, served by
 * `@objectstack/runtime`'s dispatcher, not by this package) is pinned in
 * `packages/runtime/src/analytics-json-dimension-door.test.ts`. This file is
 * the route this package serves: an INLINE dataset, compiled per request,
 * whose dimensions reach the same cube query through `DatasetExecutor`.
 *
 * ## Measured without the refusal, through this door
 *
 * On the base (the `meta_doc` row), and with the refusal ablated (the
 * `acct_hq` row). Three rows, `title` x, x, y, and a different `meta`
 * document per row; a dataset declaring `meta_doc` over the `json` field
 * `meta`, and `acct_hq` over the `json` field `hq` of the object the
 * `account` lookup references:
 *
 * | `selection.dimensions` | SQLite | PostgreSQL 16 |
 * |:--|:--|:--|
 * | `title_dim` (text, the control) | 200, `x` 2 · `y` 1 | same |
 * | `meta_doc` (json) | 200, one group per serialized document (3) | 500 |
 * | `acct_hq` (`account.hq`, a json field of the `include`d object) | 200, one group per document (2) | 500 |
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

const OBJECT = 'rest_dataset_json_dim_ledger';
/** The object the ledger's `account` lookup references — joined through the dataset's `include`. */
const ACCOUNT = 'rest_dataset_json_dim_account';

const ACCOUNT_OBJECT = {
  name: ACCOUNT,
  label: 'Dataset JSON dimension account',
  fields: {
    name: { name: 'name', type: 'text' as const },
    hq: { name: 'hq', type: 'json' as const },
  },
};

const LEDGER = {
  name: OBJECT,
  label: 'Dataset JSON dimension ledger',
  fields: {
    title: { name: 'title', type: 'text' as const },
    meta: { name: 'meta', type: 'json' as const },
    account: { name: 'account', type: 'lookup' as const, reference: ACCOUNT },
  },
};

const ACCOUNTS = [
  { id: 'a1', name: 'A', hq: { city: 'Paris' } },
  { id: 'a2', name: 'B', hq: { city: 'Rome' } },
];

const ROWS = [
  { id: 'r1', title: 'x', meta: { a: 1 }, account: 'a1' },
  { id: 'r2', title: 'x', meta: { a: 2 }, account: 'a1' },
  { id: 'r3', title: 'y', meta: { b: 1 }, account: 'a2' },
];

/** The inline dataset the request carries — as a Studio preview or a widget posts it. */
const DATASET = {
  name: 'json_dim_inline',
  label: 'JSON dimension inline',
  object: OBJECT,
  include: ['account'],
  dimensions: [
    { name: 'title_dim', field: 'title', type: 'string' },
    { name: 'meta_doc', field: 'meta', type: 'string' },
    { name: 'acct_name', field: 'account.name', type: 'string' },
    { name: 'acct_hq', field: 'account.hq', type: 'string' },
  ],
  measures: [{ name: 'row_count', aggregate: 'count' }],
};

/** The route the refusal prescribes — asserted on the wire body. */
const ROUTE = 'Group by a field that stores one scalar value: store the part you group on in a field of its own and group by that field.';

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
    `a dataset dimension on a json field at POST /api/v1/analytics/dataset/query — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: any;
      let engine: ObjectQL;
      /** Raw-SQL statements and engine aggregates that read THIS object. */
      const reads = { rawSql: 0, aggregate: 0 };
      let query: (selection: Record<string, unknown>) => Promise<{ status: number; body: any }>;

      const dropTables = async () => {
        if (cell.id === 'sqlite') return;
        for (const table of [OBJECT, ACCOUNT]) await driver?.execute(`drop table if exists ${table}`).catch(() => {});
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTables();
        engine = new ObjectQL({ logger: quiet } as any);
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(ACCOUNT_OBJECT as any);
        engine.registry.registerObject(LEDGER as any);
        await engine.syncSchemas();
        for (const row of ACCOUNTS) await engine.insert(ACCOUNT, { ...row } as any);
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
        const analytics = registered.analytics as AnalyticsService;

        const rest = new RestServer(
          createMockServer() as any, mockProtocol() as any, { api: { requireAuth: false } } as any,
          undefined, undefined, undefined, undefined, undefined, undefined, undefined,
          undefined, undefined, undefined, undefined,
          async () => analytics,
        );
        (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
        rest.registerRoutes();
        const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/analytics/dataset/query');
        expect(route).toBeDefined();
        query = async (selection) => {
          const res = makeRes();
          // What the wire carries: JSON.
          const body = JSON.parse(JSON.stringify({ dataset: DATASET, selection }));
          await route!.handler({ method: 'POST', params: {}, headers: {}, body, query: {} } as any, res);
          return { status: res.statusCode, body: res.body };
        };
      });

      afterAll(async () => {
        await dropTables();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      it('a dataset dimension on a json field answers 400 INVALID_FIELD naming the dataset dimension — no statement reaches the engine', async () => {
        const before = { ...reads };
        const res = await query({ measures: ['row_count'], dimensions: ['meta_doc'] });
        expect(res.status, JSON.stringify(res.body)).toBe(400);
        expect(res.body.code).toBe('INVALID_FIELD');
        expect(String(res.body.message)).toContain(`Dimension 'meta_doc' on cube '${DATASET.name}' groups by field 'meta'`);
        expect(String(res.body.message)).toContain(`'${OBJECT}' declares as json`);
        expect(String(res.body.message)).toContain(ROUTE);
        expect(reads, 'no raw SQL and no engine aggregate for the object').toEqual(before);
      });

      it('a dataset dimension over an included relationship\'s json field answers the same 400, naming the joined object — no statement reaches the engine', async () => {
        const before = { ...reads };
        const res = await query({ measures: ['row_count'], dimensions: ['acct_hq'] });
        expect(res.status, JSON.stringify(res.body)).toBe(400);
        expect(res.body.code).toBe('INVALID_FIELD');
        expect(String(res.body.message)).toContain(
          `Dimension 'acct_hq' on cube '${DATASET.name}' groups by field 'account.hq', whose column 'hq' the joined object '${ACCOUNT}' declares as json`,
        );
        expect(String(res.body.message)).toContain(ROUTE);
        expect(reads, 'no raw SQL and no engine aggregate for the object').toEqual(before);
      });

      it('CONTROL a text dataset dimension is served unchanged: one group per value, counted', async () => {
        const before = { ...reads };
        const res = await query({ measures: ['row_count'], dimensions: ['title_dim'] });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const groups = (res.body.rows as Array<{ title_dim: string; row_count: number | string }>)
          .map((r) => [r.title_dim, Number(r.row_count)] as const)
          .sort(([a], [b]) => a.localeCompare(b));
        expect(groups).toEqual([['x', 2], ['y', 1]]);
        expect(reads.rawSql - before.rawSql, 'the native strategy answered').toBeGreaterThanOrEqual(1);

        const joined = await query({ measures: ['row_count'], dimensions: ['acct_name'] });
        expect(joined.status, JSON.stringify(joined.body)).toBe(200);
        const joinedGroups = (joined.body.rows as Array<{ acct_name: string; row_count: number | string }>)
          .map((r) => [r.acct_name, Number(r.row_count)] as const)
          .sort(([a], [b]) => a.localeCompare(b));
        expect(joinedGroups).toEqual([['A', 2], ['B', 1]]);
      });
    },
  );
}
