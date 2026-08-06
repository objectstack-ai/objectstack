// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#3933] The bulk write routes used to spread the request body OVER
// `object: req.params.object`, so a body key moved the write to a different
// object than the one in the URL. `enforceApiAccess` gates on `req.params.object`
// — so `enable.apiEnabled` / `enable.apiMethods` (ADR-0049 / #1889) was enforced
// on the object in the PATH while the object in the BODY got written. The path
// object is now written last, and the body is parsed against the spec contract
// (which also strips a body `context`).

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

const UPDATE_MANY = '/api/v1/data/:object/updateMany';
const DELETE_MANY = '/api/v1/data/:object/deleteMany';

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
  res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn();
  return res;
}

/**
 * `open` is exposed to the API; `locked` is not. The exploit points the URL at
 * `open` (so the gate clears) and names `locked` in the body.
 */
function setup() {
  const updateManyData = vi.fn().mockResolvedValue({
    success: true, operation: 'update', total: 1, succeeded: 1, failed: 0, results: [],
  });
  const deleteManyData = vi.fn().mockResolvedValue({
    success: true, operation: 'delete', total: 1, succeeded: 1, failed: 0, results: [],
  });
  const protocol: any = {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue([
      { name: 'open' },
      { name: 'locked', enable: { apiEnabled: false } },
    ]),
    getMetaItem: vi.fn().mockResolvedValue({}),
    findData: vi.fn().mockResolvedValue([]),
    updateManyData,
    deleteManyData,
  };
  const rest = new RestServer(createMockServer() as any, protocol, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  return { rest, updateManyData, deleteManyData };
}

async function post(rest: any, path: string, object: string, body: any) {
  const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === path);
  if (!route) throw new Error(`route not registered: ${path}`);
  const res = makeRes();
  await route.handler({ method: 'POST', params: { object }, query: {}, body }, res);
  return res;
}

const ONE_UPDATE = [{ id: 'r1', data: { name: 'x' } }];

describe('bulk writes bind to the object in the PATH (#3933)', () => {
  it('updateMany: a body `object` cannot redirect the write', async () => {
    const { rest, updateManyData } = setup();
    const res = await post(rest, UPDATE_MANY, 'open', { object: 'locked', records: ONE_UPDATE });

    expect(res.statusCode).toBe(200);
    expect(updateManyData.mock.calls[0][0].object).toBe('open');
  });

  it('deleteMany: a body `object` cannot redirect the delete', async () => {
    const { rest, deleteManyData } = setup();
    const res = await post(rest, DELETE_MANY, 'open', { object: 'locked', ids: ['r1'] });

    expect(res.statusCode).toBe(200);
    expect(deleteManyData.mock.calls[0][0].object).toBe('open');
  });

  it('the apiEnabled gate cannot be bypassed by naming the locked object in the body', async () => {
    const { rest, updateManyData, deleteManyData } = setup();
    // Sanity: addressed directly, `locked` is hidden (404, ADR-0049).
    expect((await post(rest, UPDATE_MANY, 'locked', { records: ONE_UPDATE })).statusCode).toBe(404);
    expect((await post(rest, DELETE_MANY, 'locked', { ids: ['r1'] })).statusCode).toBe(404);
    expect(updateManyData).not.toHaveBeenCalled();
    expect(deleteManyData).not.toHaveBeenCalled();

    // Via the exploit: the gate clears `open`, and `open` is what gets written.
    await post(rest, UPDATE_MANY, 'open', { object: 'locked', records: ONE_UPDATE });
    await post(rest, DELETE_MANY, 'open', { object: 'locked', ids: ['r1'] });
    expect(updateManyData.mock.calls.every((c) => c[0].object === 'open')).toBe(true);
    expect(deleteManyData.mock.calls.every((c) => c[0].object === 'open')).toBe(true);
  });
});

describe('updateMany ingress validation (#3933)', () => {
  it('never forwards a body-supplied context — the caller cannot forge the principal', async () => {
    const { rest, updateManyData } = setup();
    // An authenticated caller (the harness resolves `test-user`) tries to
    // escalate by putting `isSystem: true` in the body. The protocol must see
    // the RESOLVED context, never the body's — the body `context` is stripped.
    await post(rest, UPDATE_MANY, 'open', {
      records: ONE_UPDATE,
      context: { userId: 'nobody', isSystem: true, roles: ['admin'] },
    });

    const forwarded = updateManyData.mock.calls[0][0].context;
    expect(forwarded?.userId).toBe('test-user');
    expect(forwarded?.isSystem).toBeUndefined();
  });

  it('forwards a well-formed request unchanged', async () => {
    const { rest, updateManyData } = setup();
    const res = await post(rest, UPDATE_MANY, 'open', {
      records: ONE_UPDATE,
      options: { atomic: false, continueOnError: true },
    });

    expect(res.statusCode).toBe(200);
    const req = updateManyData.mock.calls[0][0];
    expect(req.records).toEqual(ONE_UPDATE);
    expect(req.options).toMatchObject({ atomic: false, continueOnError: true });
  });

  it('rejects a malformed records list with 400 VALIDATION_FAILED', async () => {
    const { rest, updateManyData } = setup();
    const res = await post(rest, UPDATE_MANY, 'open', { records: [{ data: { name: 'x' } }] });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    // The documented data-surface envelope (`fields[]`, wire-format §7), not a
    // second per-route shape.
    //
    // `required`, not `invalid_type` (ADR-0114 D3): `id` is ABSENT here, and Zod
    // spells absent as a type mismatch against `undefined`. This assertion used to
    // pin that passthrough, so it pinned a form marking a MISSING input as the
    // wrong TYPE — the message below still says "received undefined", which is
    // what the old code was reporting as a type error.
    expect(res.body.fields).toEqual([
      { field: 'records.0.id', code: 'required', message: expect.any(String) },
    ]);
    expect(updateManyData).not.toHaveBeenCalled();
  });
});
