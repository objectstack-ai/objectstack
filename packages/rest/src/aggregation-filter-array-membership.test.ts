// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20873] A per-aggregation `filter` with `$contains` / `$notContains` on a
 * declared multi-valued field counts the rows the same condition finds as the
 * call's `where`, through the door a caller uses:
 * `POST /api/v1/data/:object/query` → `RestServer` →
 * `ObjectStackProtocolImplementation.findData` → `ObjectQL.aggregate` → a real
 * `SqlDriver`. Every row runs beside its `where` TWIN, so a later change to
 * either side of the pair — the driver's membership construct or the engine's
 * evaluator — breaks the equality here rather than drifting silently.
 *
 * Measured on the base (`origin/main` `212d613c`) through `engine.aggregate`
 * on SQLite and a live PostgreSQL 16.14: every per-aggregation count below was
 * 0 for `$contains` and 6 (every row) for `$notContains`, against the `where`
 * twin's numbers in the table. The engine evaluated the filter, and its arm
 * failed every value that was not a string.
 *
 * | filter | `where` twin |
 * |:--|:--|
 * | `owners $contains 'u1'` (the card) | 2 |
 * | `owners $contains 'u10'` | 1 |
 * | `owners $notContains 'u1'` | 4 |
 * | `tags $contains 'red'` | 2 |
 * | `tags $notContains 'red'` | 4 |
 * | `$or` of `$contains` (the any-of spelling) | 2 |
 * | `title $contains 'u1'` (the control, unchanged) | 3 |
 *
 * InMemoryDriver's evaluator cell is `@objectstack/objectql`'s
 * `engine-aggregate-filter-array-membership.test.ts`, over the read shape
 * `find()` presents on all three backends (measured identical): this package
 * does not depend on the in-memory driver, and that driver's test consumers are
 * a ruled, closed census (`check:driver-memory-census`).
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL and MySQL cells run where
 * `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` are set and are a named skip
 * otherwise. ⚠️ No CI job provisions those variables for this package, so the
 * live cells are red-capable and un-run in CI; the PR that landed this file
 * carries their local PostgreSQL run. Each live cell owns its table, dropped
 * before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rest_agg_filter_membership_20873';

const DOC = {
  name: OBJECT,
  label: 'Doc 20873',
  fields: {
    title: { name: 'title', type: 'text' as const },
    owners: { name: 'owners', type: 'lookup' as const, reference: 'rest_agg_filter_user_20873', multiple: true },
    tags: { name: 'tags', type: 'tags' as const },
  },
};

/** `d5` (`['u10']`) and `d3` (`['redwood']`) are where membership and a substring disagree. */
const ROWS = [
  { id: 'd1', title: 'u1 memo', owners: ['u1', 'u2'], tags: ['red', 'blue'] },
  { id: 'd2', title: 'none', owners: ['u2'], tags: ['blue'] },
  { id: 'd3', title: 'about u10', owners: ['u3', 'u1'], tags: ['redwood'] },
  { id: 'd4', title: 'x', owners: [], tags: [] },
  { id: 'd5', title: 'u1', owners: ['u10'], tags: ['red'] },
  { id: 'd6', title: null, owners: null, tags: null },
];

/** filter · the `where` twin's count on this fixture. */
const CASES: ReadonlyArray<readonly [string, Record<string, unknown>, number]> = [
  ['the card — $contains a member id', { owners: { $contains: 'u1' } }, 2],
  ['$contains an id another stored id has as a prefix', { owners: { $contains: 'u10' } }, 1],
  ['$notContains — the exact complement, the null row included', { owners: { $notContains: 'u1' } }, 4],
  ['$contains on a tags field — a member, not a substring of one', { tags: { $contains: 'red' } }, 2],
  ['$notContains on a tags field', { tags: { $notContains: 'red' } }, 4],
  ['an $or of $contains — the any-of spelling', { $or: [{ owners: { $contains: 'u1' } }, { owners: { $contains: 'u3' } }] }, 2],
  ['control — $contains on a text field stays a substring', { title: { $contains: 'u1' } }, 3],
];

interface Cell {
  id: 'sqlite' | 'pg' | 'mysql';
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
  {
    id: 'mysql',
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

const perAggregation = (filter: unknown) => ({
  aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter }],
});
const whereTwin = (filter: unknown) => ({ where: filter, aggregations: [{ function: 'count', alias: 'n' }] });

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#20873] POST /data/:object/query — a per-aggregation filter counts a multi-valued field as its where twin — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      let driver: any;
      let post: (body: Record<string, unknown>) => Promise<any[]>;

      const dropTables = async () => {
        if (cell.id === 'sqlite') return;
        await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
      };

      const boot = async (populated: boolean) => {
        if (engine) await engine.destroy().catch(() => {});
        driver = new SqlDriver(config as any);
        await dropTables();
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(DOC as any);
        await engine.syncSchemas();
        if (populated) for (const row of ROWS) await engine.insert(OBJECT, { ...row } as any);

        const protocol = new ObjectStackProtocolImplementation(engine as any);
        const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
        (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
        rest.registerRoutes();
        const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
        expect(route).toBeDefined();
        post = async (body) => {
          const res = makeRes();
          await route!.handler({ params: { object: OBJECT }, body: JSON.parse(JSON.stringify(body)) } as any, res);
          expect(res._status ?? 200, JSON.stringify(res._json)).toBe(200);
          return res._json.records as any[];
        };
      };

      beforeAll(async () => { await boot(true); }, 60_000);
      afterAll(async () => {
        await dropTables();
        await engine?.destroy().catch(() => {});
      }, 60_000);

      for (const [name, filter, count] of CASES) {
        it(`${name}: m = ${count}, the where twin's count`, async () => {
          const [twin] = await post(whereTwin(filter));
          expect(twin, 'where twin').toEqual({ n: count });
          expect(await post(perAggregation(filter))).toEqual([{ n: 6, m: twin.n }]);
        }, 60_000);
      }

      it('having over a groupBy text projection keeps the substring reading', async () => {
        const kept = await post({
          groupBy: ['title'],
          aggregations: [{ function: 'count', alias: 'n' }],
          having: { title: { $contains: 'u1' } },
        });
        expect(kept.map((row) => row.title).sort()).toEqual(['about u10', 'u1', 'u1 memo']);
      }, 60_000);

      it('an empty table counts 0 for each, as its where twin does', async () => {
        await boot(false);
        for (const [, filter] of CASES) {
          expect(await post(whereTwin(filter))).toEqual([{ n: 0 }]);
          expect(await post(perAggregation(filter))).toEqual([{ n: 0, m: 0 }]);
        }
      }, 60_000);
    },
  );
}
