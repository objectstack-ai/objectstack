// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15825 — DEFECT 2 of 2: the `dateRange` window legs of the analytics cube
 * face used to do their calendar arithmetic on the PROCESS's local calendar
 * and render it on the UTC one — reinstated under #16322 in the closed PRESET
 * vocabulary, which is the only spelling the contract still admits.
 *
 * ## ⛔ Why this file cannot be written to run only at `TZ=UTC`
 *
 * A UTC-calendar spelling (`setUTCDate`, `getUTCDay`, `Date.UTC`) and its local
 * twin (`setDate`, `getDay`, `new Date(y, m, d)`) are behaviourally
 * INDISTINGUISHABLE at `TZ=UTC`, which is precisely why nothing in CI ever went
 * red on this and why it shipped. Every case below therefore fakes BOTH halves
 * of the environment: a DST-observing zone (`process.env.TZ`, re-read by V8 on
 * the next `Date` operation) AND an instant at which the two spellings actually
 * part company. A fence at the bottom re-asserts the indistinguishability, so
 * the reason this file is shaped this way cannot quietly stop being true.
 *
 * ## What each cell measures, and what its control proves
 *
 * The cell drives the real public entry — `MemoryAnalyticsService.query()`,
 * through `AnalyticsQuerySchema.parse` — and asserts the ROW SET it selects in
 * a DST zone equals the row set the same query selects at `TZ=UTC`. The oracle
 * is that INVARIANCE, not a second implementation: the query carries no
 * `timezone`, so the answer is a property of the data and the clock and must
 * not move with a host setting. (A query that DOES carry one is the sibling
 * file's subject — `memory-analytics-date-range-timezone.test.ts`.)
 *
 * The inline control is load-bearing: each cell first asserts that the
 * PROCESS-calendar spelling of that preset's window start DISAGREES with the
 * one-calendar spelling at that instant. Without it a green run would be
 * ambiguous between "the resolution is host-independent" and "this instant
 * does not discriminate" — the second being the failure mode that hid this bug
 * for years.
 *
 * ⚠️ How SHARP the control is differs by leg, measured, and the difference is
 * stated rather than papered over:
 *
 *  - on the three ROLLING day legs (`last_7_days` / `last_30_days` /
 *    `last_90_days`) the two spellings agree except across a transition —
 *    `setDate` preserves WALL-CLOCK time, so shifting the local calendar by n
 *    days moves the INSTANT by exactly n x 24h only while every local day in
 *    the window is 24 hours long. Measured over a 9-zone x 366-day x 7-preset
 *    sweep of 2026: 14/366 live days for `last_7_days` in every zone below;
 *  - on the CALENDAR legs (`last_week` / `last_month` / `last_quarter` /
 *    `last_year`) the local spelling reads the period off a UTC-midnight
 *    anchor's LOCAL fields, so in a zone AHEAD of UTC it too parts company only
 *    across a transition (Berlin `last_week`: 14/366; Auckland: 16/366), while
 *    in a zone BEHIND UTC it disagrees every day of the year (New York
 *    `last_month`: 366/366 — and by a whole MONTH, not an hour: at
 *    2026-11-01T12:00:00Z the window starts 2026-10-01T00:00:00.000Z one way
 *    and 2026-09-02T00:00:00.000Z the other).
 *
 * ⭐ This is a SEPARATE defect from the window boundary. Defect 1 —
 * `new Date(y, m, d)` building LOCAL midnight — is pinned in
 * `memory-analytics-date-range-utc-window.test.ts`. ⛔ Neither repair fixes the
 * other, and each was ablated on its own to prove it.
 *
 * ## ⭐ What #16322 changed underneath these cells
 *
 * The driver no longer does this arithmetic at all. `parseDateRangeString`
 * delegates to `@objectstack/core`'s `resolveAnalyticsDateRangeString`, which
 * lowers each preset to a pair of `{date-macro}` tokens and hands them to the
 * one macro resolver — anchored on `calendarPartsInTzOrUtc(now, query.timezone)`
 * and stepped with `setUTC*` throughout, so the PROCESS calendar is read on no
 * path. These cells are what makes that structural claim a measured one, and
 * what would go red if a future edit reached for a local accessor again.
 *
 * ⚠️ The cells were RE-MEASURED for this reinstatement, ⛔ not re-spelled: the
 * old table fed the relative dialect (`'last 3 days'`, `'last 1 month'`) that
 * #16041 closed at the schema, and `last_week` / `last_month` / `last_quarter`
 * / `last_year` are CALENDAR windows — the PREVIOUS week/month/quarter/year,
 * not n units back — so their instants answer a different question from the old
 * `last N units` ones. The retired harness is in history at 5f4f1f6e22 /
 * 1cf7392728; the cell table below is a fresh sweep (2026-09-09).
 */

import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';
import { AnalyticsQuerySchema } from '@objectstack/spec/data';
import type { AnalyticsQuery, Cube, DateRangePreset } from '@objectstack/spec/data';

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

// ⭐ Parsed by the CONTRACT, deliberately: every `range` below is a member of
// the closed vocabulary, so a cell that drifted out of it would be refused
// here rather than silently measuring a dialect no door accepts.
const asQuery = (input: AnalyticsQuery): AnalyticsQuery => AnalyticsQuerySchema.parse(input);

/** Ask `range` over rows planted at `instants`; answer which probes came back. */
async function probesSelected(instants: string[], range: DateRangePreset): Promise<string[]> {
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

/** Which arithmetic leg a preset exercises — the axis the table must cover. */
type Leg = 'rolling-day' | 'week' | 'month' | 'quarter' | 'year';

/** The window boundary, already repaired — defect 1 is not what this file measures. */
function utcAnchor(): Date {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

/** The ONE-CALENDAR spelling of a preset's window start: UTC fields throughout. */
function utcCalendarStart(preset: DateRangePreset): string {
    const s = utcAnchor();
    switch (preset) {
        case 'last_7_days':  s.setUTCDate(s.getUTCDate() - 7);  return s.toISOString();
        case 'last_30_days': s.setUTCDate(s.getUTCDate() - 30); return s.toISOString();
        case 'last_90_days': s.setUTCDate(s.getUTCDate() - 90); return s.toISOString();
        case 'last_week': {
            const dow = (s.getUTCDay() + 6) % 7; // 0 = Monday
            s.setUTCDate(s.getUTCDate() - dow - 7);
            return s.toISOString();
        }
        case 'last_month':
            return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - 1, 1)).toISOString();
        case 'last_quarter':
            return new Date(Date.UTC(s.getUTCFullYear(), Math.floor(s.getUTCMonth() / 3) * 3 - 3, 1)).toISOString();
        case 'last_year':
            return new Date(Date.UTC(s.getUTCFullYear() - 1, 0, 1)).toISOString();
        default:
            throw new Error(`no control spelling for ${preset}`);
    }
}

/** The DEFECT, spelled out: the same window start read off the PROCESS calendar. */
function localCalendarStart(preset: DateRangePreset): string {
    const s = utcAnchor();
    switch (preset) {
        case 'last_7_days':  s.setDate(s.getDate() - 7);  return s.toISOString();
        case 'last_30_days': s.setDate(s.getDate() - 30); return s.toISOString();
        case 'last_90_days': s.setDate(s.getDate() - 90); return s.toISOString();
        case 'last_week': {
            const dow = (s.getDay() + 6) % 7;
            s.setDate(s.getDate() - dow - 7);
            return s.toISOString();
        }
        case 'last_month': {
            const r = new Date(s);
            r.setDate(1);
            r.setMonth(r.getMonth() - 1);
            return r.toISOString();
        }
        case 'last_quarter': {
            const r = new Date(s);
            r.setDate(1);
            r.setMonth(Math.floor(r.getMonth() / 3) * 3 - 3);
            return r.toISOString();
        }
        case 'last_year': {
            const r = new Date(s);
            r.setDate(1);
            r.setMonth(0);
            r.setFullYear(r.getFullYear() - 1);
            return r.toISOString();
        }
        default:
            throw new Error(`no control spelling for ${preset}`);
    }
}

interface Cell {
    zone: string;
    /** Frozen clock, always written in UTC. */
    instant: string;
    range: DateRangePreset;
    leg: Leg;
    kind: 'spring-forward' | 'fall-back';
}

/**
 * Red cells — every one MEASURED, ⛔ not guessed: each is an instant at which
 * the process-calendar spelling actually disagrees with the one-calendar
 * answer in that zone, from a 9-zone x 366-day x 7-preset sweep of 2026
 * (2026-09-09). Both hemispheres, both transition directions, all five legs
 * the closed vocabulary has (the rolling day family plus the four calendar
 * periods), and two zones whose standard offset is not a whole hour
 * (St_Johns -03:30, Chatham +12:45) so a whole-hour assumption cannot hide in
 * the repair.
 *
 * ⚠️ The zone/direction coverage is the RETIRED table's, carried over
 * deliberately so nothing this file used to watch stopped being watched: the
 * spring-forward zones are New_York, Los_Angeles, St_Johns, London and Berlin
 * (week + year), the fall-back ones Sydney, Auckland, Chatham, Santiago, plus
 * New_York and London on the month leg.
 */
const DST_CELLS: Cell[] = [
    { zone: 'America/New_York',    instant: '2026-03-09T12:00:00Z', range: 'last_7_days',  leg: 'rolling-day', kind: 'spring-forward' },
    { zone: 'America/Los_Angeles', instant: '2026-03-09T12:00:00Z', range: 'last_30_days', leg: 'rolling-day', kind: 'spring-forward' },
    { zone: 'America/St_Johns',    instant: '2026-03-09T12:00:00Z', range: 'last_7_days',  leg: 'rolling-day', kind: 'spring-forward' },
    { zone: 'Europe/London',       instant: '2026-03-30T12:00:00Z', range: 'last_90_days', leg: 'rolling-day', kind: 'spring-forward' },
    { zone: 'America/New_York',    instant: '2026-03-09T12:00:00Z', range: 'last_week',    leg: 'week',        kind: 'spring-forward' },
    { zone: 'Europe/Berlin',       instant: '2026-03-30T12:00:00Z', range: 'last_week',    leg: 'week',        kind: 'spring-forward' },
    { zone: 'Australia/Sydney',    instant: '2026-04-05T12:00:00Z', range: 'last_7_days',  leg: 'rolling-day', kind: 'fall-back' },
    { zone: 'Pacific/Auckland',    instant: '2026-04-05T12:00:00Z', range: 'last_week',    leg: 'week',        kind: 'fall-back' },
    { zone: 'Pacific/Chatham',     instant: '2026-04-05T12:00:00Z', range: 'last_month',   leg: 'month',       kind: 'fall-back' },
    { zone: 'America/New_York',    instant: '2026-11-01T12:00:00Z', range: 'last_month',   leg: 'month',       kind: 'fall-back' },
    { zone: 'Europe/London',       instant: '2026-11-01T12:00:00Z', range: 'last_month',   leg: 'month',       kind: 'fall-back' },
    { zone: 'Pacific/Auckland',    instant: '2026-10-04T12:00:00Z', range: 'last_quarter', leg: 'quarter',     kind: 'spring-forward' },
    { zone: 'America/Santiago',    instant: '2026-04-06T12:00:00Z', range: 'last_year',    leg: 'year',        kind: 'fall-back' },
    { zone: 'Europe/Berlin',       instant: '2026-03-30T12:00:00Z', range: 'last_year',    leg: 'year',        kind: 'spring-forward' },
];

const label = (c: Cell) => `${c.zone} @ ${c.instant} '${c.range}'`;

/**
 * Probes that straddle BOTH candidate window starts, so the row set can tell
 * the two spellings apart, plus one comfortably inside the window either way.
 */
function probesFor(c: Cell): string[] {
    const truth = Date.parse(utcCalendarStart(c.range));
    const mixed = Date.parse(localCalendarStart(c.range));
    return [...new Set([
        new Date(truth).toISOString(),
        new Date(truth - 1).toISOString(),
        new Date(mixed).toISOString(),
        new Date(mixed - 1).toISOString(),
        new Date(truth + 43_200_000).toISOString(), // comfortably inside, both ways
    ])].sort();
}

describe('#15825 defect 2 — a preset window resolves on one calendar, across DST transitions', () => {
    for (const c of DST_CELLS) {
        it(`${c.kind}: ${label(c)}`, async () => {
            const { truth, mixed, probes } = await at(c.zone, c.instant, async () => ({
                truth: utcCalendarStart(c.range),
                mixed: localCalendarStart(c.range),
                probes: probesFor(c),
            }));

            // CONTROL FIRST — if these agree, the cell is not discriminating
            // and every assertion below would be vacuous. (It is the whole
            // reason a TZ=UTC-only test is worthless here.)
            expect(
                mixed,
                `${label(c)}: the process-calendar spelling must DISAGREE here, otherwise this cell pins nothing`,
            ).not.toBe(truth);

            const inZone = await at(c.zone, c.instant, () => probesSelected(probes, c.range));
            const atUtc = await at('UTC', c.instant, () => probesSelected(probes, c.range));

            // THE ORACLE: at TZ=UTC the two spellings coincide, so this run is
            // the reference answer. The process timezone must not move it.
            expect(inZone, `${label(c)}: the process timezone changed which rows were counted`).toEqual(atUtc);

            // And the answer must actually be non-trivial — a window that
            // selected everything or nothing would compare equal for free.
            // ⭐ This half is also what the pre-#16322 driver failed outright:
            // every preset but `today` fell to the `[range, range]` fallback
            // and selected EVERY row, so `toBeLessThan` was unreachable.
            expect(inZone.length, `${label(c)}: probes must straddle the boundary`).toBeGreaterThan(0);
            expect(inZone.length, `${label(c)}: probes must straddle the boundary`).toBeLessThan(probes.length);
        });
    }

    it('the rolling day legs match the offset-free definition — n x 24h before the UTC day', async () => {
        const days: Partial<Record<DateRangePreset, number>> = {
            last_7_days: 7, last_30_days: 30, last_90_days: 90,
        };
        for (const c of DST_CELLS.filter((x) => x.leg === 'rolling-day')) {
            await at(c.zone, c.instant, async () => {
                const n = days[c.range]!;
                expect(utcCalendarStart(c.range), label(c))
                    .toBe(new Date(utcAnchor().getTime() - n * 86_400_000).toISOString());
            });
        }
    });

    it('every red cell is live — the process-calendar spelling disagrees in all of them', async () => {
        const live: string[] = [];
        for (const c of DST_CELLS) {
            await at(c.zone, c.instant, async () => {
                if (localCalendarStart(c.range) !== utcCalendarStart(c.range)) live.push(label(c));
            });
        }
        expect(live.length, 'a cell that no longer flips has stopped guarding the fix').toBe(DST_CELLS.length);
    });

    it('both directions are represented — a window start too EARLY and one too LATE', async () => {
        const dirs = new Set<string>();
        for (const c of DST_CELLS) {
            await at(c.zone, c.instant, async () => {
                dirs.add(localCalendarStart(c.range) < utcCalendarStart(c.range) ? 'early' : 'late');
            });
        }
        expect([...dirs].sort()).toEqual(['early', 'late']);
    });

    it('all five legs of the closed vocabulary are covered — rolling days, week, month, quarter, year', () => {
        expect([...new Set(DST_CELLS.map((c) => c.leg))].sort())
            .toEqual(['month', 'quarter', 'rolling-day', 'week', 'year']);
    });

    it('all three rolling presets are exercised, not just one of them', () => {
        const rolling = DST_CELLS.filter((c) => c.leg === 'rolling-day').map((c) => c.range);
        expect([...new Set(rolling)].sort()).toEqual(['last_30_days', 'last_7_days', 'last_90_days']);
    });
});

// ── Fences: what this change must NOT have moved ──────────────────────────

describe('#15825 defect 2 fences', () => {
    it('⛔ at TZ=UTC the two spellings are INDISTINGUISHABLE — a UTC-only test proves nothing', async () => {
        for (const c of DST_CELLS) {
            await at('UTC', c.instant, async () => {
                expect(localCalendarStart(c.range), label(c)).toBe(utcCalendarStart(c.range));
            });
        }
    });

    it('zones that do not observe DST are unaffected — both spellings already agreed on the day legs there', async () => {
        for (const zone of ['UTC', 'Asia/Shanghai', 'Asia/Kolkata', 'Australia/Perth']) {
            for (const instant of ['2026-03-09T12:00:00Z', '2026-11-02T12:00:00Z', '2026-06-15T12:00:00Z']) {
                await at(zone, instant, async () => {
                    expect(localCalendarStart('last_7_days'), `${zone} @ ${instant}`)
                        .toBe(utcCalendarStart('last_7_days'));
                });
            }
        }
    });

    it('an ordinary instant in a DST zone is unaffected on the day legs — the local day is 24h there', async () => {
        for (const zone of [...new Set(DST_CELLS.map((c) => c.zone))]) {
            await at(zone, '2026-06-15T12:00:00Z', async () => {
                expect(localCalendarStart('last_7_days'), zone).toBe(utcCalendarStart('last_7_days'));
            });
        }
    });

    it('the process timezone is restored after every case', () => {
        expect(process.env.TZ).toBe(REAL_TZ);
    });
});
