// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#3939] "max 200" was declared on three Zod schemas and in the docs, and
// enforced on exactly one route (the cross-object /batch, which checked the
// CONFIGURED maxBatchSize rather than the hardcoded 200). Every per-object bulk
// route took an unbounded list — which #3897 made expensive as well as rude,
// since deleteMany now costs one engine round-trip per id.
//
// The cap now lives at the route, driven by `batch.maxBatchSize`, on all of
// them, with one envelope.

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';
import { httpRequestForRoute } from './http-request-test-builder.js';

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

function setup(maxBatchSize?: number) {
  const spies = {
    createManyData: vi.fn().mockResolvedValue({ object: 'invoice', records: [], count: 0 }),
    updateManyData: vi.fn().mockResolvedValue({ success: true, total: 0, succeeded: 0, failed: 0, results: [] }),
    deleteManyData: vi.fn().mockResolvedValue({ success: true, total: 0, succeeded: 0, failed: 0, results: [] }),
    batchData: vi.fn().mockResolvedValue({ success: true, total: 0, succeeded: 0, failed: 0, results: [] }),
  };
  const protocol: any = {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue([{ name: 'invoice' }]),
    getMetaItem: vi.fn().mockResolvedValue({}),
    findData: vi.fn().mockResolvedValue([]),
    ...spies,
  };
  // The cross-object /batch route 501s without an ObjectQL provider that can
  // open a transaction, so give it one — the cap check sits behind that gate.
  const ql = { transaction: vi.fn(async (fn: any) => fn({})) };
  const rest = new RestServer(
    createMockServer() as any,
    protocol,
    { api: { requireAuth: false }, ...(maxBatchSize !== undefined ? { batch: { maxBatchSize } } : {}) } as any,
    undefined, undefined, undefined, undefined, // kernelManager, envRegistry, defaultEnvIdProvider, authServiceProvider
    async () => ql,                             // objectQLProvider (positional arg #8)
  );
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  return { rest, ql, ...spies };
}

async function post(rest: any, path: string, body: any) {
  const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === path);
  if (!route) throw new Error(`route not registered: ${path}`);
  const res = makeRes();
  await route.handler({ method: 'POST', params: { object: 'invoice' }, query: {}, body }, res);
  return res;
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`);
const updates = (n: number) => ids(n).map((id) => ({ id, data: { name: id } }));
const creates = (n: number) => ids(n).map((id) => ({ name: id }));

const DELETE_MANY = '/api/v1/data/:object/deleteMany';
const UPDATE_MANY = '/api/v1/data/:object/updateMany';
const CREATE_MANY = '/api/v1/data/:object/createMany';
const OBJ_BATCH = '/api/v1/data/:object/batch';

describe('bulk routes enforce the configured batch cap (#3939)', () => {
  it('deleteMany: 201 ids against a default cap of 200 → 400, protocol never called', async () => {
    const { rest, deleteManyData } = setup();
    const res = await post(rest, DELETE_MANY, { ids: ids(201) });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'BATCH_TOO_LARGE', count: 201, max: 200, object: 'invoice' });
    expect(deleteManyData).not.toHaveBeenCalled();
  });

  it('updateMany: 201 records → 400, protocol never called', async () => {
    const { rest, updateManyData } = setup();
    const res = await post(rest, UPDATE_MANY, { records: updates(201) });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'BATCH_TOO_LARGE', count: 201, max: 200 });
    expect(updateManyData).not.toHaveBeenCalled();
  });

  it('createMany: 201 records (bare array body) → 400, protocol never called', async () => {
    const { rest, createManyData } = setup();
    const res = await post(rest, CREATE_MANY, creates(201));

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'BATCH_TOO_LARGE', count: 201, max: 200 });
    expect(createManyData).not.toHaveBeenCalled();
  });

  it('per-object batch: 201 records → 400, protocol never called', async () => {
    const { rest, batchData } = setup();
    const res = await post(rest, OBJ_BATCH, { operation: 'update', records: updates(201) });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'BATCH_TOO_LARGE', count: 201, max: 200 });
    expect(batchData).not.toHaveBeenCalled();
  });

  it('exactly at the cap still goes through', async () => {
    const { rest, deleteManyData } = setup();
    const res = await post(rest, DELETE_MANY, { ids: ids(200) });

    expect(res.statusCode).toBe(200);
    expect(deleteManyData).toHaveBeenCalledTimes(1);
  });

  it('the cap follows the deployment config, not a hardcoded 200', async () => {
    // Raised: 500 is fine when the deployment says so.
    const raised = setup(500);
    expect((await post(raised.rest, DELETE_MANY, { ids: ids(300) })).statusCode).toBe(200);
    expect(raised.deleteManyData).toHaveBeenCalledTimes(1);

    // Lowered: 10 rejects what the default would have accepted.
    const lowered = setup(10);
    const res = await post(lowered.rest, DELETE_MANY, { ids: ids(11) });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'BATCH_TOO_LARGE', count: 11, max: 10 });
    expect(lowered.deleteManyData).not.toHaveBeenCalled();
  });

  it('a shape error still wins over the size error', async () => {
    // Both wrong: 201 entries AND the wrong entry type. The caller hears about
    // the shape first — it is the more specific answer.
    const { rest } = setup();
    const res = await post(rest, DELETE_MANY, { ids: ids(201).map((id) => ({ id })) });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('cross-object batch reports the cap like everyone else (#3939)', () => {
  it('carries BATCH_TOO_LARGE instead of a bare error string', async () => {
    const { rest, ql } = setup(5);
    const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/batch');
    const res = makeRes();
    await route!.handler(httpRequestForRoute(route!, {
      body: { operations: ids(6).map((id) => ({ object: 'invoice', action: 'delete', id })) },
    }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'BATCH_TOO_LARGE', count: 6, max: 5 });
    // Rejected before anything was written.
    expect(ql.transaction).not.toHaveBeenCalled();
  });
});
