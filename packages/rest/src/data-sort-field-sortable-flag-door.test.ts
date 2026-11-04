// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29896] A field the author marks `sortable: false` is not sortable: the
 * served sortability projection says so, and the Data API door refuses a sort
 * on it with the same `400 INVALID_SORT` it already answers for a field the
 * projection calls unsortable (a virtual `formula`). Real `SqlDriver`
 * (SQLite), real `ObjectQL`, real protocol and the real `RestServer` routes —
 * the harness of `data-search-field-searchable-flag-door.test.ts`.
 *
 * Before (base eee41490): the projection served `nosort: { sortable: true }`
 * and `GET /api/v1/data/:object?sort=nosort` answered 200, sorted by the
 * column, while the same request over the formula field was refused
 * `400 INVALID_SORT`.
 *
 * Pinned here: the projection over the registered object and over the served
 * `GET /meta/object/:name` envelope, the card's sort (refused before any
 * driver read, on `sort`, `-sort` and `$orderby`), and the controls — a field
 * with no `sortable` key and a field with `sortable: true` still sort both
 * ways, and the formula refusal is unchanged.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { resolveObjectSortability } from '@objectstack/spec/api';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'rest_sort_flag_29896';

const FIELDS = {
  name: { name: 'name', type: 'text' as const },
  // The card's field: an author-declared unsortable column.
  nosort: { name: 'nosort', type: 'text' as const, sortable: false },
  // CONTROL — an explicit `sortable: true` keeps today's answer.
  rank: { name: 'rank', type: 'number' as const, sortable: true },
  // CONTROL — a virtual type the projection already calls unsortable.
  calc: { name: 'calc', type: 'formula' as const, expression: 'rank * 2' },
};

// `name` and `nosort` sort in opposite orders, so a sort by either is visible.
const ROWS = [
  { id: 'r1', name: 'alpha', nosort: 'zulu', rank: 3 },
  { id: 'r2', name: 'bravo', nosort: 'yankee', rank: 1 },
  { id: 'r3', name: 'charlie', nosort: 'xray', rank: 2 },
];

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {}, send: () => res,
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

describe('[#29896] field.sortable: false on the sortability projection and the Data API door — sqlite', () => {
  let engine: ObjectQL;
  let driver: any;
  let protocol: ObjectStackProtocolImplementation;
  const reads = { n: 0 };
  let list: (query: Record<string, string>) => Promise<{ status: number; body: any }>;
  let rest: RestServer;

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject({ name: OBJECT, label: 'Sort flag 29896', fields: FIELDS } as any);
    await engine.syncSchemas();
    // A real `single` install's Default Organization (ADR-0131 D9, D1).
    await installDefaultOrganization(engine);
    for (const row of ROWS) await engine.insert(OBJECT, row as any);

    for (const verb of ['find', 'findOne', 'count', 'aggregate'] as const) {
      const real = driver[verb].bind(driver);
      driver[verb] = (o: string, ...rest: unknown[]) => { if (o === OBJECT) reads.n += 1; return real(o, ...rest); };
    }

    protocol = new ObjectStackProtocolImplementation(engine as any);
    rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const getRoute = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object');
    expect(getRoute, 'GET /api/v1/data/:object').toBeDefined();
    list = async (q) => {
      const res = makeRes();
      // What a querystring carries: strings.
      await getRoute!.handler({ params: { object: OBJECT }, query: { ...q }, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  const names = (body: any) => (body?.records ?? []).map((r: any) => r.name);

  it('the projection over the registered object: `nosort` is unsortable, `name` and `rank` sortable, `calc` still virtual', () => {
    const { fields } = resolveObjectSortability(engine.registry.getObject(OBJECT));
    expect(fields.nosort).toEqual({ sortable: false, reason: 'author-declared' });
    expect(fields.name).toEqual({ sortable: true });
    expect(fields.rank).toEqual({ sortable: true });
    expect(fields.calc).toEqual({ sortable: false, reason: 'virtual-type' });
  });

  it('the served `GET /api/v1/meta/object/:name` envelope carries the same verdict', async () => {
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type/:name');
    expect(route, 'GET /api/v1/meta/:type/:name').toBeDefined();
    const served = {
      type: 'object', name: OBJECT, item: engine.registry.getObject(OBJECT),
      lock: 'none', editable: true, deletable: true, resettable: false,
    };
    // The registry is the protocol's object source; the envelope is the
    // producer's (meta-item-envelope.test.ts), over that registered object.
    const original = (protocol as any).getMetaItem;
    (protocol as any).getMetaItem = async () => served;
    try {
      const res = makeRes();
      await route!.handler({ params: { type: 'object', name: OBJECT }, query: {}, headers: {} } as any, res);
      expect(res._status ?? 200, JSON.stringify(res._json)).toBe(200);
      expect(res._json.sortability.fields.nosort).toEqual({ sortable: false, reason: 'author-declared' });
      expect(res._json.sortability.fields.name).toEqual({ sortable: true });
      expect(res._json.sortability).toEqual(resolveObjectSortability(res._json.item));
    } finally {
      (protocol as any).getMetaItem = original;
    }
  });

  it('the card\'s request: `sort=nosort` is 400 INVALID_SORT before any driver read', async () => {
    const requests: Array<Record<string, string>> = [
      { sort: 'nosort' }, { sort: '-nosort' }, { $orderby: 'nosort desc' }, { sort: 'name,nosort' },
    ];
    for (const q of requests) {
      const before = reads.n;
      const refused = await list(q);
      expect(refused.status, `${JSON.stringify(q)} -> ${JSON.stringify(refused.body)}`).toBe(400);
      expect(refused.body.code).toBe('INVALID_SORT');
      expect(refused.body.error).toContain("'nosort'");
      expect(reads.n - before, `${JSON.stringify(q)}: the refusal precedes the driver`).toBe(0);
    }
  });

  it('CONTROL — a field with no `sortable` key still sorts, both ways', async () => {
    const asc = await list({ sort: 'name' });
    expect(asc.status, JSON.stringify(asc.body)).toBe(200);
    expect(names(asc.body)).toEqual(['alpha', 'bravo', 'charlie']);
    const desc = await list({ sort: '-name' });
    expect(desc.status, JSON.stringify(desc.body)).toBe(200);
    expect(names(desc.body)).toEqual(['charlie', 'bravo', 'alpha']);
  });

  it('CONTROL — a field with `sortable: true` still sorts, both ways', async () => {
    const asc = await list({ sort: 'rank' });
    expect(asc.status, JSON.stringify(asc.body)).toBe(200);
    expect(names(asc.body)).toEqual(['bravo', 'charlie', 'alpha']);
    const desc = await list({ sort: '-rank' });
    expect(desc.status, JSON.stringify(desc.body)).toBe(200);
    expect(names(desc.body)).toEqual(['alpha', 'charlie', 'bravo']);
  });

  it('CONTROL — the virtual `formula` refusal is unchanged', async () => {
    const before = reads.n;
    const refused = await list({ sort: 'calc' });
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(refused.body.code).toBe('INVALID_SORT');
    expect(refused.body.error).toContain('a formula field');
    expect(reads.n - before, 'the refusal precedes the driver').toBe(0);
  });
});
