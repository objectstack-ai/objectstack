// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32200] `client.analytics.queryDatasetBatch(queries)` against the REAL
 * `POST /analytics/dataset/query/batch` route of `@objectstack/rest` (aliased to
 * source in this package's vitest config): the URL and body the client builds
 * go into the registered handler, and the body that handler writes comes back.
 * Nothing between them rewrites a key, so the shape the method resolves to is
 * the route's own answer, not a mock's.
 *
 * The analytics service behind the route is a stand-in (`queryDataset` echoing
 * the dataset it was handed): what is measured here is the door and the
 * client, not the semantic layer.
 */

import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import { RestServer } from '@objectstack/rest';
import { DATASET_QUERY_BATCH_MAX_QUERIES, DatasetQueryBatchResponseSchema } from '@objectstack/spec/api';
import { ObjectStackClient, type DatasetQueryBody } from './index';

const BASE_URL = 'http://localhost:3000';

const dataset = (name: string) => ({
    name, label: name, object: 'opportunity', include: ['account'],
    dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
    measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
});
const selection = { dimensions: ['region'], measures: ['revenue'] };

/** The real batch route, its service a stand-in that echoes the dataset name. */
function realRoute() {
    const queryDataset = vi.fn(async (ds: any) => ({ rows: [{ dataset: ds.name, revenue: 100 }], fields: [] }));
    const server = {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
    const protocol = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn(async ({ name }: { name: string }) => ({ type: 'dataset', name, item: name === 'orders' ? dataset('orders') : undefined })),
    };
    const rest = new RestServer(
        server as any, protocol as any, { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined,
        async () => ({ queryDataset }),
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'usr_1' });
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/analytics/dataset/query/batch');
    expect(route, 'POST /analytics/dataset/query/batch must be mounted by @objectstack/rest').toBeTruthy();
    return { route: route as any, queryDataset };
}

function clientOnRealRoute() {
    const { route, queryDataset } = realRoute();
    const sent: Array<{ url: string; method?: string; body: unknown }> = [];
    const fetchImpl = async (url: string, init: RequestInit = {}): Promise<any> => {
        const parsed = new URL(String(url));
        const body = init.body ? JSON.parse(String(init.body)) : undefined;
        sent.push({ url: String(url), method: init.method, body });
        expect(parsed.pathname).toBe('/api/v1/analytics/dataset/query/batch');
        const res: any = { statusCode: 200, body: undefined };
        res.status = (c: number) => { res.statusCode = c; return res; };
        res.json = (b: any) => { res.body = b; return res; };
        res.end = () => res;
        await route.handler({ method: init.method ?? 'GET', params: {}, headers: {}, query: Object.fromEntries(parsed.searchParams), body } as any, res);
        return {
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: String(res.statusCode),
            headers: new Headers(),
            json: async () => res.body,
        };
    };
    const client = new ObjectStackClient({ baseUrl: BASE_URL, fetch: fetchImpl as any });
    return { client, sent, queryDataset };
}

describe('[#32200] client.analytics.queryDatasetBatch on the real batch route', () => {
    it('types its entries as the single door\'s body, the type `queryDataset` takes', () => {
        const { client } = clientOnRealRoute();
        expectTypeOf(client.analytics.queryDatasetBatch).parameter(0).toEqualTypeOf<DatasetQueryBody[]>();
        expectTypeOf(client.analytics.queryDataset).parameter(0).toEqualTypeOf<DatasetQueryBody>();
    });

    it('POSTs `{ queries }` to /analytics/dataset/query/batch and resolves to the answer\'s `data`, one entry per query in order', async () => {
        const { client, sent } = clientOnRealRoute();
        const queries: DatasetQueryBody[] = [
            { dataset: dataset('inline_a'), selection },
            { datasetName: 'nope', selection },
            { datasetName: 'orders', selection },
        ];
        const answer = await client.analytics.queryDatasetBatch(queries);

        expect(sent).toEqual([{ url: `${BASE_URL}/api/v1/analytics/dataset/query/batch`, method: 'POST', body: { queries } }]);
        // The payload, not the envelope: the route's body is `{ success, data }`.
        expect(DatasetQueryBatchResponseSchema.safeParse({ success: true, data: answer }).success).toBe(true);
        expect(answer.results).toHaveLength(3);
        expect(answer.results[0]).toEqual({ data: { rows: [{ dataset: 'inline_a', revenue: 100 }], fields: [] } });
        expect(answer.results[1]).toEqual({ status: 404, error: { code: 'NOT_FOUND', message: 'Dataset "nope" not found.' } });
        expect(answer.results[2]).toEqual({ data: { rows: [{ dataset: 'orders', revenue: 100 }], fields: [] } });
    });

    it('throws on a whole-batch refusal, carrying the server\'s sentence; it neither bounds nor splits what it sends', async () => {
        const { client, sent, queryDataset } = clientOnRealRoute();
        const queries = Array.from({ length: DATASET_QUERY_BATCH_MAX_QUERIES + 1 }, () => ({ dataset: dataset('sales'), selection }));
        await expect(client.analytics.queryDatasetBatch(queries)).rejects.toThrow(`at most ${DATASET_QUERY_BATCH_MAX_QUERIES}`);
        // One request, all 51 queries in it: the server refused them, not the client.
        expect(sent).toHaveLength(1);
        expect((sent[0].body as any).queries).toHaveLength(DATASET_QUERY_BATCH_MAX_QUERIES + 1);
        expect(queryDataset).not.toHaveBeenCalled();
    });

    it('an empty list is sent as is and refused by the server', async () => {
        const { client, sent } = clientOnRealRoute();
        await expect(client.analytics.queryDatasetBatch([])).rejects.toThrow(/No query was run/);
        expect(sent[0].body).toEqual({ queries: [] });
    });
});
