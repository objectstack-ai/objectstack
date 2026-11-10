// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32200] `POST /analytics/dataset/query` answers byte for byte as it did
 * before its per-body judgment moved into `answerDatasetQuery`, the function
 * the batch door shares with it.
 *
 * The move turned every `res.status(x).json(y)` of the door into a returned
 * `{ status: x, body: y }` that the door then writes. One case per arm the
 * move touched: each answer is serialized (status + exact JSON bytes) and held
 * to an inline snapshot. The snapshots were written by running THIS file
 * against `origin/main`'s `analytics-routes.ts` (the door before the move) and
 * then run unchanged against the moved door; the PR body records both legs.
 * The rest of the door's existing suites (`analytics-*.test.ts`) run unchanged
 * as well.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RestServer } from './rest-server';
import '@objectstack/objectql';
import { PackageScopedNameRefusedError } from '@objectstack/core';

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}
function mockProtocol(extra: Record<string, unknown> = {}) {
    return {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        ...extra,
    };
}
function savedDatasets(items: any[]) {
    return {
        getMetaItem: vi.fn(async ({ name }: { name: string }) => ({ type: 'dataset', name, item: items.find((d) => d?.name === name) })),
    };
}

const inlineDataset = {
    name: 'sales', label: 'Sales', object: 'opportunity', include: ['account'],
    dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
    measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};
const selection = { dimensions: ['region'], measures: ['revenue'] };

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

interface Arm {
    readonly provider?: any;
    readonly protocol?: any;
    readonly ctx?: () => Promise<any>;
    readonly query?: Record<string, unknown>;
    readonly body: any;
}

const service = (queryDataset: (...a: any[]) => Promise<unknown>) => async () => ({ queryDataset });
const answering = service(async () => ({ rows: [{ region: 'NA', revenue: 100 }], fields: [{ name: 'revenue', type: 'number' }] }));
const throwing = (error: unknown) => service(async () => { throw error; });

/** Drive the single door once and serialize what it wrote: status, then the exact body bytes. */
async function single(arm: Arm): Promise<string> {
    const rest = new RestServer(
        mockServer() as any, (arm.protocol ?? mockProtocol()) as any, { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined,
        arm.provider,
    );
    (rest as any).resolveExecCtx = arm.ctx ?? (async () => ({ userId: 'test-user' }));
    rest.registerRoutes();
    const route = rest.getRoutes().find((r) => r.method === 'POST' && r.path === '/api/v1/analytics/dataset/query');
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.end = vi.fn(() => res);
    await route!.handler({ method: 'POST', path: '/api/v1/analytics/dataset/query', params: {}, headers: {}, query: arm.query ?? {}, body: arm.body } as any, res);
    // A 200 is written with `res.json` alone, never `res.status(200)`: pinned too.
    return `${res.statusCode} status-calls=${res.status.mock.calls.length} ${JSON.stringify(res.body)}`;
}

describe('[#32200] the single dataset door answers byte for byte as before the shared judgment', () => {
    // The fault log at its SHIPPED level ('info'); the spy only swallows the output.
    beforeEach(() => {
        vi.stubEnv('OS_REST_LOG', 'info');
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it('answered: the bare AnalyticsResult, written without a status call', async () => {
        expect(await single({ provider: answering, body: { dataset: inlineDataset, selection } })).toMatchInlineSnapshot(`"200 status-calls=0 {"rows":[{"region":"NA","revenue":100}],"fields":[{"name":"revenue","type":"number"}]}"`);
    });

    it('401: anonymous', async () => {
        expect(await single({ provider: answering, ctx: async () => ({}), body: { dataset: inlineDataset, selection } })).toMatchInlineSnapshot(`"401 status-calls=1 {"error":"UNAUTHENTICATED","code":"UNAUTHENTICATED","message":"Authentication is required to access this endpoint."}"`);
    });

    it('501: no analytics service', async () => {
        expect(await single({ body: { dataset: inlineDataset, selection } })).toMatchInlineSnapshot(`"501 status-calls=1 {"code":"NOT_IMPLEMENTED","message":"Analytics dataset query is not available on this deployment (no analytics service with queryDataset)."}"`);
    });

    it('503: a declared fault before any body is judged (identity resolution)', async () => {
        const ctx = async () => { throw Object.assign(new Error('identity store at 10.0.0.9 down'), { status: 503, code: 'SERVICE_UNAVAILABLE' }); };
        expect(await single({ provider: answering, ctx, body: { dataset: inlineDataset, selection } })).toMatchInlineSnapshot(`"503 status-calls=1 {"error":"Internal server error","code":"SERVICE_UNAVAILABLE"}"`);
    });

    it('400: the outer-body door (an unknown key)', async () => {
        expect(await single({ provider: answering, body: { dataset: inlineDataset, selection, runtimeFilter: { region: 'NA' } } })).toMatchInlineSnapshot(`"400 status-calls=1 {"code":"VALIDATION_FAILED","message":"Unrecognized key(s) on this dataset query: \`runtimeFilter\` (did you mean \`selection.runtimeFilter\`?). The request body takes \`dataset\`, \`datasetName\`, \`previewDrafts\`, \`selection\`; every selection member, the filter included, goes inside \`selection\`. This door will not ignore a key it does not understand: a dropped filter would answer with the unfiltered aggregate.","details":{"fields":[{"field":"runtimeFilter","code":"unknown_field","message":"Unrecognized key \`runtimeFilter\` on this dataset query — did you mean \`selection.runtimeFilter\`?"}]}}"`);
    });

    it('400: selection.measures missing', async () => {
        expect(await single({ provider: answering, body: { dataset: inlineDataset, selection: { dimensions: ['region'] } } })).toMatchInlineSnapshot(`"400 status-calls=1 {"code":"VALIDATION_FAILED","message":"body.selection.measures must be a non-empty array of measure names."}"`);
    });

    it('400: the selection door', async () => {
        expect(await single({ provider: answering, body: { dataset: inlineDataset, selection: { measures: ['revenue'], dimensions: 'region' } } })).toMatchInlineSnapshot(`"400 status-calls=1 {"code":"VALIDATION_FAILED","message":"Invalid dataset selection: selection.dimensions: Invalid input: expected array, received string","details":{"fields":[{"field":"selection.dimensions","code":"invalid_type","message":"Invalid input: expected array, received string"}]}}"`);
    });

    it('400: a repeated ?package=', async () => {
        expect(await single({ provider: answering, query: { package: ['a', 'b'] }, body: { datasetName: 'sales', selection } })).toMatchInlineSnapshot(`"400 status-calls=1 {"error":{"code":"VALIDATION_ERROR","message":"The \\"package\\" query parameter was supplied 2 times. Supply it at most once — this endpoint will not choose between conflicting values."}}"`);
    });

    it('404: an unknown datasetName', async () => {
        expect(await single({ provider: answering, protocol: mockProtocol(savedDatasets([])), body: { datasetName: 'nope', selection } })).toMatchInlineSnapshot(`"404 status-calls=1 {"code":"NOT_FOUND","message":"Dataset \\"nope\\" not found."}"`);
    });

    it('400: neither dataset nor datasetName', async () => {
        expect(await single({ provider: answering, body: { selection } })).toMatchInlineSnapshot(`"400 status-calls=1 {"code":"VALIDATION_FAILED","message":"Provide body.dataset (inline) or body.datasetName."}"`);
    });

    it('400: an invalid dataset definition, with its singular `detail`', async () => {
        const bad = { ...inlineDataset, measures: [{ name: 'x', aggregate: 'not_a_real_agg' }] };
        expect(await single({ provider: answering, body: { dataset: bad, selection } })).toMatchInlineSnapshot(`"400 status-calls=1 {"code":"VALIDATION_FAILED","message":"Invalid dataset definition.","detail":"[\\n  {\\n    \\"origin\\": \\"string\\",\\n    \\"code\\": \\"too_small\\",\\n    \\"minimum\\": 2,\\n    \\"inclusive\\": true,\\n    \\"path\\": [\\n      \\"measures\\",\\n      0,\\n      \\"name\\"\\n    ],\\n    \\"message\\": \\"Identifier must be at least 2 characters\\"\\n  },\\n  {\\n    \\"code\\": \\"invalid_value\\",\\n    \\"values\\": [\\n      \\"count\\",\\n      \\"sum\\",\\n      \\"avg\\",\\n      \\"min\\",\\n      \\"max\\",\\n      \\"count_distinct\\"\\n    ],\\n    \\"path\\": [\\n      \\"measures\\",\\n      0,\\n      \\"aggregate\\"\\n    ],\\n    \\"message\\": \\"Invalid option: expected one of \\\\\\"count\\\\\\"|\\\\\\"sum\\\\\\"|\\\\\\"avg\\\\\\"|\\\\\\"min\\\\\\"|\\\\\\"max\\\\\\"|\\\\\\"count_distinct\\\\\\"\\"\\n  }\\n]"}"`);
    });

    it('409: a name two packages hold', async () => {
        const protocol = mockProtocol({ getMetaItem: vi.fn().mockRejectedValue(twoHolders()) });
        expect(await single({ provider: answering, protocol, body: { datasetName: 'sales', selection } })).toMatchInlineSnapshot(`"409 status-calls=1 {"code":"RESOURCE_CONFLICT","message":"The dataset \\"sales\\" is held by 2 packages in this environment and the caller names no package: package \\"com.acme.alpha\\"; package \\"com.acme.beta\\". Nothing picks one of them: address it by its package."}"`);
    });

    it('503: a protocol with no by-name read', async () => {
        expect(await single({ provider: answering, body: { datasetName: 'sales', selection } })).toMatchInlineSnapshot(`"503 status-calls=1 {"error":"The dataset \\"sales\\" could not be resolved: this deployment's metadata protocol has no by-name read. This is a server-side fault, not a missing dataset.","code":"SERVICE_UNAVAILABLE"}"`);
    });

    it('503: a failed by-name read', async () => {
        const protocol = mockProtocol({ getMetaItem: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.7:5432')) });
        expect(await single({ provider: answering, protocol, body: { datasetName: 'sales', selection } })).toMatchInlineSnapshot(`"503 status-calls=1 {"error":"The dataset \\"sales\\" could not be resolved: the dataset read failed. This is a server-side fault, not a missing dataset.","code":"SERVICE_UNAVAILABLE"}"`);
    });

    it('① a declared 4xx, with a marked userMessage', async () => {
        const error = Object.assign(new Error('operator "$like" is not supported'), { code: 'INVALID_FILTER', status: 400, userMessage: 'Pick a supported filter.' });
        expect(await single({ provider: throwing(error), body: { dataset: inlineDataset, selection } })).toMatchInlineSnapshot(`"400 status-calls=1 {"code":"INVALID_FILTER","message":"operator \\"$like\\" is not supported","userMessage":"Pick a supported filter."}"`);
    });

    it('① a declared 4xx whose code is outside the vocabulary', async () => {
        const error = Object.assign(new Error('month-end close is in progress'), { code: 'MONTH_END_CLOSE', status: 409 });
        expect(await single({ provider: throwing(error), body: { dataset: inlineDataset, selection } })).toMatchInlineSnapshot(`"409 status-calls=1 {"code":"MONTH_END_CLOSE","message":"month-end close is in progress"}"`);
    });

    it('①b the `statusCode` spelling', async () => {
        const error = Object.assign(new Error('record is locked'), { code: 'RECORD_LOCKED', statusCode: 409 });
        expect(await single({ provider: throwing(error), body: { dataset: inlineDataset, selection } })).toMatchInlineSnapshot(`"409 status-calls=1 {"code":"RECORD_LOCKED","message":"record is locked"}"`);
    });

    it('③a a declared 5xx with no code', async () => {
        const error = Object.assign(new Error('pool exhausted on 10.0.0.7'), { status: 503 });
        expect(await single({ provider: throwing(error), body: { dataset: inlineDataset, selection } })).toMatchInlineSnapshot(`"503 status-calls=1 {"error":"Internal server error"}"`);
    });

    it('③a a declared 5xx with a code', async () => {
        const error = Object.assign(new Error('[read-scope-sql] unsafe field identifier "x"'), { status: 500, code: 'READ_SCOPE_COMPILE_FAILED' });
        expect(await single({ provider: throwing(error), body: { dataset: inlineDataset, selection } })).toMatchInlineSnapshot(`"500 status-calls=1 {"error":"Internal server error","code":"READ_SCOPE_COMPILE_FAILED"}"`);
    });

    it('③b an undeclared fault, readable', async () => {
        expect(await single({ provider: throwing(new Error('no strategy can handle query for cube "sales"')), body: { dataset: inlineDataset, selection } })).toMatchInlineSnapshot(`"500 status-calls=1 {"code":"ANALYTICS_QUERY_FAILED","error":"no strategy can handle query for cube \\"sales\\""}"`);
    });

    it('③b an undeclared fault that leaks SQL, withheld, with a marked userMessage', async () => {
        const error = Object.assign(new Error('SELECT bogus FROM "crm_account" - no such column: bogus'), { userMessage: 'The chart could not be drawn.' });
        expect(await single({ provider: throwing(error), body: { dataset: inlineDataset, selection } })).toMatchInlineSnapshot(`"500 status-calls=1 {"code":"ANALYTICS_QUERY_FAILED","error":"Internal server error","userMessage":"The chart could not be drawn."}"`);
    });
});
