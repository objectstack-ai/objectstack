// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17058] `POST /analytics/dataset/query` parses its `selection` AT THE DOOR.
 *
 * The defect: the route checked only that `selection.measures` was a non-empty
 * array, so every other member reached `dataset-executor` unrefused — while the
 * sibling routes (`/analytics/query`, `/analytics/sql`) lift the identical
 * failure to a 400 at their entry. One family, two postures.
 *
 * ## The measurement the card left open, taken here and PINNED
 *
 * The card asked whether the dataset route's `selection` is genuinely the same
 * shape as the siblings' before reusing their schema. It is **not** — §1 below
 * drives that against the real schema — so the door parses a PROJECTION of the
 * members whose declarations coincide, and the four dataset-only members are
 * projected away rather than refused. §5 is the other half of that answer and
 * the one that matters most: a fully-loaded VALID selection still passes.
 * A door that refuses too much is a worse defect than the one being fixed.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';
import {
    SELECTION_MEMBERS_SHARED_WITH_ANALYTICS_QUERY,
    datasetSelectionRefusal,
} from './analytics-selection-door';

// ── harness (the shape `analytics-routes.test.ts` uses) ──────────────────────

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}
function mockProtocol() {
    return {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
    };
}
function mockRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.end = vi.fn(() => res);
    return res;
}

const inlineDataset = {
    name: 'sales',
    label: 'Sales',
    object: 'opportunity',
    dimensions: [
        { name: 'region', field: 'region', type: 'string' },
        { name: 'close_date', field: 'close_date', type: 'date' },
    ],
    measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};

function buildRoute() {
    const queryDataset = vi.fn().mockResolvedValue({ rows: [], fields: [] });
    const server = mockServer();
    const rest = new RestServer(
        server as any, mockProtocol() as any, { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined,
        async () => ({ queryDataset }),
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const route = rest.getRoutes().find((r) => r.method === 'POST' && r.path.endsWith('/analytics/dataset/query'))!;
    expect(route, 'POST …/analytics/dataset/query must be registered').toBeTruthy();
    return { route, queryDataset };
}

/** POST a body through the REAL route and return `{ res, queryDataset }`. */
async function post(body: unknown) {
    const { route, queryDataset } = buildRoute();
    const res = mockRes();
    await route.handler({ method: 'POST', params: {}, headers: {}, body } as any, res);
    return { res, queryDataset };
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the shape question: `DatasetSelection` is NOT the siblings' shape
// ─────────────────────────────────────────────────────────────────────────────

describe('#17058 §1 — the dataset route\'s `selection` is not the sibling routes\' body shape', () => {
    /**
     * A legal, ordinary dashboard-widget selection. Every member here is
     * declared on `DatasetSelection` (`spec/contracts/analytics-service.ts`).
     */
    const legalSelection = {
        dimensions: ['region'],
        measures: ['revenue'],
        runtimeFilter: { region: 'NA' },
        timeDimensions: [{ dimension: 'close_date', granularity: 'month', dateRange: 'last_30_days' }],
        dateGranularity: 'month',
        order: { revenue: 'desc' },
        limit: 10,
        offset: 0,
        compareTo: { kind: 'previousPeriod' },
        totals: { groupings: [['region'], []] },
        timezone: 'Asia/Shanghai',
    } as const;

    it('the siblings\' own schema REFUSES it — on `cube` and on all four dataset-only members', async () => {
        const { AnalyticsQueryRequestSchema } = await import('@objectstack/spec/api');
        const parsed = (AnalyticsQueryRequestSchema as any).safeParse(legalSelection);

        expect(parsed.success, 'a legal DatasetSelection must NOT parse as an AnalyticsQuery').toBe(false);
        const paths: string[] = parsed.error.issues.map((i: any) => i.path.join('.'));
        const unrecognized: string[] = parsed.error.issues
            .filter((i: any) => i.code === 'unrecognized_keys')
            .flatMap((i: any) => i.keys ?? []);

        // `cube` is required there and absent here — a dataset selection names
        // no cube; the dataset is addressed by `body.dataset`/`datasetName`.
        expect(paths).toContain('cube');
        // …and the schema is `.strict()`, so the dataset-only members are keys
        // it has never heard of. This is why reusing it would 400 every real
        // dashboard widget.
        expect(unrecognized.sort()).toEqual(
            ['compareTo', 'dateGranularity', 'runtimeFilter', 'totals'].sort(),
        );
    });

    it('the shared projection accepts the same selection — that is the half this door parses', async () => {
        expect(await datasetSelectionRefusal(legalSelection)).toBeUndefined();
    });

    /**
     * The projection list is a claim about two declarations agreeing. Pin both
     * directions so a later edit cannot quietly move a member into or out of it.
     */
    it('every projected member is an `AnalyticsQuery` member; no dataset-only member is', async () => {
        const { AnalyticsQuerySchema } = await import('@objectstack/spec/data');
        const analyticsMembers = Object.keys((AnalyticsQuerySchema as any).shape);
        for (const member of SELECTION_MEMBERS_SHARED_WITH_ANALYTICS_QUERY) {
            expect(analyticsMembers, `${member} must be declared on AnalyticsQuery`).toContain(member);
        }
        for (const datasetOnly of ['runtimeFilter', 'dateGranularity', 'compareTo', 'totals']) {
            expect(analyticsMembers).not.toContain(datasetOnly);
            expect(SELECTION_MEMBERS_SHARED_WITH_ANALYTICS_QUERY as readonly string[])
                .not.toContain(datasetOnly);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the card's measured specimen, driven through the real route
// ─────────────────────────────────────────────────────────────────────────────

describe('#17058 §2 — a malformed `dateRange` is refused at the door, not by the face behind it', () => {
    it('answers 400 ANALYTICS_DATE_RANGE_UNRECOGNIZED and never reaches the service', async () => {
        const { res, queryDataset } = await post({
            dataset: inlineDataset,
            selection: {
                dimensions: ['region'],
                measures: ['revenue'],
                timeDimensions: [{ dimension: 'close_date', dateRange: 'not a range at all' }],
            },
        });

        expect(res.statusCode).toBe(400);
        // The SAME code the sibling door answers for the identical condition —
        // one condition, one code (ADR-0112 D3 / the #5240 convention).
        expect(res.body.code).toBe('ANALYTICS_DATE_RANGE_UNRECOGNIZED');
        // The message locates the offending member on the REQUEST body…
        expect(res.body.message).toContain('selection.timeDimensions.0.dateRange');
        // …and carries the schema's own prescription, quoted not restated.
        expect(res.body.message).toContain('not a range at all');
        expect(res.body.message).toContain('last_7_days');
        // The whole point of a door: the executor never sees it.
        expect(queryDataset).not.toHaveBeenCalled();
    });

    it('the envelope\'s code is a registered vocabulary member, not a dialect', async () => {
        const { ApiErrorSchema } = await import('@objectstack/spec/api');
        const { res } = await post({
            dataset: inlineDataset,
            selection: {
                measures: ['revenue'],
                timeDimensions: [{ dimension: 'close_date', dateRange: 'Last 7 days' }],
            },
        });
        const parsed = (ApiErrorSchema as any).safeParse({
            code: res.body.code,
            message: res.body.message,
            httpStatus: res.statusCode,
        });
        expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the rest of the shape: `timeDimensions` is not special
// ─────────────────────────────────────────────────────────────────────────────

describe('#17058 §3 — the generic refusal is 400 VALIDATION_FAILED + details.fields[]', () => {
    const cases: Array<{ name: string; selection: Record<string, unknown>; field: string }> = [
        {
            name: 'a typo\'d nested key (`granuarity`) — top-level strictness does not recurse',
            selection: {
                measures: ['revenue'],
                timeDimensions: [{ dimension: 'close_date', granuarity: 'month' }],
            },
            field: 'selection.timeDimensions.0',
        },
        {
            name: 'a measure name that is not a string',
            selection: { measures: [42] },
            field: 'selection.measures.0',
        },
        {
            name: 'a dimension list that is not a list',
            selection: { measures: ['revenue'], dimensions: 'region' },
            field: 'selection.dimensions',
        },
        {
            name: 'an order direction outside the declared pair',
            selection: { measures: ['revenue'], order: { revenue: 'ASC' } },
            field: 'selection.order.revenue',
        },
        {
            name: 'a `limit` sent as a string',
            selection: { measures: ['revenue'], limit: '10' },
            field: 'selection.limit',
        },
    ];

    for (const c of cases) {
        it(`refuses ${c.name}`, async () => {
            const { res, queryDataset } = await post({ dataset: inlineDataset, selection: c.selection });
            expect(res.statusCode).toBe(400);
            expect(res.body.code).toBe('VALIDATION_FAILED');
            const fields: Array<{ field: string; code: string }> = res.body.details.fields;
            expect(fields.map((f) => f.field)).toContain(c.field);
            expect(queryDataset).not.toHaveBeenCalled();
        });
    }

    it('the date-range lift is all-or-nothing: a body wrong in MORE places stays generic', async () => {
        const { res } = await post({
            dataset: inlineDataset,
            selection: {
                measures: ['revenue'],
                timeDimensions: [{ dimension: 'close_date', dateRange: 'nope', granuarity: 'month' }],
            },
        });
        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
        const fields: Array<{ field: string }> = res.body.details.fields;
        expect(fields.map((f) => f.field)).toContain('selection.timeDimensions.0.dateRange');
        expect(fields.map((f) => f.field)).toContain('selection.timeDimensions.0');
    });

    it('the `measures` door ahead of the parse keeps its own sentence', async () => {
        const { res } = await post({ dataset: inlineDataset, selection: { dimensions: ['region'] } });
        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
        expect(res.body.message).toContain('body.selection.measures');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the four dataset-only members keep passing (they are projected away)
// ─────────────────────────────────────────────────────────────────────────────

describe('#17058 §4 — the dataset-only members are NOT judged by the sibling schema', () => {
    const datasetOnly: Array<[string, unknown]> = [
        ['runtimeFilter', { region: { $ne: 'EU' } }],
        ['dateGranularity', 'quarter'],
        ['compareTo', { kind: 'previousYear' }],
        ['totals', { groupings: [[]] }],
    ];

    for (const [member, value] of datasetOnly) {
        it(`\`${member}\` reaches the service untouched`, async () => {
            const selection = { dimensions: ['region'], measures: ['revenue'], [member]: value };
            const { res, queryDataset } = await post({ dataset: inlineDataset, selection });
            expect(res.statusCode).toBe(200);
            expect(queryDataset).toHaveBeenCalledTimes(1);
            expect(queryDataset.mock.calls[0][1]).toBe(selection);
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — ⭐ the negative side: a valid selection still passes, unmodified
// ─────────────────────────────────────────────────────────────────────────────

describe('#17058 §5 — a valid selection still passes, and passes through unchanged', () => {
    it('a fully-loaded selection — all eleven members — answers 200', async () => {
        const selection = {
            dimensions: ['region'],
            measures: ['revenue'],
            runtimeFilter: { region: 'NA' },
            timeDimensions: [{ dimension: 'close_date', granularity: 'month', dateRange: 'last_30_days' }],
            dateGranularity: 'month',
            order: { revenue: 'desc' },
            limit: 10,
            offset: 0,
            compareTo: { kind: 'previousPeriod', dimension: 'close_date' },
            totals: { groupings: [['region'], []] },
            timezone: 'Asia/Shanghai',
        };
        const { res, queryDataset } = await post({ dataset: inlineDataset, selection });
        expect(res.statusCode).toBe(200);
        expect(queryDataset).toHaveBeenCalledTimes(1);
        // Validation-only: the CALLER's object is what the service receives,
        // by identity — never a parse output that could carry a schema default.
        expect(queryDataset.mock.calls[0][1]).toBe(selection);
    });

    it('the explicit `[start, end]` window arm is untouched by the closing', async () => {
        const { res, queryDataset } = await post({
            dataset: inlineDataset,
            selection: {
                measures: ['revenue'],
                timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '{today}'] }],
            },
        });
        expect(res.statusCode).toBe(200);
        expect(queryDataset).toHaveBeenCalledTimes(1);
    });

    /**
     * The leniency sweep, as a test. Every `selection` literal the in-repo
     * suites POST at this route (and the one `packages/qa/dogfood` sends) is
     * replayed through the new door: if any of them had been relying on the
     * leniency, the fix would have broken it, and triage asked for that answer
     * explicitly rather than as an impression.
     */
    it('every in-repo selection specimen still passes the door', async () => {
        const specimens: Array<Record<string, unknown>> = [
            // packages/rest/src/analytics-dataset-dimension-gate.test.ts
            { measures: ['account_count'], dimensions: ['bogus_dim'] },
            { measures: ['account_count'], dimensions: ['industry'], timeDimensions: [{ dimension: 'bogus_dim', granularity: 'month' }] },
            // packages/rest/src/analytics-dataset-where-gate.test.ts
            { measures: ['account_count'], runtimeFilter: { bogus_col: 'x' } },
            { measures: ['account_count'], runtimeFilter: { industry: { $sortOf: 'tech' } } },
            // packages/rest/src/analytics-dataset-refusal-envelope.test.ts
            { dimensions: ['stage'], measures: ['revenue'], order: { profit: 'desc' } },
            { dimensions: ['stage'], measures: ['revenue'], totals: { groupings: [['region']] } },
            // packages/rest/src/analytics-dataset-unlisted-refusal-envelope.test.ts
            { dimensions: ['stage'], measures: ['revenue'], timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', 'the-first-of-never'] }], compareTo: { kind: 'previousPeriod' } },
            { dimensions: ['stage'], measures: ['revenue'], timeDimensions: [{ dimension: 'close_date', granularity: 'month' }], compareTo: { kind: 'previousPeriod' } },
            { dimensions: ['stage'], measures: ['revenue'], timeDimensions: [{ dimension: 'account_opened', granularity: 'month' }] },
            // packages/client/src/client.test.ts
            { measures: ['amount_sum'] },
            // packages/qa/dogfood/test/temporal-storage-e2e.dogfood.test.ts
            { measures: ['cnt'], timeDimensions: [{ dimension: 'issued', granularity: 'month' }] },
        ];
        for (const selection of specimens) {
            expect(
                await datasetSelectionRefusal(selection),
                `specimen must still pass: ${JSON.stringify(selection)}`,
            ).toBeUndefined();
        }
    });
});
