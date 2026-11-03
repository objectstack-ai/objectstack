// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29008] A field marked `searchable: true` is searched, and a `$searchFields`
 * override naming it is accepted, when its object declares no
 * `searchableFields` — over the Data API door on a real `SqlDriver` (SQLite),
 * the harness of `data-search-fields-credential-door.test.ts`.
 *
 * Ruling record 6573569376 (letter A): with no declaration, the set `search`
 * scans is the type-based auto-default plus every field marked
 * `searchable: true`, of any type except `secret` / `password` / `vector`, and
 * the ingress allow-list is the same set. Before, the card's three requests
 * answered `[]`, `[]`, then `400 INVALID_FIELD` "is not searchable … 'snippet'
 * is type 'code'" while the served schema said `searchable: true`.
 *
 * Pinned here: the card's three requests (the row comes back through `snippet`
 * and through `body`, and `$searchFields=snippet` answers 200 with it), and the
 * controls the ruling keeps — an unflagged `code` field is still neither
 * scanned nor accepted, a flagged `secret` is still refused, and an object
 * that DECLARES `searchableFields` keeps its declaration as the whole set.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

/** No declaration: the flag decides. */
const AUTO = 'rest_search_flag_auto_29008';
/** The same fields, under a declaration that names only `name`. */
const DECLARED = 'rest_search_flag_declared_29008';

const FIELDS = {
  name: { name: 'name', type: 'text' as const },
  snippet: { name: 'snippet', type: 'code' as const, searchable: true },
  body: { name: 'body', type: 'html' as const, searchable: true },
  // CONTROL — a `code` field NOT marked: the auto-default still skips its type.
  scratch: { name: 'scratch', type: 'code' as const },
  // CONTROL — a hard exclusion: the flag cannot admit a credential.
  api_key: { name: 'api_key', type: 'secret' as const, searchable: true },
};

const ROWS = [
  { id: 'r1', name: 'fs2 row', snippet: 'select QQCODE from x', body: '<p>holding QQHTML</p>', scratch: 'QQSCRATCH' },
  { id: 'r2', name: 'other row', snippet: 'select 1', body: '<p>nothing</p>', scratch: 'nothing' },
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

describe('[#29008] field.searchable: true on the Data API door — sqlite', () => {
  let engine: ObjectQL;
  let driver: any;
  const reads = { n: 0 };
  let list: (object: string, query: Record<string, string>) => Promise<{ status: number; body: any }>;

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject({ name: AUTO, label: 'Search flag auto 29008', fields: FIELDS } as any);
    engine.registry.registerObject({
      name: DECLARED, label: 'Search flag declared 29008', searchableFields: ['name'], fields: FIELDS,
    } as any);
    await engine.syncSchemas();
    // A real `single` install's Default Organization (ADR-0131 D9, D1).
    await installDefaultOrganization(engine);
    for (const object of [AUTO, DECLARED]) {
      for (const row of ROWS) await engine.insert(object, row as any);
    }

    const watched = new Set<string>([AUTO, DECLARED]);
    for (const verb of ['find', 'findOne', 'count', 'aggregate'] as const) {
      const real = driver[verb].bind(driver);
      driver[verb] = (o: string, ...rest: unknown[]) => { if (watched.has(o)) reads.n += 1; return real(o, ...rest); };
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
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  const names = (body: any) => (body?.records ?? []).map((r: any) => r.name);

  it('the card\'s three requests: found through `snippet`, through `body`, and `$searchFields=snippet` is 200', async () => {
    const byCode = await list(AUTO, { $search: 'QQCODE' });
    expect(byCode.status, JSON.stringify(byCode.body)).toBe(200);
    expect(names(byCode.body)).toEqual(['fs2 row']);

    const byHtml = await list(AUTO, { $search: 'QQHTML' });
    expect(byHtml.status, JSON.stringify(byHtml.body)).toBe(200);
    expect(names(byHtml.body)).toEqual(['fs2 row']);

    const narrowed = await list(AUTO, { $search: 'QQCODE', $searchFields: 'snippet' });
    expect(narrowed.status, JSON.stringify(narrowed.body)).toBe(200);
    expect(names(narrowed.body)).toEqual(['fs2 row']);
    // …and the narrowing is real: the html term is not in `snippet`.
    const narrowedMiss = await list(AUTO, { $search: 'QQHTML', $searchFields: 'snippet' });
    expect(narrowedMiss.status, JSON.stringify(narrowedMiss.body)).toBe(200);
    expect(names(narrowedMiss.body)).toEqual([]);
  });

  it('CONTROL — an unflagged `code` field is not scanned, and naming it is still 400 INVALID_FIELD before any read', async () => {
    const unscanned = await list(AUTO, { $search: 'QQSCRATCH' });
    expect(unscanned.status, JSON.stringify(unscanned.body)).toBe(200);
    expect(names(unscanned.body)).toEqual([]);

    const before = reads.n;
    const refused = await list(AUTO, { $search: 'QQSCRATCH', $searchFields: 'scratch' });
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(refused.body.code).toBe('INVALID_FIELD');
    expect(refused.body.error).toContain("Field 'scratch' on object '" + AUTO + "' is not searchable");
    expect(reads.n - before, 'the refusal precedes the driver').toBe(0);
  });

  it('CONTROL — a flagged `secret` stays excluded: naming it is 400 INVALID_FIELD before any read', async () => {
    const before = reads.n;
    const refused = await list(AUTO, { $search: 'QQKEY', $searchFields: 'api_key' });
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(refused.body.code).toBe('INVALID_FIELD');
    expect(reads.n - before, 'the refusal precedes the driver').toBe(0);
  });

  it('CONTROL — a declared `searchableFields` stays the whole set: the flag is not read there', async () => {
    const byCode = await list(DECLARED, { $search: 'QQCODE' });
    expect(byCode.status, JSON.stringify(byCode.body)).toBe(200);
    expect(names(byCode.body)).toEqual([]);

    const byName = await list(DECLARED, { $search: 'fs2' });
    expect(byName.status, JSON.stringify(byName.body)).toBe(200);
    expect(names(byName.body)).toEqual(['fs2 row']);

    const before = reads.n;
    const refused = await list(DECLARED, { $search: 'QQCODE', $searchFields: 'snippet' });
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(refused.body.code).toBe('INVALID_FIELD');
    expect(refused.body.error).toContain("The object declares 'searchableFields' (name)");
    expect(reads.n - before, 'the refusal precedes the driver').toBe(0);
  });
});
