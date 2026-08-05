// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5224] The two machine-readable endpoint faces announce ONLY what the
// endpoint matcher will serve.
//
// ---------------------------------------------------------------------------
// The measured break
// ---------------------------------------------------------------------------
// On a real showcase boot (`objectstack dev --fresh`, 47 plugins) a single
// metadata write reproduced it end to end:
//
//   PUT  /api/v1/meta/api/e8_backdoor        -> 200 {"success":true,...}
//   GET  /api/v1/apps/showcase/backdoor      -> 404 (anonymous AND authenticated)
//   GET  /api/v1/meta/api                    -> 3 items, incl. e8_backdoor
//   GET  /api/v1/openapi.json                -> paths["/api/v1/apps/showcase/backdoor"]
//                                               = {"get":{...,"security":[]}}
//
// Two readers, two answers. The faces enumerate through
// `protocol.getMetaItems` (ObjectQL SchemaRegistry + `sys_metadata`); service
// is decided by `IMetadataService.matchEndpoint` -> `EndpointMatcher` ->
// `MetadataManager.listForIndex('api')` (the manager's registry + its
// registered loaders, `filesystem` / `memory` on dev and serve). A row written
// through the metadata write path lands only in the first, so the faces
// advertised an anonymous, unmetered endpoint that does not exist — and
// `/openapi.json` is what SDKs, codegen and AI clients generate from
// (AGENTS.md Route & surface ownership Rule 4, ADR-0076 D12).
//
// ---------------------------------------------------------------------------
// Why a real MetadataManager and not a stub
// ---------------------------------------------------------------------------
// Two of the three pins are only meaningful against the real matcher: pin (1)
// needs an item the manager genuinely cannot see, and pin (3) needs the #5189 /
// #5040 E7b load gate to genuinely exclude one. A stubbed authority would pin
// this file's own idea of those rules instead of the runtime's.
//
// ---------------------------------------------------------------------------
// Reverse verification, direction predicted BEFORE running
// ---------------------------------------------------------------------------
// Reverting the narrowing (documenting `apiItems` again, dropping the `api`
// branch in `GET /meta/:type`) turns pins (1) and (3) RED on both faces — they
// assert on absence that only the filter produces.
//
// Pin (2) is deliberately NOT of that shape and does not flip: a stack-artifact
// endpoint is announced before AND after. Stating that plainly matters more
// than a uniform-looking table — it is the no-collateral-damage guard, and a
// guard that changed colour with the fix would be pinning the fix rather than
// the invariant. Both predictions were confirmed by running it (see the PR).

import { describe, it, expect, vi } from 'vitest';
import { MetadataManager } from '@objectstack/metadata';
import { MemoryLoader } from '@objectstack/metadata';
import { RestServer } from './rest-server';

// ---------------------------------------------------------------------------
// The three declarations, each standing for one way a route can exist
// ---------------------------------------------------------------------------

/** (2) Published through a stack artifact — the matcher serves it. */
const SERVED = {
  name: 'showcase_task_feed',
  path: '/api/v1/apps/showcase/tasks',
  method: 'GET',
  summary: 'Task feed',
  type: 'object_operation',
  target: 'showcase_task',
  objectParams: { object: 'showcase_task', operation: 'find' },
  authRequired: true,
  _packageId: 'com.example.showcase',
  _provenance: 'package',
};

/**
 * (1) The measured row: written straight through the metadata write path, so
 * `getMetaItems` enumerates it and the matcher's index never contains it.
 */
const RUNTIME_WRITTEN = {
  name: 'e8_backdoor',
  path: '/api/v1/apps/showcase/backdoor',
  method: 'GET',
  type: 'object_operation',
  target: 'showcase_task',
  objectParams: { object: 'showcase_task', operation: 'find' },
  authRequired: false,
};

/**
 * (3) Reaches the matcher's store but is EXCLUDED at load by the identity-free
 * publish gates (#5189, #5040 E7b): ADR-0121 D6 forbids an anonymous endpoint
 * with no armed `rateLimit`, and the runtime honours `authRequired: false`
 * faithfully, so a bypassed D6 would mint an anonymous zero-quota entry point.
 * The gate makes it answer 404; this pins that the faces agree with the gate.
 */
const GATE_EXCLUDED = {
  name: 'anon_unmetered',
  path: '/api/v1/apps/showcase/open',
  method: 'GET',
  type: 'object_operation',
  target: 'showcase_task',
  objectParams: { object: 'showcase_task', operation: 'find' },
  authRequired: false,
};

const ALL_ENUMERATED = [SERVED, RUNTIME_WRITTEN, GATE_EXCLUDED];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

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
  res.header = vi.fn(() => res); res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
  return res;
}

/**
 * A metadata manager holding what a dev/serve boot's manager holds: the stack
 * artifact's endpoints and anything a plugin registered — never the
 * `sys_metadata` rows, which is the whole point.
 */
async function managerHolding(items: Array<Record<string, unknown>>): Promise<MetadataManager> {
  const manager = new MetadataManager({ formats: ['json'], loaders: [new MemoryLoader()] });
  for (const item of items) await manager.register('api', String(item.name), item);
  return manager;
}

/**
 * Mount the REST server with the endpoint-match authority wired exactly where
 * `rest-api-plugin` wires it — POSITIONALLY, so this also pins the parameter
 * slot the plugin passes it in.
 */
function mountRest(enumerated: Array<Record<string, unknown>>, authority: unknown | undefined) {
  const protocol: any = {
    getDiscovery: vi.fn().mockResolvedValue({
      version: 'v0', endpoints: { data: '', metadata: '', ui: '', auth: '/auth' },
    }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn(async ({ type }: any) => {
      const t = String(type ?? '');
      if (t === 'api' || t === 'apis') return { type: 'api', items: enumerated };
      return { type: t, items: [] };
    }),
    getMetaItem: vi.fn().mockResolvedValue({}),
    findData: vi.fn().mockResolvedValue([]),
  };

  const rest = new RestServer(
    createMockServer() as any,
    protocol,
    { api: { requireAuth: false, version: 'v1' } } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined,
    authority === undefined ? undefined : async () => authority,
  );
  // The metadata routes deny anonymous callers unconditionally (#3963); an
  // identity is a precondition of reaching the handler, not the subject here.
  (rest as any).resolveExecCtx = async () => ({ userId: 'u1' });
  rest.registerRoutes();
  (rest as any).registerOpenApiEndpoints('/api/v1');
  return { rest, protocol };
}

async function getMetaApi(rest: any, type = 'api', query: Record<string, unknown> = {}) {
  const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type');
  if (!route) throw new Error('meta/:type route not registered');
  const res = makeRes();
  await route.handler({ method: 'GET', params: { type }, query, body: {}, headers: {} }, res);
  return res;
}

async function getOpenApi(rest: any) {
  const entry = (rest as any).routeManager.get('GET', '/api/v1/openapi.json');
  if (!entry) throw new Error('openapi.json route not registered');
  const res = makeRes();
  await entry.handler({ method: 'GET', headers: { host: 'example.test' }, params: {}, query: {}, path: '/api/v1/openapi.json' }, res);
  return res;
}

const announcedNames = (body: any): string[] => {
  const list = Array.isArray(body) ? body : (body?.items ?? []);
  return list.map((i: any) => i?.name).sort();
};

const declaredPaths = (doc: any): string[] =>
  Object.keys(doc?.paths ?? {}).filter((p) => p.startsWith('/api/v1/apps/')).sort();

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

describe('#5224 — GET /meta/api announces only what the matcher serves', () => {
  it('omits the runtime-written row the matcher cannot see, and the gate-excluded one', async () => {
    const manager = await managerHolding([SERVED, GATE_EXCLUDED]);
    const { rest } = mountRest(ALL_ENUMERATED, manager);

    // Ground truth first: this is what the runtime will and will not serve.
    expect((await manager.matchEndpoint({ method: 'GET', path: SERVED.path }))?.endpoint.name)
      .toBe('showcase_task_feed');
    expect(await manager.matchEndpoint({ method: 'GET', path: RUNTIME_WRITTEN.path })).toBeUndefined();
    expect(await manager.matchEndpoint({ method: 'GET', path: GATE_EXCLUDED.path })).toBeUndefined();

    const res = await getMetaApi(rest);

    expect(res.statusCode).toBe(200);
    // Before the fix: ['anon_unmetered', 'e8_backdoor', 'showcase_task_feed'].
    expect(announcedNames(res.body)).toEqual(['showcase_task_feed']);
  }, 60_000);

  it('answers the STORED item, decorations intact — the narrowing is a filter, not a rewrite', async () => {
    const manager = await managerHolding([SERVED]);
    const { rest } = mountRest(ALL_ENUMERATED, manager);

    const res = await getMetaApi(rest);
    const item = (res.body?.items ?? res.body)[0];

    // `_packageId` / `_provenance` are what the Studio list reads; replacing
    // the row with the matcher's parsed value would drop them silently.
    expect(item._packageId).toBe('com.example.showcase');
    expect(item._provenance).toBe('package');
    expect(item.summary).toBe('Task feed');
  }, 60_000);

  it('applies to the PLURAL spelling too — `/meta/apis` is the canonical REST form', async () => {
    const manager = await managerHolding([SERVED]);
    const { rest } = mountRest(ALL_ENUMERATED, manager);

    expect(announcedNames((await getMetaApi(rest, 'apis')).body)).toEqual(['showcase_task_feed']);
  }, 60_000);

  it('leaves `?preview=draft` unfiltered — that surface answers "what is PENDING"', async () => {
    // A draft is by construction not served and not meant to look served, so
    // narrowing the drafts view to the served set would empty it of exactly the
    // items it exists to show. Codegen and SDK clients read the plain list.
    const manager = await managerHolding([SERVED]);
    const { rest } = mountRest(ALL_ENUMERATED, manager);

    expect(announcedNames((await getMetaApi(rest, 'api', { preview: 'draft' })).body))
      .toEqual(['anon_unmetered', 'e8_backdoor', 'showcase_task_feed']);
  }, 60_000);

  it('does not narrow any OTHER metadata type — the special case is `api`-only', async () => {
    const manager = await managerHolding([]);
    const { rest, protocol } = mountRest(ALL_ENUMERATED, manager);

    await getMetaApi(rest, 'view');
    // For every other type, "listed" and "in effect" are the same fact and the
    // enumerating reader already answered it; nothing extra is asked.
    expect(protocol.getMetaItems).toHaveBeenCalledWith(expect.objectContaining({ type: 'view' }));
  }, 60_000);

  it('reports a store outage rather than an empty declaration set', async () => {
    // `matchEndpoint` throws when its store cannot be read (contract; ADR-0110
    // D3). Answering 200 with zero items would state, confidently, that the
    // deployment declares no endpoints.
    const outage = { matchEndpoint: async () => { throw new Error('metadata store unreachable'); } };
    const { rest } = mountRest(ALL_ENUMERATED, outage);

    const res = await getMetaApi(rest);
    // The pin is that the request FAILS rather than answering a set. The exact
    // status is not this change's to decide: an unrecognised error reaching
    // `handleRouteError` lands on `mapDataError`'s terminal fallback, which
    // this route measured at 400 — a pre-existing classification shared by
    // every error on the metadata routes, not a consequence of the narrowing.
    // Asserting 5xx here would pin someone else's bug as if it were fixed.
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.body?.items ?? res.body).not.toEqual([SERVED]);
  }, 60_000);
});

describe('#5224 — GET /openapi.json documents only what the matcher serves', () => {
  it('drops the runtime-written path that used to ship with `security: []`', async () => {
    const manager = await managerHolding([SERVED, GATE_EXCLUDED]);
    const { rest } = mountRest(ALL_ENUMERATED, manager);

    const doc = (await getOpenApi(rest)).body;

    expect(declaredPaths(doc)).toEqual(['/api/v1/apps/showcase/tasks']);
    // The measured lie, gone: a path advertised as needing no credentials while
    // answering 404 propagates into every client generated from this document.
    expect(doc.paths['/api/v1/apps/showcase/backdoor']).toBeUndefined();
    expect(doc.paths['/api/v1/apps/showcase/open']).toBeUndefined();
  }, 60_000);

  it('keeps the served endpoint fully described — no collateral damage', async () => {
    const manager = await managerHolding([SERVED]);
    const { rest } = mountRest(ALL_ENUMERATED, manager);

    const op = (await getOpenApi(rest)).body.paths['/api/v1/apps/showcase/tasks'].get;

    expect(op.operationId).toBe('showcase_task_feed');
    expect(op.summary).toBe('Task feed');
    expect(op.responses['200']).toBeDefined();
    expect(op.responses['401']).toBeDefined();
    // `security: []` belongs ONLY to a genuinely anonymous served endpoint.
    expect(op.security).not.toEqual([]);
  }, 60_000);

  it('documents the MATCHER’s value when the two readers disagree about the same route', async () => {
    // The whole defect is that the two readers can hold different states of
    // the same `api` row. When they do, the document must describe the one the
    // runtime will act on — the matcher's parsed endpoint — not the enumerated
    // copy. Written as a discriminating pin on purpose: asserting only that
    // `authRequired` defaults to `true` would pass either way, because the
    // enrichment parses whatever it is handed.
    const stale = { ...SERVED, summary: 'STALE — the enumerated copy', authRequired: false };
    const manager = await managerHolding([SERVED]);
    const { rest } = mountRest([stale], manager);

    const op = (await getOpenApi(rest)).body.paths['/api/v1/apps/showcase/tasks'].get;
    expect(op.summary).toBe('Task feed');
    // …and therefore no `security: []` derived from the stale copy's
    // `authRequired: false`.
    expect(op.security).not.toEqual([]);
    expect(op.responses['401']).toBeDefined();
  }, 60_000);

  it('ships a document with no declared paths when the matcher serves nothing', async () => {
    const manager = await managerHolding([]);
    const { rest } = mountRest(ALL_ENUMERATED, manager);

    expect(declaredPaths((await getOpenApi(rest)).body)).toEqual([]);
  }, 60_000);
});

describe('#5224 — an ABSENT authority degrades loudly, never silently', () => {
  it('keeps enumerating and says so once when no matcher is reachable', async () => {
    // A host that never wired the metadata service cannot be told a verdict
    // that was never computed — inventing "nothing is served" would blank a
    // correct document. It falls back to the stored set and NAMES the loss.
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(String(a[0])); });
    try {
      const { rest } = mountRest(ALL_ENUMERATED, undefined);

      expect(announcedNames((await getMetaApi(rest)).body)).toHaveLength(3);
      expect(errors.some((e) => e.includes('no endpoint matcher is reachable'))).toBe(true);

      // Once per server, not once per request.
      const before = errors.filter((e) => e.includes('no endpoint matcher is reachable')).length;
      await getMetaApi(rest);
      await getOpenApi(rest);
      expect(errors.filter((e) => e.includes('no endpoint matcher is reachable')).length).toBe(before);
    } finally {
      spy.mockRestore();
    }
  }, 60_000);

  it('treats an occupant WITHOUT `matchEndpoint` as absent, not as "serves nothing"', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { rest } = mountRest(ALL_ENUMERATED, { register: () => undefined });
      expect(announcedNames((await getMetaApi(rest)).body)).toHaveLength(3);
    } finally {
      spy.mockRestore();
    }
  }, 60_000);
});
