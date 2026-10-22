// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25229] The Data API's page window — `$top` / `top` / `limit` and `$skip` /
 * `skip` / `offset` — is a non-negative integer on BOTH list doors
 * (`GET /data/:object`'s querystring, `POST /data/:object/query`'s body), or a
 * `400 INVALID_REQUEST` naming the parameter the caller wrote, before any read;
 * over a real `SqlDriver` (SQLite), five rows.
 *
 * Measured on the base (`345f0b154c`) over a stock showcase boot
 * (`showcase_account`, 14 rows, admin session), and again on the fix:
 *
 * | request | base | fix |
 * |:--|:--|:--|
 * | `GET ?$skip=-5`, `?$skip=-1&$top=3` | 500 `INTERNAL_ERROR` (knex `offset` throws) | 400 naming `$skip` |
 * | `POST {"offset":-5}` | 500 `INTERNAL_ERROR` | 400 naming `offset` |
 * | `GET ?$top=abc`, `?$top=-1`, `?$skip=abc` | 200, all 14 rows | 400 naming the spelling |
 * | `POST {"limit":-1}` | 200, all 14 rows | 400 naming `limit` |
 * | `GET ?$top=` | 200, 0 rows | 400 naming `$top` |
 * | `GET ?$skip=` | 200, all 14 rows | 400 naming `$skip` |
 * | `POST {"offset":1.5}` / `{"limit":1.5}` | 200, 13 rows / 1 row | 400 naming the key |
 * | `POST {"limit":"ten"}` | 400 `VALIDATION_FAILED` (the body schema) | unchanged |
 * | `POST {"limit":0}` | 200, 0 rows | unchanged |
 * | `GET ?$top=5&$skip=2`, `POST {"limit":5,"offset":2}` | 200, 5 rows | unchanged |
 *
 * The refusal lives once, in the shared normalizer both doors hand their
 * request to (`metadata-protocol`'s `findData`); the per-spelling pin with a
 * recording engine is that package's `protocol.page-window.test.ts`. This file
 * is the door-level half: the status and `code` each door answers, the
 * spelling it names, that the driver was never asked, and the controls paging
 * exactly as before.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'rest_page_window_25229';

const ITEMS = {
  name: OBJECT,
  label: 'Items 25229',
  fields: {
    label: { name: 'label', type: 'text' as const },
  },
};

const LABELS = ['a', 'b', 'c', 'd', 'e'];

/** name · the querystring `GET /data/:object` receives · the spelling the refusal names. */
const REFUSED_GET: ReadonlyArray<readonly [string, Record<string, string>, string]> = [
  ['$skip=-5 (the card)', { $skip: '-5' }, '$skip'],
  ['$skip=-1&$top=3 (the card)', { $skip: '-1', $top: '3' }, '$skip'],
  ['$skip=abc', { $skip: 'abc' }, '$skip'],
  ['$top=abc (the card)', { $top: 'abc' }, '$top'],
  ['$top=-1 (the card)', { $top: '-1' }, '$top'],
  ['$top= blank (the card)', { $top: '' }, '$top'],
  ['$top=1.5', { $top: '1.5' }, '$top'],
  ['top=abc', { top: 'abc' }, 'top'],
  ['skip=-1', { skip: '-1' }, 'skip'],
  ['limit=-1', { limit: '-1' }, 'limit'],
  ['offset=-1', { offset: '-1' }, 'offset'],
];

/** name · the JSON body `POST /data/:object/query` receives · the spelling the refusal names. */
const REFUSED_POST: ReadonlyArray<readonly [string, Record<string, unknown>, string]> = [
  ['offset: -5 (the card)', { offset: -5 }, 'offset'],
  ['limit: -1 (the card)', { limit: -1 }, 'limit'],
  ['offset: 1.5', { offset: 1.5 }, 'offset'],
  ['limit: 1.5', { limit: 1.5 }, 'limit'],
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

describe('[#25229] the page window on both list doors — sqlite', () => {
  let engine: ObjectQL;
  let driver: any;
  const reads = { n: 0 };
  let list: (query: Record<string, string>) => Promise<{ status: number; body: any }>;
  let query: (body: Record<string, unknown>) => Promise<{ status: number; body: any }>;

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(ITEMS as any);
    await engine.syncSchemas();
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);
    for (const label of LABELS) await engine.insert(OBJECT, { id: `r${label}`, label } as any);

    // Reads of THIS object — the protocol's own metadata traffic is not the question.
    for (const verb of ['find', 'findOne', 'count', 'aggregate'] as const) {
      const real = driver[verb].bind(driver);
      driver[verb] = (o: string, ...rest: unknown[]) => { if (o === OBJECT) reads.n += 1; return real(o, ...rest); };
    }

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const getRoute = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object');
    const postRoute = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
    expect(getRoute).toBeDefined();
    expect(postRoute).toBeDefined();
    list = async (q) => {
      const res = makeRes();
      // What a querystring carries: strings.
      await getRoute!.handler({ params: { object: OBJECT }, query: { $orderby: 'label', ...q }, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
    query = async (body) => {
      const res = makeRes();
      // What the wire carries: JSON.
      await postRoute!.handler({ params: { object: OBJECT }, body: JSON.parse(JSON.stringify({ orderBy: [{ field: 'label', order: 'asc' }], ...body })), query: {}, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  const labelsOf = (body: any): string[] => (body?.records ?? []).map((r: any) => r.label);

  it('GET: 400 INVALID_REQUEST naming the querystring spelling — no read', async () => {
    const before = reads.n;
    for (const [name, q, param] of REFUSED_GET) {
      const res = await list(q);
      expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code, name).toBe('INVALID_REQUEST');
      expect(res.body.error, name).toContain(`Query parameter '${param}' must be a non-negative integer`);
    }
    expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
  });

  it('POST: 400 INVALID_REQUEST naming the body key — no read', async () => {
    const before = reads.n;
    for (const [name, body, param] of REFUSED_POST) {
      const res = await query(body);
      expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code, name).toBe('INVALID_REQUEST');
      expect(res.body.error, name).toContain(`Query parameter '${param}' must be a non-negative integer`);
    }
    expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
  });

  it('POST: a non-number window is still the schema door\'s 400 VALIDATION_FAILED, unchanged', async () => {
    const res = await query({ limit: 'ten' });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('controls: a well-formed window pages exactly as before on both doors', async () => {
    const get = await list({ $top: '2', $skip: '1' });
    expect(get.status, JSON.stringify(get.body)).toBe(200);
    expect(labelsOf(get.body)).toEqual(['b', 'c']);

    const post = await query({ limit: 2, offset: 1 });
    expect(post.status, JSON.stringify(post.body)).toBe(200);
    expect(labelsOf(post.body)).toEqual(['b', 'c']);

    const bare = await list({ top: '2', skip: '3' });
    expect(labelsOf(bare.body)).toEqual(['d', 'e']);

    const noWindow = await list({});
    expect(labelsOf(noWindow.body)).toEqual(LABELS);

    // `0` is a count, not a malformed window: no rows, and still a 200.
    const zero = await query({ limit: 0 });
    expect(zero.status, JSON.stringify(zero.body)).toBe(200);
    expect(labelsOf(zero.body)).toEqual([]);
    const zeroSkip = await list({ $skip: '0', $top: '1' });
    expect(labelsOf(zeroSkip.body)).toEqual(['a']);
  });
});
