// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The analytics dataset door's half of the ledger's `dataset_query` row: one
 * event per saved-dataset query that reached the read, handed to the `audit`
 * slot's `recordDatasetQuery` (plugin-audit's `dataset-query-audit.ts` owns
 * the row, the per-dataset opt-in and the batching, pinned there).
 *
 * The rules are the export door's: a query the door refused before the read
 * hands no event; a query that failed after the read started hands one event
 * with outcome `failed`, its status and machine code.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

function mockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  return res;
}

const SALES = {
  name: 'sales', label: 'Sales', object: 'opportunity',
  dimensions: [{ name: 'region', field: 'region', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};

/** A value no field name, operator or code in this file spells. */
const SECRET = 'Zq7-door-filter-value-8830';

function protocolWith(items: any[]) {
  return {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue([]),
    getMetaItem: vi.fn(async ({ name }: { name: string }) => ({ type: 'dataset', name, item: items.find((d) => d?.name === name) })),
  };
}

function boot(opts: { queryDataset?: (...a: any[]) => Promise<any>; sink?: Record<string, unknown> } = {}) {
  const events: any[] = [];
  const sink = opts.sink ?? { recordDatasetQuery: (event: any) => { events.push(event); } };
  const queryDataset = vi.fn(opts.queryDataset ?? (async () => ({ rows: [{ region: 'NA', revenue: 1 }, { region: 'EU', revenue: 2 }], fields: [] })));
  const rest = new RestServer(
    mockServer() as any, protocolWith([SALES]) as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    async () => ({ queryDataset }), // analyticsServiceProvider
    undefined, // settingsServiceProvider
    undefined, // serviceExistsProvider
    undefined, // securityServiceProvider
    undefined, // requestEnvResolver
    undefined, // metadataServiceProvider
    undefined, // tenancyServiceProvider
    async () => sink, // auditServiceProvider
  );
  (rest as any).resolveExecCtx = async () => ({ userId: 'u_analyst', tenantId: 'org_a' });
  rest.registerRoutes();
  const single = rest.getRoutes().find((r) => r.method === 'POST' && r.path.endsWith('/analytics/dataset/query'))!;
  const batch = rest.getRoutes().find((r) => r.method === 'POST' && r.path.endsWith('/analytics/dataset/query/batch'))!;
  const post = async (body: unknown) => {
    const res = mockRes();
    await single.handler({ method: 'POST', params: {}, query: {}, headers: {}, body } as any, res);
    return res;
  };
  const postBatch = async (queries: unknown[]) => {
    const res = mockRes();
    await batch.handler({ method: 'POST', params: {}, query: {}, headers: {}, body: { queries } } as any, res);
    return res;
  };
  return { events, queryDataset, post, postBatch };
}

const selection = {
  dimensions: ['region'],
  measures: ['revenue'],
  runtimeFilter: { region: SECRET, amount: { $gte: 5 } },
};

describe('POST /analytics/dataset/query hands the ledger one event per query that reached the read', () => {
  it('a saved-dataset query that answered hands ONE event: caller, dataset, selection names, the filter as read, the row count', async () => {
    const { events, post } = boot();
    const res = await post({ datasetName: 'sales', selection });
    expect(res.statusCode).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      context: { userId: 'u_analyst', tenantId: 'org_a' },
      datasetName: 'sales',
      objectName: 'opportunity',
      dimensions: ['region'],
      measures: ['revenue'],
      readQuery: { filter: selection.runtimeFilter },
      rowCount: 2,
      outcome: 'succeeded',
    });
  });

  it('a query refused before the read hands no event', async () => {
    const { events, post, queryDataset } = boot();
    // No measures: the door's selection check refuses it.
    expect((await post({ datasetName: 'sales', selection: { dimensions: ['region'], measures: [] } })).statusCode).toBe(400);
    // A dataset the resolver does not find.
    expect((await post({ datasetName: 'nope', selection })).statusCode).toBe(404);
    // An unknown body key: the body door refuses it.
    expect((await post({ datasetName: 'sales', selection, runtimeFilter: {} })).statusCode).toBe(400);
    expect(queryDataset).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('a query that failed after the read started hands ONE event with outcome failed, its status and machine code', async () => {
    const { events, post } = boot({
      queryDataset: async () => { throw Object.assign(new Error(`driver said ${SECRET}`), { code: 'SERVICE_UNAVAILABLE', status: 503 }); },
    });
    const res = await post({ datasetName: 'sales', selection });
    expect(res.statusCode).toBe(503);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ datasetName: 'sales', outcome: 'failed', rowCount: 0, status: 503, errorCode: 'SERVICE_UNAVAILABLE' });
    // The error's text, which a driver can fill with a comparand, never travels.
    expect(JSON.stringify({ ...events[0], readQuery: undefined })).not.toContain(SECRET);
  });

  it('an inline dataset definition hands no event: the opt-in is per saved dataset, and an inline name is the caller\'s text', async () => {
    const { events, post } = boot();
    const res = await post({ dataset: SALES, selection });
    expect(res.statusCode).toBe(200);
    expect(events).toEqual([]);
  });

  it('the batch door hands one event per query that reached the read, and none for an entry refused before it', async () => {
    const { events, postBatch } = boot();
    const res = await postBatch([
      { datasetName: 'sales', selection },
      { datasetName: 'nope', selection },
      { datasetName: 'sales', selection: { measures: ['revenue'] } },
    ]);
    expect(res.statusCode).toBe(200);
    expect(events.map((e) => [e.datasetName, e.outcome])).toEqual([
      ['sales', 'succeeded'],
      ['sales', 'succeeded'],
    ]);
  });

  it('a ledger sink that throws never changes the answer', async () => {
    const { post } = boot({ sink: { recordDatasetQuery: () => { throw new Error('ledger down'); } } });
    const res = await post({ datasetName: 'sales', selection });
    expect(res.statusCode).toBe(200);
    expect(res.body.rows).toHaveLength(2);
  });
});
