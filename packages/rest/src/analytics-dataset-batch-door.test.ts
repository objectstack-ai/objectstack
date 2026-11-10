// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32200] `POST {basePath}/analytics/dataset/query/batch` — several
 * single-door bodies in one request, each answered or refused on its own.
 *
 * What is pinned, through the real registered routes:
 *
 * - The whole batch is refused (400, house envelope, nothing run) only when the
 *   batch itself is malformed, as `DatasetQueryBatchRequestSchema` states; 50
 *   queries are answered and 51 are refused.
 * - `results.length === queries.length`, in request order, for a mixed batch.
 * - Each query is judged by the single door's own judgment: a name two packages
 *   hold answers that entry's 409 naming both, byte-equal to the single door's
 *   409 for the same body, while its siblings are answered and run the dataset
 *   they name.
 * - Each refusal is mapped into `ApiErrorSchema`: `userMessage` is carried, a
 *   code outside the vocabulary moves to `declaredCode`, and a 5xx with no code
 *   or no message has both filled.
 * - The batch URL's `?preview=draft` and an entry's `previewDrafts` reach drafts
 *   only for a caller admitted to them; a repeated `?package=` refuses the batch.
 * - A refusal that depends on no query (401, 501, a 503 before any query)
 *   answers the whole request with the single door's status, in the house
 *   envelope.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';
import '@objectstack/objectql';
import { PackageScopedNameRefusedError } from '@objectstack/core';
import {
    ApiErrorSchema,
    DATASET_QUERY_BATCH_MAX_QUERIES,
    DatasetQueryBatchEntrySchema,
    DatasetQueryBatchRequestSchema,
    DatasetQueryBatchResponseSchema,
    standardErrorCodeForHttpStatus,
} from '@objectstack/spec/api';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';

// ── harness (the shape `analytics-routes.test.ts` uses) ──────────────────────

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}
function mockProtocol(extra: Record<string, unknown> = {}): any {
    return {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        ...extra,
    };
}
function mockRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.end = vi.fn(() => res);
    return res;
}

const dataset = (name: string, object = 'opportunity') => ({
    name, label: name, object, include: ['account'],
    dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
    measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
});
const selection = { dimensions: ['region'], measures: ['revenue'] };

/** The two holders of `sales`: the by-name read refuses, naming both. */
const twoHolders = () => new PackageScopedNameRefusedError({
    status: 'refused',
    reason: 'ambiguous-in-environment',
    type: 'dataset',
    name: 'sales',
    callerPackageId: null,
    candidates: [{ kind: 'package', packageId: 'com.acme.alpha' }, { kind: 'package', packageId: 'com.acme.beta' }],
    message: 'The dataset "sales" is held by 2 packages in this environment and the caller names no package: '
        + 'package "com.acme.alpha"; package "com.acme.beta". Nothing picks one of them: address it by its package.',
});

/**
 * A protocol whose by-name read refuses `sales` (two holders) and answers
 * every other saved name. Its LIST carries both `sales` holders first, so a
 * door that picked a dataset out of the list instead of asking the by-name
 * resolver would serve the alpha copy.
 */
function packagedProtocol(saved: any[] = [dataset('orders', 'order')]) {
    return mockProtocol({
        getMetaItems: vi.fn().mockResolvedValue([
            { ...dataset('sales'), _packageId: 'com.acme.alpha' },
            { ...dataset('sales'), _packageId: 'com.acme.beta' },
            ...saved,
        ]),
        getMetaItem: vi.fn(async ({ name }: { name: string }) => {
            if (name === 'sales') throw twoHolders();
            return { type: 'dataset', name, item: saved.find((d) => d.name === name) };
        }),
    });
}

/** An analytics service whose answer names the dataset and the measures it ran. */
function echoService() {
    const queryDataset = vi.fn(async (ds: any, sel: any, _context?: unknown, _options?: unknown) => ({
        rows: [{ dataset: ds.name, measures: sel.measures.join(',') }],
        fields: [{ name: 'revenue', type: 'number' }],
    }));
    return { queryDataset, provider: async () => ({ queryDataset }) };
}

function buildServer(provider?: any, protocol: any = mockProtocol(), ctx: () => Promise<any> = async () => ({ userId: 'test-user' })) {
    const rest = new RestServer(
        mockServer() as any, protocol as any, { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined,
        provider,
    );
    (rest as any).resolveExecCtx = ctx;
    rest.registerRoutes();
    const find = (path: string) => rest.getRoutes().find((r) => r.method === 'POST' && r.path === path);
    const single = find('/api/v1/analytics/dataset/query');
    const batch = find('/api/v1/analytics/dataset/query/batch');
    const call = async (route: any, body: unknown, query: Record<string, unknown> = {}) => {
        const res = mockRes();
        await route.handler({ method: 'POST', params: {}, headers: {}, query: { ...query }, body } as any, res);
        return res;
    };
    return {
        rest, single, batch,
        postSingle: (body: unknown, query?: Record<string, unknown>) => call(single, body, query),
        postBatch: (body: unknown, query?: Record<string, unknown>) => call(batch, body, query),
    };
}

/** The house error envelope, with the shape the contract states for a whole-batch refusal. */
function expectWholeRefusal(res: any, status: number, code: string) {
    expect(res.statusCode).toBe(status);
    expect(res.body.success).toBe(false);
    expect(res.body).not.toHaveProperty('data');
    expect(res.body.error.code).toBe(code);
    expect(typeof res.body.error.message).toBe('string');
    expect(ApiErrorSchema.safeParse(res.body.error).success).toBe(true);
}

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────

describe('[#32200] the batch door is mounted beside the single door', () => {
    it('registers POST {basePath}/analytics/dataset/query/batch, tagged analytics, next to the single door', () => {
        const { rest, single, batch } = buildServer(echoService().provider);
        expect(single).toBeTruthy();
        expect(batch).toBeTruthy();
        expect(batch!.metadata?.tags).toContain('analytics');
        const paths = rest.getRoutes().map((r) => `${r.method} ${r.path}`);
        expect(paths.indexOf('POST /api/v1/analytics/dataset/query/batch'))
            .toBe(paths.indexOf('POST /api/v1/analytics/dataset/query') + 1);
    });
});

describe('[#32200] a malformed batch is refused whole: 400 VALIDATION_FAILED, nothing run', () => {
    const malformed: Array<[string, unknown]> = [
        ['a body that is not an object (null)', null],
        ['a body that is not an object (array)', [{ dataset: dataset('sales'), selection }]],
        ['a body that is not an object (string)', 'queries'],
        ['`queries` missing', {}],
        ['`queries` not an array', { queries: { dataset: dataset('sales'), selection } }],
        ['`queries` empty', { queries: [] }],
        ['a non-object query (null)', { queries: [{ dataset: dataset('sales'), selection }, null] }],
        ['a non-object query (string)', { queries: ['sales'] }],
        ['a non-object query (array)', { queries: [[{ dataset: dataset('sales'), selection }]] }],
        ['a key beside `queries`', { queries: [{ dataset: dataset('sales'), selection }], previewDrafts: true }],
    ];

    for (const [name, body] of malformed) {
        it(name, async () => {
            // The door judges by the contract's one declaration of the shape.
            expect(DatasetQueryBatchRequestSchema.safeParse(body).success).toBe(false);
            const { queryDataset, provider } = echoService();
            const { postBatch } = buildServer(provider);
            const res = await postBatch(body);
            expectWholeRefusal(res, 400, 'VALIDATION_FAILED');
            expect(res.body.error.message).toMatch(/No query was run\.$/);
            expect(queryDataset).not.toHaveBeenCalled();
        });
    }

    it(`${DATASET_QUERY_BATCH_MAX_QUERIES} queries are answered, every one`, async () => {
        const { queryDataset, provider } = echoService();
        const { postBatch } = buildServer(provider);
        const queries = Array.from({ length: DATASET_QUERY_BATCH_MAX_QUERIES }, () => ({ dataset: dataset('sales'), selection }));
        const res = await postBatch({ queries });
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.results).toHaveLength(DATASET_QUERY_BATCH_MAX_QUERIES);
        expect(res.body.data.results.every((e: any) => 'data' in e)).toBe(true);
        expect(queryDataset).toHaveBeenCalledTimes(DATASET_QUERY_BATCH_MAX_QUERIES);
        expect(DatasetQueryBatchResponseSchema.safeParse(res.body).success).toBe(true);
    });

    it(`${DATASET_QUERY_BATCH_MAX_QUERIES + 1} queries are refused whole, naming the bound; none is run`, async () => {
        const { queryDataset, provider } = echoService();
        const { postBatch } = buildServer(provider);
        const queries = Array.from({ length: DATASET_QUERY_BATCH_MAX_QUERIES + 1 }, () => ({ dataset: dataset('sales'), selection }));
        const res = await postBatch({ queries });
        expectWholeRefusal(res, 400, 'VALIDATION_FAILED');
        expect(res.body.error.message).toContain(`at most ${DATASET_QUERY_BATCH_MAX_QUERIES}`);
        expect(queryDataset).not.toHaveBeenCalled();
    });
});

describe('[#32200] one entry per query, in request order; one refusal never fails its siblings', () => {
    it('a mixed batch: answered, refused 400, refused 404, refused 409, answered — each in its own position', async () => {
        const { queryDataset, provider } = echoService();
        const { postBatch } = buildServer(provider, packagedProtocol());
        const queries = [
            { dataset: dataset('inline_a'), selection },
            { dataset: dataset('inline_b'), selection: { dimensions: ['region'] } },
            { datasetName: 'nope', selection },
            { datasetName: 'sales', selection },
            { datasetName: 'orders', selection: { measures: ['revenue'] } },
        ];
        const res = await postBatch({ queries });

        expect(res.statusCode).toBe(200);
        expect(DatasetQueryBatchResponseSchema.safeParse(res.body).success).toBe(true);
        const { results } = res.body.data;
        expect(results).toHaveLength(queries.length);
        expect(results[0]).toEqual({ data: { rows: [{ dataset: 'inline_a', measures: 'revenue' }], fields: [{ name: 'revenue', type: 'number' }] } });
        expect(results[1].status).toBe(400);
        expect(results[1].error.code).toBe('VALIDATION_FAILED');
        expect(results[2]).toEqual({ status: 404, error: { code: 'NOT_FOUND', message: 'Dataset "nope" not found.' } });
        expect(results[3].status).toBe(409);
        expect(results[3].error.code).toBe('RESOURCE_CONFLICT');
        expect(results[4].data.rows).toEqual([{ dataset: 'orders', measures: 'revenue' }]);
        // Only the two answerable queries reached the service.
        expect(queryDataset.mock.calls.map((c) => c[0].name)).toEqual(['inline_a', 'orders']);
    });

    it('order holds when the queries finish out of order', async () => {
        const delays = [30, 0, 15, 5, 25, 0, 10];
        const queryDataset = vi.fn(async (ds: any) => {
            await new Promise((r) => setTimeout(r, delays[Number(ds.name.slice(1))]));
            return { rows: [{ dataset: ds.name }], fields: [] };
        });
        const { postBatch } = buildServer(async () => ({ queryDataset }));
        const queries = delays.map((_, i) => ({ dataset: dataset(`q${i}`), selection }));
        const res = await postBatch({ queries });
        expect(res.body.data.results.map((e: any) => e.data.rows[0].dataset)).toEqual(delays.map((_, i) => `q${i}`));
    });

    it('at most six queries run at once', async () => {
        let inFlight = 0;
        let peak = 0;
        const queryDataset = vi.fn(async () => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await new Promise((r) => setTimeout(r, 5));
            inFlight -= 1;
            return { rows: [], fields: [] };
        });
        const { postBatch } = buildServer(async () => ({ queryDataset }));
        await postBatch({ queries: Array.from({ length: 20 }, () => ({ dataset: dataset('sales'), selection })) });
        expect(queryDataset).toHaveBeenCalledTimes(20);
        expect(peak).toBe(6);
    });
});

describe('[#32200, ADR-0150 D3] each query is resolved exactly as the single door resolves it', () => {
    it('a name two packages hold answers that entry\'s 409 naming both — byte-equal to the single door\'s 409', async () => {
        const { postSingle, postBatch } = buildServer(echoService().provider, packagedProtocol());
        const body = { datasetName: 'sales', selection };
        const alone = await postSingle(body);
        const res = await postBatch({ queries: [body] });

        expect(alone.statusCode).toBe(409);
        const [entry] = res.body.data.results;
        expect(entry.status).toBe(alone.statusCode);
        expect(JSON.stringify(entry.error)).toBe(JSON.stringify(alone.body));
        expect(entry.error.message).toContain('com.acme.alpha');
        expect(entry.error.message).toContain('com.acme.beta');
    });

    it('a query refused for its resolution does not change which dataset a sibling runs', async () => {
        const { queryDataset, provider } = echoService();
        const protocol = packagedProtocol();
        const { postBatch } = buildServer(provider, protocol);
        const res = await postBatch({ queries: [
            { datasetName: 'sales', selection },
            { datasetName: 'orders', selection },
            { datasetName: 'sales', selection: { measures: ['revenue'] } },
        ] });

        const { results } = res.body.data;
        expect(results.map((e: any) => e.status ?? 200)).toEqual([409, 200, 409]);
        expect(results[1].data.rows[0].dataset).toBe('orders');
        // Each query asked the by-name resolver for its OWN name and nothing else;
        // no list was read, so no first holder could be picked.
        expect(protocol.getMetaItem.mock.calls.map((c: any[]) => c[0])).toEqual([
            { type: 'dataset', name: 'sales' },
            { type: 'dataset', name: 'orders' },
            { type: 'dataset', name: 'sales' },
        ]);
        expect(protocol.getMetaItems).not.toHaveBeenCalled();
        expect(queryDataset).toHaveBeenCalledTimes(1);
        expect(queryDataset.mock.calls[0][0].name).toBe('orders');
    });

    it('`?package=X` on the batch URL qualifies every query, as `?package=` qualifies the single door', async () => {
        const protocol = mockProtocol({
            getMetaItem: vi.fn(async ({ name }: { name: string }) => ({ type: 'dataset', name, item: dataset(name) })),
        });
        const { postBatch } = buildServer(echoService().provider, protocol);
        const res = await postBatch({ queries: [{ datasetName: 'sales', selection }, { datasetName: 'orders', selection }] }, { package: 'com.acme.beta' });
        expect(res.statusCode).toBe(200);
        expect(protocol.getMetaItem.mock.calls.map((c: any[]) => c[0])).toEqual([
            { type: 'dataset', name: 'sales', packageId: 'com.acme.beta' },
            { type: 'dataset', name: 'orders', packageId: 'com.acme.beta' },
        ]);
    });

    it('a repeated `?package=` on the batch URL refuses the whole batch; nothing is read or run', async () => {
        const { queryDataset, provider } = echoService();
        const protocol = packagedProtocol();
        const { postBatch } = buildServer(provider, protocol);
        const res = await postBatch({ queries: [{ datasetName: 'orders', selection }] }, { package: ['com.acme.alpha', 'com.acme.beta'] });
        expectWholeRefusal(res, 400, 'VALIDATION_ERROR');
        expect(res.body.error.message).toContain('"package" query parameter was supplied 2 times');
        expect(protocol.getMetaItem).not.toHaveBeenCalled();
        expect(queryDataset).not.toHaveBeenCalled();
    });
});

describe('[#32200] each refusal is the single door\'s, mapped into ApiErrorSchema', () => {
    /** The single door's answer to one body and the batch's entry for the same body. */
    async function bothDoors(error: unknown, protocol: any = mockProtocol(), body: any = { dataset: dataset('sales'), selection }) {
        const queryDataset = vi.fn(async () => { throw error; });
        const { postSingle, postBatch } = buildServer(async () => ({ queryDataset }), protocol);
        const alone = await postSingle(body);
        const res = await postBatch({ queries: [body] });
        const [entry] = res.body.data.results;
        expect(DatasetQueryBatchEntrySchema.safeParse(entry).success).toBe(true);
        expect(entry.status).toBe(alone.statusCode);
        return { alone: alone.body, entry };
    }

    it('`userMessage` is carried when the single door\'s refusal carries it', async () => {
        const error = Object.assign(new Error('operator "$like" is not supported'), {
            code: 'INVALID_FILTER', status: 400, userMessage: 'Pick a supported filter.',
        });
        const { alone, entry } = await bothDoors(error);
        expect(alone.userMessage).toBe('Pick a supported filter.');
        expect(entry.error).toEqual({ code: 'INVALID_FILTER', message: 'operator "$like" is not supported', userMessage: 'Pick a supported filter.' });
    });

    it('a code outside the vocabulary moves to `declaredCode`; `code` is the member the status derives', async () => {
        const error = Object.assign(new Error('month-end close is in progress'), { code: 'MONTH_END_CLOSE', status: 409 });
        const { alone, entry } = await bothDoors(error);
        expect(alone.code).toBe('MONTH_END_CLOSE');
        expect(entry.error).toEqual({
            code: standardErrorCodeForHttpStatus(409),
            message: 'month-end close is in progress',
            declaredCode: 'MONTH_END_CLOSE',
        });
    });

    it('a field-addressed refusal keeps its `details.fields[]`', async () => {
        const { entry } = await bothDoors(new Error('unused'), mockProtocol(), { dataset: dataset('sales'), selection: { measures: ['revenue'], dimensions: 'region' } });
        expect(entry.status).toBe(400);
        expect(entry.error.details.fields[0].field).toBe('selection.dimensions');
    });

    it('the singular `detail` of "Invalid dataset definition." is left out: free text, not field-addressed data', async () => {
        const bad = { ...dataset('sales'), measures: [{ name: 'x', aggregate: 'not_a_real_agg' }] };
        const { alone, entry } = await bothDoors(new Error('unused'), mockProtocol(), { dataset: bad, selection });
        expect(typeof alone.detail).toBe('string');
        expect(entry.error).toEqual({ code: 'VALIDATION_FAILED', message: 'Invalid dataset definition.' });
    });

    it('a declared 5xx with NO code: `code` is the member the status derives, `message` the withheld outward text', async () => {
        const error = Object.assign(new Error('pool exhausted on 10.0.0.7'), { status: 503 });
        const { alone, entry } = await bothDoors(error);
        expect(alone).toEqual({ error: INTERNAL_ERROR_MESSAGE });
        expect(entry.error).toEqual({ code: 'SERVICE_UNAVAILABLE', message: INTERNAL_ERROR_MESSAGE });
        expect(JSON.stringify(entry)).not.toContain('10.0.0.7');
    });

    it('a declared 5xx with a code but no message: `message` is the text the door carries under `error`', async () => {
        // The protocol has no by-name read: the door's own declared 503, its sentence under `error`.
        const { alone, entry } = await bothDoors(new Error('unused'), mockProtocol(), { datasetName: 'sales', selection });
        expect(alone.code).toBe('SERVICE_UNAVAILABLE');
        expect(alone).not.toHaveProperty('message');
        expect(entry.error).toEqual({ code: 'SERVICE_UNAVAILABLE', message: alone.error });
    });

    it('an undeclared fault: `ANALYTICS_QUERY_FAILED`, `message` the withheld text, the mark carried', async () => {
        const error = Object.assign(new Error('SELECT bogus FROM "crm_account" - no such column: bogus'), { userMessage: 'The chart could not be drawn.' });
        const { alone, entry } = await bothDoors(error);
        expect(alone).toEqual({ code: 'ANALYTICS_QUERY_FAILED', error: INTERNAL_ERROR_MESSAGE, userMessage: 'The chart could not be drawn.' });
        expect(entry.error).toEqual({ code: 'ANALYTICS_QUERY_FAILED', message: INTERNAL_ERROR_MESSAGE, userMessage: 'The chart could not be drawn.' });
    });
});

describe('[#32200, #20338] drafts reach only a caller admitted to them, from either source', () => {
    const draftBatch = { queries: [
        { datasetName: 'orders', selection, previewDrafts: true },
        { datasetName: 'orders', selection },
    ] };

    it('a caller who may not read drafts gets published data for `?preview=draft` and for an entry\'s `previewDrafts`', async () => {
        const { queryDataset, provider } = echoService();
        const protocol = packagedProtocol();
        const { postBatch } = buildServer(provider, protocol, async () => ({ userId: 'test-user' }));
        const res = await postBatch(draftBatch, { preview: 'draft' });

        expect(res.statusCode).toBe(200);
        expect(res.body.data.results.every((e: any) => 'data' in e)).toBe(true);
        for (const [request] of protocol.getMetaItem.mock.calls) expect(request).not.toHaveProperty('previewDrafts');
        for (const call of queryDataset.mock.calls) expect(call[3]).toBeUndefined();
    });

    it('CONTROL: an admitted caller gets the draft read for both sources', async () => {
        const { queryDataset, provider } = echoService();
        const protocol = packagedProtocol();
        const { postBatch } = buildServer(provider, protocol, async () => ({ userId: 'test-user', isSystem: true }));

        await postBatch(draftBatch);
        expect(protocol.getMetaItem.mock.calls.map((c: any[]) => c[0].previewDrafts)).toEqual([true, undefined]);
        expect(queryDataset.mock.calls.map((c) => c[3])).toEqual([{ previewDrafts: true }, undefined]);

        protocol.getMetaItem.mockClear();
        queryDataset.mockClear();
        await postBatch(draftBatch, { preview: 'draft' });
        expect(protocol.getMetaItem.mock.calls.map((c: any[]) => c[0].previewDrafts)).toEqual([true, true]);
        expect(queryDataset.mock.calls.map((c) => c[3])).toEqual([{ previewDrafts: true }, { previewDrafts: true }]);
    });
});

describe('[#32200] a refusal that depends on no query answers the whole request, in the house envelope', () => {
    const queries = [{ dataset: dataset('sales'), selection }];

    it('401: an anonymous caller — the single door\'s status, nothing run', async () => {
        const { queryDataset, provider } = echoService();
        const { postSingle, postBatch } = buildServer(provider, mockProtocol(), async () => ({}));
        const alone = await postSingle(queries[0]);
        const res = await postBatch({ queries });
        expect(alone.statusCode).toBe(401);
        expectWholeRefusal(res, alone.statusCode, alone.body.code);
        expect(res.body.error.message).toBe(alone.body.message);
        expect(queryDataset).not.toHaveBeenCalled();
    });

    it('501: no analytics service — the single door\'s status and sentence', async () => {
        const { postSingle, postBatch } = buildServer(undefined);
        const alone = await postSingle(queries[0]);
        const res = await postBatch({ queries });
        expect(alone.statusCode).toBe(501);
        expectWholeRefusal(res, 501, 'NOT_IMPLEMENTED');
        expect(res.body.error.message).toBe(alone.body.message);
    });

    it('503: a declared fault before any query (identity resolution) — the single door\'s status, its text withheld', async () => {
        const { queryDataset, provider } = echoService();
        const ctx = async () => { throw Object.assign(new Error('identity store at 10.0.0.9 down'), { status: 503, code: 'SERVICE_UNAVAILABLE' }); };
        const { postSingle, postBatch } = buildServer(provider, mockProtocol(), ctx);
        const alone = await postSingle(queries[0]);
        const res = await postBatch({ queries });
        expect(alone.statusCode).toBe(503);
        expectWholeRefusal(res, 503, 'SERVICE_UNAVAILABLE');
        expect(res.body.error.message).toBe(INTERNAL_ERROR_MESSAGE);
        expect(JSON.stringify(res.body)).not.toContain('10.0.0.9');
        expect(queryDataset).not.toHaveBeenCalled();
    });
});
