// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29394] `$search` over an object whose declared `searchableFields` holds a
 * column that can never hold a string (`number`, `date`, `boolean`, `json`)
 * — on the Data API door, over a real `SqlDriver` (SQLite), the harness of
 * `data-search-fields-credential-door.test.ts`.
 *
 * Before: the engine's expansion emitted `$icontains` for every resolved
 * field. The #15661 declared-type door, which refuses a text operator over
 * such a column, judges only the caller's own `where`, so these clauses went
 * straight to the driver. The SQL family refuses a text operator on a JSON
 * column, so ONE `json` entry in the declared set failed EVERY search on the
 * object, however the term read, with a refusal about a predicate the caller
 * never wrote. (The numeric, boolean and temporal clauses were type-gated to
 * no-match beneath the door; a value-keyed face matched their text rendering
 * instead.)
 *
 * After: such a column contributes no clause (the door's own verdict,
 * `textOperatorDoorVerdict`). The text column still matches; a set of only
 * such columns answers no rows, 200, never an error and never every row.
 *
 * The dialect-neutral pin on the emitted AST is objectql's
 * `engine-search-non-text-column.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const MIXED = 'rest_search_non_text_mixed_29394';
const ONLY_NON_TEXT = 'rest_search_non_text_only_29394';
const AUTO_FLAGGED = 'rest_search_non_text_auto_29394';

const FIELDS = {
  name: { name: 'name', type: 'text' as const },
  qty: { name: 'qty', type: 'number' as const },
  born: { name: 'born', type: 'date' as const },
  active: { name: 'active', type: 'boolean' as const },
  meta: { name: 'meta', type: 'json' as const },
};

const ROWS = [
  { id: 'r1', name: 'qq9-alpha', qty: 42, born: '2026-01-05', active: true, meta: { k: 'qq9' } },
  { id: 'r2', name: 'qq9-beta', qty: 7, born: '2025-03-01', active: false, meta: { k: 'x' } },
  { id: 'r3', name: 'other', qty: 420, born: '2026-02-02', active: true, meta: { k: 'qq9' } },
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

describe('[#29394] $search over a declared non-text column on the Data API door — sqlite', () => {
  let engine: ObjectQL;
  let list: (object: string, query: Record<string, string>) => Promise<{ status: number; body: any }>;
  let query: (object: string, body: Record<string, unknown>) => Promise<{ status: number; body: any }>;

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: MIXED, label: 'Mixed 29394',
      searchableFields: ['name', 'qty', 'born', 'active', 'meta'],
      fields: FIELDS,
    } as any);
    engine.registry.registerObject({
      name: ONLY_NON_TEXT, label: 'Only non-text 29394',
      searchableFields: ['qty', 'born', 'active', 'meta'],
      fields: FIELDS,
    } as any);
    // The auto branch: no `searchableFields`, flagged non-text fields join the
    // set (ruling 6573569376 letter A) and must still contribute no clause.
    engine.registry.registerObject({
      name: AUTO_FLAGGED, label: 'Auto flagged 29394',
      fields: {
        name: FIELDS.name,
        qty: { ...FIELDS.qty, searchable: true },
        born: { ...FIELDS.born, searchable: true },
        meta: { ...FIELDS.meta, searchable: true },
      },
    } as any);
    await engine.syncSchemas();
    // A real `single` install's Default Organization (ADR-0131 D9, D1).
    await installDefaultOrganization(engine);
    for (const object of [MIXED, ONLY_NON_TEXT, AUTO_FLAGGED]) {
      for (const row of ROWS) {
        const { active: _active, ...rest } = row;
        await engine.insert(object, (object === AUTO_FLAGGED ? rest : { ...row }) as any);
      }
    }

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const getRoute = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object');
    expect(getRoute, 'GET /api/v1/data/:object').toBeDefined();
    list = async (object, q) => {
      const res = makeRes();
      // What a querystring carries: strings.
      await getRoute!.handler({ params: { object }, query: { $orderby: 'name', ...q }, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
    const postRoute = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
    expect(postRoute, 'POST /api/v1/data/:object/query').toBeDefined();
    query = async (object, body) => {
      const res = makeRes();
      // What the wire carries: JSON.
      await postRoute!.handler({ params: { object }, body: JSON.parse(JSON.stringify(body)), query: {}, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  const ids = (body: any) => (body?.records ?? []).map((r: any) => r.id);

  it('the card\'s shape: a term in the text column matches through it — 200, the two rows, GET and POST', async () => {
    const got = await list(MIXED, { $search: 'qq9' });
    expect(got.status, JSON.stringify(got.body)).toBe(200);
    expect(ids(got.body)).toEqual(['r1', 'r2']);

    const posted = await query(MIXED, { search: 'qq9' });
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    expect(ids(posted.body).sort()).toEqual(['r1', 'r2']);
  });

  it('a term found only in a non-text value\'s rendering matches nothing — 200, no rows', async () => {
    for (const term of ['42', '2026', 'true']) {
      const got = await list(MIXED, { $search: term });
      expect(got.status, `${term}: ${JSON.stringify(got.body)}`).toBe(200);
      expect(ids(got.body), term).toEqual([]);
    }
  });

  it('a set of only non-text columns answers no rows — 200, not an error, not every row', async () => {
    for (const term of ['qq9', '42']) {
      const got = await list(ONLY_NON_TEXT, { $search: term });
      expect(got.status, `${term}: ${JSON.stringify(got.body)}`).toBe(200);
      expect(ids(got.body), term).toEqual([]);
    }
    // Control: no search at all is every row.
    const all = await list(ONLY_NON_TEXT, {});
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(ids(all.body)).toHaveLength(3);
  });

  it('$searchFields naming a declared non-text column is accepted and matches nothing; beside the text column it matches through it', async () => {
    const narrowed = await list(MIXED, { $search: 'qq9', $searchFields: 'meta' });
    expect(narrowed.status, JSON.stringify(narrowed.body)).toBe(200);
    expect(ids(narrowed.body)).toEqual([]);

    const both = await list(MIXED, { $search: 'qq9', $searchFields: 'meta,name' });
    expect(both.status, JSON.stringify(both.body)).toBe(200);
    expect(ids(both.body)).toEqual(['r1', 'r2']);
  });

  it('the auto branch: flagged searchable: true number / date / json fields add no clause — the text column matches, 200', async () => {
    const got = await list(AUTO_FLAGGED, { $search: 'qq9' });
    expect(got.status, JSON.stringify(got.body)).toBe(200);
    expect(ids(got.body)).toEqual(['r1', 'r2']);
    const rendered = await list(AUTO_FLAGGED, { $search: '2026' });
    expect(rendered.status, JSON.stringify(rendered.body)).toBe(200);
    expect(ids(rendered.body)).toEqual([]);
    // The flag admits the field at the ingress door: naming it is accepted, and matches nothing.
    const named = await list(AUTO_FLAGGED, { $search: 'qq9', $searchFields: 'meta' });
    expect(named.status, JSON.stringify(named.body)).toBe(200);
    expect(ids(named.body)).toEqual([]);
  });

  it('control: the caller\'s own text operator on a non-text column is still refused by the #15661 door', async () => {
    const posted = await query(MIXED, { where: { qty: { $contains: '4' } } });
    expect(posted.status, JSON.stringify(posted.body)).toBe(400);
    expect(posted.body.code, JSON.stringify(posted.body)).toBe('INVALID_FILTER');
  });
});
