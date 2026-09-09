// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16322] This package's arm of the shared `dateRange` conformance fixture —
 * ALL THREE of its analytics faces, held to the same rules `driver-memory` is
 * (`memory-analytics-date-range-conformance.test.ts`).
 *
 * The cases and the rules are `@objectstack/core`'s
 * `analyticsDateRangeConformanceFindings`; ⛔ no rule is written here, because a
 * rule only one backend is held to is the asymmetry this card exists to close.
 *
 * ## ⚠️ Where the SQL analytics `dateRange` path actually is
 *
 * Measured, because the card's scope says "the SQL drivers' analytics path" and
 * that reads like `driver-sql`: `packages/drivers/driver-sql/src/sql-driver.ts`
 * contains NO `dateRange` handling at all — two comment mentions and no code.
 * The lowering lives HERE, in the two strategies, which is why the SQL half of
 * the conformance fixture is in this package.
 *
 * ## ⭐ Why a THIRD face, and why the count is what makes the claim true
 *
 * The two strategies are not all of this package's `dateRange` lowering: the
 * draft-preview evaluator (`preview-evaluator.ts`, ADR-0037 P3 — the Live
 * Canvas face) is a fourth analytics face platform-wide, and it carried the
 * same `[range, range]` fallback the other three shed. Registering only the
 * two SQL faces would have left the kit's `FACES` list one short of the claim
 * the change makes, and a face outside the kit is a face free to grow a second
 * interpretation — which is the exact defect #16041 was split to end.
 *
 * ## Driven through `queryDataset`, deliberately
 *
 * That is the `POST /analytics/dataset/query` path, which types its selection
 * from `AnalyticsQuery` and NEVER Zod-parses it — so it is the live in-process
 * caller that reaches a face past the schema door, which is the moment a
 * face-side refusal exists for. Before this card, MEASURED on `b834b48e7a`,
 * that door lowered `last_30_days` — a VALID preset — to
 * `created_at >= 'last_30_days' AND created_at <= 'last_30_days'`, and lowered
 * `'not a range at all'` to exactly the same shape.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  analyticsDateRangeConformanceFindings,
  resolveAnalyticsDateRangeString,
  type AnalyticsDateRangeFace,
  type LoweredDateRangeWindow,
} from '@objectstack/core';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { Cube } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import { evaluateAnalyticsQueryOverRows, lowerPreviewDateRange } from '../preview-evaluator.js';

/** Frozen so the three rolling presets, whose bound is NOW, are comparable. */
const NOW = new Date('2026-09-09T12:34:56.789Z');
const CTX = { tenantId: 'org_A' } as ExecutionContext;

const DATASET = DatasetSchema.parse({
    name: 'events', label: 'Events', object: 'events', include: [],
    dimensions: [
        { name: 'created_at', field: 'created_at', type: 'date' },
        { name: 'probe', field: 'probe', type: 'string' },
    ],
    measures: [{ name: 'count', aggregate: 'count' }],
});

/** The ObjectQL aggregate strategy — every date-bucketed query lands here. */
async function lowerViaObjectql(range: string | readonly string[]): Promise<LoweredDateRangeWindow> {
    const calls: Array<Record<string, unknown>> = [];
    const svc = new AnalyticsService({
        queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
        executeAggregate: async (_object: string, opts: unknown) => {
            calls.push(opts as Record<string, unknown>);
            return [];
        },
    });
    await svc.queryDataset(
        DATASET,
        {
            dimensions: ['created_at'], measures: ['count'],
            timeDimensions: [{ dimension: 'created_at', dateRange: range }],
        } as never,
        CTX,
    );
    const filter = (calls[0].filter as Record<string, Record<string, string>>).created_at;
    const exclusive = Object.prototype.hasOwnProperty.call(filter, '$lt');
    return { start: filter.$gte, end: exclusive ? filter.$lt : filter.$lte, endExclusive: exclusive };
}

/** The native-SQL strategy — the pushdown path, read off the bound statement. */
async function lowerViaNativeSql(range: string | readonly string[]): Promise<LoweredDateRangeWindow> {
    const statements: string[] = [];
    const bound: unknown[][] = [];
    const svc = new AnalyticsService({
        queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
        executeRawSql: async (_o: string, sql: string, params: unknown[]) => {
            statements.push(sql);
            bound.push(params);
            return [];
        },
    });
    await svc.queryDataset(
        DATASET,
        {
            dimensions: ['probe'], measures: ['count'],
            timeDimensions: [{ dimension: 'created_at', dateRange: range }],
        } as never,
        CTX,
    );
    const exclusive = / < \$\d+\)/.test(statements[0]);
    const params = bound[0].map((p) => (p instanceof Date ? p.toISOString() : String(p)));
    return { start: params[0], end: params[1], endExclusive: exclusive };
}

/**
 * The draft-preview evaluator — the Live Canvas face, reached through
 * `queryDataset(…, { previewDrafts: true })` when the base object has a pending
 * seed draft.
 *
 * ⛔ Read off the lowering, not off an emitted filter, because this face emits
 * none: it evaluates rows in memory and returns an `AnalyticsResult`, so there
 * is no `$match` or bound statement carrying the two bounds and the operator.
 * `lowerPreviewDateRange` is the ONE call site `evaluateAnalyticsQueryOverRows`
 * uses; the three cases in the second `describe` below are the control that it
 * really is wired there — without them a green here would be ambiguous between
 * "the preview face conforms" and "an exported helper conforms while the
 * evaluator quietly ignores it".
 */
async function lowerViaPreview(range: string | readonly string[]): Promise<LoweredDateRangeWindow> {
    return lowerPreviewDateRange(range);
}

const FACES: AnalyticsDateRangeFace[] = [
    { name: 'service-analytics (ObjectQL strategy)', lower: lowerViaObjectql },
    { name: 'service-analytics (native SQL strategy)', lower: lowerViaNativeSql },
    { name: 'service-analytics (draft-preview evaluator)', lower: lowerViaPreview },
];

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});
afterEach(() => {
    vi.useRealTimers();
});

describe('#16322 — this package\'s analytics faces conform to the shared dateRange vocabulary', () => {
    it.each(FACES.map((f) => [f.name, f] as const))('%s has no conformance findings', async (_n, face) => {
        expect(await analyticsDateRangeConformanceFindings(face, { now: NOW })).toEqual([]);
    });

    it('⛔ the harness itself is live — a face that lowers nothing is caught', async () => {
        // The same control the memory arm carries: without it a green above is
        // ambiguous between "these strategies conform" and "the kit found
        // nothing to look at".
        const findings = await analyticsDateRangeConformanceFindings({
            name: 'a face that answers every input with one window',
            lower: async () => ({ start: 'x', end: 'y', endExclusive: false }),
        }, { now: NOW });
        expect(findings.length).toBeGreaterThan(0);
    });
});

/**
 * ⭐ The preview face is registered above on its LOWERING; these three cases are
 * why that registration means anything.
 *
 * The two strategy faces are driven through the whole service, so "the face
 * conforms" and "the live path uses it" are one measurement for them. The
 * preview face emits no filter to read, so its registration goes through
 * `lowerPreviewDateRange` — and an exported helper that the evaluator does not
 * actually call would satisfy the kit while the live path kept its old
 * fallback. These cases close that gap end to end, through the exported
 * `evaluateAnalyticsQueryOverRows` and against the SHARED resolver's window
 * (⛔ not against the helper's own answer, which would only restate itself).
 */
const PREVIEW_CUBE = {
    name: 'events',
    sql: 'events',
    dimensions: { id: { name: 'id', type: 'string', sql: 'id' } },
    measures: { count: { name: 'count', type: 'count', sql: '*' } },
} as unknown as Cube;

/** Row ids the evaluator keeps for `dateRange`, grouped by `id` so rows ARE ids. */
function previewSelects(dateRange: string | readonly string[], rows: Array<Record<string, unknown>>): string[] {
    const result = evaluateAnalyticsQueryOverRows(
        {
            measures: ['count'],
            dimensions: ['id'],
            timeDimensions: [{ dimension: 'created_at', dateRange }],
        } as never,
        PREVIEW_CUBE,
        rows.map((r) => ({ ...r })),
    );
    return result.rows.map((r) => String(r.id)).sort();
}

const shift = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();

describe('#16322 — the draft-preview evaluator APPLIES the window it reports', () => {
    // The frozen clock is the file-level `beforeEach` above — the rolling
    // presets' upper bound is NOW, so it has to be the same NOW here.
    it('a ROLLING preset selects exactly the shared resolver\'s window, upper bound REACHED', () => {
        // `last_30_days` ends at NOW and includes it (#16179 leaves the rolling
        // leg inclusive). Before the wiring this selected ZERO rows: the bounds
        // were the literal name, and no ISO instant sorts inside
        // ['last_30_days', 'last_30_days~'].
        const w = resolveAnalyticsDateRangeString('last_30_days', { now: NOW });
        expect(w.endExclusive).toBe(false);
        expect(previewSelects('last_30_days', [
            { id: 'before_start', created_at: shift(w.start, -1) },
            { id: 'at_start', created_at: w.start },
            { id: 'at_end', created_at: w.end },
            { id: 'after_end', created_at: shift(w.end, 1) },
        ])).toEqual(['at_end', 'at_start']);
    });

    it('a CALENDAR preset stops BEFORE its end instant', () => {
        // The other upper reading: two adjacent calendar windows must not both
        // count a row stamped on the boundary.
        const w = resolveAnalyticsDateRangeString('this_month', { now: NOW });
        expect(w.endExclusive).toBe(true);
        expect(previewSelects('this_month', [
            { id: 'before_start', created_at: shift(w.start, -1) },
            { id: 'at_start', created_at: w.start },
            { id: 'just_inside_end', created_at: shift(w.end, -1) },
            { id: 'at_end', created_at: w.end },
        ])).toEqual(['at_start', 'just_inside_end']);
    });

    it('⛔ an unrecognised string is REFUSED by the evaluator with the ADR-0112 envelope', () => {
        // ⛔ Asserted on the ENVELOPE, not on `toThrow()`: a face that threw a
        // bare `Error` — which is what an unfixed one does — would satisfy a
        // bare `toThrow`.
        let thrown: (Error & { code?: string; status?: number }) | undefined;
        try {
            previewSelects('not a range at all', [{ id: 'a', created_at: '2026-09-09T00:00:00.000Z' }]);
        } catch (e) {
            thrown = e as Error & { code?: string; status?: number };
        }
        expect(thrown?.code).toBe('ANALYTICS_DATE_RANGE_UNRECOGNIZED');
        expect(thrown?.status).toBe(400);
    });

    it('⛔ the CALLER\'s explicit window keeps its own bounds and its inclusive upper reading', () => {
        // The #16179 separation on this face too: only a window this face
        // RESOLVED states an exclusive upper bound.
        expect(previewSelects(['2026-09-01T00:00:00.000Z', '2026-09-30T00:00:00.000Z'], [
            { id: 'before', created_at: '2026-08-31T23:59:59.999Z' },
            { id: 'lower', created_at: '2026-09-01T00:00:00.000Z' },
            { id: 'upper', created_at: '2026-09-30T00:00:00.000Z' },
            { id: 'after', created_at: '2026-09-30T00:00:00.001Z' },
        ])).toEqual(['lower', 'upper']);
    });
});
