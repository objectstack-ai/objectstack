// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `GET {basePath}/openapi.json` at the route level (#5040 E6, #5078, #5588).
 *
 * The pure enrichment is unit-tested in `openapi-endpoints.test.ts` and the
 * pure built-in section in `openapi-builtin-paths.test.ts`; what this file
 * covers is the part only the server can answer — that the handler really asks
 * the protocol for `api` items alongside `object` items, that with the empty
 * set the world's response is unchanged, and (since #5588) that the built-in
 * section the document publishes is THIS server's route table rather than the
 * static artifact's stale one.
 *
 * This route has ONE owner. #5078 established it with a real boot after a
 * shadow `generateOpenApi` branch in the dispatcher had spent months looking
 * like a second one; these assertions are the cheap standing version of that
 * boot, so the ownership claim stops depending on somebody re-running it.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';
import { toTemplatePath } from './openapi-builtin-paths';

function makeServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn(), close: vi.fn(),
  } as any;
}

/**
 * A protocol that records which metadata types were enumerated and answers
 * each from `items`, in the `{ type, items }` envelope `getMetaItems` declares.
 */
function makeProtocol(items: Record<string, unknown[]>) {
  const asked: string[] = [];
  const protocol: any = {
    getMetaItems: vi.fn(async ({ type }: { type: string }) => {
      asked.push(type);
      return { type, items: items[type] ?? [] };
    }),
  };
  return { protocol, asked };
}

/**
 * A server with its REAL route surface mounted.
 *
 * `registerRoutes()` rather than the private `registerOpenApiEndpoints` alone:
 * since #5588 the document's built-in section IS the route table, so a server
 * with only the openapi route mounted would be answering a different question
 * than the one production asks.
 */
function makeRest(protocol: any, config: Record<string, unknown> = {}) {
  const rest = new RestServer(
    makeServer(),
    protocol,
    { api: { requireAuth: false, version: 'v1', ...config } } as any,
  );
  rest.registerRoutes();
  return rest;
}

/** Drive the registered `GET {base}/openapi.json` handler and read the body. */
async function serveOpenApiFrom(rest: RestServer, base = '/api/v1') {
  const entry = (rest as any).routeManager.get('GET', `${base}/openapi.json`);
  expect(entry, 'the openapi.json route must be registered by this package').toBeDefined();

  let status = 200;
  let body: any;
  const res: any = {
    status: (c: number) => { status = c; return res; },
    json: (b: any) => { body = b; },
    setHeader: () => {},
    send: () => {},
  };
  await entry.handler({ headers: { host: 'example.test' }, params: {}, path: `${base}/openapi.json` }, res);
  return { status, body };
}

async function serveOpenApi(protocol: any) {
  return serveOpenApiFrom(makeRest(protocol));
}

const TASKS_ENDPOINT = {
  name: 'list_tasks',
  path: '/api/v1/apps/showcase/tasks',
  method: 'GET',
  type: 'object_operation',
  target: 'showcase_task',
  objectParams: { object: 'showcase_task', operation: 'find' },
  summary: 'List showcase tasks',
};

describe('GET /api/v1/openapi.json — endpoint enrichment', () => {
  it('enumerates `api` items alongside `object` items', async () => {
    const { protocol, asked } = makeProtocol({ object: [], api: [] });
    await serveOpenApi(protocol);
    expect(asked).toContain('object');
    expect(asked).toContain('api');
  });

  it('serves a document identical to the pre-#5093 one while no endpoint is declared', async () => {
    // The load-bearing invariant: a deployment that declares no endpoint must
    // not be able to tell the enrichment step exists. Since the #5040 E7
    // publish flip this is no longer the only state in production — endpoints
    // do publish — which is exactly why the no-declaration state needs pinning
    // rather than assuming. Compared against the same
    // handler fed a protocol with no `api` capability at all — i.e. the world
    // exactly as it was before the enrichment step existed.
    const withEmptyApis = await serveOpenApi(makeProtocol({ object: [], api: [] }).protocol);
    const withoutApiSupport = await serveOpenApi({ getMetaItems: vi.fn(async () => ({ type: 'object', items: [] })) });

    expect(withEmptyApis.status).toBe(200);
    expect(JSON.stringify(withEmptyApis.body)).toBe(JSON.stringify(withoutApiSupport.body));
  });

  it('adds one path entry per declared endpoint', async () => {
    const { protocol } = makeProtocol({ object: [], api: [TASKS_ENDPOINT] });
    const { body } = await serveOpenApi(protocol);
    const item = body.paths['/api/v1/apps/showcase/tasks'];
    expect(item).toBeDefined();
    expect(item.get.operationId).toBe('list_tasks');
    expect(item.get.summary).toBe('List showcase tasks');
    // `authRequired` defaults to true, so it points at the document's scheme.
    expect(item.get.security).toEqual(body.security);
  });

  it('still serves the document when the api enumeration throws', async () => {
    // A metadata store outage must cost the endpoint section, never the
    // document — the base spec and the object expansion are independent of it.
    const protocol: any = {
      getMetaItems: vi.fn(async ({ type }: { type: string }) => {
        if (type === 'api') throw new Error('store unavailable');
        return { type, items: [] };
      }),
    };
    const { status, body } = await serveOpenApi(protocol);
    expect(status).toBe(200);
    expect(body.openapi).toBe('3.1.0');
  });

  it('keeps serving `{object}` expansion unchanged alongside the new step', async () => {
    const { protocol } = makeProtocol({ object: [{ name: 'showcase_task' }], api: [] });
    const { body } = await serveOpenApi(protocol);
    const expanded = Object.keys(body.paths).filter((p) => p.includes('showcase_task'));
    expect(expanded.length).toBeGreaterThan(0);
    // The template row survives, marked, exactly as before — but it is now the
    // template of a route that EXISTS. Before #5588 this assertion read
    // `body.paths['/api/{object}']`, a path the server 404s (0/10 of the old
    // section's operations were reachable); the expansion machinery is
    // unchanged, what it expands is finally real.
    expect(body.paths['/api/v1/data/{object}']['x-template']).toBe(true);
    expect(body.paths['/api/v1/data/showcase_task']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// #5588 — the built-in section is this server's route table
// ---------------------------------------------------------------------------

/** Paths the OLD, spec-authored built-in section published. All 10 404'd. */
const PHANTOM_PATHS = [
  '/api/{object}',
  '/api/{object}/{id}',
  '/api/meta',
  '/api/meta/types',
  '/api/meta/{type}',
  '/api/meta/{type}/{name}',
  '/api/.well-known/objectstack',
];

/**
 * The `paths` section the static artifact carried until #5744 — rebuilt here
 * as a FIXTURE, because the artifact no longer supplies one.
 *
 * #5821 pinned "no artifact path leaks into the served document" by reading
 * the artifact's OWN `paths` and looping over them. That was the right input
 * while spec still emitted a route section. #5744 then removed the emission —
 * correctly, ADR-0076: a section can only be produced by the package that
 * mounts the routes — and the pin's input silently became the empty set.
 * Re-measured on this branch through the same `loadOpenApiSpec` seam the pin
 * uses (#6894):
 *
 *     #5821 pin input set (stale paths): [] -> size 0
 *     loop body executions: 0
 *
 * A `for` over nothing asserts nothing, and the case stayed green saying so.
 * The other direction — waiting for the artifact to carry a route section
 * again — would mean asking the producer to keep a removed defect alive in
 * order to feed a test, so the input is constructed here instead.
 */
function staleArtifactPaths(): Record<string, any> {
  const operation = (operationId: string) => ({
    operationId,
    responses: { '200': { description: 'OK' } },
  });
  const section: Record<string, any> = {};
  for (const path of PHANTOM_PATHS) {
    section[path] = { get: operation(`stale ${path}`) };
  }
  // The historical section's other defect, kept so the fixture is the shape
  // that really shipped rather than a uniform one: it documented PUT on a
  // record, a verb this server answers 405 to.
  section['/api/{object}/{id}'].put = operation('stale put record');
  return section;
}

describe('#5588 — built-in routes come from rest, not from the static artifact', () => {
  it('publishes no path the server does not mount', async () => {
    // The converse of the bug, asserted as a set relation rather than by
    // example: every documented path must be a mounted route (modulo the
    // `{object}` expansion, whose concrete copies are derived from a template
    // that is itself mounted). This is what makes a phantom row impossible to
    // add without failing here.
    const { protocol } = makeProtocol({ object: [], api: [] });
    const rest = makeRest(protocol);
    const { body } = await serveOpenApiFrom(rest);

    const mounted = new Set(rest.getRoutes().map((r: any) => toTemplatePath(r.path)));
    for (const path of Object.keys(body.paths)) {
      expect(mounted.has(path), `documented path '${path}' is not a mounted route`).toBe(true);
    }
    // …and the other direction: nothing mounted is silently dropped.
    expect(Object.keys(body.paths).length).toBe(mounted.size);
    expect(mounted.size).toBeGreaterThan(50);
  });

  it('describes none of the seven phantom paths the old section published', async () => {
    const { protocol } = makeProtocol({ object: [{ name: 'showcase_task' }], api: [] });
    const { body } = await serveOpenApi(protocol);
    for (const phantom of PHANTOM_PATHS) {
      expect(body.paths[phantom], `'${phantom}' is served by nothing`).toBeUndefined();
    }
    // `/api/.well-known/objectstack` had no route on ANY prefix under this
    // server: the real one is the runtime dispatcher's, mounted at the SITE
    // ROOT, so it must not appear here on either spelling.
    expect(body.paths['/api/v1/.well-known/objectstack']).toBeUndefined();
    expect(body.paths['/.well-known/objectstack']).toBeUndefined();

    // `/api/v1/meta/types` used to be asserted absent here, on the grounds
    // that it "exists nowhere in the repo". That was true of the ROUTE and not
    // of the path: it was ledgered and implemented in the dispatcher all
    // along, and only the REST registration was missing — so `/meta/types`
    // answered from the `/meta/:type` catch-all instead of 404ing, which is
    // why nobody noticed (#7526). It is a real mount now, and this document is
    // built from mounted routes, so it belongs in the document. The
    // unversioned `/api/meta/types` spelling in PHANTOM_PATHS is still a
    // phantom and is still asserted absent by the loop above.
    expect(body.paths['/api/v1/meta/types']).toBeDefined();
  });

  it('documents the real CRUD surface, with the real verbs', async () => {
    const { protocol } = makeProtocol({ object: [], api: [] });
    const { body } = await serveOpenApi(protocol);

    const collection = body.paths['/api/v1/data/{object}'];
    expect(collection).toBeDefined();
    expect(Object.keys(collection).sort()).toEqual(['get', 'post']);

    const single = body.paths['/api/v1/data/{object}/{id}'];
    expect(single).toBeDefined();
    // PATCH, not PUT. The old document said `PUT {object}/{id}`; the server
    // answers 405 to a PUT there.
    expect(single.patch).toBeDefined();
    expect(single.put, 'PUT on a record 405s — it must not be documented').toBeUndefined();
    expect(Object.keys(single).sort()).toEqual(['delete', 'get', 'patch']);

    expect(body.paths['/api/v1/meta'].get).toBeDefined();
    expect(body.paths['/api/v1/discovery'].get).toBeDefined();
    expect(body.paths['/api/v1/openapi.json'].get).toBeDefined();
  });

  it('carries the registration summary and path parameters into each operation', async () => {
    const { protocol } = makeProtocol({ object: [], api: [] });
    const { body } = await serveOpenApi(protocol);

    const get = body.paths['/api/v1/data/{object}/{id}'].get;
    expect(get.operationId).toBe('getDataByObjectById');
    expect(get.summary).toBe('Get record by ID');
    expect(get.tags).toEqual(['data', 'crud']);
    expect(get.parameters.map((p: any) => p.name)).toEqual(['object', 'id']);
    expect(get.parameters.every((p: any) => p.in === 'path' && p.required === true)).toBe(true);

    // A route registered `public` says so; everything else inherits the
    // document's requirement rather than claiming to be open.
    expect(body.paths['/api/v1/forms/{slug}'].get.security).toEqual([]);
    expect(get.security).toBeUndefined();
  });

  it('follows the configured apiPath instead of a hardcoded prefix', async () => {
    // The reason a static artifact could never be right: `apiPath` is
    // deployment configuration (`api.apiPath ?? basePath + '/' + version`).
    const { protocol } = makeProtocol({ object: [], api: [] });
    const rest = makeRest(protocol, { apiPath: '/backend/api/v9' });
    const { body } = await serveOpenApiFrom(rest, '/backend/api/v9');

    expect(body.paths['/backend/api/v9/data/{object}']).toBeDefined();
    expect(body.paths['/api/v1/data/{object}']).toBeUndefined();
    for (const path of Object.keys(body.paths)) {
      expect(path.startsWith('/backend/api/v9')).toBe(true);
    }
  });

  it('gives the project-scoped mirror its own document, not a doubled one', async () => {
    const { protocol } = makeProtocol({ object: [], api: [] });
    const rest = makeRest(protocol, { enableProjectScoping: true, projectResolution: 'auto' });

    const unscoped = await serveOpenApiFrom(rest, '/api/v1');
    const scoped = await serveOpenApiFrom(rest, '/api/v1/environments/:environmentId');

    for (const path of Object.keys(unscoped.body.paths)) {
      expect(path.startsWith('/api/v1/environments/'), `'${path}' belongs to the scoped document`).toBe(false);
    }
    expect(scoped.body.paths['/api/v1/environments/{environmentId}/data/{object}']).toBeDefined();
    // The scoped base's own parameter is declared like any other.
    const names = scoped.body.paths['/api/v1/environments/{environmentId}/data/{object}'].get.parameters
      .map((p: any) => p.name);
    expect(names).toEqual(['environmentId', 'object']);
  });

  it('passes the half of the document `packages/spec` owns through serve untouched', async () => {
    // The artifact's surviving half — `components.schemas`, `securitySchemes`,
    // `info` — is the contract, and serve-time enrichment must not touch it.
    const rest = makeRest(makeProtocol({ object: [], api: [] }).protocol);
    const artifact = await (rest as any).loadOpenApiSpec();
    expect(artifact, 'the bundled artifact must be loadable for this pin to mean anything').toBeTruthy();
    // Recorded rather than assumed, because the pin below depends on it: since
    // #5744 the artifact is the contract half ONLY and describes no routes, so
    // the discard case has to plant its own section to have anything to check.
    expect(
      artifact.paths,
      'since #5744 the artifact emits no route section — if this ever comes back, feed it to the discard pin below instead of a fixture',
    ).toBeUndefined();

    const { body } = await serveOpenApiFrom(rest);
    expect(Object.keys(body.components.schemas)).toEqual(Object.keys(artifact.components.schemas));
    expect(body.components.securitySchemes).toEqual(artifact.components.securitySchemes);
    expect(body.info.title).toBe(artifact.info.title);
  });

  it('discards a `paths`-carrying artifact instead of merging it', async () => {
    // #5588 ruling C: the serve path DISCARDS whatever route section the
    // static artifact carries rather than merging it, because a merge with a
    // wrong section republishes the wrong section. Today's artifact carries
    // none (#5744), so the only honest way to keep asserting the discard is to
    // hand the handler one that does — see `staleArtifactPaths` for why the
    // input is a fixture and not the artifact's own key any more (#6894).
    const rest = makeRest(makeProtocol({ object: [], api: [] }).protocol);
    const artifact = await (rest as any).loadOpenApiSpec();
    expect(artifact, 'the bundled artifact must be loadable for this pin to mean anything').toBeTruthy();
    // `loadOpenApiSpec` caches per instance and hands back the cached object
    // itself, so planting the section on it is what the handler will read.
    artifact.paths = staleArtifactPaths();

    // Read the input back THROUGH the loader, and require it to be non-empty.
    // This assertion is the one that would have caught #6894: it turns "the
    // loop found nothing to check" from a silent pass into a failure, so the
    // layer cannot go hollow again without saying so.
    const stale = Object.keys((await (rest as any).loadOpenApiSpec()).paths ?? {});
    expect(
      stale.length,
      'the pin input set is empty — the loop below would assert nothing (#6894)',
    ).toBeGreaterThan(0);

    const { body } = await serveOpenApiFrom(rest);
    for (const path of stale) {
      expect(body.paths[path], `stale artifact path '${path}' leaked into the served document`).toBeUndefined();
    }
  });
});
