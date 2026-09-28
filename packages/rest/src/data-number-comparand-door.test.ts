// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20351] A non-numeric string compared against a declared number field is
 * refused at the public door — `POST /api/v1/data/:object/query` and
 * `engine.find` / `engine.aggregate` answer `400 INVALID_FILTER` at `where`,
 * the per-aggregation `filter` and `having`, before any read — over a real
 * `SqlDriver`, with a numeric comparand as the control and a numeric string
 * shown to count what its number counts.
 *
 * Measured on the base (`3062e5001`) through this door and the engine, three
 * rows (5, 12, 30):
 *
 * | position | InMemoryDriver | SQLite | PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | `where`: `$gt` / `$eq` / `$ne` / implicit / `$in` member `"abc"`, `$eq ""` | 200, no rows (`$ne`: every row) | same | 500 `DATABASE_ERROR` |
 * | `where`: `$gt "12"` / `$eq "12"` | 200, no rows | 200, 1 row | 200, 1 row |
 * | per-aggregation `filter` `$gt "abc"` (`$ne "abc"`) | count 0 (3) | count 0 (3) | count 0 (3) |
 * | `having` on `sum(amount)` `$gt "abc"` (`$ne "abc"`) | no group (every group) | same | same |
 *
 * The door sits in the engine, in front of every driver, so one verdict holds
 * on each cell; the engine-level pin that drives the contract's whole case
 * table through a recording driver is `@objectstack/objectql`'s
 * `engine-number-comparand-declared-type-door.test.ts`. InMemoryDriver's row
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

const OBJECT = 'rest_number_door_20351';

const LEDGER = {
  name: OBJECT,
  label: 'Ledger 20351',
  fields: {
    customer_id: { name: 'customer_id', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    price: { name: 'price', type: 'currency' as const },
  },
};

const ROWS = [
  { id: 'd1', customer_id: 'c1', amount: 5, price: 50 },
  { id: 'd2', customer_id: 'c1', amount: 12, price: 120 },
  { id: 'd3', customer_id: 'c2', amount: 30, price: 300 },
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

/** name · the constraint on `amount` — each a non-numeric string at a judged position. */
const REFUSED: ReadonlyArray<readonly [string, unknown]> = [
  ['$gt "abc" (the card)', { $gt: 'abc' }],
  ['$eq "abc"', { $eq: 'abc' }],
  ['$ne "abc"', { $ne: 'abc' }],
  ['implicit "abc"', 'abc'],
  ['a $in member "abc"', { $in: [10, 'abc'] }],
  ['a $between bound "abc"', { $between: ['abc', 20] }],
  ['$eq "" (blank)', { $eq: '' }],
  ['$gt "1,000" (a locale spelling)', { $gt: '1,000' }],
  ['$gt "{current_user_id}" (a placeholder)', { $gt: '{current_user_id}' }],
];

/** name · the constraint as a numeric string · the same as a number · `where` count. */
const NARROWED: ReadonlyArray<readonly [string, unknown, unknown, number]> = [
  ['$gt "12"', { $gt: '12' }, { $gt: 12 }, 1],
  ['$eq "12"', { $eq: '12' }, { $eq: 12 }, 1],
  ['implicit "5"', '5', 5, 1],
  ['$in ["5", "30"]', { $in: ['5', '30'] }, { $in: [5, 30] }, 2],
  ['$between ["1e1", "3e1"]', { $between: ['1e1', '3e1'] }, { $between: [10, 30] }, 2],
  ['$ne "12"', { $ne: '12' }, { $ne: 12 }, 2],
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
  groupBy: ['customer_id'],
  aggregations: [
    { function: 'sum', field: 'amount', alias: 'total' },
    { function: 'max', field: 'price', alias: 'top' },
    ...(path === 'rows' ? [{ function: 'count' as const, alias: 'fb', filter: { customer_id: { $ne: '' } } }] : []),
  ],
  having,
});

const refusalOf = async (p: Promise<unknown>) =>
  p.then(() => null, (e: any) => e as Error & { code?: string; status?: number });

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#20351] a non-numeric string against a number field at the public door — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
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
        engine.registry.registerObject(LEDGER as any);
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
        for (const [name, spec] of REFUSED) {
          const where = { amount: spec } as FilterCondition;
          const res = await query({ where });
          expect(res.status, `REST, ${name}: ${JSON.stringify(res.body)}`).toBe(400);
          expect(res.body.code, `REST, ${name}`).toBe('INVALID_FILTER');
          expect(res.body.error, `REST, ${name}`).toContain("filter on 'amount'");
          const err = await refusalOf(engine.find(OBJECT, { where }));
          expect({ code: err?.code, status: err?.status }, `engine.find, ${name}`).toEqual({ code: 'INVALID_FILTER', status: 400 });
        }
        expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
      });

      it('the per-aggregation filter and having: 400 INVALID_FILTER at their own positions — no read', async () => {
        const before = reads.n;
        for (const op of ['$gt', '$ne'] as const) {
          const filter = await query(perAggregation({ amount: { [op]: 'abc' } } as FilterCondition) as Record<string, unknown>);
          expect(filter.status, `filter ${op}: ${JSON.stringify(filter.body)}`).toBe(400);
          expect(filter.body.code, `filter ${op}`).toBe('INVALID_FILTER');
          expect(filter.body.error, `filter ${op}`).toContain(`aggregations[1].filter.amount.${op}`);
          const engineFilter = await refusalOf(engine.aggregate(OBJECT, perAggregation({ amount: { [op]: 'abc' } } as FilterCondition)));
          expect({ code: engineFilter?.code, status: engineFilter?.status }, `engine filter ${op}`).toEqual({ code: 'INVALID_FILTER', status: 400 });
          for (const path of ['native', 'rows'] as const) {
            for (const column of ['total', 'top'] as const) {
              const having = await query(grouped(path, { [column]: { [op]: 'abc' } } as FilterCondition) as Record<string, unknown>);
              expect(having.status, `having ${path} ${column} ${op}: ${JSON.stringify(having.body)}`).toBe(400);
              expect(having.body.code, `having ${path} ${column} ${op}`).toBe('INVALID_FILTER');
              expect(having.body.error, `having ${path} ${column} ${op}`).toContain(`having.${column}.${op}`);
            }
          }
        }
        expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
      });

      it('the control: a number is answered, and a numeric string counts what its number counts at every position', async () => {
        for (const [name, asString, asNumber, count] of NARROWED) {
          const s = await query({ where: { amount: asString } });
          const n = await query({ where: { amount: asNumber } });
          expect(s.status, `where, ${name}: ${JSON.stringify(s.body)}`).toBe(200);
          expect(n.status, `where control, ${name}`).toBe(200);
          expect(s.body.records.length, `where, ${name}`).toBe(count);
          expect(s.body.records.map((r: any) => r.id).sort(), `where, ${name}`).toEqual(n.body.records.map((r: any) => r.id).sort());
          expect((await engine.find(OBJECT, { where: { amount: asString } as FilterCondition })).length, `engine.find, ${name}`).toBe(count);
          const fs = await query(perAggregation({ amount: asString } as FilterCondition) as Record<string, unknown>);
          const fn = await query(perAggregation({ amount: asNumber } as FilterCondition) as Record<string, unknown>);
          expect(fs.status, `filter, ${name}: ${JSON.stringify(fs.body)}`).toBe(200);
          expect(Number(fs.body.records[0]?.m), `filter, ${name}`).toBe(count);
          expect(Number(fs.body.records[0]?.m), `filter, ${name}`).toBe(Number(fn.body.records[0]?.m));
        }
        for (const path of ['native', 'rows'] as const) {
          const groupsOf = async (having: FilterCondition) => {
            const res = await query(grouped(path, having) as Record<string, unknown>);
            expect(res.status, `having ${path} ${JSON.stringify(having)}: ${JSON.stringify(res.body)}`).toBe(200);
            return res.body.records.map((r: any) => r.customer_id).sort();
          };
          expect(await groupsOf({ total: { $gt: '20' } }), `having ${path}`).toEqual(['c2']);
          expect(await groupsOf({ total: { $gt: '20' } }), `having ${path}`).toEqual(await groupsOf({ total: { $gt: 20 } }));
          expect(await groupsOf({ top: { $eq: '120' } }), `having ${path}`).toEqual(['c1']);
        }
      });
    },
  );
}
