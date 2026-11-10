// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The three per-object bulk doors that answer a per-row report —
// `POST /data/:object/batch`, `/updateMany` and `/deleteMany` — answer
// `207 Multi-Status` when any row failed and `200` when none did, with the
// report as the body either way (`bulkReportStatus` in `batch-routes.ts`).
//
// A report whose every row failed used to answer `200 { success: false, … }`,
// so a client reading only the status counted it as written. The answer stays
// 2xx on purpose: the client SDK's shared `fetch` throws on any non-2xx, and
// the console reads the per-row `results` of `updateMany` / `deleteMany`. The
// SDK half is pinned over a real server in `@objectstack/client`'s
// `client.hono.test.ts`.

import { describe, it, expect, vi } from 'vitest';
// The server's source reaches `import('@objectstack/objectql')` inside a
// function; pay that load during collection, not inside a case's clock.
import '@objectstack/objectql';
import { RestServer } from './rest-server';

function createMockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRes() {
  const res: any = { statusCode: 200, body: undefined, statusCalls: [] as number[] };
  res.status = vi.fn((c: number) => { res.statusCode = c; res.statusCalls.push(c); return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn();
  return res;
}

const row = (index: number, ok: boolean) => ok
  ? { id: `r${index}`, success: true, index }
  : { id: `r${index}`, success: false, index, errors: [{ code: 'RECORD_NOT_FOUND', message: `Record r${index} not found`, httpStatus: 404 }] };

/** A protocol report of `total` rows, the first `failedCount` of them failed. */
function report(total: number, failedCount: number) {
  const results = Array.from({ length: total }, (_, i) => row(i, i >= failedCount));
  return { success: failedCount === 0, operation: 'update', total, succeeded: total - failedCount, failed: failedCount, results };
}

function setup(answer: unknown) {
  const protocol: any = {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue([{ name: 'invoice' }]),
    getMetaItem: vi.fn().mockResolvedValue({}),
    findData: vi.fn().mockResolvedValue([]),
    createManyData: vi.fn().mockResolvedValue({ object: 'invoice', records: [], count: 0 }),
    batchData: vi.fn().mockResolvedValue(answer),
    updateManyData: vi.fn().mockResolvedValue(answer),
    deleteManyData: vi.fn().mockResolvedValue(answer),
  };
  const rest = new RestServer(createMockServer() as any, protocol, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  return rest;
}

const DOORS = [
  ['POST /data/:object/batch', '/api/v1/data/:object/batch', { operation: 'update', records: [{ id: 'r0', data: { name: 'x' } }, { id: 'r1', data: { name: 'y' } }] }],
  ['POST /data/:object/updateMany', '/api/v1/data/:object/updateMany', { records: [{ id: 'r0', data: { name: 'x' } }, { id: 'r1', data: { name: 'y' } }] }],
  ['POST /data/:object/deleteMany', '/api/v1/data/:object/deleteMany', { ids: ['r0', 'r1'] }],
] as const;

async function post(answer: unknown, path: string, body: unknown) {
  const rest = setup(answer);
  const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === path);
  if (!route) throw new Error(`route not registered: ${path}`);
  const res = makeRes();
  await route.handler({ method: 'POST', params: { object: 'invoice' }, query: {}, body }, res);
  return res;
}

describe.each(DOORS)('%s answers 207 when a row failed, 200 when none did', (_door, path, body) => {
  it('every row failed: 207, and the body is the report unchanged', async () => {
    const answer = report(2, 2);
    const res = await post(answer, path, body);
    expect(res.statusCode).toBe(207);
    expect(res.body).toEqual(report(2, 2));
    expect(res.body).toBe(answer);
  });

  it('one row of two failed: 207', async () => {
    const res = await post(report(2, 1), path, body);
    expect(res.statusCode).toBe(207);
    expect(res.body).toEqual(report(2, 1));
  });

  it('CONTROL: no row failed: 200, the report unchanged', async () => {
    const res = await post(report(2, 0), path, body);
    expect(res.statusCode).toBe(200);
    expect(res.statusCalls).not.toContain(207);
    expect(res.body).toEqual(report(2, 0));
  });

  it('a report carrying no numeric `failed` answers 200, as before', async () => {
    const res = await post({ results: [] }, path, body);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ results: [] });
  });
});
