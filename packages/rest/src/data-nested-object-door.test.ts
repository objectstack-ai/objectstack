// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20802] The nested-relation form `{ relation: { field: value } }` is SERVED
 * at the public door — `POST /api/v1/data/:object/query` answers the rows the
 * form means, over a real `SqlDriver` — and what the first cut keeps refusing
 * is still refused, `400 INVALID_FILTER` in the engine's words, before any read.
 *
 * #20745's table, re-read on this branch through this door (owner `u1`, region
 * NA, on `d1` and `d3`; `d4` has no owner):
 *
 * | `where` | before (PR #20781) | now: SQLite · PostgreSQL 16 |
 * |:--|:--|:--|
 * | `{ owner: { region: 'NA' } }` (lookup; master-detail and multiple lookup alike) | 400 `INVALID_FILTER` | `d1`, `d3` |
 * | `{ parent: { title: 'a' } }` (tree) | 400 | `d2`, `d3` |
 * | `{ $not: { owner: { region: 'NA' } } }` | 400 | `d2`, `d4` — the row with no owner satisfies the negation |
 * | `{ $or: [{ owner: { region: 'EU' } }, { title: 'a' }] }` | 400 | `d1`, `d2` |
 * | `{ owner: { region: 'APAC' } }` (no related record matches) | 400 | no rows |
 * | `{ meta: { a: 1 } }` (json; address alike), `{ id: { a: 1 } }` | 400 | 400, unchanged |
 * | a second level, an undeclared key, `{}`, an unregistered related object | 400 | 400, in words of their own |
 * | `aggregations[1].filter` / `having` `{ owner: { region: 'NA' } }` | 400 | 400, the words say `where` serves it |
 *
 * The InMemoryDriver cells were measured on this branch and are not pinned
 * here: this package does not depend on the in-memory driver, and that
 * driver's test consumers are a ruled, closed census
 * (`check:driver-memory-census`). They answered every row above alike, except
 * the multi-valued arm where one stored id contains another as a substring
 * (`u1` / `u10`): the in-memory driver matches `$contains` per element by
 * substring — the gap `FILTER_OPERATORS`' `$contains` docblock records for it.
 * `@objectstack/objectql`'s `engine-nested-relation-lowering.test.ts` pins the
 * driver input the engine sends, which is the same on every driver.
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
import { ObjectQL, RELATION_FILTER_ID_CAP } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rest_nested_obj_20745';
const OWNER = 'rest_nested_own_20745';

const OWNER_OBJECT = {
  name: OWNER,
  label: 'Owner 20745',
  fields: { region: { name: 'region', type: 'text' as const } },
};

const LEDGER = {
  name: OBJECT,
  label: 'Ledger 20745',
  fields: {
    title: { name: 'title', type: 'text' as const },
    owner: { name: 'owner', type: 'lookup' as const, reference: OWNER },
    boss: { name: 'boss', type: 'master_detail' as const, reference: OWNER },
    owners: { name: 'owners', type: 'lookup' as const, reference: OWNER, multiple: true },
    assignee: { name: 'assignee', type: 'user' as const },
    parent: { name: 'parent', type: 'tree' as const, reference: OBJECT },
    meta: { name: 'meta', type: 'json' as const },
    ship_to: { name: 'ship_to', type: 'address' as const },
    photo: { name: 'photo', type: 'image' as const },
  },
};

const OWNERS = [{ id: 'u1', region: 'NA' }, { id: 'u2', region: 'EU' }];

const ROWS = [
  { id: 'd1', title: 'a', owner: 'u1', boss: 'u1', owners: ['u1'], assignee: 'u1', meta: { a: 1 }, ship_to: { city: 'Paris' } },
  { id: 'd2', title: 'b', owner: 'u2', boss: 'u2', owners: ['u2'], assignee: 'u2', parent: 'd1', meta: { a: 2 }, ship_to: { city: 'Rome' } },
  { id: 'd3', title: 'c', owner: 'u1', boss: 'u1', owners: ['u1', 'u2'], assignee: 'u1', parent: 'd1', meta: { b: 1 }, ship_to: { city: 'Paris' } },
  // No relation at all: the row the negation's NULL polarity is about.
  { id: 'd4', title: 'd' },
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

/** name · the `where` · the rows it means. */
const SERVED: ReadonlyArray<readonly [string, FilterCondition, readonly string[]]> = [
  ['a lookup (the card)', { owner: { region: 'NA' } }, ['d1', 'd3']],
  ['a master-detail', { boss: { region: 'NA' } }, ['d1', 'd3']],
  ['a multiple lookup — any member', { owners: { region: 'NA' } }, ['d1', 'd3']],
  ['a multiple lookup, the other member', { owners: { region: 'EU' } }, ['d2', 'd3']],
  ['a tree field', { parent: { title: 'a' } }, ['d2', 'd3']],
  ['beside a column of the object', { title: 'c', owner: { region: 'NA' } }, ['d3']],
  ['inside $or', { $or: [{ owner: { region: 'EU' } }, { title: 'a' }] }, ['d1', 'd2']],
  ['under $not — no owner satisfies it', { $not: { owner: { region: 'NA' } } }, ['d2', 'd4']],
  ['under $not, a multiple lookup', { $not: { owners: { region: 'NA' } } }, ['d2', 'd4']],
  ['no related record matches', { owner: { region: 'APAC' } }, []],
  ['no related record matches, a multiple lookup', { owners: { region: 'APAC' } }, []],
  ['under $not, no related record matches', { $not: { owner: { region: 'APAC' } } }, ['d1', 'd2', 'd3', 'd4']],
  ['an operator in the condition', { owner: { region: { $in: ['EU'] } } }, ['d2']],
];

/**
 * name · the `where` · the path · words only this refusal prints · the route
 * it names. Both are asserted on the REST body, so the route is pinned to land
 * inside the door's 500-character message bound.
 */
const REFUSED: ReadonlyArray<readonly [string, FilterCondition, string, string, string]> = [
  ['a json field (the card)', { meta: { a: 1 } }, 'where.meta', 'whole-value match', '{ "meta": { "$null": false } }, or store the part you filter on in a field of its own'],
  ['an address field', { ship_to: { city: 'Paris' } }, 'where.ship_to', 'whole-value match', '{ "ship_to": { "$null": false } }'],
  ['the id column (the card)', { id: { a: 1 } }, 'where.id', "the platform-provisioned text column 'id'", `Compare 'id' with a value ({ "id": VALUE })`],
  ['a second level', { parent: { owner: { region: 'NA' } } }, 'where.parent', `'owner' is itself a lookup field of the related object '${OBJECT}'`, '{ "parent": { "$in": [ID, …] } }'],
  ['a key the related object does not declare', { owner: { regio: 'NA' } }, 'where.owner', `'regio' is not a field of the related object '${OWNER}'`, '{ "owner": { "FIELD": VALUE } }'],
  ['an empty condition', { owner: {} }, 'where.owner', 'names no field of the related object', '{ "owner": { "$null": false } }'],
  ['a related object not registered here', { assignee: { region: 'NA' } }, 'where.assignee', "no object 'sys_user' is registered here", '{ "assignee": { "$in": [ID, …] } }'],
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

const idsOf = (body: any): string[] => (body?.records ?? []).map((r: any) => r.id).sort();

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#20802] the nested-relation form at the public door — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      let driver: any;
      const reads = { n: 0 };
      let query: (body: Record<string, unknown>, object?: string) => Promise<{ status: number; body: any }>;

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

        // Reads of the two objects — the protocol's own metadata traffic is not the question.
        for (const verb of ['find', 'findOne', 'count', 'aggregate'] as const) {
          const real = driver[verb].bind(driver);
          driver[verb] = (o: string, ...rest: unknown[]) => { if (o === OBJECT || o === OWNER) reads.n += 1; return real(o, ...rest); };
        }

        const protocol = new ObjectStackProtocolImplementation(engine as any);
        const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
        (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
        rest.registerRoutes();
        const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
        expect(route).toBeDefined();
        query = async (body, object = OBJECT) => {
          const res = makeRes();
          // What the wire carries: JSON.
          await route!.handler({ params: { object }, body: JSON.parse(JSON.stringify(body)), query: {}, headers: {} } as any, res);
          return { status: res._status ?? 200, body: res._json };
        };
      });

      afterAll(async () => {
        await dropTables();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      it('where: #20745\'s table answers the rows the form means — on every relation type, composed as written', async () => {
        for (const [name, where, rows] of SERVED) {
          const res = await query({ where });
          expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(200);
          expect(idsOf(res.body), name).toEqual([...rows].sort());
          const direct = await engine.find(OBJECT, { where });
          expect(direct.map((r: any) => r.id).sort(), `engine.find, ${name}`).toEqual([...rows].sort());
        }
      });

      it('the nested form answers exactly what the two-step route answers', async () => {
        const na = await query({ where: { region: 'NA' } }, OWNER);
        const ids = idsOf(na.body);
        expect(ids).toEqual(['u1']);
        for (const [nested, twoStep] of [
          [{ owner: { region: 'NA' } }, { owner: { $in: ids } }],
          [{ owners: { region: 'NA' } }, { $or: ids.map((id) => ({ owners: { $contains: id } })) }],
          [{ $not: { owner: { region: 'NA' } } }, { $not: { owner: { $in: ids } } }],
        ] as Array<[FilterCondition, FilterCondition]>) {
          expect(idsOf((await query({ where: nested })).body), JSON.stringify(nested))
            .toEqual(idsOf((await query({ where: twoStep })).body));
        }
      });

      it('where: what the first cut keeps refusing answers 400 INVALID_FILTER in the engine\'s words — no read', async () => {
        const before = reads.n;
        for (const [name, where, path, words, route] of REFUSED) {
          const res = await query({ where });
          expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(400);
          expect(res.body.code, name).toBe('INVALID_FILTER');
          expect(res.body.error, name).toContain(`at ${path},`);
          expect(res.body.error, name).toContain('The filter was NOT applied.');
          expect(res.body.error, name).toContain(words);
          expect(res.body.error, name).toContain(route);
          const err = await engine.find(OBJECT, { where }).then(() => null, (e: any) => e);
          expect({ code: err?.code, status: err?.status }, `engine.find, ${name}`).toEqual({ code: 'INVALID_FILTER', status: 400 });
        }
        const dotted = await query({ where: { 'owner.region': 'NA' } });
        expect(dotted.status, JSON.stringify(dotted.body)).toBe(400);
        expect(dotted.body.code).toBe('INVALID_FIELD');
        expect(JSON.stringify(dotted.body)).toContain('nest the condition beneath the relation field');
        expect(reads.n - before, 'no read of either object — every refusal precedes the driver').toBe(0);
      });

      it('the per-aggregation filter and having: 400 INVALID_FILTER at their own positions, naming where — no read', async () => {
        const before = reads.n;
        const filter = await query({
          aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter: { owner: { region: 'NA' } } }],
        } satisfies EngineAggregateOptions as Record<string, unknown>);
        expect(filter.status, JSON.stringify(filter.body)).toBe(400);
        expect(filter.body.code).toBe('INVALID_FILTER');
        expect(filter.body.error).toContain('at aggregations[1].filter.owner,');
        expect(filter.body.error).toContain("which the engine serves in 'where'");
        const having = await query({
          groupBy: ['owner'],
          aggregations: [{ function: 'count', alias: 'n' }],
          having: { owner: { region: 'NA' } },
        } satisfies EngineAggregateOptions as Record<string, unknown>);
        expect(having.status, JSON.stringify(having.body)).toBe(400);
        expect(having.body.code).toBe('INVALID_FILTER');
        expect(having.body.error).toContain('at having.owner,');
        expect(reads.n - before, 'no read — every refusal precedes the driver').toBe(0);
        // …and in `where`, the same condition narrows the aggregate.
        const counted = await query({
          where: { owner: { region: 'NA' } },
          aggregations: [{ function: 'count', alias: 'n' }],
        } satisfies EngineAggregateOptions as Record<string, unknown>);
        expect(counted.status, JSON.stringify(counted.body)).toBe(200);
        expect(JSON.stringify(counted.body)).toContain('"n":2');
      });

      it('the cap: a condition matching more related records than the cap is REFUSED, never truncated; at the cap it is served whole', async () => {
        const many = Array.from({ length: RELATION_FILTER_ID_CAP }, (_, i) => ({ id: `cap_${i}`, region: 'CAP' }));
        // In batches: one multi-row INSERT of a thousand rows passes SQLite's
        // compound-SELECT limit.
        for (let i = 0; i < many.length; i += 100) await engine.insert(OWNER, many.slice(i, i + 100) as any);
        await engine.insert(OWNER, { id: 'cap_extra', region: 'CAP_EXTRA' } as any);
        await engine.insert(OBJECT, { id: 'd_cap', title: 'cap', owner: 'cap_extra' } as any);
        try {
          const over = await query({ where: { owner: { region: { $in: ['CAP', 'CAP_EXTRA'] } } } });
          expect(over.status, JSON.stringify(over.body)).toBe(400);
          expect(over.body.code).toBe('INVALID_FILTER');
          expect(over.body.error).toContain(`matched more than ${RELATION_FILTER_ID_CAP} records of the related object '${OWNER}'`);
          expect(over.body.error).toContain('the filter was NOT applied');
          expect(over.body.error).toContain('{ "owner": { "$in": [ID, …] } }');
          // Exactly the cap: served, every id in play (no ledger row points at one).
          const at = await query({ where: { owner: { region: 'CAP' } } });
          expect(at.status, JSON.stringify(at.body)).toBe(200);
          expect(idsOf(at.body)).toEqual([]);
          const extra = await query({ where: { owner: { region: 'CAP_EXTRA' } } });
          expect(idsOf(extra.body)).toEqual(['d_cap']);
        } finally {
          await engine.delete(OBJECT, { where: { id: 'd_cap' } } as any);
          await engine.delete(OWNER, { where: { region: { $in: ['CAP', 'CAP_EXTRA'] } }, multi: true } as any);
        }
      });

      it('CONTROL the routes still answer the rows, and a file field\'s object reaches the driver unjudged', async () => {
        const na = await query({ where: { region: 'NA' } }, OWNER);
        const ids = idsOf(na.body);
        for (const field of ['owner', 'boss', 'assignee']) {
          const res = await query({ where: { [field]: { $in: ids } } });
          expect(idsOf(res.body), field).toEqual(['d1', 'd3']);
        }
        const multiple = await query({ where: { owners: { $contains: ids[0] } } });
        expect(idsOf(multiple.body)).toEqual(['d1', 'd3']);
        const present = await query({ where: { meta: { $null: false } } });
        expect(idsOf(present.body)).toEqual(['d1', 'd2', 'd3']);
        const before = reads.n;
        const res = await query({ where: { photo: { url: 'x' } } });
        expect(reads.n - before, 'the driver was asked').toBe(1);
        expect(JSON.stringify(res.body)).not.toContain('is filter structure, not a value');
      });
    },
  );
}
