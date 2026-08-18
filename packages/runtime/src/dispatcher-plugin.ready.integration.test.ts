// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';

import { createDispatcherPlugin } from './dispatcher-plugin.js';
import type { IHttpServer } from '@objectstack/spec/contracts';

/**
 * Integration regression for framework #2217 seam #2.
 *
 * The dispatcher's GET /ready branch had a passing UNIT test that called
 * `dispatch()` directly — but in a real server the route was never mounted on
 * the HTTP layer, so it 404'd with the Hono not-found body (`{"error":"Not
 * found"}`) BEFORE reaching the handler. A dispatch()-only test cannot catch
 * that; this one boots the actual HTTP stack (HonoServerPlugin + the dispatcher
 * plugin), opens a real socket and uses `fetch`, exactly like a k8s / load
 * balancer readiness probe (the EE rolling-restart drain gate — cloud ADR-0018).
 */
describe('GET /ready over a real HTTP server (integration)', () => {
  let kernel: LiteKernel;
  let baseUrl: string;

  beforeAll(async () => {
    kernel = new LiteKernel();
    // port 0 → OS-assigned free port; resolved via getPort() after listening.
    kernel.use(new HonoServerPlugin({ port: 0 }));
    kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false }));

    await kernel.bootstrap();

    const httpServer = kernel.getService<IHttpServer>('http.server');
    baseUrl = `http://127.0.0.1:${httpServer.getPort!()}`;
  }, 30_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([
        kernel.shutdown(),
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }
  }, 30_000);

  it('returns 200 with state "running" once bootstrapped', async () => {
    const res = await fetch(`${baseUrl}/api/v1/ready`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ready');
    expect(body.data.state).toBe('running');
  });

  it('mounts /health alongside /ready (both probes reachable)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('ok');
  });

  it('proves the harness mirrors prod: an unmounted path 404s with the adapter not-found body', async () => {
    // This is the exact response /ready produced BEFORE the fix. Asserting it
    // here shows the test would have failed against the old code (the /ready
    // assertion above would have returned this body), not passed vacuously.
    const res = await fetch(`${baseUrl}/api/v1/this-route-does-not-exist`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
        success: false,
        error: { code: 'ENDPOINT_NOT_FOUND', message: 'Not found' },
    });
  });

  it('returns 503 while the kernel is shutting down (drain signal)', async () => {
    // The server socket must stay open to serve the probe, so we can't call
    // shutdown() (it closes the socket). Instead simulate the draining state
    // the dispatcher reads per-request via kernel.getState().
    const realGetState = kernel.getState.bind(kernel);
    (kernel as any).getState = () => 'stopping';
    try {
      const res = await fetch(`${baseUrl}/api/v1/ready`);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.success).toBe(false);
      // [#3842] The status moved to `httpStatus`; `code` is the semantic string,
      // derived from 503 since /ready carries no code of its own.
      expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(body.error.httpStatus).toBe(503);
      expect(body.error.details.state).toBe('stopping');
    } finally {
      (kernel as any).getState = realGetState;
    }
  });
});
