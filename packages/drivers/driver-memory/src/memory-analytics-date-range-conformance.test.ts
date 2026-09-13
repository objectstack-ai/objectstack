// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16322] `driver-memory`'s arm of the shared `dateRange` conformance fixture.
 *
 * The cases and the rules are `@objectstack/core`'s
 * `analyticsDateRangeConformanceFindings` — the SQL analytics path runs the
 * identical set in `@objectstack/service-analytics`
 * (`analytics-date-range-conformance.test.ts`), which is what makes "memory and
 * SQL refuse identically and lower to the same window" a measurement rather
 * than a claim. ⛔ Assertions do not belong in this file: a rule written here
 * is a rule the other backend is not held to, and that asymmetry is the whole
 * defect #16041 split this card off to close.
 *
 * ## Why the window is read out of `result.sql`
 *
 * The cube face lowers into a mingo pipeline and the service already returns
 * that pipeline as `result.sql` for debugging. Both bounds AND the upper-bound
 * OPERATOR are in it, which is exactly the three facts the kit compares — and
 * reading them there needs no probe rows, so the comparison is about the WINDOW
 * rather than about which rows happen to sit near it. (The row-level readings
 * are the sibling files' job: `…-dst.test.ts`, `…-timezone.test.ts`,
 * `…-utc-window.test.ts`.)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  analyticsDateRangeConformanceFindings,
  type LoweredDateRangeWindow,
} from '@objectstack/core';
import type { AnalyticsQuery, Cube } from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';

/** Frozen so the three rolling presets, whose bound is NOW, are comparable. */
const NOW = new Date('2026-09-09T12:34:56.789Z');

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

/**
 * ⛔ Deliberately NOT through `AnalyticsQuerySchema.parse`: the schema door
 * refuses the out-of-vocabulary cases first (#16041), and what this measures is
 * the DRIVER's own answer for an in-process caller past that door —
 * `POST /analytics/dataset/query` being the live example, since it types its
 * selection from `AnalyticsQuery` and never Zod-parses it.
 */
async function lower(range: string | readonly string[]): Promise<LoweredDateRangeWindow> {
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
    // [#17596] ⛔ "no window" is not "a refusal", and the kit can only tell them
    // apart by what this says: a pipeline with no `$match` stage selects EVERY
    // row, which is the defect the ARITY case exists to catch on this face. The
    // kit quotes this text whenever a thrown thing carries no ADR-0112 `code`.
    if (!m) {
      throw new Error(
        'emitted NO window — the pipeline has no time predicate at all, so every row is '
        + `selected: ${String(result.sql)}`,
      );
    }
    return { start: m[1], end: m[3], endExclusive: m[2] === '$lt' };
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});
afterEach(() => {
    vi.useRealTimers();
});

describe('#16322 — driver-memory conforms to the shared dateRange vocabulary', () => {
    it('has no conformance findings', async () => {
        const findings = await analyticsDateRangeConformanceFindings(
            { name: 'driver-memory (cube face)', lower },
            { now: NOW },
        );
        expect(findings).toEqual([]);
    });

    it('⛔ the harness itself is live — a face that lowers nothing is caught', async () => {
        // Without this the green above would be ambiguous between "the driver
        // conforms" and "the kit found nothing to look at". A deliberately
        // broken face must produce findings; if it does not, the run above said
        // nothing about this driver either.
        const findings = await analyticsDateRangeConformanceFindings({
            name: 'a face that answers every input with one window',
            lower: async () => ({ start: 'x', end: 'y', endExclusive: false }),
        }, { now: NOW });
        expect(findings.length).toBeGreaterThan(0);
    });
});
