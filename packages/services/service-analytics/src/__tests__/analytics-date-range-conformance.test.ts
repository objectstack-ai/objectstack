// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16322] The SQL analytics path's arm of the shared `dateRange` conformance
 * fixture — BOTH strategies, held to the same rules `driver-memory` is
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
  type AnalyticsDateRangeFace,
  type LoweredDateRangeWindow,
} from '@objectstack/core';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';

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

const FACES: AnalyticsDateRangeFace[] = [
    { name: 'service-analytics (ObjectQL strategy)', lower: lowerViaObjectql },
    { name: 'service-analytics (native SQL strategy)', lower: lowerViaNativeSql },
];

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});
afterEach(() => {
    vi.useRealTimers();
});

describe('#16322 — the SQL analytics path conforms to the shared dateRange vocabulary', () => {
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
