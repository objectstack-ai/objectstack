// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15825 — DEFECT 2 of 2: the `last N ...` legs of `parseDateRangeString()`
 * did their arithmetic on the LOCAL calendar and rendered it on the UTC one.
 *
 * ## ⛔ Why this file cannot be written to run only at `TZ=UTC`
 *
 * The two spellings — local `setDate(getDate() - n)` and UTC
 * `setUTCDate(getUTCDate() - n)` — are behaviourally INDISTINGUISHABLE at
 * `TZ=UTC`, which is precisely why nothing in CI ever went red on this and why
 * it shipped. Every case below therefore fakes BOTH halves of the environment:
 * a DST-observing zone (`process.env.TZ`, re-read by V8 on the next `Date`
 * operation) AND an instant whose day/month/year shift crosses that zone's own
 * transition.
 *
 * ## The mechanism, stated once
 *
 * `setDate` preserves WALL-CLOCK time, so shifting the local calendar by n
 * days moves the INSTANT by exactly n x 24h only while every local day in the
 * window is 24 hours long. Across a spring-forward that window is 23 hours;
 * across a fall-back, 25. The rendering is `toISOString()` — UTC. So the
 * window start slips an hour, and rows in that hour are wrongly gained or
 * wrongly lost. `setMonth` / `setFullYear` are the same class, and the
 * `last 1 month` cell below shows the local calendar can move the answer by a
 * whole DAY, not merely an hour.
 *
 * ## ⭐ This is a SEPARATE defect from the window boundary
 *
 * Defect 1 — `new Date(y, m, d)` building LOCAL midnight — is pinned in
 * `memory-analytics-date-range-utc-window.test.ts`. ⛔ Neither repair fixes the
 * other, and each was ablated on its own to prove it. Every cell here is built
 * on a boundary that is ALREADY `Date.UTC`, so what it measures is the
 * arithmetic leg alone.
 *
 * ## The oracle is timezone-INVARIANCE, not a second implementation
 *
 * For `month` and `year` there is no offset-free definition of the answer to
 * compare against, so re-deriving one would just be the fix written twice. The
 * oracle used instead is the property the card is actually about: at `TZ=UTC`
 * the two spellings coincide, so the `TZ=UTC` run IS the reference answer, and
 * a correct implementation must return exactly that answer in every other
 * zone. Where a definition does exist (`day` / `week`, since a UTC day is
 * always 24h) it is asserted as well.
 *
 * ## The inline control is load-bearing
 *
 * Each cell also evaluates the OLD spelling directly and asserts it DISAGREES
 * with the one-calendar answer. Without it a green run would be ambiguous
 * between "the fix works" and "these instants are not actually in a transition
 * window" — the second being the failure mode that hid this bug for so long.
 */

import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';
import { AnalyticsQuerySchema } from '@objectstack/spec/data';
import type { AnalyticsQuery, Cube } from '@objectstack/spec/data';

const REAL_TZ = process.env.TZ;

/** Run `fn` with the process on `zone` and the clock frozen at `instant`. */
async function at<T>(zone: string, instant: string, fn: () => Promise<T>): Promise<T> {
    process.env.TZ = zone;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(instant));
    try {
        return await fn();
    } finally {
        vi.useRealTimers();
        if (REAL_TZ === undefined) delete process.env.TZ;
        else process.env.TZ = REAL_TZ;
    }
}

type Unit = 'day' | 'week' | 'month' | 'year';

/** The window boundary, already repaired — defect 1 is not what this file measures. */
function utcBoundary(): Date {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

/** The DEFECT, spelled out: UTC boundary, arithmetic on the LOCAL calendar. */
function localArithmeticStart(unit: Unit, num: number): string {
    const s = utcBoundary();
    if (unit === 'day') s.setDate(s.getDate() - num);
    else if (unit === 'week') s.setDate(s.getDate() - num * 7);
    else if (unit === 'month') s.setMonth(s.getMonth() - num);
    else s.setFullYear(s.getFullYear() - num);
    return s.toISOString();
}

/**
 * ⚠️ Used ONLY to place probe rows on either side of the two candidate
 * boundaries — never as the oracle. The oracle is the `TZ=UTC` run below.
 */
function utcArithmeticStart(unit: Unit, num: number): string {
    const s = utcBoundary();
    if (unit === 'day') s.setUTCDate(s.getUTCDate() - num);
    else if (unit === 'week') s.setUTCDate(s.getUTCDate() - num * 7);
    else if (unit === 'month') s.setUTCMonth(s.getUTCMonth() - num);
    else s.setUTCFullYear(s.getUTCFullYear() - num);
    return s.toISOString();
}

const CUBE: Cube = {
    name: 'events',
    title: 'Events',
    sql: 'events',
    measures: {
        count: { name: 'count', label: 'Count', type: 'count', sql: 'id' },
    },
    dimensions: {
        probe: { name: 'probe', label: 'Probe', type: 'string', sql: 'probe' },
        createdAt: {
            name: 'created_at',
            label: 'Created At',
            type: 'time',
            sql: 'created_at',
            granularities: ['day'],
        },
    },
    public: true,
};

const asQuery = (input: AnalyticsQuery): AnalyticsQuery => AnalyticsQuerySchema.parse(input);

/** Ask `range` over rows planted at `instants`; answer which probes came back. */
async function probesSelected(instants: string[], range: string): Promise<string[]> {
    const driver = new InMemoryDriver({
        initialData: {
            events: instants.map((iso, i) => ({
                id: i + 1,
                probe: iso,
                created_at: new Date(iso),
            })),
        },
    });
    await driver.connect();
    const service = new MemoryAnalyticsService({ driver, cubes: [CUBE] });
    const result = await service.query(asQuery({
        cube: 'events',
        measures: ['events.count'],
        dimensions: ['events.probe'],
        timeDimensions: [{ dimension: 'events.createdAt', dateRange: range }],
    }));
    return result.rows.map((row) => String(row['events.probe'])).sort();
}

interface Cell {
    zone: string;
    /** Frozen clock, always written in UTC. */
    instant: string;
    range: string;
    unit: Unit;
    num: number;
    kind: 'spring-forward' | 'fall-back';
}

/**
 * Red cells — every one MEASURED, ⛔ not guessed: each is an instant at which
 * the local-arithmetic spelling actually disagrees with the one-calendar
 * answer in that zone, taken from a 9-zone x 366-day sweep of 2026 across all
 * four units (2026-09-05). Both hemispheres, both transition directions, all
 * four legs (`day` / `week` / `month` / `year`), and two zones whose standard
 * offset is not a whole hour (St_Johns -03:30, Chatham +12:45) so a
 * whole-hour assumption cannot hide in the repair.
 */
const DST_CELLS: Cell[] = [
    { zone: 'America/New_York',    instant: '2026-03-09T12:00:00Z', range: 'last 3 days',   unit: 'day',   num: 3, kind: 'spring-forward' },
    { zone: 'America/Los_Angeles', instant: '2026-03-09T12:00:00Z', range: 'last 7 days',   unit: 'day',   num: 7, kind: 'spring-forward' },
    { zone: 'America/St_Johns',    instant: '2026-03-09T12:00:00Z', range: 'last 3 days',   unit: 'day',   num: 3, kind: 'spring-forward' },
    { zone: 'Europe/London',       instant: '2026-03-30T12:00:00Z', range: 'last 7 days',   unit: 'day',   num: 7, kind: 'spring-forward' },
    { zone: 'America/New_York',    instant: '2026-03-09T12:00:00Z', range: 'last 1 week',   unit: 'week',  num: 1, kind: 'spring-forward' },
    { zone: 'Europe/Berlin',       instant: '2026-03-30T12:00:00Z', range: 'last 2 weeks',  unit: 'week',  num: 2, kind: 'spring-forward' },
    { zone: 'Australia/Sydney',    instant: '2026-04-05T12:00:00Z', range: 'last 3 days',   unit: 'day',   num: 3, kind: 'fall-back' },
    { zone: 'Pacific/Auckland',    instant: '2026-04-05T12:00:00Z', range: 'last 2 weeks',  unit: 'week',  num: 2, kind: 'fall-back' },
    { zone: 'Pacific/Chatham',     instant: '2026-04-05T12:00:00Z', range: 'last 1 month',  unit: 'month', num: 1, kind: 'fall-back' },
    { zone: 'America/New_York',    instant: '2026-01-01T12:00:00Z', range: 'last 1 month',  unit: 'month', num: 1, kind: 'fall-back' },
    { zone: 'Europe/London',       instant: '2026-01-01T12:00:00Z', range: 'last 3 months', unit: 'month', num: 3, kind: 'fall-back' },
    { zone: 'America/Santiago',    instant: '2026-04-06T12:00:00Z', range: 'last 1 year',   unit: 'year',  num: 1, kind: 'fall-back' },
    { zone: 'Europe/Berlin',       instant: '2026-03-30T12:00:00Z', range: 'last 1 year',   unit: 'year',  num: 1, kind: 'spring-forward' },
];

const label = (c: Cell) => `${c.zone} @ ${c.instant} '${c.range}'`;

/** Probe instants straddling BOTH candidate boundaries, computed in-zone. */
function probesFor(c: Cell): string[] {
    const truth = Date.parse(utcArithmeticStart(c.unit, c.num));
    const mixed = Date.parse(localArithmeticStart(c.unit, c.num));
    return [...new Set([
        new Date(truth).toISOString(),
        new Date(truth - 1).toISOString(),
        new Date(mixed).toISOString(),
        new Date(mixed - 1).toISOString(),
        new Date(truth + 43_200_000).toISOString(), // comfortably inside, both ways
    ])].sort();
}

describe('#15825 defect 2 — the `last N ...` legs resolve on one calendar, across DST transitions', () => {
    for (const c of DST_CELLS) {
        it(`${c.kind}: ${label(c)}`, async () => {
            const { truth, mixed, probes } = await at(c.zone, c.instant, async () => ({
                truth: utcArithmeticStart(c.unit, c.num),
                mixed: localArithmeticStart(c.unit, c.num),
                probes: probesFor(c),
            }));

            // CONTROL FIRST — if these agree, the cell is not in a transition
            // window and every assertion below would be vacuous. (It is the
            // whole reason a TZ=UTC-only test is worthless here.)
            expect(
                mixed,
                `${label(c)}: the local-arithmetic spelling must DISAGREE here, otherwise this cell pins nothing`,
            ).not.toBe(truth);

            const inZone = await at(c.zone, c.instant, () => probesSelected(probes, c.range));
            const atUtc = await at('UTC', c.instant, () => probesSelected(probes, c.range));

            // THE ORACLE: at TZ=UTC the two spellings coincide, so this run is
            // the reference answer. The process timezone must not move it.
            expect(inZone, `${label(c)}: the process timezone changed which rows were counted`).toEqual(atUtc);

            // And the answer must actually be non-trivial — a window that
            // selected everything or nothing would compare equal for free.
            expect(inZone.length, `${label(c)}: probes must straddle the boundary`).toBeGreaterThan(0);
            expect(inZone.length, `${label(c)}: probes must straddle the boundary`).toBeLessThan(probes.length);
        });
    }

    it('the day and week legs also match the offset-free definition — n x 24h before the UTC day', async () => {
        for (const c of DST_CELLS.filter((x) => x.unit === 'day' || x.unit === 'week')) {
            await at(c.zone, c.instant, async () => {
                const days = c.unit === 'week' ? c.num * 7 : c.num;
                expect(utcArithmeticStart(c.unit, c.num), label(c))
                    .toBe(new Date(utcBoundary().getTime() - days * 86_400_000).toISOString());
            });
        }
    });

    it('every red cell is live — the local-arithmetic spelling disagrees in all of them', async () => {
        const live: string[] = [];
        for (const c of DST_CELLS) {
            await at(c.zone, c.instant, async () => {
                if (localArithmeticStart(c.unit, c.num) !== utcArithmeticStart(c.unit, c.num)) live.push(label(c));
            });
        }
        expect(live.length, 'a cell that no longer flips has stopped guarding the fix').toBe(DST_CELLS.length);
    });

    it('both directions are represented — a window start too EARLY and one too LATE', async () => {
        const dirs = new Set<string>();
        for (const c of DST_CELLS) {
            await at(c.zone, c.instant, async () => {
                dirs.add(localArithmeticStart(c.unit, c.num) < utcArithmeticStart(c.unit, c.num) ? 'early' : 'late');
            });
        }
        expect([...dirs].sort()).toEqual(['early', 'late']);
    });

    it('all four arithmetic legs are covered — day, week, month and year', () => {
        expect([...new Set(DST_CELLS.map((c) => c.unit))].sort()).toEqual(['day', 'month', 'week', 'year']);
    });
});

// ── Fences: what this change must NOT have moved ──────────────────────────

describe('#15825 defect 2 fences', () => {
    it('⛔ at TZ=UTC the two spellings are INDISTINGUISHABLE — a UTC-only test proves nothing', async () => {
        for (const c of DST_CELLS) {
            await at('UTC', c.instant, async () => {
                expect(localArithmeticStart(c.unit, c.num), label(c)).toBe(utcArithmeticStart(c.unit, c.num));
            });
        }
    });

    it('zones that do not observe DST are unaffected — both spellings already agreed on the day legs there', async () => {
        for (const zone of ['UTC', 'Asia/Shanghai', 'Asia/Kolkata', 'Australia/Perth']) {
            for (const instant of ['2026-03-09T12:00:00Z', '2026-11-02T12:00:00Z', '2026-06-15T12:00:00Z']) {
                await at(zone, instant, async () => {
                    expect(localArithmeticStart('day', 7), `${zone} @ ${instant}`)
                        .toBe(utcArithmeticStart('day', 7));
                });
            }
        }
    });

    it('an ordinary instant in a DST zone is unaffected — the local day is 24h there', async () => {
        for (const zone of [...new Set(DST_CELLS.map((c) => c.zone))]) {
            await at(zone, '2026-06-15T12:00:00Z', async () => {
                expect(localArithmeticStart('day', 3), zone).toBe(utcArithmeticStart('day', 3));
            });
        }
    });

    it('the process timezone is restored after every case', () => {
        expect(process.env.TZ).toBe(REAL_TZ);
    });
});
