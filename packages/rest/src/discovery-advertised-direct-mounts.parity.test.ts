// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#6633] The mounted ⇒ advertised parity pin for the direct-mount surfaces
// (ADR-0076 D12, the half its text does not spell out: advertise everything
// mounted — the text bans advertising the unmounted).
//
// What is pinned, end to end: boot the REST surface the way production boots
// it — `RestServer.registerRoutes()` + `mountAndRecordDirectRoutes(...)`, the
// SAME composition `rest-api-plugin.ts` runs — over a recording host server
// whose handler table is the real mounted surface. Then read `/discovery`
// through that table and assert the advertised `routes.packages` /
// `routes.datasources` URLs ANSWER through the same table.
//
// Why this shape: the advertisement is a projection of the recorded mounts
// (`RestServer.getDirectMountRouteBases`), and the mounts are the arrays the
// registrars iterated to mount (#5822). This test holds the two ends of that
// chain together against the live surface, so ANY future change that moves
// only one side goes red here: move the mount without the advertisement (or
// vice versa) and the advertised URL stops resolving in the handler table.
// #6306 was the first such move and it landed with no edit in this file —
// which is the property working, not the pin missing it.
//
// The non-default-base case is the load-bearing one: it drives the
// composition at a base that is not `/api/v1` to prove nothing re-derives the
// convention. Note the level this file measures at — it calls
// `mountAndRecordDirectRoutes` directly, so `versionedBase` is its own
// parameter and the projection is pinned independently of WHO chooses that
// base. Since #6306 the production chooser is `RestServer.getApiBasePath()`
// (so `apiPath` deployments mount and advertise under `{apiPath}`); that
// wiring — plugin config in, mounted+advertised+documented URLs out — is
// pinned end to end in `direct-mount-base-follows-apipath.test.ts`.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';
import { mountAndRecordDirectRoutes } from './direct-mount-composition.js';

type Handler = (req: any, res: any) => any;

/**
 * A host server whose registrations land in a REAL handler table — both the
 * RouteManager registrations (`RestServer` mounts through it synchronously)
 * and the direct-mount registrars' rows, so one table answers "what is
 * mounted" for the whole boot.
 */
function createRecordingServer() {
  const table = new Map<string, Handler>();
  const on = (method: string) => (path: string, handler: Handler) => {
    table.set(`${method} ${path}`, handler);
  };
  const server = {
    get: on('GET'), post: on('POST'), put: on('PUT'), delete: on('DELETE'), patch: on('PATCH'),
    use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { server, table };
}

/** Match a concrete URL path against the table's `:param` patterns. */
function resolveRoute(table: Map<string, Handler>, method: string, url: string):
  { handler: Handler; params: Record<string, string> } | undefined {
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

/** Drive one mounted handler the way an adapter would, capturing the body. */
async function drive(entry: { handler: Handler; params: Record<string, string> }, query: Record<string, string> = {}) {
  let body: any;
  let statusCode = 200;
  const res: any = {
    status: (c: number) => { statusCode = c; return res; },
    json: (b: any) => { body = b; },
  };
  await entry.handler({ params: entry.params, query, body: {} }, res);
  return { statusCode, body };
}

/**
 * Boot the real composition. `withPackageService` gates the package registrar
 * exactly the way production is gated (the `package` kernel service);
 * `externalService` is what the federation routes resolve per request.
 */
function boot(opts: {
  versionedBase: string;
  withPackageService?: boolean;
  enableProjectScoping?: boolean;
  projectResolution?: string;
  /** [#6714] Rebase the RestServer's OWN mounts (`getApiBasePath()`). */
  apiPath?: string;
}) {
  const { server, table } = createRecordingServer();
  const engine = {
    registry: { getObject: (_n: string) => undefined, getRegisteredTypes: () => [] },
  };
  const services = new Map<string, any>(
    opts.withPackageService === false ? [] : [['package', { list: async () => [] }]],
  );
  const protocol = new ObjectStackProtocolImplementation(engine as any, () => services);
  const config: any = {
    api: {
      ...(opts.apiPath ? { apiPath: opts.apiPath } : {}),
      ...(opts.enableProjectScoping
        ? { enableProjectScoping: true, projectResolution: opts.projectResolution ?? 'auto' }
        : {}),
    },
  };
  const rest = new RestServer(server as any, protocol as any, config);
  rest.registerRoutes();
  const ctx = {
    getService: (name: string) => {
      if (name === 'package' && opts.withPackageService !== false) return { list: async () => [] };
      if (name === 'external-datasource') {
        return { listRemoteTables: async (_n: string, _o: any) => [{ name: 'customers' }] };
      }
      return undefined;
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  mountAndRecordDirectRoutes({
    server: server as any,
    recorder: rest,
    ctx: ctx as any,
    versionedBase: opts.versionedBase,
    // [#7033 / #7023] The package routes now carry an authorization gate;
    // production wires its caller resolver here (via
    // `RestServer.resolvePackageRouteExecutionContext`). This parity test pins
    // mounted ⇒ advertised route PLACEMENT, not authz, so it stubs a capable
    // caller — the advertised `GET /packages` URL then ANSWERS 200 the way an
    // authorized caller reaches it in production, keeping this test's subject
    // (does the advertised URL resolve and answer in the mounted table) intact.
    // The gate itself is pinned in `package-envelope.conformance.test.ts`.
    // [#9901] `manage_platform_settings` joins the set for the same reason:
    // the federation family's read routes now carry a capability gate too, and
    // the advertised `…/external/tables` URL is driven below. Without it that
    // probe would read a 403 and this pin's subject (does the advertised URL
    // resolve and answer in the mounted table) would quietly become an authz
    // assertion. That gate is pinned in
    // `external-datasource-routes-auth-guard.test.ts`.
    resolveExecutionContext: async () => ({
      userId: 'u_pkg',
      systemPermissions: ['manage_metadata', 'studio.access', 'setup.access', 'manage_platform_settings'],
    }),
    enableProjectScoping: opts.enableProjectScoping,
    projectResolution: opts.projectResolution,
  });
  return { rest, table };
}

async function readDiscovery(table: Map<string, Handler>, base = '/api/v1', params: Record<string, string> = {}) {
  const entry = resolveRoute(table, 'GET', `${base}/discovery`.replace(/:environmentId/g, params.environmentId ?? ':environmentId'));
  expect(entry, `GET ${base}/discovery must be mounted`).toBeDefined();
  const { body } = await drive({ handler: entry!.handler, params });
  return body;
}

describe('[#6633] /discovery advertises the direct-mount surfaces where they are ACTUALLY mounted', () => {
  it('advertised routes.packages / routes.datasources resolve and ANSWER in the mounted table (default base)', async () => {
    const { table } = boot({ versionedBase: '/api/v1' });
    const discovery = await readDiscovery(table);

    // Advertised…
    expect(discovery.routes.packages).toBe('/api/v1/packages');
    expect(discovery.routes.datasources).toBe('/api/v1/datasources');

    // [#6714] …and the email surface, projected from the RouteManager's
    // recorded registrations rather than the direct-mount arrays: advertised
    // base + `/send` must be a mounted POST route in the SAME table.
    expect(discovery.routes.email).toBe('/api/v1/email');
    expect(
      resolveRoute(table, 'POST', `${discovery.routes.email}/send`),
      'advertised routes.email must be the base of the mounted send route',
    ).toBeDefined();

    // …and the advertised URLs answer through the SAME mounted table.
    const pkg = resolveRoute(table, 'GET', discovery.routes.packages);
    expect(pkg, 'advertised routes.packages must be a mounted GET route').toBeDefined();
    const pkgAnswer = await drive(pkg!);
    expect(pkgAnswer.statusCode).toBe(200);
    expect(pkgAnswer.body?.success).toBe(true);

    const ext = resolveRoute(table, 'GET', `${discovery.routes.datasources}/pg_main/external/tables`);
    expect(ext, 'advertised routes.datasources must be the base of the mounted federation family').toBeDefined();
    const extAnswer = await drive(ext!);
    expect(extAnswer.statusCode).toBe(200);
    expect(extAnswer.body?.data?.tables).toEqual([{ name: 'customers' }]);
  });

  it('follows a NON-default mount base — the advertisement derives from the mounts, never from the /api/v1 convention', async () => {
    // The mount base is an input here, deliberately decoupled from the
    // RestServer's own base: that is what proves the advertisement is read
    // off the recorded mounts rather than re-derived from config. It is also
    // what kept advertisement and mount inseparable across #6306's move.
    const { table } = boot({ versionedBase: '/backend/api/v9' });
    const discovery = await readDiscovery(table);

    expect(discovery.routes.packages).toBe('/backend/api/v9/packages');
    expect(discovery.routes.datasources).toBe('/backend/api/v9/datasources');

    const pkg = resolveRoute(table, 'GET', discovery.routes.packages);
    expect(pkg).toBeDefined();
    expect((await drive(pkg!)).body?.success).toBe(true);

    const ext = resolveRoute(table, 'GET', `${discovery.routes.datasources}/pg_main/external/tables`);
    expect(ext).toBeDefined();
    expect((await drive(ext!)).body?.data?.tables).toEqual([{ name: 'customers' }]);

    // The convention paths are NOT mounted on this boot, so advertising them
    // would have been the lie the projection exists to prevent.
    expect(resolveRoute(table, 'GET', '/api/v1/packages')).toBeUndefined();
    expect(resolveRoute(table, 'GET', '/api/v1/datasources/pg_main/external/tables')).toBeUndefined();

    // [#6714] The email surface is NOT a direct mount — it registers at the
    // RestServer's OWN base, which this boot leaves at the default. The two
    // families genuinely diverge on this boot, and each advertisement tells
    // its own mount's truth: per-face keys projected per-face, never one
    // shared "known base" assumption (the scheme the #6714 ruling rejected).
    expect(discovery.routes.email).toBe('/api/v1/email');
    expect(resolveRoute(table, 'POST', '/api/v1/email/send')).toBeDefined();
  });

  it('not mounted ⇒ not advertised: a boot without the package service advertises no routes.packages', async () => {
    const { table } = boot({ versionedBase: '/api/v1', withPackageService: false });
    const discovery = await readDiscovery(table);

    // The registrar was never called (same gate as production), so nothing is
    // recorded and nothing is advertised — D12's other half, kept honest even
    // though the PROTOCOL half would happily stay silent too (no `package`
    // service in its registry either; the override is what guarantees it).
    expect(Object.prototype.hasOwnProperty.call(discovery.routes, 'packages')).toBe(false);
    expect(resolveRoute(table, 'GET', '/api/v1/packages')).toBeUndefined();

    // The federation family mounts unconditionally (degrades per request), so
    // it IS advertised on the same boot.
    expect(discovery.routes.datasources).toBe('/api/v1/datasources');
    expect(resolveRoute(table, 'GET', '/api/v1/datasources/pg_main/external/tables')).toBeDefined();

    // [#6714] Same for the email surface: `registerEmailEndpoints` mounts
    // unconditionally (501-degrading when no email service is configured), so
    // it is advertised on every boot — mounted is the fact, not configured.
    expect(discovery.routes.email).toBe('/api/v1/email');
    expect(resolveRoute(table, 'POST', '/api/v1/email/send')).toBeDefined();
  });

  it('[#6714] routes.email follows apiPath — the mount moved, the advertisement moved with it, and the old convention path is GONE', async () => {
    // THE live-404 case from the card: `registerEmailEndpoints` mounts under
    // `getApiBasePath()`, which follows `apiPath`. The pre-#6714 client
    // hard-coded `POST {baseUrl}/api/v1/email/send`, so on this boot it hit a
    // path that resolves to NOTHING in the mounted table — a live 404 today,
    // not a latent gap. The advertisement is a projection of the recorded
    // RouteManager rows, so it moves with the mount by construction.
    const { table } = boot({ versionedBase: '/backend/api/v9', apiPath: '/backend/api/v9' });
    const discovery = await readDiscovery(table, '/backend/api/v9');

    expect(discovery.routes.email).toBe('/backend/api/v9/email');
    expect(
      resolveRoute(table, 'POST', `${discovery.routes.email}/send`),
      'advertised routes.email must answer where the surface is actually mounted',
    ).toBeDefined();

    // The pre-#6714 client URL — the measured live 404.
    expect(resolveRoute(table, 'POST', '/api/v1/email/send')).toBeUndefined();
  });

  it('scoped discovery advertises the scoped packages mount with the environment id substituted', async () => {
    const { table } = boot({ versionedBase: '/api/v1', enableProjectScoping: true, projectResolution: 'auto' });

    const discovery = await readDiscovery(table, '/api/v1/environments/:environmentId', { environmentId: 'env_alpha' });
    expect(discovery.routes.packages).toBe('/api/v1/environments/env_alpha/packages');
    // The scoped variant is genuinely mounted (`auto` mirrors the package
    // routes under both bases) and the advertised URL resolves against it.
    expect(resolveRoute(table, 'GET', '/api/v1/environments/env_alpha/packages')).toBeDefined();

    // The federation family has no scoped variant — the unscoped mount is the
    // truth, and the scoped response says so rather than inventing one.
    expect(discovery.routes.datasources).toBe('/api/v1/datasources');

    // [#6714] The email surface DOES have a scoped variant (`registerForBase`
    // runs the email registrar under both bases in `auto`), and the scoped
    // response advertises it with the environment id substituted — resolving
    // against the genuinely mounted `:environmentId` pattern.
    expect(discovery.routes.email).toBe('/api/v1/environments/env_alpha/email');
    expect(resolveRoute(table, 'POST', '/api/v1/environments/env_alpha/email/send')).toBeDefined();

    // The unscoped response keeps the unscoped mount.
    const unscoped = await readDiscovery(table);
    expect(unscoped.routes.packages).toBe('/api/v1/packages');
    expect(unscoped.routes.email).toBe('/api/v1/email');
  });
});
