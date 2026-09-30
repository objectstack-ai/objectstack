// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20808] At the public door — `POST /api/v1/data/:object/query` over a real
 * `SqlDriver` — a `groupBy` on a MULTI-VALUE field and a `count_distinct` on a
 * JSON-STORED field answer `400 INVALID_FIELD` in the engine's words, naming
 * the field, its declaration, the position and the route, before any read;
 * and the scalar controls, plus the `$contains` route the multi-value refusal
 * names, are served by the driver unchanged.
 *
 * Measured on the base (`origin/main` `42d78b97fe`) through this door, three
 * rows:
 *
 * | query | InMemoryDriver | SQLite | PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | `groupBy: ['status']`, a single-value select (the control) | 200, `a` 2 · `b` 1 | same | same |
 * | `groupBy` a multi-value field (`select` / `lookup` / `user` / `file` / `image` with `multiple: true`; `tags`, `multiselect`, `checkboxes`) | 200, one group per array | 200, one group per serialized array | 500 `DATABASE_ERROR` |
 * | `count_distinct` `title`, a text (the control) | 2 | 2 | 2 |
 * | `count_distinct` a structured-JSON field (`json`, `composite`, `repeater`, `record`, `location`, `address`, `vector`) | 3 | 2 (`json`: 3) | 500 `DATABASE_ERROR` |
 * | `count_distinct` a multi-value field | 3 | 2 | 500 `DATABASE_ERROR` |
 *
 * The refusals sit in the engine, in front of every driver, so one verdict
 * holds on each cell. InMemoryDriver's row is `@objectstack/objectql`'s
 * `engine-json-stored-group-distinct-door.test.ts` by construction (the doors
 * answer before a driver is resolved); this package does not depend on the
 * in-memory driver, and that driver's test consumers are a ruled, closed
 * census (`check:driver-memory-census`).
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL and MySQL cells run where
 * `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` are set and are a named skip
 * otherwise. ⚠️ No CI job provisions those variables for this package, so the
 * live cells are red-capable and un-run in CI; the PR that landed this file
 * carries their local PostgreSQL run. Each live cell owns its tables, dropped
 * before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { EngineAggregateOptions } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rest_json_stored_key_20808';
const TARGET = 'rest_json_stored_key_target_20808';

const OPTIONS = [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }];

/** field · declared type · `multiple: true` — every multi-value declaration the spec admits. */
const MULTIS: ReadonlyArray<readonly [string, string, boolean]> = [
  ['tags', 'select', true],
  ['labels', 'tags', false],
  ['ms', 'multiselect', false],
  ['cb', 'checkboxes', false],
  ['refs', 'lookup', true],
  ['watchers', 'user', true],
  ['files', 'file', true],
  ['imgs', 'image', true],
];

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
  label: 'Ledger 20808',
  fields: {
    title: { name: 'title', type: 'text' as const },
    status: { name: 'status', type: 'select' as const, options: OPTIONS },
    ...Object.fromEntries(MULTIS.map(([name, type, multiple]) => [
      name,
      {
        name,
        type,
        ...(multiple ? { multiple: true } : {}),
        ...(type === 'select' || type === 'multiselect' || type === 'checkboxes' ? { options: OPTIONS } : {}),
        ...(type === 'lookup' ? { reference: TARGET } : {}),
      },
    ])),
    ...Object.fromEntries(JSONS.map(([name, type]) => [name, { name, type }])),
  },
};

const TARGET_OBJECT = { name: TARGET, label: 'Target 20808', fields: { name: { name: 'name', type: 'text' as const } } };

/** Two of the three rows hold EQUAL values under every JSON-stored field — the case the drivers counted apart. */
const ROWS = [
  { id: 'd1', title: 'x', status: 'a', tags: ['a', 'b'], labels: ['p', 'q'], ms: ['a'], cb: ['a', 'b'], refs: ['t1', 't2'], watchers: ['u1'], files: ['f1'], imgs: ['i1'], meta: { a: 1 }, spec: { k: 1 }, rep: [{ q: 1 }], rec: { r: 1 }, loc: { lat: 1, lng: 2 }, ship_to: { city: 'Paris' }, vec: [1, 2] },
  { id: 'd2', title: 'x', status: 'a', tags: ['a'], labels: ['p'], ms: ['a', 'b'], cb: ['a'], refs: ['t1'], watchers: ['u1', 'u2'], files: ['f1', 'f2'], imgs: ['i1', 'i2'], meta: { a: 2 }, spec: { k: 2 }, rep: [{ q: 2 }], rec: { r: 2 }, loc: { lat: 3, lng: 4 }, ship_to: { city: 'Rome' }, vec: [3, 4] },
  { id: 'd3', title: 'y', status: 'b', tags: ['a', 'b'], labels: ['p', 'q'], ms: ['a'], cb: ['a', 'b'], refs: ['t1', 't2'], watchers: ['u1'], files: ['f1'], imgs: ['i1'], meta: { b: 1 }, spec: { k: 1 }, rep: [{ q: 1 }], rec: { r: 1 }, loc: { lat: 1, lng: 2 }, ship_to: { city: 'Paris' }, vec: [1, 2] },
];

const COUNT: EngineAggregateOptions['aggregations'] = [{ function: 'count', alias: 'n' }];
const distinct = (field: string): EngineAggregateOptions['aggregations'] =>
  [{ function: 'count_distinct', field, alias: 'n' }];

/** The routes the refusals name — asserted on the REST body, so each must land inside the door's 500-character bound. */
const MEMBER_ROUTE = (field: string) => `where { "${field}": { "$contains": VALUE } }`;
const SCALAR_DISTINCT_ROUTE = 'Count distinct values of a field that stores one scalar value: store the part you count in a field of its own and count_distinct that field, or count the rows with count.';

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
    `[#20808] a groupBy on a multi-value field and a count_distinct on a JSON-stored field at the public door — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      let driver: any;
      const reads = { n: 0 };
      let query: (body: Record<string, unknown>) => Promise<{ status: number; body: any }>;

      const dropTables = async () => {
        if (cell.id === 'sqlite') return;
        for (const t of [OBJECT, TARGET]) await driver?.execute(`drop table if exists ${t}`).catch(() => {});
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTables();
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(TARGET_OBJECT as any);
        engine.registry.registerObject(LEDGER as any);
        await engine.syncSchemas();
        for (const id of ['t1', 't2']) await engine.insert(TARGET, { id, name: id } as any);
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

      it('a groupBy on every multi-value declaration answers 400 INVALID_FIELD in the engine\'s words, naming the field, its declaration and the $contains route — no read', async () => {
        const before = reads.n;
        for (const [field, type, multiple] of MULTIS) {
          const res = await query({ groupBy: [field], aggregations: COUNT });
          expect(res.status, `${field}: ${JSON.stringify(res.body)}`).toBe(400);
          expect(res.body.code, field).toBe('INVALID_FIELD');
          const declared = multiple ? `${type} field with multiple: true` : `${type} field`;
          expect(res.body.error, field).toContain(`groupBy[0] names '${field}', a declared ${declared} — a multi-value field`);
          expect(res.body.error, field).toContain(MEMBER_ROUTE(field));
          const err = await engine.aggregate(OBJECT, { groupBy: [field], aggregations: COUNT }).then(() => null, (e: any) => e);
          expect({ code: err?.code, status: err?.status }, `engine.aggregate, ${field}`).toEqual({ code: 'INVALID_FIELD', status: 400 });
        }
        const objectForm = await query({ groupBy: [{ field: 'tags' }], aggregations: COUNT });
        expect(objectForm.status, JSON.stringify(objectForm.body)).toBe(400);
        expect(objectForm.body.error).toContain(`groupBy[0].field names 'tags'`);
        expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
      });

      it('a count_distinct on every structured-JSON type and every multi-value declaration answers 400 INVALID_FIELD at aggregations[0].field — no read', async () => {
        const before = reads.n;
        const cases: ReadonlyArray<readonly [string, string, boolean]> = [
          ...JSONS.map(([f, t]) => [f, `${t} field — a structured-JSON value`, false] as const),
          ...MULTIS.map(([f, t, m]) => [f, `${m ? `${t} field with multiple: true` : `${t} field`} — a multi-value field`, true] as const),
        ];
        for (const [field, declared, multiValue] of cases) {
          const res = await query({ aggregations: distinct(field) });
          expect(res.status, `${field}: ${JSON.stringify(res.body)}`).toBe(400);
          expect(res.body.code, field).toBe('INVALID_FIELD');
          expect(res.body.error, field).toContain(`aggregations[0].field counts distinct '${field}', a declared ${declared}`);
          expect(res.body.error, field).toContain(multiValue ? MEMBER_ROUTE(field) : SCALAR_DISTINCT_ROUTE);
          const err = await engine.aggregate(OBJECT, { aggregations: distinct(field) }).then(() => null, (e: any) => e);
          expect({ code: err?.code, status: err?.status }, `engine.aggregate, ${field}`).toEqual({ code: 'INVALID_FIELD', status: 400 });
        }
        expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
      });

      it('CONTROL a single-value select groupBy and a scalar count_distinct are served unchanged, from the driver', async () => {
        const before = reads.n;
        const grouped = await query({ groupBy: ['status'], aggregations: COUNT });
        expect(grouped.status, JSON.stringify(grouped.body)).toBe(200);
        const groups = (grouped.body.records as Array<{ status: string; n: number | string }>)
          .map((r) => [r.status, Number(r.n)] as const)
          .sort(([a], [b]) => a.localeCompare(b));
        expect(groups).toEqual([['a', 2], ['b', 1]]);
        for (const field of ['title', 'status']) {
          const counted = await query({ aggregations: distinct(field) });
          expect(counted.status, `${field}: ${JSON.stringify(counted.body)}`).toBe(200);
          expect(Number(counted.body.records[0].n), field).toBe(2);
        }
        expect(reads.n - before, 'the driver was asked, once per query').toBe(3);
      });

      it('CONTROL the route the multi-value refusal names answers from the driver: count with where { tags: { $contains } }', async () => {
        const before = reads.n;
        const counts: Record<string, number> = {};
        for (const member of ['a', 'b']) {
          const res = await query({ where: { tags: { $contains: member } }, aggregations: COUNT });
          expect(res.status, `${member}: ${JSON.stringify(res.body)}`).toBe(200);
          counts[member] = Number(res.body.records[0].n);
        }
        // d1 [a,b] · d2 [a] · d3 [a,b]: every row holds `a`, two hold `b`.
        expect(counts).toEqual({ a: 3, b: 2 });
        expect(reads.n - before, 'the driver was asked').toBe(2);
      });
    },
  );
}
