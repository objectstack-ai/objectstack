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

// ── [#8326] batch form — recordIds on the same request shape ─────────────────

/**
 * A deterministic fake security service: the record verdict is a pure function
 * of the recordId, so "batch answer ≡ N singular answers" is checkable as data
 * rather than as mock-call bookkeeping. `r_gone` plays the missing record —
 * the engine's fail-closed answer is `visible: false` with no `decidedBy`.
 */
function deterministicExplain() {
  return vi.fn(async (request: any) => {
    const base = { ...DECISION, object: request.object, operation: request.operation };
    if (!request.recordId) return base;
    if (request.recordId === 'r_gone') {
      return { ...base, record: { recordId: request.recordId, visible: false } };
    }
    const visible = request.recordId.endsWith('_ok');
    return {
      ...base,
      record: { recordId: request.recordId, visible, decidedBy: visible ? 'sharing' : 'rls' },
    };
  });
}

describe('[#8326] POST/GET /security/explain with recordIds (batch form)', () => {
  it('answers records[i] for recordIds[i] — same order, same length, duplicates per position', async () => {
    const explain = deterministicExplain();
    const { post } = buildServer(async () => ({ explain }), { callerCtx: CALLER });
    const res = mockRes();
    const recordIds = ['a_ok', 'b_no', 'r_gone', 'a_ok'];
    await post!.handler({ method: 'POST', params: {}, headers: {}, body: { object: 'task', operation: 'update', recordIds } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.records).toEqual([
      { recordId: 'a_ok', visible: true, decidedBy: 'sharing' },
      { recordId: 'b_no', visible: false, decidedBy: 'rls' },
      { recordId: 'r_gone', visible: false }, // missing record: fail closed, no decider
      { recordId: 'a_ok', visible: true, decidedBy: 'sharing' },
    ]);
    // The object-level trace rides along, without a singular `record` verdict.
    expect(res.body.allowed).toBe(true);
    expect(res.body.record).toBeUndefined();
    // Evaluation is the singular pipeline per unique id + one object-level
    // pass — the service never sees `recordIds`.
    for (const call of explain.mock.calls) expect(call[0].recordIds).toBeUndefined();
    expect(explain.mock.calls.map((c: any[]) => c[0].recordId).sort((a: any, b: any) => String(a).localeCompare(String(b))))
      .toEqual([undefined, 'a_ok', 'b_no', 'r_gone'].sort((a: any, b: any) => String(a).localeCompare(String(b))));
  });

  it('AGREEMENT: the batch answer equals N singular answers for the same records', async () => {
    const recordIds = ['a_ok', 'b_no', 'r_gone', 'c_ok'];

    // N singular round trips through the REAL handler.
    const singularVerdicts: unknown[] = [];
    for (const recordId of recordIds) {
      const { post } = buildServer(async () => ({ explain: deterministicExplain() }), { callerCtx: CALLER });
      const res = mockRes();
      await post!.handler({ method: 'POST', params: {}, headers: {}, body: { object: 'task', operation: 'update', recordId } } as any, res);
      expect(res.statusCode).toBe(200);
      singularVerdicts.push(res.body.record);
    }

    // One batch round trip through the REAL handler, same service semantics.
    const { post } = buildServer(async () => ({ explain: deterministicExplain() }), { callerCtx: CALLER });
    const res = mockRes();
    await post!.handler({ method: 'POST', params: {}, headers: {}, body: { object: 'task', operation: 'update', recordIds } } as any, res);
    expect(res.statusCode).toBe(200);

    expect(res.body.records).toEqual(singularVerdicts);
  });

  it('refuses a batch over the 200-id cap with 400 VALIDATION_FAILED (never truncates)', async () => {
    const explain = deterministicExplain();
    const { post } = buildServer(async () => ({ explain }), { callerCtx: CALLER });
    const res = mockRes();
    const recordIds = Array.from({ length: 201 }, (_, i) => `r_${i}_ok`);
    await post!.handler({ method: 'POST', params: {}, headers: {}, body: { object: 'task', operation: 'update', recordIds } } as any, res);

    // The refusal envelope: code AND status (ADR-0112 D5 position).
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(explain).not.toHaveBeenCalled();
  });

  it('refuses recordId + recordIds together with 400 (loud, no silent precedence) and an empty batch too', async () => {
    const explain = deterministicExplain();
    const { post } = buildServer(async () => ({ explain }), { callerCtx: CALLER });

    let res = mockRes();
    await post!.handler({ method: 'POST', params: {}, headers: {}, body: { object: 'task', operation: 'update', recordId: 'a_ok', recordIds: ['a_ok'] } } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');

    res = mockRes();
    await post!.handler({ method: 'POST', params: {}, headers: {}, body: { object: 'task', operation: 'update', recordIds: [] } } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(explain).not.toHaveBeenCalled();
  });

  it('POST does NOT wrap a bare-string recordIds — the JSON body can spell an array, so a string is a 400', async () => {
    const explain = deterministicExplain();
    const { post } = buildServer(async () => ({ explain }), { callerCtx: CALLER });
    const res = mockRes();
    await post!.handler({ method: 'POST', params: {}, headers: {}, body: { object: 'task', operation: 'update', recordIds: 'a_ok' } } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(explain).not.toHaveBeenCalled();
  });

  it('GET wraps a single repeated query param (a query string cannot spell a one-element array)', async () => {
    const explain = deterministicExplain();
    const { get } = buildServer(async () => ({ explain }), { callerCtx: CALLER });
    const res = mockRes();
    await get!.handler({ method: 'GET', params: {}, headers: {}, query: { object: 'task', operation: 'update', recordIds: 'a_ok' } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.records).toEqual([{ recordId: 'a_ok', visible: true, decidedBy: 'sharing' }]);
  });

  it('a singular request stays byte-compatible: no records[] key appears on the response', async () => {
    const explain = deterministicExplain();
    const { post } = buildServer(async () => ({ explain }), { callerCtx: CALLER });
    const res = mockRes();
    await post!.handler({ method: 'POST', params: {}, headers: {}, body: { object: 'task', operation: 'update', recordId: 'a_ok' } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.record).toEqual({ recordId: 'a_ok', visible: true, decidedBy: 'sharing' });
    expect('records' in res.body).toBe(false);
    expect(explain).toHaveBeenCalledTimes(1);
    expect(explain).toHaveBeenCalledWith({ object: 'task', operation: 'update', recordId: 'a_ok' }, CALLER);
  });

  it('fail-closes per record when the service predates record-grained explain (no record verdict answered)', async () => {
    // A pre-C2 service ignores recordId and returns object-level decisions only.
    const explain = vi.fn().mockResolvedValue(DECISION);
    const { post } = buildServer(async () => ({ explain }), { callerCtx: CALLER });
    const res = mockRes();
    await post!.handler({ method: 'POST', params: {}, headers: {}, body: { object: 'task', operation: 'update', recordIds: ['a', 'b'] } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.records).toEqual([
      { recordId: 'a', visible: false },
      { recordId: 'b', visible: false },
    ]);
  });
});
