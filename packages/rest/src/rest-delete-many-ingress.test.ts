// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#3897] `POST /data/:object/deleteMany` used to splat the raw request body
// into the protocol request (`{ object, ...req.body }`), and the protocol then
// spread that body's `options` over its own `where` — so `options.where` /
// `options.multi` from the body reached `engine.delete` and turned "delete
// these ids" into "delete everything this caller can see". The route now parses
// the body against `DeleteManyDataRequestSchema`; Zod object schemas STRIP
// unknown keys, so the engine-level keys never survive the ingress.

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

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

function setup() {
  const deleteManyData = vi.fn().mockResolvedValue({
    success: true, operation: 'delete', total: 1, succeeded: 1, failed: 0, results: [],
  });
  const protocol: any = {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', endpoints: { data: '', metadata: '', ui: '', auth: '/auth' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue([{ name: 'invoice' }]),
    getMetaItem: vi.fn().mockResolvedValue({}),
    findData: vi.fn().mockResolvedValue([]),
    deleteManyData,
  };
  const rest = new RestServer(createMockServer() as any, protocol, { api: { requireAuth: false } } as any);
  rest.registerRoutes();
  return { rest, deleteManyData };
}

async function post(rest: any, body: any) {
  const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === DELETE_MANY);
  if (!route) throw new Error('deleteMany route not registered');
  const res = makeRes();
  await route.handler({ method: 'POST', params: { object: 'invoice' }, query: {}, body }, res);
  return res;
}

describe('POST /data/:object/deleteMany — ingress validation (#3897)', () => {
  it('forwards a well-formed request with the object taken from the path', async () => {
    const { rest, deleteManyData } = setup();
    const res = await post(rest, { ids: ['a', 'b'] });

    expect(res.statusCode).toBe(200);
    expect(deleteManyData).toHaveBeenCalledTimes(1);
    const req = deleteManyData.mock.calls[0][0];
    expect(req.object).toBe('invoice');
    expect(req.ids).toEqual(['a', 'b']);
  });

  it('strips engine-level keys smuggled through options (the issue payload)', async () => {
    const { rest, deleteManyData } = setup();
    const res = await post(rest, { ids: ['a'], options: { multi: true, where: {} } });

    expect(res.statusCode).toBe(200);
    const req = deleteManyData.mock.calls[0][0];
    expect(req.options?.where).toBeUndefined();
    expect(req.options?.multi).toBeUndefined();
    expect(req.ids).toEqual(['a']);
  });

  it('strips a body-supplied top-level where / multi', async () => {
    const { rest, deleteManyData } = setup();
    await post(rest, { ids: ['a'], where: {}, multi: true });

    const req = deleteManyData.mock.calls[0][0];
    expect(req.where).toBeUndefined();
    expect(req.multi).toBeUndefined();
  });

  it('strips a body-supplied context so the principal cannot be forged', async () => {
    const { rest, deleteManyData } = setup();
    // This route is reachable with `requireAuth: false`, so no execution
    // context is resolved — a body `context` would previously have been the
    // only one the protocol saw.
    await post(rest, { ids: ['a'], context: { userId: 'root', roles: ['admin'] } });

    expect(deleteManyData.mock.calls[0][0].context).toBeUndefined();
  });

  it('keeps the legitimate BatchOptions keys', async () => {
    const { rest, deleteManyData } = setup();
    await post(rest, { ids: ['a'], options: { atomic: false, continueOnError: true } });

    const req = deleteManyData.mock.calls[0][0];
    expect(req.options).toMatchObject({ atomic: false, continueOnError: true });
  });

  it('rejects a malformed body with 400 VALIDATION_FAILED and never calls the protocol', async () => {
    const { rest, deleteManyData } = setup();
    const res = await post(rest, { ids: [{ $ne: null }] });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(deleteManyData).not.toHaveBeenCalled();
  });

  it('rejects a missing ids list rather than forwarding an unscoped delete', async () => {
    const { rest, deleteManyData } = setup();
    const res = await post(rest, { options: { multi: true } });

    expect(res.statusCode).toBe(400);
    expect(deleteManyData).not.toHaveBeenCalled();
  });
});
