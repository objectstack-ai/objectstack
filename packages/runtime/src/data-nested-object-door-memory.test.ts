// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20745] The InMemoryDriver cell of the card's table, at the public door
 * (`POST /api/v1/data/:object/query`): a plain object with no `$`-operator key
 * beneath a relation field, a structured-JSON field or the platform-provisioned
 * `id` column answers `400 INVALID_FILTER` in the engine's words, and the
 * route the refusal names answers the rows the nested form meant.
 *
 * It lives here because this is the package that has both the in-memory
 * driver and the REST door (`@objectstack/rest` resolves to its source through
 * this package's alias); `@objectstack/rest`'s `data-nested-object-door.test.ts`
 * carries the SQLite and live-dialect cells of the same table, and
 * `@objectstack/objectql`'s `engine-nested-object-door.test.ts` every position,
 * verb and word.
 *
 * Measured on the base (`origin/main` `a51920f5fb`) on InMemoryDriver, three
 * rows (owner `u1`, region NA, on `d1` and `d3`): `{ owner: { region: 'NA' } }`
 * (and its master-detail, multiple-lookup, user and tree twins) answered 200
 * with NO rows; `{ meta: { a: 1 } }` answered 200 with `d1` (deep equality);
 * `{ id: { a: 1 } }` answered 200 with no rows. SQL refused all three in the
 * driver's words.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { InMemoryDriver } from '@objectstack/driver-memory';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from '@objectstack/rest';

const OBJECT = 'mem_nested_obj_20745';
const OWNER = 'mem_nested_own_20745';

const OWNER_OBJECT = { name: OWNER, label: 'Owner 20745', fields: { region: { name: 'region', type: 'text' } } };

const LEDGER = {
  name: OBJECT,
  label: 'Ledger 20745',
  fields: {
    title: { name: 'title', type: 'text' },
    owner: { name: 'owner', type: 'lookup', reference: OWNER },
    boss: { name: 'boss', type: 'master_detail', reference: OWNER },
    owners: { name: 'owners', type: 'lookup', reference: OWNER, multiple: true },
    meta: { name: 'meta', type: 'json' },
  },
};

const OWNERS = [{ id: 'u1', region: 'NA' }, { id: 'u2', region: 'EU' }];

const ROWS = [
  { id: 'd1', title: 'a', owner: 'u1', boss: 'u1', owners: ['u1'], meta: { a: 1 } },
  { id: 'd2', title: 'b', owner: 'u2', boss: 'u2', owners: ['u2'], meta: { a: 2 } },
  { id: 'd3', title: 'c', owner: 'u1', boss: 'u1', owners: ['u1', 'u2'], meta: { b: 1 } },
];

/** name · the `where` · the path the refusal names. */
const REFUSED: ReadonlyArray<readonly [string, FilterCondition, string]> = [
  ['a lookup (no rows before)', { owner: { region: 'NA' } }, 'where.owner'],
  ['a master-detail (no rows before)', { boss: { region: 'NA' } }, 'where.boss'],
  ['a multiple lookup (no rows before)', { owners: { region: 'NA' } }, 'where.owners'],
  ['a json field (one deep-equal row before)', { meta: { a: 1 } }, 'where.meta'],
  ['the id column (no rows before)', { id: { a: 1 } }, 'where.id'],
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

describe('[#20745] a no-operator object beneath a relation, JSON or id column at the public door — InMemoryDriver', () => {
  let engine: ObjectQL;
  const reads = { n: 0 };
  let query: (body: Record<string, unknown>, object?: string) => Promise<{ status: number; body: any }>;

  beforeAll(async () => {
    const driver: any = new InMemoryDriver();
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
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('where: every row of the card answers 400 INVALID_FILTER in the engine\'s words — no read', async () => {
    const before = reads.n;
    for (const [name, where, path] of REFUSED) {
      const res = await query({ where });
      expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code, name).toBe('INVALID_FILTER');
      expect(res.body.error, name).toContain(`at ${path},`);
      expect(res.body.error, name).toContain('The filter was NOT applied.');
    }
    expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
  });

  it('the named route answers the rows the nested form meant', async () => {
    const na = await query({ where: { region: 'NA' } }, OWNER);
    expect(na.status, JSON.stringify(na.body)).toBe(200);
    const ids = idsOf(na.body);
    expect(ids).toEqual(['u1']);
    for (const field of ['owner', 'boss']) {
      const res = await query({ where: { [field]: { $in: ids } } });
      expect(res.status, `${field}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(idsOf(res.body), field).toEqual(['d1', 'd3']);
    }
    const multiple = await query({ where: { owners: { $contains: ids[0] } } });
    expect(multiple.status, JSON.stringify(multiple.body)).toBe(200);
    expect(idsOf(multiple.body)).toEqual(['d1', 'd3']);
    const present = await query({ where: { meta: { $null: false } } });
    expect(idsOf(present.body)).toEqual(['d1', 'd2', 'd3']);
  });
});
