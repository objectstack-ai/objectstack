// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

/**
 * Request-scoped memoization of `resolveExecCtx` (#2409). A single HTTP request
 * resolves the same execution context many times (data op, app-nav RBAC,
 * dashboard gating, auth gate). Each resolution is ~16 sequential queries, so we
 * memoize on the per-request `req` object + input environmentId. These tests pin
 * that contract by stubbing the heavy `computeExecCtx` and counting invocations.
 */
const httpServer: any = {
  get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
  use: vi.fn(), listen: vi.fn(), close: vi.fn(),
};
const protocol: any = {};

describe('RestServer.resolveExecCtx — request-scoped memoization (#2409)', () => {
  it('resolves once per request object and returns the cached instance', async () => {
    const rest: any = new RestServer(httpServer, protocol, { api: { requireAuth: false } } as any);
    let calls = 0;
    rest.computeExecCtx = async () => { calls++; return { userId: 'u1' }; };

    const req = { method: 'GET', path: '/x', headers: {} };
    const a = await rest.resolveExecCtx(undefined, req);
    const b = await rest.resolveExecCtx(undefined, req);

    expect(calls).toBe(1);
    expect(a).toBe(b);
  });

  it('re-resolves for a different request object', async () => {
    const rest: any = new RestServer(httpServer, protocol, { api: { requireAuth: false } } as any);
    let calls = 0;
    rest.computeExecCtx = async () => { calls++; return { userId: 'u1' }; };

    await rest.resolveExecCtx(undefined, { headers: {} });
    await rest.resolveExecCtx(undefined, { headers: {} });

    expect(calls).toBe(2);
  });

  it('keys the memo by environmentId within the same request', async () => {
    const rest: any = new RestServer(httpServer, protocol, { api: { requireAuth: false } } as any);
    let calls = 0;
    rest.computeExecCtx = async (env: any) => { calls++; return { env }; };

    const req = { headers: {} };
    await rest.resolveExecCtx('envA', req);
    await rest.resolveExecCtx('envA', req);
    await rest.resolveExecCtx('envB', req);

    expect(calls).toBe(2);
  });

  it('caches an anonymous (undefined) resolution so repeat callers do not re-resolve', async () => {
    const rest: any = new RestServer(httpServer, protocol, { api: { requireAuth: false } } as any);
    let calls = 0;
    rest.computeExecCtx = async () => { calls++; return undefined; };

    const req = { headers: {} };
    expect(await rest.resolveExecCtx(undefined, req)).toBeUndefined();
    expect(await rest.resolveExecCtx(undefined, req)).toBeUndefined();

    expect(calls).toBe(1);
  });
});
