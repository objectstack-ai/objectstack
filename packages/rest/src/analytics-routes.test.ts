// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

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
  return { getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', endpoints: {} }), getMetaTypes: vi.fn().mockResolvedValue([]), getMetaItems: vi.fn().mockResolvedValue([]) };
}
function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  return res;
}

const inlineDataset = {
  name: 'sales', label: 'Sales', object: 'opportunity', include: ['account'],
  dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};
const selection = { dimensions: ['region'], measures: ['revenue'] };

/** Build a RestServer with an optional analytics provider (positional arg #15). */
function buildServer(analyticsProvider?: any) {
  const server = mockServer();
  const rest = new RestServer(
    server as any, mockProtocol() as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    analyticsProvider,
  );
  rest.registerRoutes();
  const route = rest.getRoutes().find((r) => r.method === 'POST' && r.path.endsWith('/analytics/dataset/query'));
  return { route };
}

describe('POST /analytics/dataset/query', () => {
  it('registers the route', () => {
    const { route } = buildServer(async () => ({ queryDataset: vi.fn() }));
    expect(route).toBeTruthy();
    expect(route!.metadata?.tags).toContain('analytics');
  });

  it('runs an inline dataset through the analytics service and returns rows', async () => {
    const queryDataset = vi.fn().mockResolvedValue({ rows: [{ region: 'NA', revenue: 100 }], fields: [] });
    const { route } = buildServer(async () => ({ queryDataset }));
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, headers: {}, body: { dataset: inlineDataset, selection } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ rows: [{ region: 'NA', revenue: 100 }], fields: [] });
    // dataset was schema-validated before reaching the service (certified default applied)
    const passedDataset = queryDataset.mock.calls[0][0];
    expect(passedDataset.measures[0].certified).toBe(false);
    expect(queryDataset.mock.calls[0][1]).toEqual(selection);
  });

  it('returns 501 when no analytics service is configured', async () => {
    const { route } = buildServer(undefined);
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, headers: {}, body: { dataset: inlineDataset, selection } } as any, res);
    expect(res.statusCode).toBe(501);
    expect(res.body.code).toBe('NOT_IMPLEMENTED');
  });

  it('returns 400 when selection.measures is missing/empty', async () => {
    const { route } = buildServer(async () => ({ queryDataset: vi.fn() }));
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, headers: {}, body: { dataset: inlineDataset, selection: { dimensions: ['region'] } } } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('returns 400 for an invalid dataset definition', async () => {
    const { route } = buildServer(async () => ({ queryDataset: vi.fn() }));
    const res = mockRes();
    const bad = { ...inlineDataset, measures: [{ name: 'x', aggregate: 'not_a_real_agg' }] };
    await route!.handler({ method: 'POST', params: {}, headers: {}, body: { dataset: bad, selection } } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('maps a dataset D-C compile error to 400 (undeclared relationship)', async () => {
    const queryDataset = vi.fn().mockRejectedValue(new Error("dimension \"region\" references relationship \"account\" via \"account.region\", but \"account\" is not declared in the dataset's `include`."));
    const { route } = buildServer(async () => ({ queryDataset }));
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, headers: {}, body: { dataset: inlineDataset, selection } } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('DATASET_INVALID');
  });
});
