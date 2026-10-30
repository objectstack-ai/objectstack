// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27829] A `$searchFields` entry naming a CREDENTIAL field (`secret` /
 * `password`) is refused `400 INVALID_FIELD` at the Data API door, naming the
 * field, even when the object's own `searchableFields` declares it — over a
 * real `SqlDriver` (SQLite), the harness of `data-empty-search-fields-door.test.ts`.
 *
 * Before: the door (`assertSearchFieldsAreSearchable`) resolved the allowed set
 * from the declaration, which kept the credential entry, so the request passed;
 * the engine then withheld the credential column from the scan (ADR-0100) and,
 * by its tolerant intersection, searched the REST of the declared set.
 * `?$search=…&$searchFields=api_key` answered 200 with rows matched in `name` —
 * a narrower search answered with a wider one. The engine's withhold stays as
 * the fail-closed floor; this file pins the door's half: the status, `code`,
 * named field, that the driver was never asked, and the controls unchanged.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

/** object name · the credential type its `api_key` field carries. */
const OBJECTS = [
  ['rest_search_credential_secret_27829', 'secret'],
  ['rest_search_credential_password_27829', 'password'],
] as const;

const NAMES = ['qq7-a', 'qq7-b', 'other'];

/** The term every case searches: in two rows' `name`. */
const TERM = 'qq7';

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

describe('[#27829] $searchFields naming a declared credential field on the Data API door — sqlite', () => {
  let engine: ObjectQL;
  let driver: any;
  const reads = { n: 0 };
  let list: (object: string, query: Record<string, string>) => Promise<{ status: number; body: any }>;
  let query: (object: string, body: Record<string, unknown>) => Promise<{ status: number; body: any }>;

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    for (const [name, ctype] of OBJECTS) {
      engine.registry.registerObject({
        name,
        label: `Credential ${ctype} 27829`,
        searchableFields: ['name', 'api_key'],
        fields: {
          name: { name: 'name', type: 'text' as const },
          api_key: { name: 'api_key', type: ctype },
        },
      } as any);
    }
    await engine.syncSchemas();
    // A real `single` install's Default Organization (ADR-0131 D9, D1).
    await installDefaultOrganization(engine);
    for (const [object] of OBJECTS) {
      for (const [i, name] of NAMES.entries()) await engine.insert(object, { id: `r${i}`, name } as any);
    }

    const watched = new Set<string>(OBJECTS.map(([o]) => o));
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
      await getRoute!.handler({ params: { object }, query: { $orderby: 'name', $search: TERM, ...q }, headers: {} } as any, res);
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

  for (const [object, ctype] of OBJECTS) {
    it(`${ctype}: $searchFields=api_key and $searchFields=name,api_key are 400 INVALID_FIELD naming api_key — no read`, async () => {
      const before = reads.n;
      for (const searchFields of ['api_key', 'name,api_key']) {
        const res = await list(object, { $searchFields: searchFields });
        const label = `$searchFields=${searchFields}: ${JSON.stringify(res.body)}`;
        expect(res.status, label).toBe(400);
        expect(res.body.code, label).toBe('INVALID_FIELD');
        expect(res.body.error, label).toContain(`Field 'api_key' on object '${object}' is type '${ctype}'`);
      }
      expect(reads.n - before, 'no read of the object — the refusal precedes the driver').toBe(0);
    });

    it(`${ctype}: POST query — searchFields and the object-form search.fields naming api_key are the same refusal — no read`, async () => {
      const before = reads.n;
      for (const body of [{ search: TERM, searchFields: ['api_key'] }, { search: { query: TERM, fields: ['name', 'api_key'] } }]) {
        const res = await query(object, body);
        const label = `${JSON.stringify(body)}: ${JSON.stringify(res.body)}`;
        expect(res.status, label).toBe(400);
        expect(res.body.code, label).toBe('INVALID_FIELD');
        expect(res.body.error, label).toContain(`Field 'api_key' on object '${object}' is type '${ctype}'`);
      }
      expect(reads.n - before, 'no read of the object — the refusal precedes the driver').toBe(0);
    });

    it(`${ctype}: controls — $searchFields=name narrows, no $searchFields searches the declared set, as before`, async () => {
      const narrowed = await list(object, { $searchFields: 'name' });
      expect(narrowed.status, JSON.stringify(narrowed.body)).toBe(200);
      expect(narrowed.body.records.map((r: any) => r.name)).toEqual(['qq7-a', 'qq7-b']);

      const all = await list(object, {});
      expect(all.status, JSON.stringify(all.body)).toBe(200);
      expect(all.body.records.map((r: any) => r.name)).toEqual(['qq7-a', 'qq7-b']);

      const posted = await query(object, { search: TERM, searchFields: ['name'] });
      expect(posted.status, JSON.stringify(posted.body)).toBe(200);
      expect(posted.body.records).toHaveLength(2);
    });
  }
});
