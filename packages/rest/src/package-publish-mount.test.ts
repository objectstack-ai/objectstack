// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /packages/publish` HAS AN OWNER ON EVERY BOOT (#7563).
 *
 * ## The defect this pins shut
 *
 * On a live showcase boot, `POST /api/v1/packages/publish` answered **405**
 * with `Allow: DELETE, GET, HEAD, PATCH`. Not one of those verbs belongs to the
 * publish surface — `POST` is the only verb it has ever had. They are
 * `/packages/:id`'s method set, and the router offered them because with the
 * publish route unmounted that pattern was the only thing left matching the
 * path, with `id = "publish"`. So a caller was told "this path exists, use
 * another method", and every method on offer would have operated on a package
 * literally named `publish`.
 *
 * Two facts made it possible, and this file pins the repair of both:
 *
 *  1. The registrar was gated on `ctx.getService('package')` resolving at the
 *     ONE instant `RestApiPlugin.start()` ran. `objectstack serve` registers
 *     capability providers (`requires: ['marketplace']` → `PackageServicePlugin`)
 *     AFTER `createRestApiPlugin`, and start order follows registration order
 *     for plugins with no edge between them — so the deployments that DO
 *     compose a package service are exactly the ones that answered "no" at
 *     mount time. The service is now resolved per request.
 *  2. `POST /packages/publish` has no dispatcher twin, so "not mounted" did not
 *     degrade to a 404 the way the composition's own doc promised — it degraded
 *     to a sibling's 405. It therefore mounts unconditionally and answers its
 *     own honest 404 where no package service exists.
 *
 * ## The asymmetry is load-bearing, and is pinned too
 *
 * The other three package routes must NOT follow. Each shadows a live
 * dispatcher twin at a byte-identical pattern; mounting them without a service
 * would replace three working routes with a degraded refusal. A future edit
 * that "makes the registrar consistent" by mounting all four unconditionally
 * fails the `keeps its hands off the three dispatcher twins` case below.
 */

// `.js` on the relative imports: under `moduleResolution: nodenext` an
// extension-less one does not resolve and every symbol it names becomes `any`.
import { describe, it, expect, vi } from 'vitest';
import { registerPackageRoutes } from './package-routes.js';
import { mountAndRecordDirectRoutes } from './direct-mount-composition.js';

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

/** A caller who clears the write gate, so every case reaches the route body. */
const AUTHED = {
  resolveExecutionContext: async () => ({ userId: 'u_pkg', systemPermissions: ['manage_metadata'] }),
};

function packageServiceStub() {
  return {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    publish: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  };
}

/** Capture one response the way the direct-mount handlers write it. */
function captureRes() {
  const out: { status?: number; body?: any } = {};
  const res: any = {
    status(code: number) { out.status = code; return res; },
    json(body: any) { out.body = body; return res; },
    send(body: any) { out.body = body; return res; },
    header() { return res; },
  };
  return { res, out };
}

/** Drive the mounted publish handler with `body`. */
async function callPublish(
  server: ReturnType<typeof createMockServer>,
  body: unknown = {},
  path = '/api/v1/packages/publish',
) {
  const call = server.post.mock.calls.find((args: unknown[]) => args[0] === path);
  expect(call, `POST ${path} must be mounted for this case to mean anything`).toBeDefined();
  const { res, out } = captureRes();
  await (call as any)[1]({ method: 'POST', body, params: {}, query: {}, headers: {} }, res);
  return out;
}

/** Every `VERB /path` the registrar asked the server to mount. */
function mountedOn(server: ReturnType<typeof createMockServer>): string[] {
  const keys: string[] = [];
  for (const verb of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    for (const [path] of (server[verb] as any).mock.calls) keys.push(`${verb.toUpperCase()} ${path}`);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// the publish path always has an owner
// ---------------------------------------------------------------------------

describe('#7563 — POST /packages/publish is mounted with or without a `package` service', () => {
  it('mounts on a boot that resolves no package service at all', () => {
    const server = createMockServer();
    const returned = registerPackageRoutes(server as any, () => undefined, '/api/v1', AUTHED);

    expect(mountedOn(server)).toContain('POST /api/v1/packages/publish');
    // #5822's identity holds on this branch too: what is reported IS what was
    // mounted, not a table describing a different set.
    expect(returned.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /api/v1/packages/publish']);
  });

  it('keeps its hands off the three dispatcher twins when there is no service', () => {
    // The asymmetry, stated as a test so it cannot be "tidied up": these three
    // patterns are served by the runtime dispatcher on a package-service-less
    // stack, and a degraded REST shadow registered ahead of them would take
    // three working routes away.
    const server = createMockServer();
    registerPackageRoutes(server as any, () => undefined, '/api/v1', AUTHED);

    const keys = mountedOn(server);
    expect(keys).not.toContain('GET /api/v1/packages');
    expect(keys).not.toContain('GET /api/v1/packages/:id');
    expect(keys).not.toContain('DELETE /api/v1/packages/:id');
  });

  it('mounts the full surface when a package service is there', () => {
    const server = createMockServer();
    registerPackageRoutes(server as any, () => packageServiceStub() as any, '/api/v1', AUTHED);

    expect(mountedOn(server).sort()).toEqual([
      'DELETE /api/v1/packages/:id',
      'GET /api/v1/packages',
      'GET /api/v1/packages/:id',
      'POST /api/v1/packages/publish',
    ]);
  });
});

// ---------------------------------------------------------------------------
// what it answers, on each side of the gate
// ---------------------------------------------------------------------------

describe('#7563 — the publish route answers for itself instead of borrowing a 405', () => {
  it('404s with a message about THIS surface when no package service is composed', async () => {
    const server = createMockServer();
    registerPackageRoutes(server as any, () => undefined, '/api/v1', AUTHED);

    const out = await callPublish(server, { manifest: { id: 'com.acme.crm', version: '1.0.0' }, metadata: {} });
    expect(out.status).toBe(404);
    expect(out.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
    // Names the SURFACE, not a package id — the two 404s this module can emit
    // must not read alike.
    expect(out.body?.error?.message).toContain('marketplace publish surface');
    expect(out.body?.error?.message).not.toContain('com.acme.crm');
  });

  it('refuses an anonymous caller before disclosing whether the surface exists here', async () => {
    // The 404 is a fact about how the deployment is composed. Answering it to
    // an unauthenticated prober would make this seam a capability oracle, so
    // the anonymous floor runs first — same order as every other route here.
    const server = createMockServer();
    registerPackageRoutes(server as any, () => undefined, '/api/v1', {
      resolveExecutionContext: async () => ({ userId: null }),
    });

    const out = await callPublish(server);
    expect(out.status).toBe(401);
  });

  it('runs the real handler when the service arrives AFTER the mount decision', async () => {
    // The `objectstack serve` ordering, reproduced: the registrar is composed
    // while `getService('package')` still throws, and the service shows up
    // before the first request. Resolving per request is what makes this the
    // ordinary case rather than a silently degraded one.
    const server = createMockServer();
    let svc: ReturnType<typeof packageServiceStub> | undefined;
    registerPackageRoutes(server as any, () => svc as any, '/api/v1', AUTHED);

    // Composed with nothing there…
    expect(mountedOn(server)).toContain('POST /api/v1/packages/publish');

    // …the capability provider registers…
    svc = packageServiceStub();

    // …and the handler publishes for real.
    const out = await callPublish(server, { manifest: { id: 'com.acme.crm', version: '1.0.0' }, metadata: {} });
    expect(out.status).toBe(200);
    expect(svc.publish).toHaveBeenCalledWith({
      manifest: { id: 'com.acme.crm', version: '1.0.0' },
      metadata: {},
    });
    expect(out.body?.data?.message).toBe('Published com.acme.crm@1.0.0');
  });

  it('still validates the request body ahead of anything else it can refuse', async () => {
    const server = createMockServer();
    registerPackageRoutes(server as any, () => packageServiceStub() as any, '/api/v1', AUTHED);

    const out = await callPublish(server, {});
    expect(out.status).toBe(400);
    expect(out.body?.error?.code).toBe('MISSING_REQUIRED_FIELD');
  });
});

// ---------------------------------------------------------------------------
// through the composition production calls
// ---------------------------------------------------------------------------

describe('#7563 — the composition mounts publish on a service-less boot', () => {
  function compose(services: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    const server = createMockServer();
    const recorded: Array<{ method: string; path: string }> = [];
    mountAndRecordDirectRoutes({
      server: server as any,
      recorder: { recordDirectMountedRoutes: (routes) => { recorded.push(...routes.map((r) => ({ method: r.method, path: r.path }))); } },
      ctx: {
        getService: (name: string) => {
          if (name in services) return services[name];
          throw new Error(`Service '${name}' not found`);
        },
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      } as any,
      versionedBase: '/api/v1',
      ...extra,
    });
    return { server, recorded: recorded.map((r) => `${r.method} ${r.path}`) };
  }

  it('records the publish route — and only it — when `package` is absent', () => {
    const { server, recorded } = compose({});
    expect(mountedOn(server)).toContain('POST /api/v1/packages/publish');
    expect(recorded.filter((r) => r.includes('/packages'))).toEqual(['POST /api/v1/packages/publish']);
  });

  it('records all four when `package` is present', () => {
    const { recorded } = compose({ package: packageServiceStub() });
    expect(recorded.filter((r) => r.includes('/packages')).sort()).toEqual([
      'DELETE /api/v1/packages/:id',
      'GET /api/v1/packages',
      'GET /api/v1/packages/:id',
      'POST /api/v1/packages/publish',
    ]);
  });

  it('mirrors the publish route under the scoped base, on both bases, with no service', () => {
    // The scoped mirror used to exist only inside the service gate, so a
    // project-scoped deployment without the service had the same unowned path
    // twice.
    const { server } = compose({}, { enableProjectScoping: true, projectResolution: 'auto' });
    const keys = mountedOn(server);
    expect(keys).toContain('POST /api/v1/packages/publish');
    expect(keys).toContain('POST /api/v1/environments/:environmentId/packages/publish');
  });
});
