// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16322] THE shared conformance fixture the driver half of #16041 owes: every
 * analytics-capable face lowers the closed `timeDimensions[].dateRange` preset
 * vocabulary to the SAME window, and refuses everything else with the SAME
 * ADR-0112 envelope.
 *
 * ## Why one fixture, and why it lives here
 *
 * The ruling that split #16041 asked for exactly this — *"memory and SQL
 * drivers refuse identically and share one conformance fixture"* — because the
 * defect it closes was a DISAGREEMENT, not a bug in one backend. Measured on
 * `b834b48e7a`, one bad input, three different wrong answers:
 *
 *   - `driver-memory` matched EVERY `Date`-typed row (a `Date` compares above a
 *     `String` under BSON cross-type ordering, so both garbage bounds of the
 *     `[range, range]` fallback were satisfied) — 5/5 probe rows, 2020 and 2099
 *     included, at HTTP 200;
 *   - both SQL strategies compiled the point window
 *     `created_at >= 'last_30_days' AND created_at <= 'last_30_days'`, whose
 *     answer is whatever the dialect decides a vocabulary word compares as;
 *   - and the VALID presets fared no better: `today` was the only one
 *     driver-memory resolved, and neither SQL strategy resolved even that one.
 *
 * ⇒ the assertions below are cross-face by construction: each face is measured
 * in its own currency (a mingo pipeline, an ObjectQL filter, bound SQL) and the
 * three answers are compared to ONE expectation — `@objectstack/core`'s
 * `resolveAnalyticsDateRangeString`, the single lowering all three now call.
 * A face that grew its own interpretation goes red here even if its own
 * package's tests stay green, which is the whole point of the fixture.
 *
 * `packages/runtime` hosts it because it is the only package that can see all
 * three: `@objectstack/driver-memory` is a dependency, `@objectstack/service-analytics`
 * a devDependency. Its sibling `analytics-daterange-refusal-envelope.test.ts`
 * pins the same envelope at the HTTP door, so the two files together state the
 * whole rule — refused at the door, and refused again by every face behind it.
 *
 * ## ⚠️ The SQL faces are driven through `queryDataset`, deliberately
 *
 * That is the `/analytics/dataset/query` path, which types its selection from
 * `AnalyticsQuery` and NEVER Zod-parses it (recorded on the card). So it is the
 * live in-process caller that reaches a face past the schema door — exactly the
 * moment a driver-side refusal exists for.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DATE_RANGE_PRESETS, type DateRangePreset } from '@objectstack/spec/data';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { resolveAnalyticsDateRangeString } from '@objectstack/core';
import { InMemoryDriver, MemoryAnalyticsService } from '@objectstack/driver-memory';
import type { AnalyticsQuery, Cube } from '@objectstack/spec/data';
import { AnalyticsService } from '@objectstack/service-analytics';

/** Frozen so all three faces resolve against one instant. */
const NOW = new Date('2026-09-09T12:34:56.789Z');
const CTX = { tenantId: 'org_A' } as ExecutionContext;

/** What a face did with one `dateRange` — its window, in one shape. */
interface Lowered {
    start: string;
    end: string;
    /** `true` when the face compares the upper bound EXCLUSIVELY. */
    endExclusive: boolean;
}

/** The refusal a face raised, reduced to the envelope facts ADR-0112 fixes. */
interface Refusal {
    code?: string;
    status?: number;
    message: string;
}

const CUBE: Cube = {
    name: 'events',
    title: 'Events',
    sql: 'events',
    measures: { count: { name: 'count', label: 'Count', type: 'count', sql: 'id' } },
    dimensions: {
        probe: { name: 'probe', label: 'Probe', type: 'string', sql: 'probe' },
        createdAt: {
            name: 'created_at', label: 'Created At', type: 'time', sql: 'created_at',
            granularities: ['day'],
        },
    },
    public: true,
};

const DATASET = DatasetSchema.parse({
    name: 'events', label: 'Events', object: 'events', include: [],
    dimensions: [
        { name: 'created_at', field: 'created_at', type: 'date' },
        { name: 'probe', field: 'probe', type: 'string' },
    ],
    measures: [{ name: 'count', aggregate: 'count' }],
});

// ── The three faces ───────────────────────────────────────────────────────

/**
 * driver-memory's cube face. Its window is read out of the pipeline dump the
 * service already returns as `result.sql` — the `$match` stage this path
 * builds, which is where the bounds and the upper-bound OPERATOR both live.
 */
async function memoryFace(range: string): Promise<Lowered> {
    const driver = new InMemoryDriver({ initialData: { events: [] } });
    await driver.connect();
    const service = new MemoryAnalyticsService({ driver, cubes: [CUBE] });
    const result = await service.query({
        cube: 'events',
        measures: ['events.count'],
        dimensions: ['events.probe'],
        timeDimensions: [{ dimension: 'events.createdAt', dateRange: range }],
    } as unknown as AnalyticsQuery);
    const m = /"\$gte":"([^"]+)","(\$lte|\$lt)":"([^"]+)"/.exec(String(result.sql));
    if (!m) throw new Error(`no window in the memory pipeline dump: ${String(result.sql)}`);
    return { start: m[1], end: m[3], endExclusive: m[2] === '$lt' };
}

/** The ObjectQL aggregate strategy — the path every date-bucketed query takes. */
async function objectqlFace(range: string): Promise<Lowered> {
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

/** The native-SQL strategy — the pushdown path, measured on the bound statement. */
async function nativeSqlFace(range: string): Promise<Lowered> {
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

const FACES: Array<{ name: string; lower: (range: string) => Promise<Lowered> }> = [
    { name: 'driver-memory (cube face)', lower: memoryFace },
    { name: 'service-analytics (ObjectQL strategy)', lower: objectqlFace },
    { name: 'service-analytics (native SQL strategy)', lower: nativeSqlFace },
];

async function refusalFrom(
    face: { name: string; lower: (range: string) => Promise<Lowered> },
    range: string,
): Promise<Refusal | null> {
    try {
        await face.lower(range);
        return null;
    } catch (e) {
        const err = e as Error & { code?: string; status?: number };
        return { code: err.code, status: err.status, message: err.message };
    }
}

/** ⛔ Strings the closed vocabulary does not contain — every one a real spelling. */
const OUTSIDE_THE_VOCABULARY = [
    'Last 7 days',        // the schema's own former example, and the #16041 case
    'last 7 days',        // the relative dialect this repair deleted
    'not a range at all', // the retired driver fence's input
    'last_60_days',       // a plausible near-miss that was never declared
];

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});
afterEach(() => {
    vi.useRealTimers();
});

describe('#16322 — every analytics face lowers the preset vocabulary to ONE window', () => {
    it.each([...DATE_RANGE_PRESETS])('%s resolves identically on all three faces', async (preset) => {
        const expected = resolveAnalyticsDateRangeString(preset, { now: NOW });
        for (const face of FACES) {
            const got = await face.lower(preset);
            expect(got, `${face.name} disagreed on '${preset}'`).toEqual({
                start: expected.start,
                end: expected.end,
                endExclusive: expected.endExclusive,
            });
        }
    });

    it('⛔ no face answers with the preset NAME as a bound — the fallback shape', async () => {
        // The defect stated as a shape rather than a row count, so it is
        // checkable on the two faces that never see a row.
        for (const preset of DATE_RANGE_PRESETS) {
            for (const face of FACES) {
                const got = await face.lower(preset);
                expect([got.start, got.end], `${face.name} / ${preset}`).not.toContain(preset);
            }
        }
    });

    it('the thirteen windows are DISTINCT on every face', async () => {
        for (const face of FACES) {
            const seen = new Set<string>();
            for (const preset of DATE_RANGE_PRESETS) {
                const w = await face.lower(preset);
                seen.add(`${w.start}..${w.end}`);
            }
            expect(seen.size, `${face.name} collapsed windows together`).toBe(DATE_RANGE_PRESETS.length);
        }
    });

    it('the ten calendar presets compare the upper bound EXCLUSIVELY, the three rolling ones do not', async () => {
        // #16179's reading, held across faces: a resolved calendar window stops
        // BEFORE its end instant, so two adjacent windows cannot both count a
        // row stamped on the boundary. A rolling window ends at NOW, a moment
        // it reaches.
        const rolling: readonly DateRangePreset[] = ['last_7_days', 'last_30_days', 'last_90_days'];
        for (const preset of DATE_RANGE_PRESETS) {
            for (const face of FACES) {
                expect((await face.lower(preset)).endExclusive, `${face.name} / ${preset}`)
                    .toBe(!rolling.includes(preset));
            }
        }
    });
});

describe('#16322 — every analytics face refuses the SAME strings with the SAME envelope', () => {
    it.each(OUTSIDE_THE_VOCABULARY)('refuses %j on all three faces, identically', async (bad) => {
        const refusals: Refusal[] = [];
        for (const face of FACES) {
            const r = await refusalFrom(face, bad);
            expect(r, `${face.name} ANSWERED ${JSON.stringify(bad)} instead of refusing`).not.toBeNull();
            expect(r!.code, face.name).toBe('ANALYTICS_DATE_RANGE_UNRECOGNIZED');
            expect(r!.status, face.name).toBe(400);
            refusals.push(r!);
        }
        // Identical, not merely equivalent: one condition, one wording (#5240),
        // so an author correcting the value reads the same prescription
        // whichever backend the deployment runs.
        expect(new Set(refusals.map((r) => JSON.stringify(r))).size).toBe(1);
    });

    it('the vocabulary is CASE-SENSITIVE and snake_case on every face', async () => {
        for (const face of FACES) {
            expect(await refusalFrom(face, 'TODAY'), face.name).not.toBeNull();
            expect(await refusalFrom(face, 'Last_7_Days'), face.name).not.toBeNull();
            expect(await refusalFrom(face, 'today'), face.name).toBeNull();
        }
    });

    it('⛔ CONTROL — every DECLARED name is accepted by all three faces', async () => {
        // Without this a face that refused EVERY string would satisfy every
        // assertion above, which is the opposite defect and just as silent.
        for (const face of FACES) {
            for (const preset of DATE_RANGE_PRESETS) {
                expect(await refusalFrom(face, preset), `${face.name} refused the declared '${preset}'`)
                    .toBeNull();
            }
        }
    });

    it("⛔ CONTROL — an explicit [start, end] window is NOT refused, and keeps its inclusive upper bound", async () => {
        // The #16179 separation, stated across faces: only a window a face
        // RESOLVED is compared with `<`. A caller's own bound is theirs, and
        // `$lte` is the reading these faces have published since they existed.
        //
        // ⚠️ Written as full timestamps on purpose. A BARE `YYYY-MM-DD` end
        // means "through that whole day" and each face widens it to
        // `< nextDay` in its own currency (#4042 / #3777) — a per-face calendar
        // translation this card does not touch and which would make the three
        // spellings differ here for a reason that has nothing to do with the
        // preset vocabulary.
        const explicit = ['2026-09-01T00:00:00.000Z', '2026-09-30T00:00:00.000Z'];
        for (const face of FACES) {
            const got = await face.lower(explicit as unknown as string);
            expect(got.endExclusive, `${face.name} narrowed a caller's explicit window`).toBe(false);
            expect(got.start, face.name).toBe(explicit[0]);
            expect(got.end, face.name).toBe(explicit[1]);
        }
    });
});
