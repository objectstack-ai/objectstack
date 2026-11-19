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
 * | a fourth relationship (ADR-0071's limit is 3), an undeclared key, `{}`, an unregistered related object | 400 | 400, in words of their own |
 * | `aggregations[1].filter` / `having` `{ owner: { region: 'NA' } }` | 400 | 400, the words say `where` serves it |
 *
 * The InMemoryDriver cells were measured on this branch and are not pinned
 * here: this package does not depend on the in-memory driver, and that
 * driver's test consumers are a ruled, closed census
 * (`check:driver-memory-census`). They answered every row above alike. The
 * multi-valued arm where one stored id contains another as a substring
 * (`u1` / `u10`) differed until #20874 made the in-memory driver answer
 * `$contains` on a multi-valued field by membership; that driver pins the
 * case over the driver input below (`memory-20874-contains-membership.test.ts`).
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
import { installDefaultOrganization } from './default-organization.testkit.js';

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
  // `$ne` is evaluated on the related records: a row with no owner is in no
  // subquery, so it never matches, whatever the operator.
  ['$ne in the condition — no owner never matches', { owner: { region: { $ne: 'NA' } } }, ['d2']],
  ['$null in the condition — no owner never matches', { owner: { region: { $null: true } } }, []],
  // [#33626] Two relationships: the parent's owner. `d1` and `d4` have no parent.
  ['two hops: the parent\'s owner', { parent: { owner: { region: 'NA' } } }, ['d2', 'd3']],
  ['two hops, $ne at the second — no parent never matches', { parent: { owner: { region: { $ne: 'EU' } } } }, ['d2', 'd3']],
  ['two hops, under $not', { $not: { parent: { owner: { region: 'NA' } } } }, ['d1', 'd4']],
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
  ['a fourth relationship', { parent: { parent: { parent: { owner: { region: 'NA' } } } } }, 'where.parent.parent.parent', `'owner' holds a condition of its own past the 3-relationship limit`, '{ "parent": { "$in": [ID, …] } }'],
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
        // A real `single` install's Default Organization: the system writes below
        // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
        await installDefaultOrganization(engine);
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

      it('no cap on a single-valued relation (one subquery, no id list); a multi-valued one past the cap is REFUSED, never truncated', async () => {
        const many = Array.from({ length: RELATION_FILTER_ID_CAP }, (_, i) => ({ id: `cap_${i}`, region: 'CAP' }));
        // In batches: one multi-row INSERT of a thousand rows passes SQLite's
        // compound-SELECT limit.
        for (let i = 0; i < many.length; i += 100) await engine.insert(OWNER, many.slice(i, i + 100) as any);
        await engine.insert(OWNER, { id: 'cap_extra', region: 'CAP_EXTRA' } as any);
        await engine.insert(OBJECT, { id: 'd_cap', title: 'cap', owner: 'cap_extra' } as any);
        try {
          const over = await query({ where: { owner: { region: { $in: ['CAP', 'CAP_EXTRA'] } } } });
          expect(over.status, JSON.stringify(over.body)).toBe(200);
          expect(idsOf(over.body)).toEqual(['d_cap']);
          const overMulti = await query({ where: { owners: { region: { $in: ['CAP', 'CAP_EXTRA'] } } } });
          expect(overMulti.status, JSON.stringify(overMulti.body)).toBe(400);
          expect(overMulti.body.code).toBe('INVALID_FILTER');
          expect(overMulti.body.error).toContain(`matched more than ${RELATION_FILTER_ID_CAP} records of the related object '${OWNER}'`);
          expect(overMulti.body.error).toContain('the filter was NOT applied');
          expect(overMulti.body.error).toContain('{ "owners": { "$contains": ID } }');
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
        // Budget for the 1,000-row seed and its 1,001-row delete on a loaded full-suite shard (#27037); the slowdown itself is #27004's.
      }, 30_000);

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

// ── [#33626] up to three relationships, each hop its related object's own read ──

const HOP_CASE = 'rest_hop_case_33626';
const HOP_CONTACT = 'rest_hop_contact_33626';
const HOP_ACCOUNT = 'rest_hop_account_33626';
const HOP_REGION = 'rest_hop_region_33626';

const HOP_OBJECTS = [
  { name: HOP_REGION, label: 'Region 33626', fields: { name: { name: 'name', type: 'text' as const } } },
  {
    name: HOP_ACCOUNT, label: 'Account 33626',
    fields: { name: { name: 'name', type: 'text' as const }, region: { name: 'region', type: 'lookup' as const, reference: HOP_REGION } },
  },
  { name: HOP_CONTACT, label: 'Contact 33626', fields: { account: { name: 'account', type: 'lookup' as const, reference: HOP_ACCOUNT } } },
  {
    name: HOP_CASE, label: 'Case 33626',
    fields: { subject: { name: 'subject', type: 'text' as const }, contact: { name: 'contact', type: 'lookup' as const, reference: HOP_CONTACT } },
  },
];

/**
 * k1 → c1 → a1 → r1 (NA) · k2 → c2 → a2 → r2 (EU) · k3 → c3 → a3 → (no region)
 * · k4 → c4 → a4 → r_gone (a region that does not exist: a missing parent)
 * · k5 → c5 → (no account) · k6 → (no contact).
 */
const HOP_SEED: ReadonlyArray<readonly [string, ReadonlyArray<Record<string, unknown>>]> = [
  [HOP_REGION, [{ id: 'r1', name: 'NA' }, { id: 'r2', name: 'EU' }, { id: 'r_gone', name: 'GONE' }]],
  [HOP_ACCOUNT, [
    { id: 'a1', name: 'A1', region: 'r1' }, { id: 'a2', name: 'A2', region: 'r2' },
    { id: 'a3', name: 'A3' }, { id: 'a4', name: 'A4', region: 'r_gone' },
  ]],
  [HOP_CONTACT, [{ id: 'c1', account: 'a1' }, { id: 'c2', account: 'a2' }, { id: 'c3', account: 'a3' }, { id: 'c4', account: 'a4' }, { id: 'c5' }]],
  [HOP_CASE, [
    { id: 'k1', subject: 's', contact: 'c1' }, { id: 'k2', subject: 's', contact: 'c2' }, { id: 'k3', subject: 's', contact: 'c3' },
    { id: 'k4', subject: 's', contact: 'c4' }, { id: 'k5', subject: 's', contact: 'c5' }, { id: 'k6', subject: 't' },
  ]],
];

/** name · the nested `where` on the case · the region condition · the rows it means. */
const HOPS: ReadonlyArray<readonly [string, (region: FilterCondition) => FilterCondition, FilterCondition, readonly string[]]> = [
  ['three hops', (r) => ({ contact: { account: { region: r } } }), { name: 'NA' }, ['k1']],
  ['three hops, $ne — a missing or empty ancestor never matches', (r) => ({ contact: { account: { region: r } } }), { name: { $ne: 'NA' } }, ['k2']],
  ['three hops, $null on the last field', (r) => ({ contact: { account: { region: r } } }), { name: { $null: true } }, []],
  ['three hops, under $not — every row without a NA region', (r) => ({ $not: { contact: { account: { region: r } } } }), { name: 'NA' }, ['k2', 'k3', 'k4', 'k5', 'k6']],
  ['three hops, inside $or beside a column', (r) => ({ $or: [{ subject: 't' }, { contact: { account: { region: r } } }] }), { name: 'EU' }, ['k2', 'k6']],
];

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#33626] a nested-relation condition through three relationships — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      let driver: any;

      const dropTables = async () => {
        if (cell.id === 'sqlite') return;
        for (const o of HOP_OBJECTS.map((x) => x.name).reverse()) await driver?.execute(`drop table if exists ${o}`).catch(() => {});
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTables();
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        for (const o of HOP_OBJECTS) engine.registry.registerObject(o as any);
        await engine.syncSchemas();
        await installDefaultOrganization(engine);
        for (const [object, rows] of HOP_SEED) for (const row of rows) await engine.insert(object, { ...row } as any);
        // The missing parent: `a4` keeps pointing at a region row removed behind the engine's back.
        await driver.execute(`delete from ${HOP_REGION} where id = 'r_gone'`);
      });

      afterAll(async () => {
        await dropTables();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      /** The two-step route, hop by hop: read each related object's ids, then match the relation against them. */
      const twoStep = async (region: FilterCondition): Promise<FilterCondition> => {
        const ids = async (object: string, where: FilterCondition) =>
          (await engine.find(object, { where, fields: ['id'] })).map((r: any) => r.id);
        const regions = await ids(HOP_REGION, region);
        const accounts = await ids(HOP_ACCOUNT, { region: { $in: regions } });
        const contacts = await ids(HOP_CONTACT, { account: { $in: accounts } });
        return { $in: contacts };
      };

      it('each case answers the rows it means, and exactly what the two-step route answers — on find and count', async () => {
        for (const [name, nest, region, rows] of HOPS) {
          const nested = nest(region);
          const got = (await engine.find(HOP_CASE, { where: nested })).map((r: any) => r.id).sort();
          expect(got, name).toEqual([...rows].sort());
          expect(await engine.count(HOP_CASE, { where: nested }), `count, ${name}`).toBe(rows.length);
          // Parity: the same shape with the innermost three hops replaced by the hand-read id list.
          const contactIds = await twoStep(region);
          const reference = JSON.parse(JSON.stringify(nested).replace(
            JSON.stringify({ account: { region } }), JSON.stringify(contactIds),
          ));
          const ref = (await engine.find(HOP_CASE, { where: reference })).map((r: any) => r.id).sort();
          expect(got, `two-step parity, ${name}: ${JSON.stringify(reference)}`).toEqual(ref);
        }
      });

      it('one driver statement per read: no hop reads its ids first', async () => {
        let calls = 0;
        const real = driver.find.bind(driver);
        driver.find = (...a: unknown[]) => { calls += 1; return real(...a); };
        try {
          await engine.find(HOP_CASE, { where: { contact: { account: { region: { name: 'NA' } } } } });
        } finally {
          driver.find = real;
        }
        expect(calls).toBe(1);
      });
    },
  );
}

// ── [#33626] two tenants: related-object read restrictions are carried into the subquery, or the hop reads its ids ──

const TEN_CASE = 'rest_ten_case_33626';
const TEN_CONTACT = 'rest_ten_contact_33626';
const TEN_ACCOUNT = 'rest_ten_account_33626';
const TEN_REGION = 'rest_ten_region_33626';
const TEN_TICKET = 'rest_ten_ticket_33626';
const TEN_GRID = 'rest_ten_grid_33626';
const ORG_A = 'org_ten_a';
const ORG_B = 'org_ten_b';

/**
 * The region is tenant-scoped; the case, contact and account are no tenant's
 * (`tenancy.enabled: false`). Each tenant holds one NA region; each case
 * reaches its own tenant's region in one hop (`region`) and in three
 * (`contact` → `account` → `region`).
 */
const TEN_OBJECTS = [
  { name: TEN_REGION, label: 'Region T 33626', fields: { name: { name: 'name', type: 'text' as const } } },
  // The other direction: a tenant-scoped ticket on a grid that is no tenant's.
  { name: TEN_GRID, label: 'Grid T 33626', tenancy: { enabled: false }, fields: { name: { name: 'name', type: 'text' as const } } },
  { name: TEN_TICKET, label: 'Ticket T 33626', fields: { grid: { name: 'grid', type: 'lookup' as const, reference: TEN_GRID } } },
  {
    name: TEN_ACCOUNT, label: 'Account T 33626', tenancy: { enabled: false },
    fields: { region: { name: 'region', type: 'lookup' as const, reference: TEN_REGION } },
  },
  {
    name: TEN_CONTACT, label: 'Contact T 33626', tenancy: { enabled: false },
    fields: { account: { name: 'account', type: 'lookup' as const, reference: TEN_ACCOUNT } },
  },
  {
    name: TEN_CASE, label: 'Case T 33626', tenancy: { enabled: false },
    fields: {
      contact: { name: 'contact', type: 'lookup' as const, reference: TEN_CONTACT },
      region: { name: 'region', type: 'lookup' as const, reference: TEN_REGION },
    },
  },
];

const TEN_SEED: ReadonlyArray<readonly [string, ReadonlyArray<Record<string, unknown>>]> = [
  [TEN_REGION, [{ id: 'tr_a', name: 'NA', organization_id: ORG_A }, { id: 'tr_b', name: 'NA', organization_id: ORG_B }]],
  [TEN_ACCOUNT, [{ id: 'ta_a', region: 'tr_a' }, { id: 'ta_b', region: 'tr_b' }]],
  [TEN_CONTACT, [{ id: 'tc_a', account: 'ta_a' }, { id: 'tc_b', account: 'ta_b' }]],
  [TEN_CASE, [{ id: 'tk_a', contact: 'tc_a', region: 'tr_a' }, { id: 'tk_b', contact: 'tc_b', region: 'tr_b' }]],
  [TEN_GRID, [{ id: 'tg_1', name: 'NA' }]],
  [TEN_TICKET, [{ id: 'tt_a', grid: 'tg_1', organization_id: ORG_A }, { id: 'tt_b', grid: 'tg_1', organization_id: ORG_B }]],
];

/** name · the `where` on the case — both mean "my tenant's NA region". */
const TEN_HOPS: ReadonlyArray<readonly [string, FilterCondition]> = [
  ['one hop', { region: { name: 'NA' } }],
  ['three hops', { contact: { account: { region: { name: 'NA' } } } }],
];

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#33626] two tenants — a condition on tenant A's related rows never matches for a tenant B caller — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      let driver: any;
      const CALLER_B = { userId: 'u_ten_b', tenantId: ORG_B };

      const dropTables = async () => {
        if (cell.id === 'sqlite') return;
        for (const o of TEN_OBJECTS.map((x) => x.name).reverse()) await driver?.execute(`drop table if exists ${o}`).catch(() => {});
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTables();
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        for (const o of TEN_OBJECTS) engine.registry.registerObject(o as any);
        await engine.syncSchemas();
        await installDefaultOrganization(engine);
        // Seeded through the driver: each tenant's row carries its own organization.
        for (const [object, rows] of TEN_SEED) for (const row of rows) await driver.create(object, { ...row });
        // The organization wall: the related read of the region is walled to the caller's tenant.
        engine.setTenancyPostureProvider(() => 'isolated');
      });

      afterAll(async () => {
        await dropTables();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      /** The two-step route as the caller, hop by hop — what the id read answers. */
      const twoStep = async (hops: number): Promise<string[]> => {
        const ids = async (object: string, where: FilterCondition) =>
          (await engine.find(object, { where, fields: ['id'], context: CALLER_B })).map((r: any) => r.id);
        const regions = await ids(TEN_REGION, { name: 'NA' });
        if (hops === 1) return (await ids(TEN_CASE, { region: { $in: regions } })).sort();
        const accounts = await ids(TEN_ACCOUNT, { region: { $in: regions } });
        const contacts = await ids(TEN_CONTACT, { account: { $in: accounts } });
        return (await ids(TEN_CASE, { contact: { $in: contacts } })).sort();
      };

      it('CONTROL the region read is walled: tenant B reads its own NA region only', async () => {
        const regions = await engine.find(TEN_REGION, { where: { name: 'NA' }, context: CALLER_B });
        expect(regions.map((r: any) => r.id)).toEqual(['tr_b']);
      });

      for (const [name, where] of TEN_HOPS) {
        it(`${name}: only tenant B's case, exactly the two-step route's answer — on find and count`, async () => {
          const got = (await engine.find(TEN_CASE, { where, context: CALLER_B })).map((r: any) => r.id).sort();
          expect(got, name).toEqual(['tk_b']);
          expect(got, `two-step parity, ${name}`).toEqual(await twoStep(name === 'one hop' ? 1 : 3));
          expect(await engine.count(TEN_CASE, { where, context: CALLER_B }), `count, ${name}`).toBe(1);
        });
      }

      it('the other direction — a tenant-scoped ticket on a grid that is no tenant\'s: tenant B\'s ticket, the two-step route\'s answer, the grid read dispatched once', async () => {
        const grids = { n: 0 };
        const packageId = 'test.ten-grid-dispatch';
        engine.registerHook('beforeFind', async () => { grids.n += 1; }, { object: TEN_GRID, packageId });
        try {
          const idsAs = async (object: string, where: FilterCondition) =>
            (await engine.find(object, { where, fields: ['id'], context: CALLER_B })).map((r: any) => r.id).sort();
          const got = await idsAs(TEN_TICKET, { grid: { name: 'NA' } });
          expect(got).toEqual(['tt_b']);
          // Decided from the registry before planning: one dispatch of the grid read.
          expect(grids.n).toBe(1);
          expect(got, 'two-step parity').toEqual(await idsAs(TEN_TICKET, { grid: { $in: await idsAs(TEN_GRID, { name: 'NA' }) } }));
          expect(await engine.count(TEN_TICKET, { where: { grid: { name: 'NA' } }, context: CALLER_B }), 'count').toBe(1);
        } finally {
          engine.unregisterHooksByPackage(packageId);
        }
      });

      it('a read rule the region applies after its driver call gives the two-step route\'s answer', async () => {
        const hook = async (ctx: any) => { ctx.result = (ctx.result as any[]).filter((row) => row.id !== 'tr_b'); };
        engine.registerHook('afterFind', hook, { object: TEN_REGION, packageId: 'test.ten-region-rule' });
        try {
          for (const [name, where] of TEN_HOPS) {
            const got = (await engine.find(TEN_CASE, { where, context: CALLER_B })).map((r: any) => r.id).sort();
            expect(got, name).toEqual([]);
            expect(got, `two-step parity, ${name}`).toEqual(await twoStep(name === 'one hop' ? 1 : 3));
          }
        } finally {
          engine.unregisterHooksByPackage('test.ten-region-rule');
        }
      });
    },
  );
}

// ── [#33626] the executor boundary: driver options differ → id read, in both directions ──

const OPT_CASE = 'rest_opt_case_33626';
const OPT_REGION = 'rest_opt_region_33626';
const OPT_ORG_A = 'org_opt_a';
const OPT_ORG_B = 'org_opt_b';

/** Both objects are tenant-scoped: the registry cannot tell their driver options apart. */
const OPT_OBJECTS = [
  { name: OPT_REGION, label: 'Region O 33626', fields: { name: { name: 'name', type: 'text' as const } } },
  { name: OPT_CASE, label: 'Case O 33626', fields: { region: { name: 'region', type: 'lookup' as const, reference: OPT_REGION } } },
];

/** Each organization holds one NA region; each holds one case on its own region and one on the other's. */
const OPT_SEED: ReadonlyArray<readonly [string, ReadonlyArray<Record<string, unknown>>]> = [
  [OPT_REGION, [{ id: 'or_a', name: 'NA', organization_id: OPT_ORG_A }, { id: 'or_b', name: 'NA', organization_id: OPT_ORG_B }]],
  [OPT_CASE, [
    { id: 'ok_aa', region: 'or_a', organization_id: OPT_ORG_A }, { id: 'ok_ab', region: 'or_b', organization_id: OPT_ORG_A },
    { id: 'ok_ba', region: 'or_a', organization_id: OPT_ORG_B }, { id: 'ok_bb', region: 'or_b', organization_id: OPT_ORG_B },
  ]],
];

/**
 * name · the object whose read the recorded per-object verdict leaves
 * unscoped (`none`; the other is scoped to organization B) · the rows the
 * id read answers. Each direction has its own one-sided edit of the
 * boundary's comparison that would compose the leaf: a comparison reading
 * only the outer read's keys misses the first, only the related read's keys
 * the second.
 */
const OPT_DIRECTIONS: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ['the outer read is unscoped, the related read scoped', OPT_CASE, ['ok_ab', 'ok_bb']],
  ['the outer read is scoped, the related read unscoped', OPT_REGION, ['ok_ba', 'ok_bb']],
];

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#33626] the executor boundary — driver options differ → id read, in both directions — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      let driver: any;
      const CALLER_B = { userId: 'u_opt_b', tenantId: OPT_ORG_B };
      // The object a recorded verdict leaves unscoped, per direction.
      let unscoped: string | undefined;

      const dropTables = async () => {
        if (cell.id === 'sqlite') return;
        for (const o of OPT_OBJECTS.map((x) => x.name).reverse()) await driver?.execute(`drop table if exists ${o}`).catch(() => {});
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTables();
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        for (const o of OPT_OBJECTS) engine.registry.registerObject(o as any);
        await engine.syncSchemas();
        await installDefaultOrganization(engine);
        for (const [object, rows] of OPT_SEED) for (const row of rows) await driver.create(object, { ...row });
        engine.setTenancyPostureProvider(() => 'isolated');
        // A per-object verdict recorded for the request, as the security
        // layer records one on each read: the registry cannot predict it, so
        // the related read is planned and the boundary compares the options.
        engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
          if (unscoped !== undefined) {
            opCtx.tenantLayer0Verdict = opCtx.object === unscoped ? { kind: 'none' } : { kind: 'organization', organizationId: OPT_ORG_B };
          }
          return next();
        });
      });

      afterAll(async () => {
        await dropTables();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      /** The two-step route as the caller: the region ids, then the cases on them. */
      const twoStep = async (): Promise<string[]> => {
        const regions = (await engine.find(OPT_REGION, { where: { name: 'NA' }, fields: ['id'], context: CALLER_B })).map((r: any) => r.id);
        return (await engine.find(OPT_CASE, { where: { region: { $in: regions } }, fields: ['id'], context: CALLER_B })).map((r: any) => r.id).sort();
      };

      for (const [name, object, rows] of OPT_DIRECTIONS) {
        it(`${name}: the related ids are read at the boundary — exactly the two-step route's answer, on find and count`, async () => {
          unscoped = object;
          try {
            const where = { region: { name: 'NA' } };
            const got = (await engine.find(OPT_CASE, { where, context: CALLER_B })).map((r: any) => r.id).sort();
            expect(got, name).toEqual([...rows].sort());
            expect(got, `two-step parity, ${name}`).toEqual(await twoStep());
            expect(await engine.count(OPT_CASE, { where, context: CALLER_B }), `count, ${name}`).toBe(rows.length);
          } finally {
            unscoped = undefined;
          }
        });
      }
    },
  );
}
