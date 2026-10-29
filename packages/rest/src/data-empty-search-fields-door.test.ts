// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27484] A `searchFields` override naming no field — a blank or comma-only
 * string, an empty array — is refused `400 VALIDATION_ERROR`, naming the
 * parameter the caller wrote, on every Data API door that hands its search to
 * the shared normalizer (`metadata-protocol`'s `findData`) — over a real
 * `SqlDriver` (SQLite), three rows. The projection's envelope (#26644), so
 * `$searchFields` answers a value naming no field exactly as `$select` does
 * (`data-empty-projection-count-door.test.ts`).
 *
 * Before: the gate (`assertSearchFieldsAreSearchable`) read the empty override
 * as ABSENT, and the engine scanned the object's default search set, so
 * `?$search=n-&$searchFields=` answered 200 with every row the narrowing
 * `?$search=n-&$searchFields=label` excludes. The export route dropped a blank
 * value itself (`searchFields=` read as absent) before `findData` saw it.
 *
 * The per-spelling pin over the protocol is objectql's
 * `query-expression-conformance.test.ts`. This file is the door-level half:
 * the status and `code` each door answers, the spelling it names, that the
 * driver was never asked, and the controls answering exactly as before.
 *
 * [#27683] The body's published schema (`FindDataRequestSchema`) now declares
 * the override the normalizer enforces, so `POST /data/:object/query` refuses
 * an empty `searchFields` / `$searchFields` / `search.fields` where every other
 * malformed body is refused: at the schema, `400 VALIDATION_FAILED` naming
 * `query.KEY`, as an empty `select` is (`data-empty-projection-count-door.test.ts`).
 * The parity test at the end holds the schema door and the protocol door to
 * one refused set.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { FindDataRequestSchema } from '@objectstack/spec/api';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'rest_search_fields_27484';

const ITEMS = {
  name: OBJECT,
  label: 'Items 27484',
  fields: {
    label: { name: 'label', type: 'text' as const },
    note: { name: 'note', type: 'text' as const },
  },
};

const LABELS = ['a', 'b', 'c'];

/** The term every case searches: in every row's `note`, in no row's `label`. */
const TERM = 'n-';

/** name · the querystring `GET /data/:object` receives beside `$search` · the spelling the refusal names. */
const REFUSED_GET: ReadonlyArray<readonly [string, Record<string, string>, string]> = [
  ['$searchFields= blank (the card)', { $searchFields: '' }, '$searchFields'],
  ['$searchFields=, (the card)', { $searchFields: ',' }, '$searchFields'],
  ['$searchFields= whitespace and commas', { $searchFields: ' , ' }, '$searchFields'],
  ['searchFields= blank, unprefixed (the card)', { searchFields: '' }, 'searchFields'],
];

/**
 * name · the `POST /data/:object/query` body · the `fields[0].field` the body
 * schema's refusal names. [#27683] Refused at the schema, `VALIDATION_FAILED`;
 * they were the door's `VALIDATION_ERROR` before.
 */
const REFUSED_POST_AT_SCHEMA: ReadonlyArray<readonly [string, Record<string, unknown>, string]> = [
  ['searchFields: []', { search: TERM, searchFields: [] }, 'query.searchFields'],
  ['$searchFields: ""', { search: TERM, $searchFields: '' }, 'query.$searchFields'],
  ['$searchFields: " , "', { search: TERM, $searchFields: ' , ' }, 'query.$searchFields'],
  ['$searchFields: []', { search: TERM, $searchFields: [] }, 'query.$searchFields'],
  ['object-form search.fields: []', { search: { query: TERM, fields: [] } }, 'query.search.fields'],
];

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const chunks: string[] = [];
  const res: any = {
    write: (s: string) => { chunks.push(String(s)); return true; }, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  res._chunks = chunks;
  return res;
}

describe('[#27484] a searchFields override naming no field on the Data API doors — sqlite', () => {
  let engine: ObjectQL;
  let driver: any;
  let protocol: ObjectStackProtocolImplementation;
  const reads = { n: 0 };
  let list: (query: Record<string, string>) => Promise<{ status: number; body: any }>;
  let query: (body: Record<string, unknown>) => Promise<{ status: number; body: any }>;
  let exportCsv: (query: Record<string, string>) => Promise<{ status: number; body: any; rows: string[] }>;

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

    protocol = new ObjectStackProtocolImplementation(engine as any);
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
    const exportRoute = route('GET', '/api/v1/data/:object/export');
    list = async (q) => {
      const res = makeRes();
      // What a querystring carries: strings.
      await getRoute.handler({ params: { object: OBJECT }, query: { $orderby: 'label', $search: TERM, ...q }, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
    query = async (body) => {
      const res = makeRes();
      // What the wire carries: JSON.
      await postRoute.handler({ params: { object: OBJECT }, body: JSON.parse(JSON.stringify(body)), query: {}, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
    exportCsv = async (q) => {
      const res = makeRes();
      await exportRoute.handler({ params: { object: OBJECT }, query: { format: 'csv', search: TERM, ...q }, headers: {} } as any, res);
      const rows = res._chunks.join('').split(/\r?\n/).filter(Boolean).slice(1);
      return { status: res._status ?? 200, body: res._json, rows };
    };
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('GET list: 400 VALIDATION_ERROR naming the querystring spelling — no read', async () => {
    const before = reads.n;
    for (const [name, q, param] of REFUSED_GET) {
      const res = await list(q);
      expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code, name).toBe('VALIDATION_ERROR');
      expect(res.body.error, name).toContain(`Query parameter '${param}' names no field`);
    }
    expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
  });

  it("POST query: an empty override, either slot, is the schema door's 400 VALIDATION_FAILED naming the key — no read", async () => {
    const before = reads.n;
    for (const [name, body, field] of REFUSED_POST_AT_SCHEMA) {
      const res = await query(body);
      expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code, name).toBe('VALIDATION_FAILED');
      expect(res.body.fields?.[0]?.field, name).toBe(field);
    }
    expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
  });

  it('GET export: a blank or comma-only searchFields beside search is the same refusal — no read, no file', async () => {
    const before = reads.n;
    for (const searchFields of ['', ',']) {
      const res = await exportCsv({ searchFields });
      expect(res.status, `searchFields=${JSON.stringify(searchFields)}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.error).toContain("Query parameter 'searchFields' names no field");
      expect(res.rows).toEqual([]);
    }
    expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
  });

  it('controls: a named override narrows, an absent one scans the default set, exactly as before', async () => {
    const all = await list({});
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.records.map((r: any) => r.label)).toEqual(LABELS);

    const narrowed = await list({ $searchFields: 'label' });
    expect(narrowed.status, JSON.stringify(narrowed.body)).toBe(200);
    expect(narrowed.body.records).toEqual([]);

    const posted = await query({ search: TERM, searchFields: ['note'] });
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    expect(posted.body.records).toHaveLength(3);

    const exported = await exportCsv({});
    expect(exported.status).toBe(200);
    expect(exported.rows).toHaveLength(3);
    const exportedNarrowed = await exportCsv({ searchFields: 'label' });
    expect(exportedNarrowed.status).toBe(200);
    expect(exportedNarrowed.rows).toEqual([]);
  });

  /**
   * [#27683] The schema door (`FindDataRequestSchema`, which `POST
   * /data/:object/query` parses its body with) and the protocol door
   * (`findData`, which every other Data API door reaches without that schema)
   * refuse the same set as naming no field, probe for probe. A blank member
   * is outside it on both sides: the schema admits it and the door looks it
   * up, refusing it as an unknown field.
   */
  it('parity: the body schema refuses exactly the values the protocol door refuses as naming no field', async () => {
    const STRINGS = ['', '   ', ',', ' , ', ',,', 'label', ' label , note ', 'label,,'];
    const LISTS = [[], [''], ['label'], ['label', 'note']];
    const probes: Array<[string, Record<string, unknown>]> = [
      ...[...STRINGS, ...LISTS].map((v): [string, Record<string, unknown>] => [`$searchFields: ${JSON.stringify(v)}`, { search: TERM, $searchFields: v }]),
      ...LISTS.map((v): [string, Record<string, unknown>] => [`searchFields: ${JSON.stringify(v)}`, { search: TERM, searchFields: v }]),
      ...LISTS.map((v): [string, Record<string, unknown>] => [`search.fields: ${JSON.stringify(v)}`, { search: { query: TERM, fields: v } }]),
    ];
    const verdicts: string[] = [];
    for (const [name, bag] of probes) {
      const schemaRefuses = !FindDataRequestSchema.safeParse({ object: OBJECT, query: { object: OBJECT, ...bag } }).success;
      // The protocol door's answer: served, or the refusal's code.
      let door = 'served';
      try {
        await protocol.findData({ object: OBJECT, query: JSON.parse(JSON.stringify(bag)) } as any);
      } catch (e: any) {
        door = e?.code === 'VALIDATION_ERROR' && /names no field/.test(String(e?.message)) ? 'names no field' : String(e?.code);
      }
      expect(schemaRefuses, `${name}: schema ${schemaRefuses ? 'refuses' : 'admits'}, door ${door}`).toBe(door === 'names no field');
      verdicts.push(`${name} → ${door}`);
    }
    // Neither side is vacuous: 8 refused as naming no field, every other probe
    // served, except the blank member the door refuses by name.
    expect(verdicts.filter((v) => v.endsWith('→ names no field'))).toHaveLength(8);
    expect(verdicts.filter((v) => v.endsWith('→ served'))).toHaveLength(9);
    expect(verdicts.filter((v) => v.endsWith('→ INVALID_FIELD'))).toEqual([
      '$searchFields: [""] → INVALID_FIELD', 'searchFields: [""] → INVALID_FIELD', 'search.fields: [""] → INVALID_FIELD',
    ]);
  });
});
