// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// ADR-0090 D6 — REST face of the access-explanation engine (framework#2696).

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

// ── helpers ──────────────────────────────────────────────────────────────────

function mockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}
function mockProtocol() {
  return { getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }), getMetaTypes: vi.fn().mockResolvedValue([]), getMetaItems: vi.fn().mockResolvedValue([]) };
}
function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  return res;
}

const CALLER = { userId: 'u_admin', positions: ['everyone'], permissions: [], systemPermissions: ['manage_users'] };

const DECISION = {
  allowed: true,
  object: 'task',
  operation: 'read',
  principal: { userId: 'u_target', positions: ['everyone'], permissionSets: ['member_default'] },
  layers: [],
  readFilter: null,
};

/** Build a RestServer with an optional security provider (positional arg #18). */
function buildServer(securityProvider?: any, opts: { callerCtx?: any } = {}) {
  const server = mockServer();
  const rest = new RestServer(
    server as any, mockProtocol() as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    securityProvider,
  );
  // The route handler derives the caller context from the auth session; the
  // mock harness has no auth service, so stub the resolver directly.
  if ('callerCtx' in opts) {
    vi.spyOn(rest as any, 'resolveExecCtx').mockResolvedValue(opts.callerCtx);
  }
  rest.registerRoutes();
  const routes = rest.getRoutes().filter((r) => r.path.endsWith('/security/explain'));
  return {
    get: routes.find((r) => r.method === 'GET'),
    post: routes.find((r) => r.method === 'POST'),
  };
}

describe('GET/POST /security/explain (ADR-0090 D6)', () => {
  it('registers both transports of the route', () => {
    const { get, post } = buildServer(async () => ({ explain: vi.fn() }));
    expect(get).toBeTruthy();
    expect(post).toBeTruthy();
    expect(get!.metadata?.tags).toContain('security');
    expect(post!.metadata?.tags).toContain('security');
  });

  it('POST delegates the parsed request + caller context to security.explain', async () => {
    const explain = vi.fn().mockResolvedValue(DECISION);
    const { post } = buildServer(async () => ({ explain }), { callerCtx: CALLER });
    const res = mockRes();
    await post!.handler({ method: 'POST', params: {}, headers: {}, body: { object: 'task', operation: 'read', userId: 'u_target' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(DECISION);
    expect(explain).toHaveBeenCalledWith({ object: 'task', operation: 'read', userId: 'u_target' }, CALLER);
  });

  it('GET reads the request from the query string and defaults operation to read', async () => {
    const explain = vi.fn().mockResolvedValue(DECISION);
    const { get } = buildServer(async () => ({ explain }), { callerCtx: CALLER });
    const res = mockRes();
    await get!.handler({ method: 'GET', params: {}, headers: {}, query: { object: 'task' } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(explain).toHaveBeenCalledWith({ object: 'task', operation: 'read' }, CALLER);
  });

  it('is authenticated-only — an anonymous caller is 401ed before explain runs', async () => {
    const explain = vi.fn();
    const { post } = buildServer(async () => ({ explain }), { callerCtx: undefined });
    const res = mockRes();
    await post!.handler({ method: 'POST', params: {}, headers: {}, body: { object: 'task', operation: 'read' } } as any, res);

    // The shared anonymous-deny gate (#3963) catches this first now, so the code
    // is the uniform UNAUTHENTICATED rather than the route's own UNAUTHORIZED —
    // both 401, and explain never runs either way.
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('UNAUTHENTICATED');
    expect(explain).not.toHaveBeenCalled();
  });

  it('returns 400 for a missing object or unknown operation', async () => {
    const { post } = buildServer(async () => ({ explain: vi.fn() }), { callerCtx: CALLER });

    let res = mockRes();
    await post!.handler({ method: 'POST', params: {}, headers: {}, body: { operation: 'read' } } as any, res);
    expect(res.statusCode).toBe(400);
    // [#8073] The code moved from the retired FLAT position to the ADR-0112 D5
    // one. Same code, same 400 — `body.error.code` is where it is now declared.
    expect(res.body.error.code).toBe('VALIDATION_FAILED');

    res = mockRes();
    await post!.handler({ method: 'POST', params: {}, headers: {}, body: { object: 'task', operation: 'frobnicate' } } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it("maps the service's PermissionDeniedError to 403 (manage_users / D12 gate)", async () => {
    const denial = Object.assign(
      new Error("[Security] Access denied: explaining another user's access requires the 'manage_users' capability or a delegated adminScope covering that user (ADR-0090 D6/D12)."),
      { code: 'PERMISSION_DENIED', name: 'PermissionDeniedError' },
    );
    const { post } = buildServer(async () => ({ explain: vi.fn().mockRejectedValue(denial) }), { callerCtx: { userId: 'u_plain', positions: ['everyone'] } });
    const res = mockRes();
    await post!.handler({ method: 'POST', params: {}, headers: {}, body: { object: 'task', operation: 'read', userId: 'u_target' } } as any, res);

    expect(res.statusCode).toBe(403);
    // [#8073] Migrated from the flat `res.body.code` to the D5 position.
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('returns 501 when no security service exposes explain', async () => {
    for (const provider of [undefined, async () => ({ getReadFilter: vi.fn() })]) {
      const { post } = buildServer(provider as any, { callerCtx: CALLER });
      const res = mockRes();
      await post!.handler({ method: 'POST', params: {}, headers: {}, body: { object: 'task', operation: 'read' } } as any, res);
      expect(res.statusCode).toBe(501);
      // [#8073] Migrated from the flat `res.body.code` to the D5 position.
      expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
    }
  });

  it('maps unexpected service failures to 500', async () => {
    const { post } = buildServer(async () => ({ explain: vi.fn().mockRejectedValue(new Error('boom')) }), { callerCtx: CALLER });
    const res = mockRes();
    await post!.handler({ method: 'POST', params: {}, headers: {}, body: { object: 'task', operation: 'read' } } as any, res);
    expect(res.statusCode).toBe(500);
    // [#8073] Migrated from the flat `res.body.code`. This arm carried the OTHER
    // retired dialect too — `{ code, error: '<bare string>' }` — so its message
    // now lives at `body.error.message` rather than being `body.error` itself.
    expect(res.body.error.code).toBe('EXPLAIN_FAILED');
    expect(res.body.error.message).toBe('boom');
  });
});
