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
 * drives that against the real schema — which is why the door has never parsed
 * `AnalyticsQueryRequestSchema`. §5 is the other half of that answer and the
 * one that matters most: a fully-loaded VALID selection still passes. A door
 * that refuses too much is a worse defect than the one being fixed.
 *
 * ## [#17551, ruled] The half #17058 could not door
 *
 * #17058 parsed a PROJECTION — the seven members whose declarations coincide
 * with `AnalyticsQuery`'s — and projected `runtimeFilter`, `dateGranularity`,
 * `compareTo` and `totals` AWAY, because `DatasetSelection` had no Zod schema
 * anywhere in the repo and authoring one in this consumer is the second
 * declaration of a spec-owned wire shape PD #12 forbids. Decision batch #204
 * item 3 ruled letter A: the schema is authored in `packages/spec` and this
 * door parses the WHOLE selection against it. So §4 flips from 「these four are
 * not judged here」 to 「these four are judged here, both directions」, and §6
 * drives #17550's own specimen — `compareTo: { kind: 'nonsense' }`, which used
 * to return a previous-period comparison under a 200 — through the real route.
 *
 * ⚠️ The SCHEMA's own two-directional pins live beside the schema
 * (`spec/src/api/dataset-selection.test.ts`). What is pinned HERE is the
 * ENVELOPE: which refusal shape a failure lands in, how a field path is spelled
 * against the request body, and that the executor is never reached.
 */

// The dynamic `import()`s below are paid HERE, at module scope, so the
// transform lands during collection rather than inside a clocked window
// (`pnpm check:test-source-alias`; this package resolves both specifiers
// through `dist/`). The dynamic calls stay where they are — this only decides
// where the first load is paid.
import '@objectstack/spec/api';
import '@objectstack/spec/data';

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';
import { datasetSelectionRefusal } from './analytics-selection-door';

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
     * [#17551] The door no longer carries a member list of its own — the shape
     * it parses IS the spec's declaration. Pin that this module reaches the
     * schema rather than a local copy, in the one way a consumer can: the four
     * dataset-only members are judged here and are still not `AnalyticsQuery`
     * members. (The schema's own structural pins — the seven shared members
     * taken off `AnalyticsQuerySchema.shape` BY IDENTITY — live beside it.)
     */
    it('the four dataset-only members are judged, and are still not `AnalyticsQuery` members', async () => {
        const { AnalyticsQuerySchema } = await import('@objectstack/spec/data');
        const { DatasetSelectionSchema } = await import('@objectstack/spec/api');
        const analyticsMembers = Object.keys((AnalyticsQuerySchema as any).shape);
        const selectionMembers = Object.keys((DatasetSelectionSchema as any).shape);
        for (const datasetOnly of ['runtimeFilter', 'dateGranularity', 'compareTo', 'totals']) {
            expect(selectionMembers, `${datasetOnly} must be declared on the selection`)
                .toContain(datasetOnly);
            expect(analyticsMembers).not.toContain(datasetOnly);
        }
        // …and the door really parses THAT schema: a value only it can refuse
        // must be refused here.
        expect(await datasetSelectionRefusal({ measures: ['revenue'], compareTo: { kind: 'nope' } }))
            .toBeDefined();
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
// §4 — [#17551] the four dataset-only members, both directions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ This section is the one #17551 turned over. It used to assert that these
 * four 「reach the service untouched」 BECAUSE the door projected them away —
 * true of the projection, and the gap the ruling closed. What survives
 * unchanged is the half that still has to hold: a LEGAL value of each one still
 * reaches the service, by identity. What is added is the other half: a
 * malformed value of each is now refused at the door, with a remedy, and the
 * executor never sees it.
 */
describe('#17551 §4 — the dataset-only members are judged at the door now', () => {
    const legal: Array<[string, unknown]> = [
        ['runtimeFilter', { region: { $ne: 'EU' } }],
        ['dateGranularity', 'quarter'],
        ['compareTo', { kind: 'previousYear' }],
        ['totals', { groupings: [[]] }],
    ];

    for (const [member, value] of legal) {
        it(`CONTROL — a legal \`${member}\` still reaches the service untouched`, async () => {
            const selection = { dimensions: ['region'], measures: ['revenue'], [member]: value };
            const { res, queryDataset } = await post({ dataset: inlineDataset, selection });
            expect(res.statusCode).toBe(200);
            expect(queryDataset).toHaveBeenCalledTimes(1);
            // Validation-only: the CALLER's object, by identity — never a parse
            // output that could carry a schema default.
            expect(queryDataset.mock.calls[0][1]).toBe(selection);
        });
    }

    const malformed: Array<{ member: string; value: unknown; field: string; says: string }> = [
        {
            // ⚠️ No dataset-only sentence is invented for this one, deliberately.
            // `runtimeFilter` carries the canonical `FilterCondition`, so its
            // refusals are that vocabulary’s own — byte-identical to what the
            // sibling body's `where` answers for the same input. A second
            // wording here would be exactly the #5240 defect this card's own
            // `compareTo.kind` builder exists to avoid.
            member: 'runtimeFilter',
            value: 'region = NA',
            field: 'selection.runtimeFilter',
            says: 'expected record',
        },
        {
            member: 'dateGranularity',
            value: 'fortnight',
            field: 'selection.dateGranularity',
            says: 'month',
        },
        {
            member: 'compareTo',
            value: { kind: 'previousPeriod', offset: '7d' },
            field: 'selection.compareTo',
            says: 'offset',
        },
        {
            member: 'totals',
            value: { groupings: ['region'] },
            field: 'selection.totals.groupings.0',
            says: 'array',
        },
    ];

    for (const c of malformed) {
        it(`a malformed \`${c.member}\` answers 400 and never reaches the service`, async () => {
            const selection = { dimensions: ['region'], measures: ['revenue'], [c.member]: c.value };
            const { res, queryDataset } = await post({ dataset: inlineDataset, selection });
            expect(res.statusCode).toBe(400);
            expect(res.body.code).toBe('VALIDATION_FAILED');
            const fields: Array<{ field: string }> = res.body.details.fields;
            expect(fields.map((f) => f.field)).toContain(c.field);
            expect(String(res.body.message).toLowerCase()).toContain(c.says.toLowerCase());
            expect(queryDataset).not.toHaveBeenCalled();
        });
    }

    it('an UNDECLARED key is named against the request body, not dropped', async () => {
        // ⚠️ The root rename is live here and was inert before #17551: a
        // `.strict()` parse of the whole selection puts an unrecognized-keys
        // issue at the ROOT, which the shared mapper spells `(body)` — true for
        // the sibling routes, false here, where the object sits under
        // `selection`.
        const { res, queryDataset } = await post({
            dataset: inlineDataset,
            selection: { measures: ['revenue'], runtimeFillter: { region: 'NA' } },
        });
        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
        const fields: Array<{ field: string }> = res.body.details.fields;
        expect(fields.map((f) => f.field)).toContain('selection');
        expect(fields.map((f) => f.field)).not.toContain('selection.(body)');
        // The refusal carries the fix, which is the whole point of doing this
        // in the schema rather than with a key list here.
        expect(res.body.message).toContain('\`runtimeFillter\` → \`runtimeFilter\`');
        expect(queryDataset).not.toHaveBeenCalled();
    });
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

// ─────────────────────────────────────────────────────────────────────────────
// §5 — [#17598] an arity refusal is ONE condition with ONE wording ON THE WIRE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The array arm is `z.tuple([z.string(), z.string()])` since #17598, so a
 * 1-element window is refused HERE — on the base it was not refused by the
 * schema at all, which is why the arm's own `Too small` text only started
 * riding the wire with that narrowing. The prescription already names the
 * arity, so the arm's restatement is dropped in `fieldsFromZodIssues`
 * (`@objectstack/types`), the one mapper both analytics doors share.
 *
 * ⚠️ These assert the SERVED BODY. The review that found the second wording
 * recorded that nothing pinned the wire in either direction; at `error.issues`
 * the union has always been a single issue, so an issue-level pin would have
 * stayed green through exactly this defect.
 */
describe('#17598 §5 — the arity refusal carries one wording on the wire', () => {
    const arities: Array<[string, unknown]> = [
        ['one bound', ['2026-01-01']],
        ['no bounds', []],
        ['three bounds', ['2026-01-01', '2026-01-15', '2026-01-31']],
    ];

    for (const [name, dateRange] of arities) {
        it(`${name}: the prescription, and NOT the arm's own arity text`, async () => {
            const { res, queryDataset } = await post({
                dataset: inlineDataset,
                selection: {
                    measures: ['revenue'],
                    timeDimensions: [{ dimension: 'close_date', dateRange }],
                },
            });

            expect(res.statusCode).toBe(400);
            expect(res.body.code).toBe('ANALYTICS_DATE_RANGE_UNRECOGNIZED');
            expect(res.body.message).toContain('not the two bounds [start, end]');
            expect(res.body.message).not.toMatch(/Too (small|big)/);
            // One entry for the member, so the `<field>: <message>` join names
            // it once — the shape a second wording showed up as.
            expect(String(res.body.message).match(/selection\.timeDimensions\.0\.dateRange/g))
                .toHaveLength(1);
            expect(queryDataset).not.toHaveBeenCalled();
        });
    }

    it('a selection wrong in MORE than the dateRange keeps every other diagnosis', async () => {
        // ⛔ The collapse is not a silencer: the generic envelope still carries
        // the other member, and the dateRange condition appears exactly once.
        const { res } = await post({
            dataset: inlineDataset,
            selection: {
                measures: ['revenue'],
                dimensions: 'region',
                timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01'] }],
            },
        });

        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
        const fields: Array<{ field: string; message: string }> = res.body.details.fields;
        expect(fields.map((f) => f.field)).toContain('selection.dimensions');
        expect(fields.filter((f) => f.field === 'selection.timeDimensions.0.dateRange'))
            .toHaveLength(1);
        expect(fields.some((f) => /Too (small|big)/.test(f.message))).toBe(false);
    });

    it('a non-string bound still names WHICH bound — that is a location, not a restatement', async () => {
        const { res } = await post({
            dataset: inlineDataset,
            selection: {
                measures: ['revenue'],
                timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', 3] }],
            },
        });

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toContain('selection.timeDimensions.0.dateRange.1');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — ⭐ [#17550] the card this door closes, driven through the real route
// ─────────────────────────────────────────────────────────────────────────────

/**
 * #17550: `shiftRange` branched only on `previousYear` and fell through to the
 * `previousPeriod` arm, so `compareTo: { kind: 'nonsense' }` returned a
 * previous-period comparison under an ordinary **200**. Nothing in the response
 * distinguished it from a real answer, and the wrong answer is a comparison
 * WINDOW — a number a dashboard renders and a person reads as fact.
 *
 * That card's own fix put an exhaustive `switch` in `shiftRange`, which closes
 * it for an IN-PROCESS caller. ⚠️ It could not close it at the door: the door
 * projected `compareTo` away, so a body still travelled into the executor and
 * was answered there, one layer past the boundary that owns request shape —
 * and only for a `compareTo` that survived long enough to be shifted at all.
 * This section is that half: the refusal now happens AT THE DOOR, in the
 * route's own envelope, before the analytics service is called.
 *
 * ⛔ Both halves stay. The executor's refusal is not redundant — `shiftRange`
 * is a published export of `service-analytics` and `queryDataset` is reachable
 * in-process by a caller that never posted a body. What is shared between them
 * is the SENTENCE (`datasetCompareKindRefusalMessage`), so one condition keeps
 * one wording (#5240).
 */
describe('#17550 §6 — an unrecognised `compareTo.kind` is refused at the door', () => {
    it('the card\'s specimen answers 400 and the executor is never called', async () => {
        const { res, queryDataset } = await post({
            dataset: inlineDataset,
            selection: {
                dimensions: ['region'],
                measures: ['revenue'],
                timeDimensions: [{ dimension: 'close_date', dateRange: 'last_30_days' }],
                compareTo: { kind: 'nonsense' },
            },
        });

        // ⛔ Not a 200 with a comparison in it — that IS the defect.
        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
        const fields: Array<{ field: string }> = res.body.details.fields;
        expect(fields.map((f) => f.field)).toContain('selection.compareTo.kind');
        // ⭐ The whole point of the ruling's North Star clause: loud, AND with a
        // prescription. What arrived, the closed vocabulary, and what to do.
        expect(res.body.message).toContain('"nonsense"');
        expect(res.body.message).toContain("'previousPeriod'");
        expect(res.body.message).toContain("'previousYear'");
        expect(res.body.message).toContain('drop compareTo');
        // The refusal is the whole reason a door exists.
        expect(queryDataset).not.toHaveBeenCalled();
    });

    it('the envelope\'s code is a registered vocabulary member, not a dialect', async () => {
        const { ApiErrorSchema } = await import('@objectstack/spec/api');
        const { res } = await post({
            dataset: inlineDataset,
            selection: { measures: ['revenue'], compareTo: { kind: 'nonsense' } },
        });
        const parsed = (ApiErrorSchema as any).safeParse({
            code: res.body.code,
            message: res.body.message,
            httpStatus: res.statusCode,
        });
        expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    });

    it('CONTROL — the same selection with a declared kind still answers 200', async () => {
        const selection = {
            dimensions: ['region'],
            measures: ['revenue'],
            timeDimensions: [{ dimension: 'close_date', dateRange: 'last_30_days' }],
            compareTo: { kind: 'previousPeriod' },
        };
        const { res, queryDataset } = await post({ dataset: inlineDataset, selection });
        expect(res.statusCode).toBe(200);
        expect(queryDataset).toHaveBeenCalledTimes(1);
        expect(queryDataset.mock.calls[0][1]).toBe(selection);
    });

    it('the door and the executor answer the SAME sentence, differing only in where', async () => {
        const { datasetCompareKindRefusalMessage } = await import('@objectstack/spec/api');
        const { res } = await post({
            dataset: inlineDataset,
            selection: { measures: ['revenue'], compareTo: { kind: 'nonsense' } },
        });
        // The verdict clause — everything before the origin clause — is what
        // both raise. Pinning it here is what keeps a second wording from
        // arriving at this door later.
        const verdict = datasetCompareKindRefusalMessage('nonsense', 'schema').split(' Refused at')[0];
        expect(res.body.message).toContain(verdict);
    });
});
