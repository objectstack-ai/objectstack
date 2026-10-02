// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21382] A number other than `1` / `0`, a `Date` or an array compared
 * against a declared boolean field is refused at the public door —
 * `POST /api/v1/data/:object/query` and `engine.find` / `engine.aggregate`
 * answer `400 INVALID_FILTER` at `where`, the per-aggregation `filter` and
 * `having`, before any read — over a real `SqlDriver`, with `true`, `1` and
 * `"true"` as the controls.
 *
 * Measured on the base (`69a12a0952`) through the engine, two rows (one
 * `true`, one `false`); a `where` cell reads implicit, `$eq`, `$ne`, and a
 * `$in` member beside `false`:
 *
 * | comparand, position | InMemoryDriver | SQLite | PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | `2`, `-1`, `0.5`, a `Date`, `where` | 200: no row, no row, both, the false row | the same | 500 `DATABASE_ERROR` at every slot |
 * | the same, per-aggregation `filter` / `having` | count 0, 0, 2, 1 / the groups alike | the same | the same |
 * | an array `[true]` as a `$in` member, `where` | 200, the false row | 400, the driver's own | 400, the driver's own |
 * | the same, per-aggregation `filter` / `having` | count 1 / the false group | the same | the same |
 *
 * The door sits in the engine, in front of every driver, so one verdict holds
 * on each cell; the engine-level pin that drives the contract's whole case
 * table through a recording driver is `@objectstack/objectql`'s
 * `engine-boolean-comparand-declared-type-door.test.ts`. InMemoryDriver's row
 * is that pin's by construction: the door answers before a driver is resolved.
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL and MySQL cells run where
 * `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` are set and are a named skip
 * otherwise. ⚠️ No CI job provisions those variables for this package (the
 * `Temporal Conformance (live PG + MySQL)` job runs `driver-sql`,
 * `metadata-protocol` and one `runtime` file), so the live cells are
 * red-capable and un-run in CI; the PR that landed this file carries their
 * local PostgreSQL run. Each live cell owns one table, dropped before and
 * after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { EngineAggregateOptions, FilterCondition } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rest_boolean_door_21382';

const TASKS = {
  name: OBJECT,
  label: 'Tasks 21382',
  fields: {
    label: { name: 'label', type: 'text' as const },
    done: { name: 'done', type: 'boolean' as const },
  },
};

const ROWS = [
  { id: 'rt', label: 'a', done: true },
  { id: 'rf', label: 'b', done: false },
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

/** name · the constraint on `done` — what JSON carries: a number other than 1 / 0, or an array. */
const REFUSED_OVER_REST: ReadonlyArray<readonly [string, unknown]> = [
  ['implicit 2 (the card)', 2],
  ['$eq -1', { $eq: -1 }],
  ['$ne 0.5', { $ne: 0.5 }],
  ['a $in member 2', { $in: [false, 2] }],
  ['a $nin member -1', { $nin: [-1] }],
  ['a $in member [true] (the card)', { $in: [false, [true]] }],
  ['$gt [true] (an array at a scalar slot)', { $gt: [true] }],
];

/**
 * name · a factory for the constraint — what only an in-process caller (a
 * flow, a hook, server code) can send: a `Date`, beside the number.
 */
const REFUSED_IN_PROCESS: ReadonlyArray<readonly [string, () => unknown]> = [
  ['implicit 2', () => 2],
  ['implicit Date', () => new Date(Date.UTC(2026, 0, 1))],
  ['$ne Date', () => ({ $ne: new Date(Date.UTC(2026, 0, 1)) })],
  ['a $in member [true]', () => ({ $in: [false, [true]] })],
];

/** name · the constraint · the ids `where` answers — the controls, unchanged. */
const CONTROLS: ReadonlyArray<readonly [string, unknown, readonly string[]]> = [
  ['implicit true', true, ['rt']],
  ['implicit 1', 1, ['rt']],
  ['implicit "true"', 'true', ['rt']],
  ['$ne 1', { $ne: 1 }, ['rf']],
  ['a $in member 1', { $in: [false, 1] }, ['rf', 'rt']],
  ['$eq 0', { $eq: 0 }, ['rf']],
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

const perAggregation = (filter: FilterCondition): EngineAggregateOptions => ({
  aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter }],
});

/**
 * `native`: SqlDriver aggregates and the engine applies `having` to its
 * answer. `rows`: a filtered aggregation sends the engine to the rows path,
 * where it aggregates itself and then applies `having`.
 */
const grouped = (path: 'native' | 'rows', having: FilterCondition): EngineAggregateOptions => ({
  groupBy: ['done'],
  aggregations: [
    { function: 'count', alias: 'n' },
    ...(path === 'rows' ? [{ function: 'count' as const, alias: 'fb', filter: { label: { $ne: '' } } }] : []),
  ],
  having,
});

const refusalOf = async (p: Promise<unknown>) =>
  p.then(() => null, (e: any) => e as Error & { code?: string; status?: number });

/** A stored boolean comes back as a boolean or as 1 / 0, per dialect. */
const asBoolean = (v: unknown): boolean => v === true || v === 1 || v === '1';

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#21382] a non-string comparand outside the accepted set against a boolean field at the public door — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      let driver: any;
      const reads = { n: 0 };
      let query: (body: Record<string, unknown>) => Promise<{ status: number; body: any }>;

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        if (cell.id !== 'sqlite') await driver.execute(`drop table if exists ${OBJECT}`).catch(() => {});
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(TASKS as any);
        await engine.syncSchemas();
        for (const row of ROWS) await engine.insert(OBJECT, { ...row } as any);

        // Reads of THIS object — the protocol's own metadata traffic is not the question.
        for (const verb of ['find', 'findOne', 'count', 'aggregate'] as const) {
          const real = driver[verb].bind(driver);
          driver[verb] = (o: string, ...rest: unknown[]) => { if (o === OBJECT) reads.n += 1; return real(o, ...rest); };
        }

        const protocol = new ObjectStackProtocolImplementation(engine as any);
        const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
        (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
        rest.registerRoutes();
        const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
        expect(route).toBeDefined();
        query = async (body) => {
          const res = makeRes();
          // What the wire carries: JSON.
          await route!.handler({ params: { object: OBJECT }, body: JSON.parse(JSON.stringify(body)), query: {}, headers: {} } as any, res);
          return { status: res._status ?? 200, body: res._json };
        };
      });

      afterAll(async () => {
        if (cell.id !== 'sqlite') await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      it('where: 400 INVALID_FILTER naming the field, through REST and engine.find — no read', async () => {
        const before = reads.n;
        for (const [name, spec] of REFUSED_OVER_REST) {
          const where = { done: spec } as FilterCondition;
          const res = await query({ where });
          expect(res.status, `REST, ${name}: ${JSON.stringify(res.body)}`).toBe(400);
          expect(res.body.code, `REST, ${name}`).toBe('INVALID_FILTER');
          expect(res.body.error, `REST, ${name}`).toContain("filter on 'done' compares a declared boolean field");
          const err = await refusalOf(engine.find(OBJECT, { where }));
          expect({ code: err?.code, status: err?.status }, `engine.find, ${name}`).toEqual({ code: 'INVALID_FILTER', status: 400 });
        }
        for (const [name, spec] of REFUSED_IN_PROCESS) {
          const err = await refusalOf(engine.find(OBJECT, { where: { done: spec() } as FilterCondition }));
          expect({ code: err?.code, status: err?.status }, `engine.find, ${name}`).toEqual({ code: 'INVALID_FILTER', status: 400 });
          expect(err?.message, `engine.find, ${name}`).toContain("filter on 'done' compares a declared boolean field");
        }
        expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
      });

      it('the per-aggregation filter and having: 400 INVALID_FILTER at their own positions — no read', async () => {
        const before = reads.n;
        for (const [name, spec] of [['implicit 2', 2], ['a $in member [true]', { $in: [false, [true]] }]] as const) {
          const filter = await query(perAggregation({ done: spec } as FilterCondition) as Record<string, unknown>);
          expect(filter.status, `filter, ${name}: ${JSON.stringify(filter.body)}`).toBe(400);
          expect(filter.body.code, `filter, ${name}`).toBe('INVALID_FILTER');
          expect(filter.body.error, `filter, ${name}`).toContain('aggregations[1].filter.done');
          for (const path of ['native', 'rows'] as const) {
            const having = await query(grouped(path, { done: spec } as FilterCondition) as Record<string, unknown>);
            expect(having.status, `having ${path}, ${name}: ${JSON.stringify(having.body)}`).toBe(400);
            expect(having.body.code, `having ${path}, ${name}`).toBe('INVALID_FILTER');
            expect(having.body.error, `having ${path}, ${name}`).toContain("filter on 'done' compares a boolean aggregated column");
          }
        }
        for (const [name, spec] of REFUSED_IN_PROCESS) {
          const filtered = await refusalOf(engine.aggregate(OBJECT, perAggregation({ done: spec() } as FilterCondition)));
          expect({ code: filtered?.code, status: filtered?.status }, `filter, ${name}`).toEqual({ code: 'INVALID_FILTER', status: 400 });
          expect(filtered?.message, `filter, ${name}`).toContain('aggregations[1].filter.done');
          for (const path of ['native', 'rows'] as const) {
            const having = await refusalOf(engine.aggregate(OBJECT, grouped(path, { done: spec() } as FilterCondition)));
            expect({ code: having?.code, status: having?.status }, `having ${path}, ${name}`).toEqual({ code: 'INVALID_FILTER', status: 400 });
            expect(having?.message, `having ${path}, ${name}`).toContain('having.done');
          }
        }
        expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
      });

      it('the controls: true, 1 and "true" answer the rows they name, at every position', async () => {
        for (const [name, spec, ids] of CONTROLS) {
          const res = await query({ where: { done: spec } });
          expect(res.status, `where, ${name}: ${JSON.stringify(res.body)}`).toBe(200);
          expect(res.body.records.map((r: any) => r.id).sort(), `where, ${name}`).toEqual([...ids]);
          const counted = await query(perAggregation({ done: spec } as FilterCondition) as Record<string, unknown>);
          expect(counted.status, `filter, ${name}: ${JSON.stringify(counted.body)}`).toBe(200);
          expect(Number(counted.body.records[0]?.m), `filter, ${name}`).toBe(ids.length);
        }
        for (const path of ['native', 'rows'] as const) {
          const groupsOf = async (having: FilterCondition) => {
            const res = await query(grouped(path, having) as Record<string, unknown>);
            expect(res.status, `having ${path} ${JSON.stringify(having)}: ${JSON.stringify(res.body)}`).toBe(200);
            return res.body.records.map((r: any) => asBoolean(r.done)).sort();
          };
          expect(await groupsOf({ done: true }), `having ${path}`).toEqual([true]);
          expect(await groupsOf({ done: 1 }), `having ${path}`).toEqual([true]);
          expect(await groupsOf({ done: { $ne: 'true' } }), `having ${path}`).toEqual([false]);
        }
      });
    },
  );
}
