// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// RestServer's data routes refuse a write to `sys_api_key` from a request an
// API key authenticated: changing a key is a signed-in-session act, the answer
// `/keys` gives. The rule is `@objectstack/core`'s
// `apiKeyManagementCredentialRefusal`, asked at `enforceApiAccess` (every
// single-object data route) and per op on the cross-object `POST /batch`, off
// the context's `__admittedBy` (the credential the shared resolver told
// `computeExecCtx`).
//
// The fixture's `sys_api_key` declares MORE methods than the shipped object
// (bulk included) on purpose: the shipped object's own `apiMethods` answer the
// bulk routes `405` before this rule is asked, so only a wider declaration
// reaches the rule there. Both halves are pinned per case: the refusal (status
// + `code`) with the protocol never asked, and the served write's arguments.

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

function createMockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.setHeader = vi.fn(); res.header = vi.fn(() => res); res.write = vi.fn(); res.end = vi.fn();
  return res;
}

function setup(admittedBy: 'api_key' | 'session' | undefined, sysApiKeyMethods = ['get', 'list', 'update', 'bulk']) {
  const updateData = vi.fn(async (req: any) => ({ object: req.object, id: req.id, record: { id: req.id, ...req.data } }));
  const updateManyData = vi.fn().mockResolvedValue({
    success: true, operation: 'update', total: 1, succeeded: 1, failed: 0, results: [],
  });
  const findData = vi.fn().mockResolvedValue({ object: 'sys_api_key', records: [], total: 0 });
  const items = [
    { name: 'sys_api_key', enable: { apiMethods: sysApiKeyMethods } },
    { name: 'open' },
  ];
  const protocol: any = {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue(items),
    getMetaItem: vi.fn(async (req: any) => ({ type: req?.type, name: req?.name, item: items.find((o) => o.name === req?.name) })),
    findData,
    updateData,
    updateManyData,
  };
  const transaction = vi.fn(async (fn: any) => fn({}));
  const engine: any = { transaction, update: vi.fn(async () => ({})), insert: vi.fn(), delete: vi.fn() };
  const rest = new RestServer(
    createMockServer() as any, protocol, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined,
    (async () => engine) as any,
  );
  (rest as any).resolveExecCtx = async () => ({ userId: 'u1', ...(admittedBy ? { __admittedBy: admittedBy } : {}) });
  rest.registerRoutes();
  const call = async (method: string, path: string, params: Record<string, string>, body?: unknown) => {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    if (!route) throw new Error(`route not registered: ${method} ${path}`);
    const res = makeRes();
    await route.handler({ method, params, query: {}, headers: {}, body } as any, res);
    return res;
  };
  return { call, updateData, updateManyData, findData, transaction };
}

const BY_ID = '/api/v1/data/:object/:id';
const LIST = '/api/v1/data/:object';
const UPDATE_MANY = '/api/v1/data/:object/updateMany';
const BATCH = '/api/v1/batch';

describe('RestServer data routes: changing an API key requires a signed-in session', () => {
  it('refuses PATCH sys_api_key from an API-key-admitted request — 403 PERMISSION_DENIED, protocol never asked', async () => {
    const { call, updateData } = setup('api_key');
    const res = await call('PATCH', BY_ID, { object: 'sys_api_key', id: 'k1' }, { revoked: false });
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
    expect(res.body.object).toBe('sys_api_key');
    expect(updateData).not.toHaveBeenCalled();
  });

  it('serves the same PATCH for a session-admitted request, with the patch it sent', async () => {
    const { call, updateData } = setup('session');
    const res = await call('PATCH', BY_ID, { object: 'sys_api_key', id: 'k1' }, { revoked: false });
    expect(res.statusCode).toBe(200);
    expect(updateData).toHaveBeenCalledTimes(1);
    expect(updateData.mock.calls[0][0]).toMatchObject({ object: 'sys_api_key', id: 'k1', data: { revoked: false } });
  });

  it('serves it for a context that names no credential (the rule is positive on the credential)', async () => {
    const { call, updateData } = setup(undefined);
    const res = await call('PATCH', BY_ID, { object: 'sys_api_key', id: 'k1' }, { revoked: true });
    expect(res.statusCode).toBe(200);
    expect(updateData).toHaveBeenCalledTimes(1);
  });

  it('leaves reads of sys_api_key, and writes to other objects, alone for an API-key-admitted request', async () => {
    const { call, updateData, findData } = setup('api_key');
    expect((await call('GET', LIST, { object: 'sys_api_key' })).statusCode).toBe(200);
    expect(findData).toHaveBeenCalledTimes(1);
    const other = await call('PATCH', BY_ID, { object: 'open', id: 'o1' }, { name: 'x' });
    expect(other.statusCode).toBe(200);
    expect(updateData.mock.calls[0][0].object).toBe('open');
  });

  it('an operation the object does not expose keeps its 405, ahead of the credential rule', async () => {
    const { call, updateData } = setup('api_key', ['get', 'list']);
    const res = await call('PATCH', BY_ID, { object: 'sys_api_key', id: 'k1' }, { revoked: false });
    expect(res.statusCode).toBe(405);
    expect(res.body.code).toBe('OBJECT_API_METHOD_NOT_ALLOWED');
    expect(updateData).not.toHaveBeenCalled();
  });

  it('refuses the per-object bulk route the same way', async () => {
    const { call, updateManyData } = setup('api_key');
    const res = await call('POST', UPDATE_MANY, { object: 'sys_api_key' }, { records: [{ id: 'k1', data: { revoked: true } }] });
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
    expect(updateManyData).not.toHaveBeenCalled();
  });

  it('refuses a cross-object batch naming sys_api_key before the transaction opens, and serves one that does not', async () => {
    const refused = setup('api_key');
    const res = await refused.call('POST', BATCH, {}, {
      operations: [{ object: 'sys_api_key', action: 'update', id: 'k1', data: { revoked: true } }],
    });
    expect(res.statusCode).toBe(403);
    expect(res.body.code ?? res.body.error?.code).toBe('PERMISSION_DENIED');
    expect(refused.transaction).not.toHaveBeenCalled();

    const served = setup('api_key');
    const ok = await served.call('POST', BATCH, {}, {
      operations: [{ object: 'open', action: 'update', id: 'o1', data: { name: 'x' } }],
    });
    expect(ok.statusCode, JSON.stringify(ok.body)).toBe(200);
    expect(served.transaction).toHaveBeenCalledTimes(1);
  });
});
