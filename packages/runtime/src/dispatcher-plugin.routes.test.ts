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
  const rec = (verb: string) => (path: string, _handler: unknown) => {
    routes.push(`${verb} ${path}`);
  };
  return {
    routes,
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

  it('also mounts a known existing route (sanity that start() ran)', async () => {
    const { server, routes } = makeFakeServer();
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(makeCtx(server));

    expect(routes).toContain('POST /api/v1/analytics/query');
  });

  it('honours a custom prefix', async () => {
    const { server, routes } = makeFakeServer();
    const plugin = createDispatcherPlugin({ prefix: '/v2', securityHeaders: false });
    await plugin.start?.(makeCtx(server));

    expect(routes).toContain('POST /v2/mcp');
    expect(routes).toContain('POST /v2/keys');
  });
});
