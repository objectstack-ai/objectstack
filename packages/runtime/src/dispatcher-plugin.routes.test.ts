// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

/**
 * Regression: the dispatcher mounts routes EXPLICITLY on the HTTP server (there
 * is no catch-all). A dispatch() branch with no matching `server.<verb>()`
 * registration is unreachable over HTTP and 404s before reaching the handler —
 * which is exactly how /mcp and /keys shipped broken (unit tests called the
 * handlers directly, hiding it). This test asserts the routes are registered.
 */

function makeFakeServer() {
  const routes: string[] = [];
  const handlers: Record<string, (req: any, res: any) => any> = {};
  const rec = (verb: string) => (path: string, handler: any) => {
    routes.push(`${verb} ${path}`);
    handlers[`${verb} ${path}`] = handler;
  };
  return {
    routes,
    handlers,
    server: {
      get: rec('GET'),
      post: rec('POST'),
      put: rec('PUT'),
      delete: rec('DELETE'),
      patch: rec('PATCH'),
    },
  };
}

function makeCtx(fakeServer: any) {
  const kernel = {
    getService: () => undefined,
    getServiceAsync: async () => undefined,
  };
  return {
    getKernel: () => kernel,
    getService: (name: string) => (name === 'http.server' ? fakeServer : undefined),
    environmentId: undefined,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    hook: () => {},
    on: () => {},
  } as any;
}

describe('createDispatcherPlugin — HTTP route registration', () => {
  it('mounts /mcp (GET/POST/DELETE) and /keys (POST) so they reach dispatch()', async () => {
    const { server, routes } = makeFakeServer();
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(makeCtx(server));

    expect(routes).toContain('POST /api/v1/mcp');
    expect(routes).toContain('GET /api/v1/mcp');
    expect(routes).toContain('DELETE /api/v1/mcp');
    expect(routes).toContain('POST /api/v1/keys');
  });

  // Regression (#7649): /mcp/skill was mounted for GET ONLY. The route serves
  // GET and nothing else, so that looked right — but the dispatcher owns a 405
  // branch for the other verbs ("Method not allowed — use GET", built through
  // `buildApiError` since #3842), and an unmounted verb never reaches it: Hono
  // sends it to `notFound`, where the adapter's `unmatchedResponse()` answers
  // 405 with its own hand-rolled `{error, code, message, method, path, allowed}`
  // body. Same status, different envelope, and the domain branch dead code.
  // Mounting the verbs is what routes the mismatch to the branch that exists.
  // The envelope itself is pinned end-to-end in
  // `mcp-skill-method-not-allowed.hono.integration.test.ts` — a status-only
  // assertion cannot see this defect.
  it('mounts /mcp/skill for the same verbs as /mcp so a method mismatch reaches the dispatcher 405', async () => {
    const { server, routes } = makeFakeServer();
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(makeCtx(server));

    expect(routes).toContain('GET /api/v1/mcp/skill');
    expect(routes).toContain('POST /api/v1/mcp/skill');
    expect(routes).toContain('DELETE /api/v1/mcp/skill');
  });

  // Regression (framework #2217 seam #2): /ready shipped with a dispatch()
  // branch but NO server.<verb>() registration, so it 404'd over HTTP before
  // reaching the handler — the same class of bug as /mcp and /keys. /health and
  // /ready are the k8s / load-balancer probes the EE rolling-restart drain gate
  // polls (cloud ADR-0018); both must be mounted to be reachable.
  it('mounts /health and /ready so the liveness/readiness probes reach dispatch()', async () => {
    const { server, routes } = makeFakeServer();
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(makeCtx(server));

    expect(routes).toContain('GET /api/v1/health');
    expect(routes).toContain('GET /api/v1/ready');
  });

  // Regression: PATCH /packages/:id (edit a package's manifest — name /
  // description / version) had a handlePackages() branch all along but NO
  // server.patch() registration, so it 405'd over HTTP and the Studio "edit
  // package" form silently failed. Same class of bug as /ready above. The
  // sibling /:id/enable|disable PATCH routes were mounted; the bare /:id was not.
  it('mounts PATCH /packages/:id so the edit-manifest form reaches dispatch()', async () => {
    const { server, routes } = makeFakeServer();
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(makeCtx(server));

    expect(routes).toContain('PATCH /api/v1/packages/:id');
    // Sanity: the sibling routes that WERE always mounted.
    expect(routes).toContain('PATCH /api/v1/packages/:id/enable');
    expect(routes).toContain('POST /api/v1/packages');
  });

  // Regression: the in-app notifications surface (ADR-0030) — inbox list +
  // receipt mark-read — had a `handleNotification` dispatch() branch and a
  // discovery entry, but NO server.<verb>() registration, so every
  // `/api/v1/notifications*` request 404'd on the standalone / `os dev` server
  // (only the cloud hosts' hono catch-all reached it). That left mark-read with
  // no working endpoint — the console's direct receipt write is rejected by
  // ADR-0103's engine-owned gate — so unread notifications could never clear.
  it('mounts /notifications (GET list, POST read, POST read/all) so mark-read reaches dispatch()', async () => {
    const { server, routes } = makeFakeServer();
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(makeCtx(server));

    expect(routes).toContain('GET /api/v1/notifications');
    expect(routes).toContain('POST /api/v1/notifications/read');
    expect(routes).toContain('POST /api/v1/notifications/read/all');
  });

  it('also mounts a known existing route (sanity that start() ran)', async () => {
    const { server, routes } = makeFakeServer();
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(makeCtx(server));

    expect(routes).toContain('GET /api/v1/i18n/locales');
  });

  // [#3891 follow-through] The /analytics wire surface exists only when the
  // capability does: with no `analytics` service registered (and no
  // kernel-resolver), the three routes are NOT mounted — the path answers the
  // adapter's shared 404, with no 405 Allow hint for an API that isn't there.
  describe('capability-conditional /analytics mounting', () => {
    const ANALYTICS_ROUTES = [
      'POST /api/v1/analytics/query',
      'GET /api/v1/analytics/meta',
      'POST /api/v1/analytics/sql',
    ];

    function ctxWithServices(fakeServer: any, services: Record<string, any>) {
      const kernel = {
        getService: (name: string) => services[name],
        getServiceAsync: async (name: string) => services[name],
      };
      return {
        getKernel: () => kernel,
        getService: (name: string) => (name === 'http.server' ? fakeServer : undefined),
        environmentId: undefined,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        hook: () => {}, on: () => {},
      } as any;
    }

    it('does NOT mount /analytics when no analytics service is registered', async () => {
      const { server, routes } = makeFakeServer();
      const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
      await plugin.start?.(makeCtx(server));

      for (const r of ANALYTICS_ROUTES) expect(routes).not.toContain(r);
    });

    it('mounts /analytics when the analytics service is registered', async () => {
      const { server, routes } = makeFakeServer();
      const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
      await plugin.start?.(ctxWithServices(server, { analytics: { query: async () => ({ rows: [] }) } }));

      for (const r of ANALYTICS_ROUTES) expect(routes).toContain(r);
    });

    // [#4000] "Registered" is not the test — `handlerReady` is (ADR-0076 D12).
    // plugin-dev used to fill this slot with a stub, which mounted the three
    // routes and served its fabricated rows with a 200. The stub is retired,
    // and the mount gate now reads the same predicate the domain does, so the
    // wire surface can't advertise routes that could only 404.
    it('does NOT mount /analytics when the registered analytics service self-declares as a stub', async () => {
      const { server, routes } = makeFakeServer();
      const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
      await plugin.start?.(ctxWithServices(server, {
        analytics: { __serviceInfo: { status: 'stub' }, query: async () => ({ rows: [], fields: [] }) },
      }));

      for (const r of ANALYTICS_ROUTES) expect(routes).not.toContain(r);
    });

    it('DOES mount /analytics for a degraded-but-serving analytics service', async () => {
      const { server, routes } = makeFakeServer();
      const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
      await plugin.start?.(ctxWithServices(server, {
        analytics: { __serviceInfo: { status: 'degraded' }, query: async () => ({ rows: [] }) },
      }));

      for (const r of ANALYTICS_ROUTES) expect(routes).toContain(r);
    });

    it('mounts /analytics unconditionally on a multi-tenant host (kernel-resolver wired)', async () => {
      // Host-global mounts, per-project services: presence is a per-request
      // question the analytics domain answers (`handled:false` → 404), so the
      // mount must not depend on the DEFAULT kernel's service registry.
      const { server, routes } = makeFakeServer();
      const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
      await plugin.start?.(ctxWithServices(server, {
        'kernel-resolver': { resolveKernel: async (_ctx: any, def: any) => def },
      }));

      for (const r of ANALYTICS_ROUTES) expect(routes).toContain(r);
    });
  });

  it('honours a custom prefix', async () => {
    const { server, routes } = makeFakeServer();
    const plugin = createDispatcherPlugin({ prefix: '/v2', securityHeaders: false });
    await plugin.start?.(makeCtx(server));

    expect(routes).toContain('POST /v2/mcp');
    expect(routes).toContain('POST /v2/keys');
  });

  // cloud#152: discovery reflects mutable runtime config (e.g. routes.mcp toggles
  // with OS_MCP_SERVER_ENABLED). It must be served Cache-Control: no-store so an
  // edge/CDN never serves a stale payload after the config changes.
  it('serves both discovery routes with Cache-Control: no-store', async () => {
    const { server, handlers } = makeFakeServer();
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(makeCtx(server));

    for (const route of ['GET /.well-known/objectstack', 'GET /api/v1/discovery']) {
      const handler = handlers[route];
      expect(handler, `${route} should be registered`).toBeTypeOf('function');
      const headers: Record<string, string> = {};
      const res: any = {
        header: (k: string, v: string) => { headers[k] = v; },
        json: () => {},
      };
      await handler({}, res);
      expect(headers['Cache-Control'], `${route} Cache-Control`).toBe('no-store');
    }
  });

  // ADR-0076 D11 / OQ#9 — single owner for ${prefix}/discovery. When the REST
  // plugin is registered on the same kernel it serves /api/v1/discovery itself;
  // which payload a client saw used to depend on plugin start order
  // (first-registration-wins). The bridge must cede the route deterministically
  // and keep /.well-known/objectstack (dispatcher-owned, no other registrant).
  it('cedes /api/v1/discovery to the REST plugin when it is registered', async () => {
    const { server, routes } = makeFakeServer();
    const ctx = makeCtx(server);
    ctx.getKernel().hasPlugin = (name: string) => name === 'com.objectstack.rest.api';
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(ctx);

    expect(routes).not.toContain('GET /api/v1/discovery');
    expect(routes).toContain('GET /.well-known/objectstack');
    // Non-discovery routes are unaffected by the cession.
    expect(routes).toContain('GET /api/v1/packages');
  });

  // [#3913 follow-up] The exact bug this file's header describes, committed
  // again: `handleActionsRequest` learned to route the OBJECT-LESS shape
  // `POST /actions//:action` at the canonical 'global' key, and its unit tests
  // called `handleActions()` / `dispatch()` DIRECTLY — so they passed while the
  // path had no `server.post()` of its own. `:object` does not match an empty
  // segment, so over real HTTP the request fell through to Hono's `notFound`
  // and answered a bare `{error: 'Not found'}` with the domain never running.
  // Found by dogfooding, not by the suite. Assert the registration, which is
  // the only thing that makes the branch reachable.
  it('mounts the object-less action shape /actions//:action so it reaches dispatch()', async () => {
    const { server, routes } = makeFakeServer();
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(makeCtx(server));

    expect(routes).toContain('POST /api/v1/actions//:action');
    // The object-scoped shapes must keep their registrations — the empty-segment
    // route is additive and must not replace or shadow them.
    expect(routes).toContain('POST /api/v1/actions/:object/:action');
    expect(routes).toContain('POST /api/v1/actions/:object/:action/:recordId');
  });
});
