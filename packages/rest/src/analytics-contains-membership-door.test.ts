// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20987] `$contains` / `$notContains` on a multi-valued field answer
 * MEMBERSHIP at `POST /api/v1/analytics/dataset/query`, over a real
 * `SqlDriver`: in the read scope the analytics plugin hands its compiler, and
 * in the selection's `runtimeFilter` (the analytics `where`). A text field is
 * the control: there `$contains` stays the substring test.
 *
 * The contract is `FILTER_OPERATORS.$contains` (`@objectstack/spec/data`): on a
 * multi-valued or JSON-stored field the operator asks whether the comparand is
 * an ELEMENT of the stored array. The fixture row storing `["u10"]` holds `u1`
 * as a substring of its text and not as a member.
 *
 * Before the fix both legs read the stored JSON text by substring: on SQLite
 * the read scope admitted a row outside it and the filter over-counted (its
 * complement under-counted); on PostgreSQL the statement was refused, a 500.
 *
 * ## The composition, and the dialect axis of THIS file
 *
 * The analytics service is the one `AnalyticsServicePlugin` composes over a
 * real `ObjectQL` engine, both auto-bridges live, so `NativeSQLStrategy`
 * answers on a SQL driver; the read scope is the host's `getReadScope` option,
 * the filter a row policy compiles to (the policy itself is driven through a
 * real security plugin in `packages/qa/dogfood/test/analytics-contains-membership.dogfood.test.ts`,
 * on SQLite). The SQLite cell always runs. The PostgreSQL cell runs where
 * `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise; no CI step
 * provisions that variable for this package, so the live cell is red-capable
 * and un-run in CI, and the PR that landed this file carries its local
 * PostgreSQL 16 run. The live cell owns its table, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AnalyticsServicePlugin, type AnalyticsService } from '@objectstack/service-analytics';
import { RestServer } from './rest-server';

const OBJECT = 'rest_contains_membership_item';

const ITEM = {
  name: OBJECT,
  label: 'Contains membership item',
  fields: {
    title: { name: 'title', type: 'text' as const },
    label: { name: 'label', type: 'text' as const },
    tags: { name: 'tags', type: 'tags' as const },
  },
};

/** `r2` stores `["u10"]`; `r4` stores no tags and no label. */
const ROWS = [
  { id: 'r1', title: 'r1', label: 'u1', tags: ['u1', 'u2'] },
  { id: 'r2', title: 'r2', label: 'u10', tags: ['u10'] },
  { id: 'r3', title: 'r3', label: 'u2', tags: ['u2'] },
  { id: 'r4', title: 'r4' },
];

/** The inline dataset the request carries — as a Studio preview or a widget posts it. */
const DATASET = {
  name: 'contains_membership_inline',
  label: 'Contains membership inline',
  object: OBJECT,
  dimensions: [{ name: 'title_dim', field: 'title', type: 'string' }],
  measures: [{ name: 'row_count', aggregate: 'count' }],
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
    `$contains on a multi-valued field answers membership at POST /api/v1/analytics/dataset/query — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: any;
      let engine: ObjectQL;
      /** The read scope the host hands the analytics plugin, swapped per case. */
      let scope: Record<string, unknown> | undefined;
      let query: (selection: Record<string, unknown>) => Promise<{ status: number; body: any }>;

      const dropTables = async () => {
        if (cell.id === 'sqlite') return;
        await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
      };

      /** The titles served, each with its count — the rows the answer counted. */
      const titles = async (selection: Record<string, unknown>): Promise<string[]> => {
        const res = await query({ measures: ['row_count'], dimensions: ['title_dim'], ...selection });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        return (res.body.rows as Array<{ title_dim: string; row_count: number | string }>)
          .flatMap((r) => (Number(r.row_count) > 0 ? [r.title_dim] : []))
          .sort();
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTables();
        engine = new ObjectQL({ logger: quiet } as any);
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(ITEM as any);
        await engine.syncSchemas();
        for (const row of ROWS) await engine.insert(OBJECT, { ...row } as any);

        // The plugin's own composition over the real engine: both auto-bridges,
        // and the host's read scope.
        const registered: Record<string, unknown> = {};
        await new AnalyticsServicePlugin({
          getReadScope: (object: string) => (object === OBJECT ? (scope as never) : undefined),
        }).init({
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

      afterEach(() => {
        scope = undefined;
      });

      afterAll(async () => {
        await dropTables();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      it('CONTROL: with no scope and no filter, every row is counted', async () => {
        expect(await titles({})).toEqual(['r1', 'r2', 'r3', 'r4']);
      });

      it('a read scope asking $contains of the multi-valued field admits only the row holding the member, not the row storing ["u10"]', async () => {
        scope = { tags: { $contains: 'u1' } };
        expect(await titles({})).toEqual(['r1']);
      });

      it('a read scope asking $notContains admits the complement, the row with no tags included', async () => {
        scope = { tags: { $notContains: 'u1' } };
        expect(await titles({})).toEqual(['r2', 'r3', 'r4']);
      });

      it("the selection's runtimeFilter $contains counts members, and $notContains the complement", async () => {
        expect(await titles({ runtimeFilter: { tags: { $contains: 'u1' } } })).toEqual(['r1']);
        expect(await titles({ runtimeFilter: { tags: { $notContains: 'u1' } } })).toEqual(['r2', 'r3', 'r4']);
      });

      it('CONTROL: on a text field, the read scope and the runtimeFilter stay the substring test', async () => {
        expect(await titles({ runtimeFilter: { label: { $contains: 'u1' } } })).toEqual(['r1', 'r2']);
        scope = { label: { $contains: 'u1' } };
        expect(await titles({})).toEqual(['r1', 'r2']);
      });
    },
  );
}
