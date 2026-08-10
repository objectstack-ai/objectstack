// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3899 ④ — the request-side gate, REST half: every route the catalog
 * (`plugin-rest-api.zod.ts`) declares a `requestSchema` for and
 * `@objectstack/rest` serves must answer a violating body with
 * `400 VALIDATION_FAILED` + `fields[]`, with the protocol NEVER invoked.
 *
 * The catalog is documentation with no runtime consumer, which is exactly how
 * its promises drifted from the mounts (#3899 ①): `requestSchema` strings sat
 * on routes that read `req.body || {}` raw, so a malformed body did not 400 —
 * it executed different semantics (an unfiltered full read on `/query`, a
 * garbage row reaching the engine on `/createMany`). These cases drive the
 * REAL registered handlers, and the completeness test is the ratchet: a new
 * catalog `requestSchema` on a rest-served route with no violating-body case
 * here fails the suite.
 *
 * Siblings: `packages/runtime/src/request-schema-gate.conformance.test.ts`
 * (dispatcher-served groups) and
 * `packages/spec/src/api/plugin-rest-api.schema-refs.test.ts` (names resolve;
 * requestSchema only on body-carrying methods).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_DATA_CRUD_ROUTES,
  DEFAULT_BATCH_ROUTES,
  DEFAULT_METADATA_ROUTES,
} from '@objectstack/spec/api';
import { RestServer } from './rest-server';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/** The catalog groups whose mounted routes @objectstack/rest serves. */
const REST_GROUPS = [DEFAULT_DATA_CRUD_ROUTES, DEFAULT_BATCH_ROUTES, DEFAULT_METADATA_ROUTES];

function createMockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn();
  return res;
}

function setup() {
  const spies = {
    findData: vi.fn().mockResolvedValue({ object: 'invoice', records: [] }),
    createData: vi.fn().mockResolvedValue({ object: 'invoice', id: 'r1', record: {} }),
    updateData: vi.fn().mockResolvedValue({ object: 'invoice', id: 'r1', record: {} }),
    batchData: vi.fn().mockResolvedValue({ success: true, total: 0, succeeded: 0, failed: 0, results: [] }),
    createManyData: vi.fn().mockResolvedValue({ object: 'invoice', records: [], count: 0 }),
    updateManyData: vi.fn().mockResolvedValue({ success: true, total: 0, succeeded: 0, failed: 0, results: [] }),
    deleteManyData: vi.fn().mockResolvedValue({ success: true, total: 0, succeeded: 0, failed: 0, results: [] }),
  };
  const protocol: any = {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue([{ name: 'invoice' }]),
    getMetaItem: vi.fn().mockResolvedValue({}),
    ...spies,
  };
  const rest = new RestServer(
    createMockServer() as any,
    protocol,
    { api: { requireAuth: false } } as any,
  );
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  return { rest, ...spies };
}

async function drive(rest: any, method: string, path: string, body: unknown, params: Record<string, string>) {
  const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
  if (!route) throw new Error(`route not registered: ${method} ${path}`);
  const res = makeRes();
  await route.handler({ method, params, query: {}, headers: {}, body }, res);
  return res;
}

interface GateCase {
  /** `METHOD prefix+path` exactly as the catalog spells it. */
  route: string;
  params: Record<string, string>;
  violating: unknown[];
  valid: unknown;
  spy: keyof ReturnType<typeof setup> & string;
}

const PARAMS = { object: 'invoice' };
const PARAMS_ID = { object: 'invoice', id: 'r1' };

/**
 * One case per rest-served catalog route with a `requestSchema`. The
 * completeness test below forces this table to keep up with the catalog.
 */
const CASES: GateCase[] = [
  {
    route: 'POST /api/v1/data/:object/query',
    params: PARAMS,
    violating: [
      'garbage',            // non-object body — used to become `query: 'garbage'`
      [{ limit: 5 }],       // array body
      { limit: 'ten' },     // mistyped clause — used to be forwarded as-is
      { joins: [] },        // retired key (#4286) — the tombstone must be audible
      // #6815 — the per-aggregation `distinct` flag, retired under ADR-0049.
      // It is the one retired key on this route that is NOT top-level: it sits
      // inside an `aggregations[]` entry, so the tombstone is only audible if
      // entry validation descends into the array. Before the retirement this
      // body parsed clean and answered a DEDUPLICATED sum on an in-memory
      // fallback and an ordinary sum on every SQL datasource — one query, two
      // numbers, both plausible.
      { aggregations: [{ function: 'sum', field: 'amount', alias: 'total', distinct: true }] },
    ],
    valid: { where: { status: 'active' }, limit: 5 },
    spy: 'findData',
  },
  {
    route: 'POST /api/v1/data/:object',
    params: PARAMS,
    violating: ['garbage', 42, [{ name: 'x' }]],
    valid: { name: 'ACME' },
    spy: 'createData',
  },
  {
    route: 'PATCH /api/v1/data/:object/:id',
    params: PARAMS_ID,
    violating: ['garbage', 42, [{ name: 'x' }]],
    valid: { name: 'ACME (renamed)' },
    spy: 'updateData',
  },
  {
    route: 'POST /api/v1/data/:object/batch',
    params: PARAMS,
    violating: [
      {},                                            // operation + records missing
      { operation: 'frobnicate', records: [] },      // not a batch operation
      { operation: 'update' },                       // records missing
      { operation: 'update', records: {} },          // records not an array
    ],
    valid: { operation: 'update', records: [{ id: 'r1', data: { name: 'z' } }] },
    spy: 'batchData',
  },
  {
    route: 'POST /api/v1/data/:object/createMany',
    params: PARAMS,
    violating: [
      { records: [{ name: 'a' }] },  // updateMany's envelope — an easy cross-route slip
      { name: 'a' },                 // a single record instead of an array
      'garbage',
    ],
    valid: [{ name: 'a' }, { name: 'b' }],
    spy: 'createManyData',
  },
  {
    route: 'POST /api/v1/data/:object/updateMany',
    params: PARAMS,
    violating: [{}, { records: [{}] }, { records: [{ id: 'r1' }] }],
    valid: { records: [{ id: 'r1', data: { name: 'z' } }] },
    spy: 'updateManyData',
  },
  {
    route: 'POST /api/v1/data/:object/deleteMany',
    params: PARAMS,
    violating: [{}, { ids: 'r1' }, { ids: [{ id: 'r1' }] }],
    valid: { ids: ['r1', 'r2'] },
    spy: 'deleteManyData',
  },
];

describe('#3899 ④ — rest routes with a declared requestSchema reject violating bodies', () => {
  it('every rest-served catalog requestSchema has a violating-body case (ratchet)', () => {
    const covered = new Set(CASES.map((c) => c.route));
    for (const group of REST_GROUPS) {
      for (const ep of group.endpoints ?? []) {
        if (!ep.requestSchema || !BODY_METHODS.has(ep.method)) continue;
        const route = `${ep.method} ${group.prefix}${ep.path}`;
        expect(
          covered.has(route),
          `${route} declares requestSchema '${ep.requestSchema}' but has no violating-body case in this suite — add one, or the declaration is a promise nothing checks`,
        ).toBe(true);
      }
    }
  });

  it('the ADR-0061 search wire contract stays valid: { search: string, searchFields: [...] }', async () => {
    // The first CI run of this gate rejected exactly this body: QuerySchema
    // declared only the structured `FullTextSearchSchema` form while the
    // executor and the ADR-0061 dogfood proof (`showcase-search.dogfood
    // .test.ts`) served the bare string + `searchFields`. The schema was the
    // wrong half — fixed there; pinned here so entry validation can never
    // again 400 the contract the conformance ledger declares enforced.
    const ctx = setup();
    const res = await drive(ctx.rest, 'POST', '/api/v1/data/:object/query',
      { search: 'retail', searchFields: ['industry'] }, PARAMS);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(ctx.findData).toHaveBeenCalledTimes(1);
  });

  for (const gateCase of CASES) {
    const [method, path] = gateCase.route.split(' ') as [string, string];
    describe(gateCase.route, () => {
      it('answers 400 VALIDATION_FAILED + fields[], protocol never called', async () => {
        for (const body of gateCase.violating) {
          const ctx = setup();
          const res = await drive(ctx.rest, method, path, body, gateCase.params);
          expect(
            res.statusCode,
            `${gateCase.route} accepted ${JSON.stringify(body)} (status ${res.statusCode}: ${JSON.stringify(res.body)})`,
          ).toBe(400);
          expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
          expect(Array.isArray(res.body.fields)).toBe(true);
          expect(res.body.fields.length).toBeGreaterThan(0);
          expect((ctx as any)[gateCase.spy]).not.toHaveBeenCalled();
        }
      });

      it('still serves a conforming body (the 400 above is the schema, not a broken route)', async () => {
        const ctx = setup();
        const res = await drive(ctx.rest, method, path, gateCase.valid, gateCase.params);
        expect(
          [200, 201].includes(res.statusCode),
          `expected 2xx, got ${res.statusCode}: ${JSON.stringify(res.body)}`,
        ).toBe(true);
        expect((ctx as any)[gateCase.spy]).toHaveBeenCalledTimes(1);
      });
    });
  }
});
