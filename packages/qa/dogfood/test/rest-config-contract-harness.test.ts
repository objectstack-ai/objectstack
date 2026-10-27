// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26572] The `test`-oracle legs of the three RestServerConfig construction
// contracts the 18.2.0 Tier 1 sweep (#26468) scored half-asserted:
// `api-backend.rest-crud-config-contract`, `api-backend.rest-batch-config-contract`
// and `api-backend.rest-metadata-config-contract`.
//
// No shipped boot path authors a RestServerConfig (`os serve` fixes it, `os
// dev` passes none — the recorded posture, #15543), so every non-default
// clause is scored the way the items prescribe: construct a real RestServer
// with the config under test, `registerRoutes()`, and read the route table,
// the refusal texts and the protocol calls back. The `api` legs, on the
// default config, are in `rest-config-contract-live.dogfood.test.ts`.
//
// ## What each case pins
//
//   - crud acceptance[2]'s harness half: a switched-off operation leaves no
//     handler at all (set beside the live OBJECT_API_DISABLED body);
//   - crud acceptance[3]: at `dataPrefix: '/records'` the route table is the
//     default table with `/data` re-based — CRUD, data-action, sharing, import
//     and per-object batch routes alike — nothing is left under `/data`, and
//     discovery advertises `/api/v1/records`;
//   - crud acceptance[4]: `crud.patterns` and `crud.objectParamStyle` (both
//     former values) refuse at construction naming the key,
//     CrudEndpointsConfigSchema and each one's prescription;
//   - batch acceptance[5]: `batch.operations.upsertMany` and
//     `batch.defaultAtomic` (true AND false) refuse naming the key,
//     BatchEndpointsConfigSchema and the replacement;
//   - metadata acceptance[1]: at `prefix: '/metadata'` no route is left under
//     `/meta`, every metadata route re-bases, and discovery follows;
//   - metadata acceptance[4]: `enableCache` selects the cached item read, and
//     each of the seven carve-outs (app, dashboard, draft, preview-drafts,
//     package-scoped, member-addressed, audience-gated book/doc) takes the
//     uncached read with the switch still on;
//   - metadata acceptance[5]: `metadata.cacheTtl` at 3600, 0 and -1 and the
//     nested `metadata.endpoints.schema` refuse naming the key,
//     MetadataEndpointsConfigSchema and the replacement.

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from '@objectstack/runtime';

function mockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: unknown) => { res.body = b; return res; });
  res.header = vi.fn(() => res);
  res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
  return res;
}

/** A protocol double that records which item-read member the route calls. */
function protocolDouble() {
  return {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue([]),
    getMetaItem: vi.fn(async ({ type, name }: { type: string; name: string }) => ({ type, name, item: { name, label: name } })),
    getMetaItemCached: vi.fn(async ({ name }: { name: string }) => ({
      data: { name, label: name }, etag: { value: `etag_${name}`, weak: false }, notModified: false,
    })),
    findData: vi.fn().mockResolvedValue([]),
    batchData: vi.fn(), createManyData: vi.fn(), updateManyData: vi.fn(), deleteManyData: vi.fn(),
  };
}

function construct(config: Record<string, unknown>) {
  const protocol = protocolDouble();
  const rest = new RestServer(mockServer() as any, protocol as any, { api: { requireAuth: false }, ...config } as any);
  // A caller who may read pending drafts, so the two draft carve-outs are the
  // ones the route admits rather than a refusal.
  (rest as any).resolveExecCtx = async () => ({ userId: 'u1', isSystem: true, systemPermissions: [] });
  rest.registerRoutes();
  return { rest, protocol };
}

const routeTable = (rest: RestServer) =>
  (rest as any).getRoutes().map((r: { method: string; path: string }) => `${r.method} ${r.path}`).sort() as string[];

async function discoveryRoutes(rest: RestServer) {
  const route = (rest as any).getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/discovery');
  const res = makeRes();
  await route.handler({ method: 'GET', params: {}, query: {}, body: {}, headers: {} }, res);
  expect(res.statusCode).toBe(200);
  return (res.body?.data ?? res.body).routes as Record<string, string>;
}

/** The construction refusal, or a failure naming the silent strip ADR-0049 forbids. */
function refusalOf(config: Record<string, unknown>): string {
  try {
    construct(config);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error(`constructed cleanly with ${JSON.stringify(config)} — a tombstone was stripped instead of refused`);
}

const BASELINE = routeTable(construct({}).rest);

describe('[#26572] rest-crud-config-contract — the construction half, on a real RestServer', () => {
  it('acceptance[2]: a switched-off operation leaves no handler at all — the route is gone, not answering', () => {
    const table = routeTable(construct({ crud: { operations: { create: false } } }).rest);
    expect(table).not.toContain('POST /api/v1/data/:object');
    expect(BASELINE.filter((r) => !table.includes(r))).toEqual(['POST /api/v1/data/:object']);
  });

  it('acceptance[3]: `dataPrefix` re-bases the whole data surface, and nothing is left under /data', async () => {
    const { rest } = construct({ crud: { dataPrefix: '/records' } });
    const table = routeTable(rest);

    expect(table.filter((r) => r.includes('/api/v1/data'))).toEqual([]);
    const dataRoutes = BASELINE.filter((r) => r.includes('/api/v1/data/'));
    // CRUD, query, data actions, sharing, import and per-object batch all moved.
    expect(dataRoutes.length).toBeGreaterThanOrEqual(20);
    expect(dataRoutes).toEqual(expect.arrayContaining([
      'POST /api/v1/data/:object/query',
      'POST /api/v1/data/:object/:id/clone',
      'GET /api/v1/data/:object/:id/shares',
      'POST /api/v1/data/:object/createMany',
    ]));
    expect(table).toEqual(BASELINE.map((r) => r.replace('/api/v1/data/', '/api/v1/records/')).sort());

    expect((await discoveryRoutes(rest)).data).toBe('/api/v1/records');
  });

  it('acceptance[4]: both tombstones refuse at construction with the schema and the prescription', () => {
    const patterns = refusalOf({ crud: { patterns: { list: { method: 'GET', path: '/x' } } } });
    expect(patterns).toContain('`crud.patterns` was removed in @objectstack/spec 17');
    expect(patterns).toContain('CrudEndpointsConfigSchema');
    expect(patterns).toContain("an endpoint on a custom path or method is a declarative `api` endpoint (`type: 'object_operation'`");

    for (const style of ['path', 'query']) {
      const refusal = refusalOf({ crud: { objectParamStyle: style } });
      expect(refusal).toContain('`crud.objectParamStyle` was removed in @objectstack/spec 17');
      expect(refusal).toContain('CrudEndpointsConfigSchema');
      expect(refusal).toContain('the object name is always a path segment');
    }
  });
});

describe('[#26572] rest-batch-config-contract — the tombstones, on a real RestServer', () => {
  it('acceptance[5]: upsertMany and defaultAtomic (true and false) refuse with the schema and the replacement', () => {
    const upsert = refusalOf({ batch: { operations: { upsertMany: false } } });
    expect(upsert).toContain('`batch.operations.upsertMany` was removed in @objectstack/spec 17');
    expect(upsert).toContain('BatchEndpointsConfigSchema');
    expect(upsert).toContain('Upsert is an operation type of the generic `POST /data/:object/batch`');

    for (const value of [true, false]) {
      const atomic = refusalOf({ batch: { defaultAtomic: value } });
      expect(atomic).toContain('`batch.defaultAtomic` was removed in @objectstack/spec 17');
      expect(atomic).toContain('BatchEndpointsConfigSchema');
      expect(atomic).toContain('`options.atomic`');
      expect(atomic).toContain('sends `options: { atomic: true }`');
    }
  });
});

describe('[#26572] rest-metadata-config-contract — the construction half, on a real RestServer', () => {
  it('acceptance[1]: `prefix` re-bases every metadata route, nothing is left under /meta, and discovery follows', async () => {
    const { rest } = construct({ metadata: { prefix: '/metadata' } });
    const table = routeTable(rest);
    const underMeta = (r: string) => /\/api\/v1\/meta(\/|$)/.test(r);

    expect(table.filter(underMeta)).toEqual([]);
    expect(BASELINE.filter(underMeta).length).toBeGreaterThanOrEqual(19);
    expect(table).toEqual(BASELINE.map((r) => (underMeta(r) ? r.replace('/api/v1/meta', '/api/v1/metadata') : r)).sort());

    expect((await discoveryRoutes(rest)).metadata).toBe('/api/v1/metadata');
  });

  it('acceptance[4]: `enableCache` selects the cached read, and each carve-out bypasses it with the switch on', async () => {
    const read = async (enableCache: boolean, type: string, query: Record<string, string> = {}) => {
      const { rest, protocol } = construct({ metadata: { enableCache } });
      const route = (rest as any).getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type/:name');
      const res = makeRes();
      await route.handler({ method: 'GET', params: { type, name: 'probe' }, query, body: {}, headers: {} }, res);
      expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
      return { cached: protocol.getMetaItemCached.mock.calls.length, uncached: protocol.getMetaItem.mock.calls.length };
    };

    // The switch: on → the cached member, off → the uncached one.
    expect(await read(true, 'object')).toEqual({ cached: 1, uncached: 0 });
    expect(await read(false, 'object')).toEqual({ cached: 0, uncached: 1 });

    // Each carve-out, scored on its own, with the switch still on.
    const carveOuts: Array<[string, string, Record<string, string>?]> = [
      ['app type', 'app'],
      ['dashboard type', 'dashboard'],
      ['draft read', 'object', { state: 'draft' }],
      ['preview-drafts read', 'object', { preview: 'draft' }],
      ['package-scoped read', 'object', { package: 'com.example.showcase' }],
      ['member-addressed read', 'translation', { member: 'zh-CN' }],
      ['audience-gated book', 'book'],
      ['audience-gated doc', 'doc'],
    ];
    for (const [label, type, query] of carveOuts) {
      expect(await read(true, type, query), label).toEqual({ cached: 0, uncached: 1 });
    }
  });

  it('acceptance[5]: cacheTtl (3600, 0, -1) and endpoints.schema refuse with the schema and the replacement', () => {
    for (const cacheTtl of [3600, 0, -1]) {
      const refusal = refusalOf({ metadata: { cacheTtl } });
      expect(refusal).toContain('`metadata.cacheTtl` was removed in @objectstack/spec 17');
      expect(refusal).toContain('MetadataEndpointsConfigSchema');
      expect(refusal).toContain('`metadata.enableCache` is the live switch');
    }

    // A tombstone inside a live block: refused, not stripped while its siblings parse.
    const schema = refusalOf({ metadata: { endpoints: { schema: false } } });
    expect(schema).toContain('`metadata.endpoints.schema` was removed in @objectstack/spec 17');
    expect(schema).toContain('MetadataEndpointsConfigSchema');
    expect(schema).toContain('the REST server mounts no `GET /meta/:type/:name/schema`');
    expect(schema).toContain('`endpoints.types` / `items` / `item` / `maintenance` are the switches that gate real mounts');
  });
});
