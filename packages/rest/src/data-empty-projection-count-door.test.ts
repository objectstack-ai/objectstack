// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26644] An empty projection and a count flag that is neither `true` nor
 * `false` are refused `400 VALIDATION_ERROR`, naming the parameter the caller
 * wrote, on every Data API door that hands its request to the shared normalizer
 * (`metadata-protocol`'s `findData` / `getData`) — over a real `SqlDriver`
 * (SQLite), three rows.
 *
 * Measured on the base (`0f3d068cf1`), and again on the fix:
 *
 * | request | base | fix |
 * |:--|:--|:--|
 * | `GET ?$select=`, `?$select=%20`, `?$select=,`, `?select=`, `?fields=` | 200, every column | 400 naming the spelling |
 * | `GET ?$count=maybe`, `?$count=1`, `?count=` (with `$top`) | 200, `total` reported | 400 naming the spelling |
 * | `POST {"select":""}`, `{"fields":[]}` | 200, every column | 400 naming the key at the body schema, `VALIDATION_FAILED` (`select` since #26909, `fields` since #27166) |
 * | `POST {"count":"maybe"}` | 400 `VALIDATION_FAILED` (the body schema) | unchanged |
 * | `GET /:id?select=`, `?select=,` | 200, every column | `VALIDATION_ERROR` naming `select`, at this route's 404 (it rewrote every 400, as for `?select=nope`); 400 since #26816 |
 * | `GET ?$select=label`, `?$count=true` / `false`, absent; `GET /:id?select=label` | 200 | unchanged |
 *
 * The per-spelling pin with a recording engine is `metadata-protocol`'s
 * `protocol.empty-projection-unknown-count.test.ts`. This file is the
 * door-level half: the status and `code` each door answers, the spelling it
 * names, that the driver was never asked, and the controls answering exactly
 * as before.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'rest_projection_count_26644';

const ITEMS = {
  name: OBJECT,
  label: 'Items 26644',
  fields: {
    label: { name: 'label', type: 'text' as const },
    note: { name: 'note', type: 'text' as const },
  },
};

const LABELS = ['a', 'b', 'c'];

/** name · the querystring `GET /data/:object` receives · the spelling the refusal names · its sentence. */
const REFUSED_GET: ReadonlyArray<readonly [string, Record<string, string>, string, string]> = [
  ['$select= blank (the card)', { $select: '' }, '$select', 'names no field'],
  ['$select= whitespace', { $select: ' ' }, '$select', 'names no field'],
  ['$select=, (the card)', { $select: ',' }, '$select', 'names no field'],
  ['select= blank (the card)', { select: '' }, 'select', 'names no field'],
  ['fields= blank', { fields: '' }, 'fields', 'names no field'],
  ['$count=maybe (the card)', { $top: '2', $count: 'maybe' }, '$count', 'must be true or false'],
  ['$count=1', { $top: '2', $count: '1' }, '$count', 'must be true or false'],
  ['count= blank', { $top: '2', count: '' }, 'count', 'must be true or false'],
];

/**
 * [#26909] The body's published schema (`FindDataRequestSchema`) now declares
 * the projection the normalizer enforces, so these are refused where every
 * other malformed body is: at the schema, `400 VALIDATION_FAILED`, `fields[0]`
 * naming `query.<key>`, and the member for a blank name (the #25269 precedent
 * for the page window).
 */
const REFUSED_POST_AT_SCHEMA: ReadonlyArray<readonly [string, Record<string, unknown>, string]> = [
  ['select: ""', { select: '' }, 'query.select'],
  ['$select: ","', { $select: ',' }, 'query.$select'],
  ['select: []', { select: [] }, 'query.select'],
  ['select: ["label", ""] (the blank member)', { select: ['label', ''] }, 'query.select.1'],
  // [#27166] The canonical `fields` takes the same arm on `QuerySchema` itself,
  // so it answers what its `$select` alias answers.
  ['fields: []', { fields: [] }, 'query.fields'],
  ['fields: ["label", " "] (the blank member)', { fields: ['label', ' '] }, 'query.fields.1'],
  // An `expand` entry is the same `QuerySchema`, so its empty projection is
  // refused at the body schema too, before the engine door would see it.
  ['expand entry fields: []', { expand: { owner: { object: 'sys_user', fields: [] } } }, 'query.expand.owner.fields'],
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

describe('[#26644] an empty projection and an unrecognised count flag on the Data API doors — sqlite', () => {
  let engine: ObjectQL;
  let driver: any;
  const reads = { n: 0 };
  let list: (query: Record<string, string>) => Promise<{ status: number; body: any }>;
  let query: (body: Record<string, unknown>) => Promise<{ status: number; body: any }>;
  let byId: (query: Record<string, string>) => Promise<{ status: number; body: any }>;

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(ITEMS as any);
    await engine.syncSchemas();
    // A real `single` install's Default Organization (ADR-0131 D9, D1).
    await installDefaultOrganization(engine);
    for (const label of LABELS) await engine.insert(OBJECT, { id: `r${label}`, label, note: `n-${label}` } as any);

    // Reads of THIS object — the protocol's own metadata traffic is not the question.
    for (const verb of ['find', 'findOne', 'count', 'aggregate'] as const) {
      const real = driver[verb].bind(driver);
      driver[verb] = (o: string, ...rest: unknown[]) => { if (o === OBJECT) reads.n += 1; return real(o, ...rest); };
    }

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const route = (method: string, path: string) => {
      const found = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
      expect(found, `${method} ${path}`).toBeDefined();
      return found!;
    };
    const getRoute = route('GET', '/api/v1/data/:object');
    const postRoute = route('POST', '/api/v1/data/:object/query');
    const idRoute = route('GET', '/api/v1/data/:object/:id');
    list = async (q) => {
      const res = makeRes();
      // What a querystring carries: strings.
      await getRoute.handler({ params: { object: OBJECT }, query: { $orderby: 'label', ...q }, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
    query = async (body) => {
      const res = makeRes();
      // What the wire carries: JSON.
      await postRoute.handler({ params: { object: OBJECT }, body: JSON.parse(JSON.stringify(body)), query: {}, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
    byId = async (q) => {
      const res = makeRes();
      await idRoute.handler({ params: { object: OBJECT, id: 'ra' }, query: q, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('GET list: 400 VALIDATION_ERROR naming the querystring spelling — no read', async () => {
    const before = reads.n;
    for (const [name, q, param, sentence] of REFUSED_GET) {
      const res = await list(q);
      expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code, name).toBe('VALIDATION_ERROR');
      expect(res.body.error, name).toContain(`Query parameter '${param}' ${sentence}`);
    }
    expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
  });

  it('POST query: `fields` / `select` / `$select` naming no field is the schema door\'s 400 VALIDATION_FAILED — no read', async () => {
    const before = reads.n;
    for (const [name, body, field] of REFUSED_POST_AT_SCHEMA) {
      const res = await query(body);
      expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code, name).toBe('VALIDATION_FAILED');
      expect(res.body.fields?.[0]?.field, name).toBe(field);
    }
    expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
  });

  it("POST query: an unrecognised count is still the schema door's 400 VALIDATION_FAILED, unchanged", async () => {
    const res = await query({ limit: 2, count: 'maybe' });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it("GET by id: VALIDATION_ERROR naming `select`, at the status this route gives every projection refusal — no read", async () => {
    // The same status as an unknown `select` field; the code is what differs.
    // That status is 400 since #26816 (the catch used to rewrite every 400
    // into a 404; `data-record-read-malformed-query-door.test.ts`).
    const unknownField = await byId({ select: 'nope' });
    expect(unknownField.body.code, JSON.stringify(unknownField.body)).toBe('INVALID_FIELD');
    expect(unknownField.status).toBe(400);
    const before = reads.n;
    for (const select of ['', ',']) {
      const res = await byId({ select });
      expect(res.status, `select=${JSON.stringify(select)}: ${JSON.stringify(res.body)}`).toBe(unknownField.status);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.error).toContain("Query parameter 'select' names no field");
    }
    expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
  });

  it('controls: a named projection and a true / false / absent count answer exactly as before', async () => {
    const projected = await list({ $select: 'label' });
    expect(projected.status, JSON.stringify(projected.body)).toBe(200);
    expect(projected.body.records.map((r: any) => r.label)).toEqual(LABELS);
    expect(projected.body.records.every((r: any) => !('note' in r))).toBe(true);

    const counted = await list({ $top: '2', $count: 'true' });
    expect(counted.status, JSON.stringify(counted.body)).toBe(200);
    expect(counted.body.total).toBe(3);

    const optedOut = await list({ $top: '2', $count: 'false' });
    expect(optedOut.status, JSON.stringify(optedOut.body)).toBe(200);
    expect('total' in optedOut.body).toBe(false);

    const absent = await list({ $top: '2' });
    expect(absent.body.total).toBe(3);

    const posted = await query({ select: 'label', limit: 2, count: true });
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    expect(posted.body.total).toBe(3);

    const one = await byId({ select: 'label' });
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    expect(one.body.record.label).toBe('a');
    expect('note' in one.body.record).toBe(false);

    const whole = await byId({});
    expect(whole.body.record.note).toBe('n-a');
  });
});
