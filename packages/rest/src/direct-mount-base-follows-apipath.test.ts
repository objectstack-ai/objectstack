// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#6306] ONE API base for the whole REST surface — pinned end to end through
// the plugin that composes it in production.
//
// The defect this replaces: `RestServer.getApiBasePath()` answers
// `api.apiPath ?? `${basePath}/${version}``, but `rest-api-plugin.ts` built
// its own `${basePath}/${version}` for the two direct-mount registrars and
// never read `apiPath`. The two expressions agree only while `apiPath` is
// unset, so a deployment that set it served TWO API prefixes at once —
// measured on `origin/main` @ 11066f681 with `apiPath: '/backend/api/v9'`:
// 92 routes mounted, 83 under `{apiPath}`, and exactly 9 left behind at
// `/api/v1` (`packages.*` ×4, `datasources/:name/external/*` ×5). Those 9
// were also absent from `{apiPath}/openapi.json` (71 paths vs 79), because
// that document is filtered to this server's base — the filter is what made
// the split visible (#5822 / PR #6303).
//
// What is pinned here, and at which level. This file drives
// `createRestApiPlugin(config).start(ctx)` — the real composition — over a
// recording host server whose handler table IS the mounted surface, then asks
// the three consumers that must agree: where the routes mount, what
// `{base}/openapi.json` documents, and what `{base}/discovery` advertises.
// That plugin-level wiring is deliberately NOT what
// `discovery-advertised-direct-mounts.parity.test.ts` measures: it calls
// `mountAndRecordDirectRoutes` directly with its own `versionedBase`, so it
// pins mounted ⇒ advertised for whatever base it is handed and stays green
// whichever base the plugin picks. The choice of base is this file's subject.
//
// The single-source assertion is the point, not the URLs: each case compares
// the mounted base against `getApiBasePath()` read off an independently
// constructed `RestServer` with the same config. A future edit that
// re-derives the base at the registrars' call site — however correctly —
// fails these, which is the intent: the bug was a second expression, so the
// pin is on there being one.

// Relative imports carry their `.js` extension (see the note in
// `direct-mount-introspection.test.ts`): under `moduleResolution: nodenext` an
// extension-less one does not resolve and every symbol it names becomes `any`.
import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';
import { createRestApiPlugin } from './rest-api-plugin.js';
import { REST_ROUTE_LEDGER } from './rest-route-ledger.js';
import { toTemplatePath } from './openapi-builtin-paths.js';

type Handler = (req: any, res: any) => any;

/** The ledger's own list of the nine, as `VERB {base-relative}` suffixes. */
const DIRECT_MOUNT_SUFFIXES = REST_ROUTE_LEDGER
  .filter((e) => e.source === 'direct-mount')
  .map((e) => {
    const [method, path] = e.route.split(' ');
    return { method, suffix: path.replace(/^\/api\/v1/, '') };
  });

/**
 * A host server whose registrations land in a real handler table — the
 * RouteManager rows `RestServer` mounts and the direct-mount registrars' rows
 * alike, so one table answers "what is mounted" for the whole boot.
 */
function createRecordingServer() {
  const table = new Map<string, Handler>();
  const on = (method: string) => vi.fn((path: string, handler: Handler) => {
    table.set(`${method} ${path}`, handler);
  });
  const server = {
    table,
    get: on('GET'), post: on('POST'), put: on('PUT'), delete: on('DELETE'), patch: on('PATCH'),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
  return server;
}

/** Match a concrete URL against the table's `:param` patterns. */
function resolveRoute(table: Map<string, Handler>, method: string, url: string) {
  const urlSegs = url.split('/');
  for (const [key, handler] of table) {
    const [m, pattern] = key.split(' ');
    if (m !== method) continue;
    const patSegs = pattern.split('/');
    if (patSegs.length !== urlSegs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < patSegs.length; i++) {
      if (patSegs[i].startsWith(':')) params[patSegs[i].slice(1)] = urlSegs[i];
      else if (patSegs[i] !== urlSegs[i]) { ok = false; break; }
    }
    if (ok) return { handler, params };
  }
  return undefined;
}

async function drive(entry: { handler: Handler; params: Record<string, string> }, req: Record<string, unknown> = {}) {
  let body: any;
  let statusCode = 200;
  const res: any = {
    status: (c: number) => { statusCode = c; return res; },
    json: (b: any) => { body = b; },
    header: () => res,
    send: () => {},
  };
  await entry.handler({ params: entry.params, query: {}, body: {}, headers: { host: 'example.test' }, ...req }, res);
  return { statusCode, body };
}

function makeProtocol() {
  const engine = { registry: { getObject: (_n: string) => undefined, getRegisteredTypes: () => [] } };
  const services = new Map<string, any>([['package', { list: async () => [] }]]);
  return new ObjectStackProtocolImplementation(engine as any, () => services);
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

/**
 * Boot the REST plugin exactly as production does, and report both the
 * mounted surface and the base an independently constructed `RestServer`
 * computes from the same config — the two things every case compares.
 */
async function bootPlugin(apiConfig?: Record<string, unknown>) {
  const server = createRecordingServer();
  const ctx = createCtx({
    'http.server': server,
    protocol: makeProtocol(),
    package: { list: vi.fn(), get: vi.fn(), publish: vi.fn(), delete: vi.fn() },
    'external-datasource': { listRemoteTables: async () => [{ name: 'customers' }] },
  });
  await createRestApiPlugin(apiConfig as any).start!(ctx as any);

  // The base the server that owns the surface computes — the single source.
  const expectedBase = new RestServer(
    createRecordingServer() as any,
    makeProtocol() as any,
    (apiConfig?.api ?? {}) as any,
  ).getApiBasePath();

  return { server, table: server.table, expectedBase };
}

function mountedKeys(table: Map<string, Handler>): string[] {
  return [...table.keys()];
}

async function serveOpenApi(table: Map<string, Handler>, base: string) {
  const entry = resolveRoute(table, 'GET', `${base}/openapi.json`);
  expect(entry, `GET ${base}/openapi.json must be mounted for this pin to mean anything`).toBeDefined();
  const { body } = await drive(entry!, { path: `${base}/openapi.json` });
  return body;
}

async function readDiscovery(table: Map<string, Handler>, base: string) {
  const entry = resolveRoute(table, 'GET', `${base}/discovery`);
  expect(entry, `GET ${base}/discovery must be mounted`).toBeDefined();
  const { body } = await drive(entry!);
  return body;
}

function documented(doc: any, wirePath: string, method: string): boolean {
  return Boolean(doc?.paths?.[toTemplatePath(wirePath)]?.[method.toLowerCase()]);
}

// ---------------------------------------------------------------------------
// the move — a deployment that sets `apiPath`
// ---------------------------------------------------------------------------

describe('#6306 — with `apiPath` set, the direct-mount routes follow it', () => {
  const API_PATH = '/backend/api/v9';
  const config = { api: { api: { apiPath: API_PATH } } };

  it('mounts all nine under {apiPath}, and leaves nothing behind at the convention prefix', async () => {
    const { table, expectedBase } = await bootPlugin(config);

    // The base is the server's, not a second expression that happens to agree.
    expect(expectedBase).toBe(API_PATH);

    for (const { method, suffix } of DIRECT_MOUNT_SUFFIXES) {
      expect(
        mountedKeys(table),
        `${method} ${expectedBase}${suffix} must mount under the one API base`,
      ).toContain(`${method} ${expectedBase}${suffix}`);
    }

    // The whole surface moved, not merely the nine: no route is left at the
    // `/api/v1` convention. This is the split itself — on `origin/main` this
    // set had exactly 9 members.
    const stragglers = mountedKeys(table).filter((k) => k.split(' ')[1].startsWith('/api/v1'));
    expect(stragglers, 'no route may stay at /api/v1 when apiPath moves the surface').toEqual([]);
  });

  it('documents all nine in {apiPath}/openapi.json — the filter that made the split visible now includes them', async () => {
    const { table, expectedBase } = await bootPlugin(config);
    const doc = await serveOpenApi(table, expectedBase);

    for (const { method, suffix } of DIRECT_MOUNT_SUFFIXES) {
      expect(
        documented(doc, `${expectedBase}${suffix}`, method),
        `${method} ${expectedBase}${suffix} is mounted but not documented`,
      ).toBe(true);
    }
    // …and the stale prefix is documented nowhere, so the document describes
    // one surface rather than two.
    expect(Object.keys(doc.paths).filter((p) => p.startsWith('/api/v1'))).toEqual([]);
  });

  it('advertises the moved bases in {apiPath}/discovery, and the advertised URLs answer', async () => {
    const { table, expectedBase } = await bootPlugin(config);
    const discovery = await readDiscovery(table, expectedBase);

    // No edit was needed in the advertising code for this: `routes.packages` /
    // `routes.datasources` are projections of the recorded mounts (#6633), so
    // moving the mount moved the advertisement.
    expect(discovery.routes.packages).toBe(`${expectedBase}/packages`);
    expect(discovery.routes.datasources).toBe(`${expectedBase}/datasources`);

    const pkg = resolveRoute(table, 'GET', discovery.routes.packages);
    expect(pkg, 'the advertised packages URL must be mounted').toBeDefined();
    // [#7033 / #7023] `GET /packages` is now authz-gated, and this real plugin
    // boot wires the production caller resolver
    // (`RestServer.resolvePackageRouteExecutionContext`) with no auth service in
    // the ctx — so the anonymous discovery probe resolves to no identity and the
    // gate answers 401. That still proves the advertised URL is MOUNTED and its
    // handler runs at the moved base (a routing miss would have failed the
    // `toBeDefined()` above); the base-placement subject of this pin is unchanged.
    // The gate itself is pinned in `package-envelope.conformance.test.ts`.
    expect((await drive(pkg!)).statusCode).toBe(401);

    const ext = resolveRoute(table, 'GET', `${discovery.routes.datasources}/pg_main/external/tables`);
    expect(ext, 'the advertised datasources base must be the base of the mounted family').toBeDefined();
    expect((await drive(ext!)).statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// the second divergent expression the single source also collapses
// ---------------------------------------------------------------------------

describe('#6306 — the base is READ, not rebuilt: `??` and `||` no longer disagree', () => {
  it('an empty `basePath` puts the nine where the rest of the surface already was', async () => {
    // A second, independent way the two expressions differed: the plugin
    // defaulted with `||` (empty string ⇒ `/api`) while `RestServer`
    // normalizes with `??` (empty string kept). So `basePath: ''` mounted the
    // RouteManager surface at `/v1` and the nine at `/api/v1` — the same
    // split, reached without `apiPath` at all. Reading the base cannot
    // disagree with itself.
    const { table, expectedBase } = await bootPlugin({ api: { api: { basePath: '', version: 'v1' } } });
    expect(expectedBase).toBe('/v1');

    for (const { method, suffix } of DIRECT_MOUNT_SUFFIXES) {
      expect(mountedKeys(table)).toContain(`${method} /v1${suffix}`);
    }
    expect(mountedKeys(table).filter((k) => k.split(' ')[1].startsWith('/api/v1'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// the baseline — unchanged where the two expressions always agreed
// ---------------------------------------------------------------------------

describe('#6306 — default and conventional configs are unchanged', () => {
  // NOTE, honestly: these two cases are green both before and after the fix —
  // `apiPath ?? `${basePath}/${version}`` and `${basePath}/${version}` are the
  // same string here, which is exactly why the defect hid for so long. They
  // are not reverse-verification evidence; they are the regression floor,
  // pinning that single-sourcing moved nothing for deployments that never set
  // `apiPath` (measured: the default mount list is identical, 92 routes,
  // before and after).
  it('default config keeps all nine at /api/v1, documented and advertised there', async () => {
    const { table, expectedBase } = await bootPlugin(undefined);
    expect(expectedBase).toBe('/api/v1');

    for (const { method, suffix } of DIRECT_MOUNT_SUFFIXES) {
      expect(mountedKeys(table)).toContain(`${method} /api/v1${suffix}`);
    }
    const doc = await serveOpenApi(table, '/api/v1');
    for (const { method, suffix } of DIRECT_MOUNT_SUFFIXES) {
      expect(documented(doc, `/api/v1${suffix}`, method)).toBe(true);
    }
    const discovery = await readDiscovery(table, '/api/v1');
    expect(discovery.routes.packages).toBe('/api/v1/packages');
    expect(discovery.routes.datasources).toBe('/api/v1/datasources');
  });

  it('a conventional custom basePath/version behaves identically under both expressions', async () => {
    const { table, expectedBase } = await bootPlugin({ api: { api: { basePath: '/gateway', version: 'v3' } } });
    expect(expectedBase).toBe('/gateway/v3');
    for (const { method, suffix } of DIRECT_MOUNT_SUFFIXES) {
      expect(mountedKeys(table)).toContain(`${method} /gateway/v3${suffix}`);
    }
  });
});
