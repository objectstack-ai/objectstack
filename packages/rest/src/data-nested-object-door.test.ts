// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20745] A plain object with no `$`-operator key beneath a relation field
 * (the nested-relation form), a structured-JSON field (a whole-value match) or
 * the platform-provisioned `id` column is refused at the public door —
 * `POST /api/v1/data/:object/query` answers `400 INVALID_FILTER` in the
 * engine's words, naming the field and the path, before any read — over a
 * real `SqlDriver`; and the route the refusal names answers the rows the
 * nested form meant.
 *
 * Measured on the base (`origin/main` `a51920f5fb`) through this door, three
 * rows (owner `u1`, region NA, on `d1` and `d3`):
 *
 * | `where` | InMemoryDriver | SQLite | PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | `{ owner: { region: 'NA' } }` (lookup; master-detail, multiple lookup, user, tree alike) | 200, no rows | 400 `INVALID_FILTER`, the driver's words | same as SQLite |
 * | `{ meta: { a: 1 } }` (json; address, composite alike) | 200, the deep-equal rows | 400, the driver's words | same |
 * | `{ id: { a: 1 } }` | 200, no rows | 400, the driver's words | same |
 * | route `{ owner: { $in: ['u1'] } }` | `d1`, `d3` | `d1`, `d3` | `d1`, `d3` |
 * | route `{ owners: { $contains: 'u1' } }` (multiple lookup) | `d1`, `d3` | `d1`, `d3` | `d1`, `d3` |
 * | `{ owners: { $in: ['u1'] } }` (multiple lookup) | `d1`, `d3` | 400, the driver's JSON-column words | same |
 *
 * The arm sits in the engine, in front of every driver, so one verdict holds
 * on each cell. InMemoryDriver's refusal row is `@objectstack/objectql`'s
 * `engine-nested-object-door.test.ts` by construction (the arm answers before
 * a driver is resolved). Its route readings above were measured, not pinned
 * here: this package does not depend on the in-memory driver, and that
 * driver's test consumers are a ruled, closed census
 * (`check:driver-memory-census`).
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

/**
 * name · the `where` · the field · the path · words only this kind's refusal
 * prints · the route it names. Both are asserted on the REST body, so the
 * route is pinned to land inside the door's 500-character message bound.
 */
const REFUSED: ReadonlyArray<readonly [string, FilterCondition, string, string, string, string]> = [
  ['a lookup (the card)', { owner: { region: 'NA' } }, 'owner', 'where.owner', 'nested-relation form', `Filter the related object '${OWNER}' first, then match 'owner' against the ids it returns: { "owner": { "$in": [ID, …] } }.`],
  ['a master-detail', { boss: { region: 'NA' } }, 'boss', 'where.boss', 'nested-relation form', '{ "boss": { "$in": [ID, …] } }'],
  ['a multiple lookup', { owners: { region: 'NA' } }, 'owners', 'where.owners', 'nested-relation form', '{ "owners": { "$contains": ID } } for one id, an $or of those for several'],
  ['a user field', { assignee: { region: 'NA' } }, 'assignee', 'where.assignee', 'nested-relation form', `Filter the related object 'sys_user' first`],
  ['a tree field', { parent: { title: 'a' } }, 'parent', 'where.parent', 'nested-relation form', `Filter the related object '${OBJECT}' first`],
  ['a json field (the card)', { meta: { a: 1 } }, 'meta', 'where.meta', 'whole-value match', '{ "meta": { "$null": false } }, or store the part you filter on in a field of its own'],
  ['an address field', { ship_to: { city: 'Paris' } }, 'ship_to', 'where.ship_to', 'whole-value match', '{ "ship_to": { "$null": false } }'],
  ['the id column (the card)', { id: { a: 1 } }, 'id', 'where.id', "the platform-provisioned text column 'id'", `Compare 'id' with a value ({ "id": VALUE })`],
  ['inside $not', { $not: { owner: { region: 'NA' } } }, 'owner', 'where.$not.owner', 'nested-relation form', '{ "owner": { "$in": [ID, …] } }'],
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

const idsOf = (body: any): string[] => (body?.records ?? []).map((r: any) => r.id).sort();

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#20745] a no-operator object beneath a relation, JSON or id column at the public door — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
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

      it('where: every row of the card answers 400 INVALID_FILTER in the engine\'s words, naming the field and the path — no read', async () => {
        const before = reads.n;
        for (const [name, where, field, path, words, route] of REFUSED) {
          const res = await query({ where });
          expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(400);
          expect(res.body.code, name).toBe('INVALID_FILTER');
          expect(res.body.error, name).toContain(`filter on '${field}'`);
          expect(res.body.error, name).toContain(`at ${path},`);
          expect(res.body.error, name).toContain('The filter was NOT applied.');
          expect(res.body.error, name).toContain(words);
          expect(res.body.error, name).toContain(route);
          const err = await engine.find(OBJECT, { where }).then(() => null, (e: any) => e);
          expect({ code: err?.code, status: err?.status }, `engine.find, ${name}`).toEqual({ code: 'INVALID_FILTER', status: 400 });
          expect(err?.message, `engine.find, ${name}`).toContain(ARM_WORDS);
        }
        expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
      });

      it('the per-aggregation filter and having: 400 INVALID_FILTER at their own positions — no read', async () => {
        const before = reads.n;
        const filter = await query({
          aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter: { owner: { region: 'NA' } } }],
        } satisfies EngineAggregateOptions as Record<string, unknown>);
        expect(filter.status, JSON.stringify(filter.body)).toBe(400);
        expect(filter.body.code).toBe('INVALID_FILTER');
        expect(filter.body.error).toContain('at aggregations[1].filter.owner,');
        const having = await query({
          groupBy: ['owner'],
          aggregations: [{ function: 'count', alias: 'n' }],
          having: { owner: { region: 'NA' } },
        } satisfies EngineAggregateOptions as Record<string, unknown>);
        expect(having.status, JSON.stringify(having.body)).toBe(400);
        expect(having.body.code).toBe('INVALID_FILTER');
        expect(having.body.error).toContain('at having.owner,');
        expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
      });

      it('the named route answers the rows the nested form meant: the related object\'s ids, then $in (single) or $contains (multiple)', async () => {
        const na = await query({ where: { region: 'NA' } }, OWNER);
        expect(na.status, JSON.stringify(na.body)).toBe(200);
        const ids = idsOf(na.body);
        expect(ids).toEqual(['u1']);
        for (const field of ['owner', 'boss', 'assignee']) {
          const res = await query({ where: { [field]: { $in: ids } } });
          expect(res.status, `${field}: ${JSON.stringify(res.body)}`).toBe(200);
          expect(idsOf(res.body), field).toEqual(['d1', 'd3']);
        }
        const multiple = await query({ where: { owners: { $contains: ids[0] } } });
        expect(multiple.status, JSON.stringify(multiple.body)).toBe(200);
        expect(idsOf(multiple.body)).toEqual(['d1', 'd3']);
        const anyOf = await query({ where: { $or: [{ owners: { $contains: 'u1' } }, { owners: { $contains: 'u9' } }] } });
        expect(idsOf(anyOf.body)).toEqual(['d1', 'd3']);
        const tree = await query({ where: { parent: { $in: ['d1'] } } });
        expect(idsOf(tree.body)).toEqual(['d2', 'd3']);
        const present = await query({ where: { meta: { $null: false } } });
        expect(idsOf(present.body)).toEqual(['d1', 'd2', 'd3']);
      });

      it('CONTROL a file field\'s object reaches the driver, never the arm\'s refusal', async () => {
        const before = reads.n;
        const res = await query({ where: { photo: { url: 'x' } } });
        expect(reads.n - before, 'the driver was asked').toBe(1);
        expect(JSON.stringify(res.body)).not.toContain(ARM_WORDS);
      });
    },
  );
}
