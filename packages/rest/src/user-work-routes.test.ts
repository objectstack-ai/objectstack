// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// [#30205] The REST face of a user's assigned work: the counts and the hand-over.

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

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

const CALLER = { userId: 'u_admin', tenantId: 'org_1' };

/** A data engine with one ticket object: the slice the routes call. */
function mockEngine() {
  const rows = [
    { id: 't1', owner_id: 'u_gone' },
    { id: 't2', owner_id: 'u_gone' },
  ];
  const users = [{ id: 'u_gone', banned: true }, { id: 'u_next', banned: false }];
  return {
    rows,
    getConfigs: () => ({ ticket: { name: 'ticket', fields: { owner_id: { type: 'lookup', reference: 'sys_user' } } } }),
    count: vi.fn(async (_o: string, q: any) => rows.filter((r) => r.owner_id === q.where.owner_id).length),
    find: vi.fn(async (o: string, q: any) => (o === 'sys_user' ? users : rows).filter((r: any) =>
      Object.entries(q.where).every(([k, v]) => r[k] === v)).slice(0, q.limit ?? Infinity)),
    update: vi.fn(async (_o: string, data: any, opts: any) => {
      const row = rows.find((r) => r.id === opts.where.id)!;
      Object.assign(row, data);
      return row;
    }),
  };
}

function buildServer(engine: any, callerCtx: any = CALLER) {
  const rest = new RestServer(
    mockServer() as any, mockProtocol() as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined,
    engine === undefined ? undefined : async () => engine,
  );
  vi.spyOn(rest as any, 'resolveExecCtx').mockResolvedValue(callerCtx);
  rest.registerRoutes();
  const routes = rest.getRoutes();
  return {
    get: routes.find((r) => r.method === 'GET' && r.path === '/api/v1/security/users/:id/assigned-work'),
    post: routes.find((r) => r.method === 'POST' && r.path === '/api/v1/security/users/:id/assigned-work/transfer'),
  };
}

describe('[#30205] GET /security/users/:id/assigned-work', () => {
  it('answers the per-object counts, read as the caller', async () => {
    const engine = mockEngine();
    const { get } = buildServer(engine);
    const res = mockRes();
    await get!.handler({ method: 'GET', params: { id: 'u_gone' }, headers: {}, query: {} } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        userId: 'u_gone',
        objects: [{ object: 'ticket', field: 'owner_id', count: 2, transferable: true }],
        total: 2,
        truncated: false,
        unreadable: [],
      },
    });
    expect(engine.count).toHaveBeenCalledWith('ticket', { where: { owner_id: 'u_gone' }, context: CALLER });
  });

  it('refuses an unknown query parameter instead of dropping it, and counts nothing', async () => {
    const engine = mockEngine();
    const { get } = buildServer(engine);
    const res = mockRes();
    await get!.handler({ method: 'GET', params: { id: 'u_gone' }, headers: {}, query: { object: 'ticket' } } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(engine.count).not.toHaveBeenCalled();
  });

  it('an anonymous caller is refused before anything is counted', async () => {
    const engine = mockEngine();
    const { get } = buildServer(engine, null);
    const res = mockRes();
    await get!.handler({ method: 'GET', params: { id: 'u_gone' }, headers: {}, query: {} } as any, res);
    expect(res.statusCode).toBe(401);
    expect(engine.count).not.toHaveBeenCalled();
  });

  it('answers 501 when no data engine is wired', async () => {
    const { get } = buildServer(undefined);
    const res = mockRes();
    await get!.handler({ method: 'GET', params: { id: 'u_gone' }, headers: {}, query: {} } as any, res);
    expect(res.statusCode).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });
});

describe('[#30205] POST /security/users/:id/assigned-work/transfer', () => {
  it('hands the records over through update, as the caller, and reports the outcome', async () => {
    const engine = mockEngine();
    const { post } = buildServer(engine);
    const res = mockRes();
    await post!.handler({ method: 'POST', params: { id: 'u_gone' }, headers: {}, query: {}, body: { toUserId: 'u_next' } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({ updated: 2, failed: 0, remaining: 0, toUserId: 'u_next' });
    expect(engine.update).toHaveBeenCalledWith('ticket', { owner_id: 'u_next' }, { where: { id: 't1' }, context: CALLER });
    expect(engine.rows.every((r) => r.owner_id === 'u_next')).toBe(true);
  });

  it('refuses a banned target with the field code, and writes nothing', async () => {
    const engine = mockEngine();
    const { post } = buildServer(engine);
    const res = mockRes();
    await post!.handler({ method: 'POST', params: { id: 'u_next' }, headers: {}, query: {}, body: { toUserId: 'u_gone' } } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields[0]).toMatchObject({ field: 'toUserId', code: 'reference_user_banned' });
    expect(engine.update).not.toHaveBeenCalled();
  });

  it('refuses an unknown body key, and a missing toUserId, before any read', async () => {
    for (const body of [{ toUserId: 'u_next', dryRun: true }, {}, { toUserId: 'u_next', objects: 'ticket' }]) {
      const engine = mockEngine();
      const { post } = buildServer(engine);
      const res = mockRes();
      await post!.handler({ method: 'POST', params: { id: 'u_gone' }, headers: {}, query: {}, body } as any, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(engine.find).not.toHaveBeenCalled();
    }
  });
});
