// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DIRECT-MOUNT ROUTES ARE ENUMERABLE — and only when they are mounted (#5822).
 *
 * The nine routes `package-routes.ts` and `external-datasource-routes.ts` mount
 * straight on the host `IHttpServer` used to be invisible to the server that
 * owns the surface: `RestServer.getRoutes()` reported `RouteManager`'s table
 * alone, so `GET {apiPath}/openapi.json` — which #5588 / PR #5821 made a
 * projection of that table — could not describe them, and eight
 * `disposition: 'sdk'` capabilities were missing from every generated client.
 *
 * What this file pins is the pair of directions that make the fix honest rather
 * than merely complete. They are equally load-bearing: the first was the
 * omission being repaired, the second is the reason #5821 chose the omission in
 * the first place, and losing it would turn this change into the phantom-row
 * defect #5588 fixed.
 *
 *   mounted     ⇒ enumerable, and documented
 *   not mounted ⇒ absent from both
 *
 * The second direction has a real trigger: the package registrar is gated on
 * the `package` service, so a deployment without it serves no `packages.*`
 * route — and must not document one. The federation registrar is NOT gated (it
 * mounts always and answers 503 per request), so "mounted" is unconditional
 * there and the document says so.
 *
 * Both are driven through the REAL composition: `mountAndRecordDirectRoutes`
 * for the server-level facts, and `createRestApiPlugin().start()` for the
 * end-to-end one, because the plugin is where a wiring regression would
 * actually happen.
 */

// Relative imports carry their `.js` extension: under `moduleResolution:
// nodenext` an extension-less one does not resolve, every symbol it names
// becomes `any`, and the callbacks over those symbols then report TS7006 — the
// pile that dominates this package's TEST_DEBT entry (AGENTS.md, Build & Test).
import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server.js';
import { mountAndRecordDirectRoutes } from './direct-mount-composition.js';
import { registerPackageRoutes } from './package-routes.js';
import { registerExternalDatasourceRoutes } from './external-datasource-routes.js';
import { createRestApiPlugin } from './rest-api-plugin.js';
import { REST_ROUTE_LEDGER } from './rest-route-ledger.js';
import { toTemplatePath } from './openapi-builtin-paths.js';

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

function createMockServer() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createCapableProtocol() {
  return {
    getDiscovery: vi.fn().mockResolvedValue({}),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn(async ({ type }: { type: string }) => ({ type, items: [] })),
    getMetaItem: vi.fn().mockResolvedValue({}),
    findData: vi.fn().mockResolvedValue([]),
    getData: vi.fn().mockResolvedValue({}),
    createData: vi.fn().mockResolvedValue({ id: '1' }),
    updateData: vi.fn().mockResolvedValue({}),
    deleteData: vi.fn().mockResolvedValue({ success: true }),
    batchData: vi.fn().mockResolvedValue({}),
    createManyData: vi.fn().mockResolvedValue([]),
    updateManyData: vi.fn().mockResolvedValue([]),
    deleteManyData: vi.fn().mockResolvedValue([]),
  };
}

/** A `package` service stub — presence is what the composition gates on. */
function packageServiceStub() {
  return { list: vi.fn(), get: vi.fn(), publish: vi.fn(), delete: vi.fn() };
}

function createCtx(services: Record<string, unknown>) {
  return {
    registerService: vi.fn(),
    getService: vi.fn((name: string) => {
      if (name in services) return services[name];
      throw new Error(`Service '${name}' not found`);
    }),
    getServices: vi.fn(() => new Map(Object.entries(services))),
    hook: vi.fn(),
    trigger: vi.fn().mockResolvedValue(undefined),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    getKernel: vi.fn(),
  };
}

/** The ledger's own list of the nine, split by registrar. */
const LEDGER_DIRECT_MOUNT = REST_ROUTE_LEDGER.filter((e) => e.source === 'direct-mount').map((e) => e.route);
const PACKAGE_ROUTES = LEDGER_DIRECT_MOUNT.filter((r) => r.includes('/packages'));
const FEDERATION_ROUTES = LEDGER_DIRECT_MOUNT.filter((r) => r.includes('/external'));

/** `VERB /path` for every route the server reports as mounted. */
function mountedKeys(rest: RestServer): string[] {
  return rest.getRoutes().map((r) => `${r.method.toUpperCase()} ${r.path}`);
}

/** Boot a server + the direct-mount composition, with the given services. */
function bootWith(
  services: Record<string, unknown>,
  composition: { enableProjectScoping?: boolean; projectResolution?: string } = {},
) {
  const server = createMockServer();
  const rest = new RestServer(server as any, createCapableProtocol() as any, {} as any);
  rest.registerRoutes();
  mountAndRecordDirectRoutes({
    server: server as any,
    recorder: rest,
    ctx: createCtx(services) as any,
    versionedBase: '/api/v1',
    ...composition,
  });
  return { rest, server };
}

/** Drive the mounted `GET {base}/openapi.json` handler and read the body. */
async function serveOpenApi(server: ReturnType<typeof createMockServer>, base = '/api/v1') {
  const call = server.get.mock.calls.find((args: unknown[]) => args[0] === `${base}/openapi.json`);
  expect(call, `GET ${base}/openapi.json must be mounted for this pin to mean anything`).toBeDefined();
  let body: any;
  const res: any = {
    status: () => res,
    json: (b: any) => { body = b; },
    header: () => res,
    send: () => {},
  };
  await (call as any)[1]({ headers: { host: 'example.test' }, params: {}, query: {}, path: `${base}/openapi.json` }, res);
  return body;
}

/** Is `VERB /wire/path` described in the document? */
function documented(body: any, route: string): boolean {
  const [method, wirePath] = route.split(' ');
  return Boolean(body?.paths?.[toTemplatePath(wirePath)]?.[method.toLowerCase()]);
}

// ---------------------------------------------------------------------------
// same source — the description IS the mount
// ---------------------------------------------------------------------------

describe('#5822 — a registrar describes exactly what it mounted', () => {
  it('package routes: the returned array matches the registration calls, one for one', () => {
    const server = createMockServer();
    const returned = registerPackageRoutes(server as any, packageServiceStub() as any, '/api/v1');

    const mounted: string[] = [];
    for (const verb of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      for (const [path] of (server[verb] as any).mock.calls) mounted.push(`${verb.toUpperCase()} ${path}`);
    }
    expect(returned.map((r) => `${r.method} ${r.path}`).sort()).toEqual(mounted.sort());
    // …and the handler in the description is the one that was mounted, not a
    // look-alike: same function identity.
    for (const route of returned) {
      const verb = route.method.toLowerCase() as 'get' | 'post' | 'delete';
      const call = (server[verb] as any).mock.calls.find(([path]: [string]) => path === route.path);
      expect(call?.[1]).toBe(route.handler);
    }
  });

  it('federation routes: the returned array matches the registration calls, one for one', () => {
    const server = createMockServer();
    const returned = registerExternalDatasourceRoutes(
      server as any,
      createCtx({}) as any,
      '/api/v1',
    );

    const mounted: string[] = [];
    for (const verb of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      for (const [path] of (server[verb] as any).mock.calls) mounted.push(`${verb.toUpperCase()} ${path}`);
    }
    expect(returned.map((r) => `${r.method} ${r.path}`).sort()).toEqual(mounted.sort());
  });
});

// ---------------------------------------------------------------------------
// direction 1 — mounted ⇒ enumerable ⇒ documented
// ---------------------------------------------------------------------------

describe('#5822 — mounted direct-mount routes are enumerable and documented', () => {
  it('getRoutes() reports all nine, marked as direct-mount', () => {
    const { rest } = bootWith({ package: packageServiceStub() });
    const keys = mountedKeys(rest);
    for (const route of LEDGER_DIRECT_MOUNT) {
      expect(keys, `${route} is mounted but not enumerable`).toContain(route);
    }
    const marked = rest.getRoutes().filter((r) => r.source === 'direct-mount');
    expect(marked.map((r) => `${r.method} ${r.path}`).sort()).toEqual([...LEDGER_DIRECT_MOUNT].sort());
    // The RouteManager rows keep their own source, so the two stay auditable
    // separately from one table.
    expect(rest.getRoutes().some((r) => r.source === 'route-manager')).toBe(true);
  });

  it('the openapi built-in section carries all nine, ledger row by ledger row', async () => {
    const { server } = bootWith({ package: packageServiceStub() });
    const body = await serveOpenApi(server);
    for (const route of LEDGER_DIRECT_MOUNT) {
      expect(documented(body, route), `${route} is mounted but not documented`).toBe(true);
    }
    // The registration's summary and tags travel with them, exactly as they do
    // for a RouteManager route.
    const list = body.paths['/api/v1/packages'].get;
    expect(list.summary).toBe('List packages (registry + published)');
    expect(list.tags).toEqual(['packages']);
    expect(body.paths['/api/v1/datasources/{name}/external/tables'].get.parameters.map((p: any) => p.name))
      .toEqual(['name']);
  });

  it('still publishes nothing the server does not mount', async () => {
    // #5588's set relation, re-proven with the nine added: growing the document
    // must not loosen the rule that produced it.
    const { rest, server } = bootWith({ package: packageServiceStub() });
    const body = await serveOpenApi(server);
    const mounted = new Set(rest.getRoutes().map((r) => toTemplatePath(r.path)));
    for (const path of Object.keys(body.paths)) {
      expect(mounted.has(path), `documented path '${path}' is not a mounted route`).toBe(true);
    }
    expect(Object.keys(body.paths).length).toBe(mounted.size);
  });

  it('files the project-scoped package mirror in the scoped document, not the unscoped one', async () => {
    const server = createMockServer();
    const rest = new RestServer(
      server as any,
      createCapableProtocol() as any,
      { api: { enableProjectScoping: true, projectResolution: 'auto' } } as any,
    );
    rest.registerRoutes();
    mountAndRecordDirectRoutes({
      server: server as any,
      recorder: rest,
      ctx: createCtx({ package: packageServiceStub() }) as any,
      versionedBase: '/api/v1',
      enableProjectScoping: true,
      projectResolution: 'auto',
    });

    expect(mountedKeys(rest)).toContain('GET /api/v1/environments/:environmentId/packages');

    const unscoped = await serveOpenApi(server, '/api/v1');
    const scoped = await serveOpenApi(server, '/api/v1/environments/:environmentId');
    expect(unscoped.paths['/api/v1/environments/{environmentId}/packages']).toBeUndefined();
    expect(scoped.paths['/api/v1/environments/{environmentId}/packages'].get).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// direction 2 — not mounted ⇒ not enumerable ⇒ not documented
// ---------------------------------------------------------------------------

describe('#5822 — an unmounted registrar is reported by nothing', () => {
  it('a boot without the `package` service enumerates and documents no packages route', async () => {
    const { rest, server } = bootWith({});
    const keys = mountedKeys(rest);
    for (const route of PACKAGE_ROUTES) {
      expect(keys, `${route} is not mounted on this boot and must not be enumerable`).not.toContain(route);
    }
    // Not merely absent from the table: absent from the wire too — the gate
    // itself is unchanged, this pins that the record follows it.
    const mountedPaths = server.get.mock.calls.map((args: unknown[]) => args[0]);
    expect(mountedPaths).not.toContain('/api/v1/packages');

    const body = await serveOpenApi(server);
    for (const route of PACKAGE_ROUTES) {
      expect(documented(body, route), `${route} is not mounted but is documented`).toBe(false);
    }
  });

  it('the federation routes are still there — they mount unconditionally', async () => {
    // The gate that does NOT exist, stated so the previous test cannot be
    // "fixed" by dropping every direct-mount row when a service is missing:
    // these five answer 503 per request instead, so they ARE mounted and are
    // correctly documented even with no `external-datasource` service.
    const { rest, server } = bootWith({});
    const keys = mountedKeys(rest);
    for (const route of FEDERATION_ROUTES) {
      expect(keys, `${route} is mounted unconditionally`).toContain(route);
    }
    const body = await serveOpenApi(server);
    for (const route of FEDERATION_ROUTES) {
      expect(documented(body, route)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// end to end — through the plugin that composes it in production
// ---------------------------------------------------------------------------

describe('#5822 — the REST plugin records what it mounts', () => {
  async function bootPlugin(services: Record<string, unknown>) {
    const server = createMockServer();
    const ctx = createCtx({ 'http.server': server, protocol: createCapableProtocol(), ...services });
    await createRestApiPlugin().start!(ctx as any);
    return { server, ctx };
  }

  it('publishes the nine when the package service is there', async () => {
    const { server } = await bootPlugin({ package: packageServiceStub() });
    const body = await serveOpenApi(server);
    for (const route of LEDGER_DIRECT_MOUNT) {
      expect(documented(body, route), `${route} is mounted by the plugin but not documented`).toBe(true);
    }
  });

  it('publishes the five, and only the five, when it is not', async () => {
    const { server } = await bootPlugin({});
    const body = await serveOpenApi(server);
    for (const route of FEDERATION_ROUTES) expect(documented(body, route)).toBe(true);
    for (const route of PACKAGE_ROUTES) expect(documented(body, route)).toBe(false);
  });
});
