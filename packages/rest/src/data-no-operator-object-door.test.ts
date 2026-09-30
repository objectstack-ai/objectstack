// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20546] A plain object with no `$`-operator key where a scalar field's
 * value belongs is refused at the public door — `POST /api/v1/data/:object/query`
 * and `engine.find` answer `400 INVALID_FILTER` in the engine's words, naming
 * the field and the path, before any read — over a real `SqlDriver`, with a
 * file field's object reaching the driver as written. The two controls triage
 * first named here — a `lookup` field's nested relation filter and a `json`
 * field's object comparand — are refused by the same arm since #20745, in
 * words of their own (`data-nested-object-door.test.ts` pins them).
 *
 * Measured on the base (`origin/main` `fbec216e2d`) through this door and the
 * engine, three rows:
 *
 * | `where` | InMemoryDriver | SQLite | PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | `{ amount: { a: 1 } }` (number), `{ title: { a: 1 } }` (text) | 200, no rows | 400 `INVALID_FILTER`, the driver's words | same as SQLite |
 * | `{ owner: { region: 'NA' } }` (lookup), `{ meta: { a: 1 } }` (json) | 200, no rows / one row | 400, the driver's words | same — refused since #20745 |
 * | `aggregations[1].filter` `{ amount: { a: 1 } }` / `having` `{ total: { a: 1 } }` | count 0 / no group | same | same |
 *
 * The arm sits in the engine, in front of every driver, so one verdict holds
 * on each cell; InMemoryDriver's row is `@objectstack/objectql`'s
 * `engine-no-operator-object-door.test.ts` by construction (the arm answers
 * before a driver is resolved). The control is this door's to let through,
 * not to fix: what a driver answers for it afterwards is its own, and is
 * pinned here only as "the driver was asked, and the words are not the arm's".
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL and MySQL cells run where
 * `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` are set and are a named skip
 * otherwise. ⚠️ No CI job provisions those variables for this package (the
 * `Temporal Conformance (live PG + MySQL)` job runs `driver-sql`,
 * `metadata-protocol` and one `runtime` file), so the live cells are
 * red-capable and un-run in CI; the PR that landed this file carries their
 * local PostgreSQL run. Each live cell owns its tables, dropped before and
 * after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { EngineAggregateOptions, FilterCondition } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rest_no_op_object_20546';
const OWNER = 'rest_no_op_owner_20546';

const OWNER_OBJECT = {
  name: OWNER,
  label: 'Owner 20546',
  fields: { region: { name: 'region', type: 'text' as const } },
};

const LEDGER = {
  name: OBJECT,
  label: 'Ledger 20546',
  fields: {
    title: { name: 'title', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    owner: { name: 'owner', type: 'lookup' as const, reference: OWNER },
    meta: { name: 'meta', type: 'json' as const },
    photo: { name: 'photo', type: 'image' as const },
  },
};

const OWNERS = [{ id: 'u1', region: 'NA' }, { id: 'u2', region: 'EU' }];

const ROWS = [
  { id: 'd1', title: 'a', amount: 5, owner: 'u1', meta: { a: 1 } },
  { id: 'd2', title: 'b', amount: 12, owner: 'u2', meta: { a: 2 } },
  { id: 'd3', title: 'c', amount: 30, owner: 'u1', meta: { b: 1 } },
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

/** name · the `where` — a no-operator object under a scalar field. */
const REFUSED: ReadonlyArray<readonly [string, FilterCondition, string, string]> = [
  ['a number field (the card)', { amount: { a: 1 } }, 'amount', 'where.amount'],
  ['a text field', { title: { a: 1 } }, 'title', 'where.title'],
  ['{} under a number field', { amount: {} }, 'amount', 'where.amount'],
  ['inside $not (every row on memory, before)', { $not: { amount: { a: 1 } } }, 'amount', 'where.$not.amount'],
];

/** name · the `where` — the accepted side: a file field (the #8371 carve-out). */
const CONTROLS: ReadonlyArray<readonly [string, FilterCondition]> = [
  ["a file field's object", { photo: { url: 'x' } }],
];

/** The arm's own words, in every refusal it raises — a control must never be answered in them. */
const ARM_WORDS = 'is filter structure, not a value';

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

const refusalOf = async (p: Promise<unknown>) =>
  p.then(() => null, (e: any) => e as Error & { code?: string; status?: number });

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#20546] a no-operator object under a scalar field at the public door — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      let driver: any;
      const reads = { n: 0 };
      let query: (body: Record<string, unknown>) => Promise<{ status: number; body: any }>;

      const dropTables = async () => {
        if (cell.id === 'sqlite') return;
        await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
        await driver?.execute(`drop table if exists ${OWNER}`).catch(() => {});
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTables();
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(OWNER_OBJECT as any);
        engine.registry.registerObject(LEDGER as any);
        await engine.syncSchemas();
        for (const row of OWNERS) await engine.insert(OWNER, { ...row } as any);
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

      it('where: 400 INVALID_FILTER in the engine\'s words, naming the field and the path, through REST and engine.find — no read', async () => {
        const before = reads.n;
        for (const [name, where, field, path] of REFUSED) {
          const res = await query({ where });
          expect(res.status, `REST, ${name}: ${JSON.stringify(res.body)}`).toBe(400);
          expect(res.body.code, `REST, ${name}`).toBe('INVALID_FILTER');
          expect(res.body.error, `REST, ${name}`).toContain(`filter on '${field}'`);
          expect(res.body.error, `REST, ${name}`).toContain(`at ${path},`);
          const err = await refusalOf(engine.find(OBJECT, { where }));
          expect({ code: err?.code, status: err?.status }, `engine.find, ${name}`).toEqual({ code: 'INVALID_FILTER', status: 400 });
          expect(err?.message, `engine.find, ${name}`).toContain(`at ${path},`);
          expect(err?.message, `engine.find, ${name}`).toContain(ARM_WORDS);
        }
        expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
      });

      it('the per-aggregation filter and having: 400 INVALID_FILTER at their own positions — no read', async () => {
        const before = reads.n;
        const filter = await query({
          aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter: { amount: { a: 1 } } }],
        } satisfies EngineAggregateOptions as Record<string, unknown>);
        expect(filter.status, JSON.stringify(filter.body)).toBe(400);
        expect(filter.body.code).toBe('INVALID_FILTER');
        expect(filter.body.error).toContain('at aggregations[1].filter.amount,');
        const having = await query({
          groupBy: ['title'],
          aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
          having: { total: { a: 1 } },
        } satisfies EngineAggregateOptions as Record<string, unknown>);
        expect(having.status, JSON.stringify(having.body)).toBe(400);
        expect(having.body.code).toBe('INVALID_FILTER');
        expect(having.body.error).toContain('at having.total,');
        expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
      });

      it('CONTROL a file field\'s object reaches the driver, never the arm\'s refusal', async () => {
        for (const [name, where] of CONTROLS) {
          const before = reads.n;
          const res = await query({ where });
          expect(reads.n - before, `REST, ${name}: the driver was asked`).toBe(1);
          expect(JSON.stringify(res.body), `REST, ${name}`).not.toContain(ARM_WORDS);
          const read = reads.n;
          const err = await refusalOf(engine.find(OBJECT, { where }));
          expect(reads.n - read, `engine.find, ${name}: the driver was asked`).toBe(1);
          expect(err?.message ?? '', `engine.find, ${name}`).not.toContain(ARM_WORDS);
        }
      });

      it('CONTROL a scalar comparand and an operator are answered as before', async () => {
        const plain = await query({ where: { amount: 12 } });
        expect(plain.status, JSON.stringify(plain.body)).toBe(200);
        expect(plain.body.records.map((r: any) => r.id)).toEqual(['d2']);
        const op = await query({ where: { amount: { $gt: 10 } } });
        expect(op.status, JSON.stringify(op.body)).toBe(200);
        expect(op.body.records.map((r: any) => r.id).sort()).toEqual(['d2', 'd3']);
      });
    },
  );
}
