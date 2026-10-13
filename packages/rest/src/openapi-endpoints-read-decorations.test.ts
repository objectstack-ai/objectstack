// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23083 — the OpenAPI reader re-parses a SERVED `api` item, so it strips the
 * read-time decorations before its closed parse.
 *
 * `GET /openapi.json` enumerates `api` items through `protocol.getMetaItems`,
 * whose served audience exits through `decorateMetadataItems` and stamps
 * `_diagnostics` on every item (`api` has a registered schema). Where no
 * endpoint matcher is reachable — a composition whose `metadata` slot is the
 * kernel's in-memory fallback, `@objectstack/verify`'s `bootStack` among them —
 * the handler hands those served items to `selectDocumentableEndpoints` as they
 * are, and the closed `ApiEndpointSchema` refused the platform's own badge by
 * name, `unrecognized_keys: ["_diagnostics"]`: every VALID declaration was
 * omitted from the document and logged at `error` as a declaration to fix.
 *
 * The fixtures are the platform's own output: `decorateMetadataItems` from
 * `@objectstack/metadata-protocol` is the producer the served read calls, so a
 * decoration it stamps is in the fixture without anyone editing this file.
 *
 * Controls, each the other half of a pin above it:
 *  - a truly invalid item is still omitted and logged — the strip launders
 *    nothing, and the refusal names the item's real defect;
 *  - the ADR-0010 envelope (`_packageId`, `_provenance`) parses exactly as it
 *    did — the closed schema allowlists it, so it is not a decoration;
 *  - an underscore key that is NOT a declared read decoration is still refused:
 *    the strip is `METADATA_READ_DECORATIONS`, never a blanket `_` prefix.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { ApiEndpointSchema } from '@objectstack/spec/api';
import { decorateMetadataItems } from '@objectstack/metadata-protocol';
import { enrichOpenApiWithEndpoints, selectDocumentableEndpoints } from './openapi-endpoints';
import { RestServer } from './rest-server';

// [#17865] The handler-level pin below observes the REST fault log, so this
// file declares the level it asserts against instead of inheriting the suite's
// quiet one. 'info' is the SHIPPED default — what a real caller gets.
beforeAll(() => { vi.stubEnv('OS_REST_LOG', 'info'); });
afterAll(() => { vi.unstubAllEnvs(); });
afterEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
// The showcase's two declarations, restated (not imported — an example app is
// not this package's dependency)
// ---------------------------------------------------------------------------

const TASK_FEED = {
  name: 'showcase_task_feed',
  path: '/api/v1/apps/showcase/tasks',
  method: 'GET',
  summary: 'Task feed',
  type: 'object_operation',
  objectParams: { object: 'showcase_task', operation: 'find' },
  authRequired: true,
  cacheTtlSeconds: 30,
};

const INQUIRY_PURGE = {
  name: 'showcase_inquiry_purge_api',
  path: '/api/v1/apps/showcase/inquiries/purge',
  method: 'POST',
  summary: 'Purge closed inquiries',
  type: 'flow',
  target: 'showcase_inquiry_purge',
  authRequired: true,
};

/** What the served read hands a reader: the producer's own decoration. */
function servedRead(items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return decorateMetadataItems('api', items.map((item) => ({ ...item })));
}

function collectingLogger() {
  return { error: vi.fn() };
}

function baseDoc() {
  return {
    openapi: '3.1.0',
    info: { title: 'ObjectStack API', version: '17.0.0' },
    paths: { '/api/meta': { get: { operationId: 'getMeta' } } },
    components: { schemas: {}, securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    security: [{ bearerAuth: [] }],
  };
}

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

describe('a valid declaration is documented however the read decorated it (#23083)', () => {
  it('documents both items exactly as the served read decorates them, and logs nothing', () => {
    const served = servedRead([TASK_FEED, INQUIRY_PURGE]);
    // Precondition: the fixture really carries the decoration, and the producer
    // itself calls both items valid — so a refusal here can only be the reader's.
    for (const item of served) expect(item._diagnostics).toEqual({ valid: true });

    const logger = collectingLogger();
    const kept = selectDocumentableEndpoints(served, logger);

    expect(kept.map((e) => e.name).sort()).toEqual(['showcase_inquiry_purge_api', 'showcase_task_feed']);
    expect(logger.error).not.toHaveBeenCalled();
    for (const endpoint of kept) expect(endpoint).not.toHaveProperty('_diagnostics');
  });

  it('documents an item carrying the draft badge, and logs nothing', () => {
    const logger = collectingLogger();
    const kept = selectDocumentableEndpoints([{ ...TASK_FEED, _draft: true }], logger);

    expect(kept.map((e) => e.name)).toEqual(['showcase_task_feed']);
    expect(logger.error).not.toHaveBeenCalled();
    expect(kept[0]).not.toHaveProperty('_draft');
  });

  it('folds the decorated declarations into the document as path entries', () => {
    const logger = collectingLogger();
    const out = enrichOpenApiWithEndpoints(baseDoc(), servedRead([TASK_FEED, INQUIRY_PURGE]), logger) as any;

    expect(out.paths['/api/v1/apps/showcase/tasks'].get.operationId).toBe('showcase_task_feed');
    expect(out.paths['/api/v1/apps/showcase/inquiries/purge'].post.operationId).toBe('showcase_inquiry_purge_api');
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('controls — the strip removes the declared decorations and nothing else', () => {
  it('still omits and logs a truly invalid item, naming its real defect', () => {
    const served = servedRead([{ ...TASK_FEED, name: 'bad_type', type: 'nope' }]);
    // The producer agrees it is invalid — the decoration rides on a bad item.
    expect((served[0]._diagnostics as { valid: boolean }).valid).toBe(false);

    const logger = collectingLogger();
    const kept = selectDocumentableEndpoints(served, logger);

    expect(kept).toEqual([]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toContain("'bad_type'");
    const { issues } = logger.error.mock.calls[0][1] as { issues: Array<{ code: string; path: unknown[]; keys?: string[] }> };
    // The refusal is about the item, not about our own badge.
    expect(issues.some((i) => i.path[0] === 'type')).toBe(true);
    expect(issues.some((i) => i.code === 'unrecognized_keys')).toBe(false);
  });

  it('parses the ADR-0010 envelope exactly as before, decorated or not', () => {
    const enveloped = { ...TASK_FEED, _packageId: 'com.example.showcase', _provenance: 'package' };
    const expected = ApiEndpointSchema.parse(enveloped);

    const logger = collectingLogger();
    const [plain] = selectDocumentableEndpoints([enveloped], logger);
    const [decorated] = selectDocumentableEndpoints(servedRead([enveloped]), logger);

    expect(plain).toEqual(expected);
    expect(decorated).toEqual(expected);
    expect(decorated._packageId).toBe('com.example.showcase');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('still refuses an underscore key that is not a declared read decoration', () => {
    const logger = collectingLogger();
    const kept = selectDocumentableEndpoints([{ ...TASK_FEED, _unexpected: true }], logger);

    expect(kept).toEqual([]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const { issues } = logger.error.mock.calls[0][1] as { issues: Array<{ code: string; keys?: string[] }> };
    expect(issues.find((i) => i.code === 'unrecognized_keys')?.keys).toEqual(['_unexpected']);
  });
});

// ---------------------------------------------------------------------------
// The production caller, on a composition with no endpoint matcher
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
 * The REST server with NO metadata service wired — the shape of a composition
 * whose `metadata` slot cannot answer `matchEndpoint` — over a protocol whose
 * `getMetaItems` answers what the served read answers.
 */
function mountWithoutMatcher(served: Array<Record<string, unknown>>) {
  const protocol: any = {
    getDiscovery: vi.fn().mockResolvedValue({
      version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
    }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn(async ({ type }: any) => {
      const t = String(type ?? '');
      if (t === 'api' || t === 'apis') return { type: 'api', items: served };
      return { type: t, items: [] };
    }),
    getMetaItem: vi.fn().mockResolvedValue({}),
    findData: vi.fn().mockResolvedValue([]),
  };
  const rest = new RestServer(
    createMockServer() as any,
    protocol,
    { api: { requireAuth: false, version: 'v1' } } as any,
  );
  // The description document denies anonymous callers; an identity is a
  // precondition of reaching the handler, not the subject here.
  (rest as any).resolveExecCtx = async () => ({ userId: 'u1' });
  rest.registerRoutes();
  (rest as any).registerOpenApiEndpoints('/api/v1');
  return rest;
}

async function getOpenApi(rest: any) {
  const entry = rest.routeManager.get('GET', '/api/v1/openapi.json');
  if (!entry) throw new Error('openapi.json route not registered');
  const res = makeRes();
  await entry.handler({ method: 'GET', headers: { host: 'example.test' }, params: {}, query: {}, path: '/api/v1/openapi.json' }, res);
  return res;
}

describe('GET /openapi.json with no endpoint matcher reachable', () => {
  it('lists both declared endpoints, and no error line names either of them', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rest = mountWithoutMatcher(servedRead([TASK_FEED, INQUIRY_PURGE]));

    const res = await getOpenApi(rest);

    expect(res.statusCode).toBe(200);
    const declared = Object.keys(res.body?.paths ?? {}).filter((p) => p.startsWith('/api/v1/apps/')).sort();
    expect(declared).toEqual(['/api/v1/apps/showcase/inquiries/purge', '/api/v1/apps/showcase/tasks']);

    const lines = errorSpy.mock.calls.map((args) => args.map(String).join(' '));
    expect(lines.filter((l) => l.includes('showcase_task_feed') || l.includes('showcase_inquiry_purge_api'))).toEqual([]);
  }, 60_000);
});
