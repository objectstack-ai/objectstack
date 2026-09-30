// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20783] A `groupBy` on a structured-JSON field is refused at the public
 * door — `POST /api/v1/data/:object/query` answers `400 INVALID_FIELD` in the
 * engine's words, naming the field, its type and the position, before any
 * read — over a real `SqlDriver`; and a `text` field's `groupBy` (the control)
 * is served unchanged.
 *
 * Measured on the base (`origin/main` `7a09eee1b1`) through this door, three
 * rows, `{ groupBy: [FIELD], aggregations: [{ function: 'count', alias: 'n' }] }`:
 *
 * | `groupBy` | InMemoryDriver | SQLite | PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | `title` (text, the control) | 200, `x` 2 · `y` 1 | same | same |
 * | `meta` (json; composite, repeater, record, location, address alike) | 200, one group, `n` 3 | 200, one group per serialized document | 500 `DATABASE_ERROR` |
 * | `vec` (vector) | 200, one group per array | 200, one group per serialized array | 500 |
 * | `{ field: 'meta', dateGranularity: 'month' }` | 200, one `null` bucket | 200, one `null` bucket | 500 |
 *
 * The refusal sits in the engine, in front of every driver, so one verdict
 * holds on each cell. InMemoryDriver's row is `@objectstack/objectql`'s
 * `engine-group-by-json-door.test.ts` by construction (the door answers before
 * a driver is resolved); this package does not depend on the in-memory
 * driver, and that driver's test consumers are a ruled, closed census
 * (`check:driver-memory-census`).
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
import type { EngineAggregateOptions } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rest_group_by_json_20783';

/** field · declared type — one field of every structured-JSON type. */
const JSONS: ReadonlyArray<readonly [string, string]> = [
  ['meta', 'json'],
  ['spec', 'composite'],
  ['rep', 'repeater'],
  ['rec', 'record'],
  ['loc', 'location'],
  ['ship_to', 'address'],
  ['vec', 'vector'],
];

const LEDGER = {
  name: OBJECT,
  label: 'Ledger 20783',
  fields: {
    title: { name: 'title', type: 'text' as const },
    ...Object.fromEntries(JSONS.map(([name, type]) => [name, { name, type }])),
  },
};

const ROWS = [
  { id: 'd1', title: 'x', meta: { a: 1 }, spec: { k: 1 }, rep: [{ q: 1 }], rec: { r: 1 }, loc: { lat: 1, lng: 2 }, ship_to: { city: 'Paris' }, vec: [1, 2] },
  { id: 'd2', title: 'x', meta: { a: 2 }, spec: { k: 2 }, rep: [{ q: 2 }], rec: { r: 2 }, loc: { lat: 3, lng: 4 }, ship_to: { city: 'Rome' }, vec: [3, 4] },
  { id: 'd3', title: 'y', meta: { b: 1 }, spec: { k: 1 }, rep: [{ q: 1 }], rec: { r: 1 }, loc: { lat: 1, lng: 2 }, ship_to: { city: 'Paris' }, vec: [1, 2] },
];

const COUNT: EngineAggregateOptions['aggregations'] = [{ function: 'count', alias: 'n' }];

/** The route the refusal names — asserted on the REST body, so it must land inside the door's 500-character bound. */
const ROUTE = 'Group by a field that stores one scalar value: store the part you group on in a field of its own and group by that field.';

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

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#20783] a groupBy on a structured-JSON field at the public door — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      let driver: any;
      const reads = { n: 0 };
      let query: (body: Record<string, unknown>) => Promise<{ status: number; body: any }>;

      const dropTables = async () => {
        if (cell.id === 'sqlite') return;
        await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTables();
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
        await dropTables();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      it('every structured-JSON type answers 400 INVALID_FIELD in the engine\'s words, naming the field, its type and the route — no read', async () => {
        const before = reads.n;
        for (const [field, type] of JSONS) {
          const res = await query({ groupBy: [field], aggregations: COUNT });
          expect(res.status, `${field}: ${JSON.stringify(res.body)}`).toBe(400);
          expect(res.body.code, field).toBe('INVALID_FIELD');
          expect(res.body.error, field).toContain(`groupBy[0] names '${field}', a declared ${type} field`);
          expect(res.body.error, field).toContain(ROUTE);
          const err = await engine.aggregate(OBJECT, { groupBy: [field], aggregations: COUNT }).then(() => null, (e: any) => e);
          expect({ code: err?.code, status: err?.status }, `engine.aggregate, ${field}`).toEqual({ code: 'INVALID_FIELD', status: 400 });
        }
        expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
      });

      it('the { field } object form and a date bucket over a json field answer the same 400 at groupBy[0].field — no read', async () => {
        const before = reads.n;
        for (const entry of [{ field: 'meta' }, { field: 'meta', dateGranularity: 'month' }]) {
          const res = await query({ groupBy: [entry], aggregations: COUNT });
          expect(res.status, `${JSON.stringify(entry)}: ${JSON.stringify(res.body)}`).toBe(400);
          expect(res.body.code).toBe('INVALID_FIELD');
          expect(res.body.error).toContain(`groupBy[0].field names 'meta', a declared json field`);
        }
        const mixed = await query({ groupBy: ['title', 'meta'], aggregations: COUNT });
        expect(mixed.status, JSON.stringify(mixed.body)).toBe(400);
        expect(mixed.body.error).toContain(`groupBy[1] names 'meta'`);
        expect(reads.n - before, 'no read of the object').toBe(0);
      });

      it('CONTROL a text field\'s groupBy is served unchanged: one group per value, counted, from the driver', async () => {
        const before = reads.n;
        const res = await query({ groupBy: ['title'], aggregations: COUNT });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const groups = (res.body.records as Array<{ title: string; n: number | string }>)
          .map((r) => [r.title, Number(r.n)] as const)
          .sort(([a], [b]) => a.localeCompare(b));
        expect(groups).toEqual([['x', 2], ['y', 1]]);
        expect(reads.n - before, 'the driver was asked').toBe(1);
      });
    },
  );
}
