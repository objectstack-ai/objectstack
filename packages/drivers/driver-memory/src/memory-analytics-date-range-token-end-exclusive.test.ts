// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16179 — `dateRange: 'today'` counted the first instant of TOMORROW.
 *
 * ## The defect, in one sentence
 *
 * `parseDateRangeString('today')` returns the day's start instant and the NEXT
 * day's start instant; the call site compared that upper bound with `$lte`
 * (`nextUtcCalendarDay` widens only a bare `YYYY-MM-DD` and returns `null` for
 * an instant, so the half-open branch was never taken). `'today'` was therefore
 * one day PLUS ONE INSTANT long, two adjacent day windows overlapped at
 * midnight, and a row stamped exactly there was counted in BOTH — silently, no
 * error, no warning.
 *
 * ## ⭐ The control is the point of this file
 *
 * The card offered two routes and the second was taken: fix what the RELATIVE
 * TOKENS emit, and ⛔ leave an explicit `dateRange: [a, b]` alone — `$lte` on a
 * caller-written timestamp end is a PUBLISHED reading (`@objectstack/driver-memory`
 * is a released package) and narrowing it is a decision nobody made. So every
 * case below asks the SAME rows through BOTH arms of `AnalyticsDateRangeSchema`
 * and asserts the difference between the two answers is EXACTLY the boundary
 * instant — the token dropped it, the explicit array still keeps it. A repair
 * that drifted into route 1 goes red here, on the explicit-array leg, not on
 * the token leg.
 *
 * ## Why the assertions are about ROWS, and why both storage forms
 *
 * The window is internal; what a caller sees is which rows the answer counted,
 * so every case drives the real public entry `MemoryAnalyticsService.query()`
 * through `AnalyticsQuerySchema.parse`. And the call site builds TWO bounds
 * joined by `$or` — one for `Date`-valued rows, one for ISO-string rows, the
 * two forms an in-memory table really holds — so each case runs on both. A
 * repair applied to one leg only passes half of this file.
 *
 * ## What this file deliberately does NOT pin
 *
 * - The `last N …` leg and the unresolved-preset fallback. The declared
 *   vocabulary spells its presets `last_7_days` while the parser matches
 *   `startsWith('last ')`, so every preset but `'today'` currently takes the
 *   `[range, range]` fallback — that mismatch is #16322 and the fallback's
 *   match-everything behaviour is #16041. ⛔ Neither is pinned here; pinning
 *   either would freeze a defect as a contract.
 * - Which calendar the window is anchored to (#16042) and where a day BEGINS
 *   (#15825). Both are pinned by their own files. This file's cells carry a
 *   non-UTC zone only to prove the repair also holds where the upper bound is a
 *   ZONE's midnight instant rather than UTC's.
 */

import { describe, it, expect, vi } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';
import { AnalyticsQuerySchema } from '@objectstack/spec/data';
import type { AnalyticsDateRange, AnalyticsQuery, Cube } from '@objectstack/spec/data';

const REAL_TZ = process.env.TZ;

/** Run `fn` with the PROCESS on `zone` and the clock frozen at `instant`. */
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

const asQuery = (input: AnalyticsQuery): AnalyticsQuery => AnalyticsQuerySchema.parse(input);

/**
 * The two shapes an in-memory table really holds for a datetime — the `Date`
 * a direct JS caller writes and the ISO string the driver's own `created_at`
 * default and every REST/JSON write produce. The call site builds one bound
 * for each and `$or`s them, so every case runs on both.
 */
const STORAGE = ['Date', 'ISO string'] as const;
type Storage = (typeof STORAGE)[number];

/** Ask `range` over rows planted at `instants`; answer which probes came back. */
async function probesSelected(
    instants: string[],
    opts: { range: AnalyticsDateRange; timezone?: string; storage: Storage },
): Promise<string[]> {
    const driver = new InMemoryDriver({
        initialData: {
            events: instants.map((iso, i) => ({
                id: i + 1,
                probe: iso,
                created_at: opts.storage === 'Date' ? new Date(iso) : iso,
            })),
        },
    });
    await driver.connect();
    const service = new MemoryAnalyticsService({ driver, cubes: [CUBE] });
    const query: AnalyticsQuery = {
        cube: 'events',
        measures: ['events.count'],
        dimensions: ['events.probe'],
        timeDimensions: [{ dimension: 'events.createdAt', dateRange: opts.range }],
    };
    if (opts.timezone !== undefined) query.timezone = opts.timezone;
    const result = await service.query(asQuery(query));
    return result.rows.map((row) => String(row['events.probe'])).sort();
}

const ms = (iso: string) => Date.parse(iso);
const iso = (t: number) => new Date(t).toISOString();

/**
 * What `zone`'s local clock reads at `instant`, from the platform tz database
 * ALONE — ⛔ never from the primitives the repair uses. This is what makes the
 * window literals below data rather than a second implementation: each one is
 * asserted to be a local midnight by this function.
 */
function localClock(instant: string, zone: string): string {
    // ⛔ No `fractionalSecondDigits`: it is not in this package's `lib` view of
    // `Intl.DateTimeFormatOptions`. The sub-second half is checked directly on
    // the literal instead — see the fence below.
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(new Date(instant));
}

interface Cell {
    zone: string;
    /** Frozen clock, always written in UTC. */
    instant: string;
    /** `'today'` on `zone`'s calendar — the half-open `[start, end)` it MUST be. */
    window: [string, string];
}

/**
 * UTC (where the bound is UTC midnight), a zone AHEAD of UTC whose day boundary
 * is a plain non-UTC instant, one BEHIND, and one whose offset is not a whole
 * number of hours — so a repair that quietly re-derived the bound as a UTC day
 * cannot pass. Every `window` literal is checked against `Intl` below.
 */
const CELLS: Cell[] = [
    { zone: 'UTC',            instant: '2026-09-06T12:00:00Z', window: ['2026-09-06T00:00:00.000Z', '2026-09-07T00:00:00.000Z'] },
    { zone: 'Asia/Shanghai',  instant: '2026-09-06T20:00:00Z', window: ['2026-09-06T16:00:00.000Z', '2026-09-07T16:00:00.000Z'] },
    { zone: 'America/Denver', instant: '2026-09-06T12:00:00Z', window: ['2026-09-06T06:00:00.000Z', '2026-09-07T06:00:00.000Z'] },
    { zone: 'Asia/Kolkata',   instant: '2026-09-06T12:00:00Z', window: ['2026-09-05T18:30:00.000Z', '2026-09-06T18:30:00.000Z'] },
];

const label = (c: Cell) => `${c.zone} @ ${c.instant}`;

/**
 * Probes around the window's UPPER bound, which is the only place this card
 * lives: the last instant inside, the boundary instant itself, the first
 * instant after — plus an unambiguous midday anchor and the window's own start,
 * so a repair that broke the LOWER bound cannot pass either.
 */
function probesFor(c: Cell): string[] {
    const [start, end] = c.window.map(ms);
    return [...new Set([
        start,
        start + Math.floor((end - start) / 2),
        end - 1,
        end,            // ⭐ THE instant this card is about
        end + 1,
    ])].map(iso);
}

/** The rows a half-open `[start, end)` window contains. */
const halfOpen = (probes: string[], w: [string, string]) =>
    probes.filter((p) => ms(p) >= ms(w[0]) && ms(p) < ms(w[1])).sort();

/** The rows a closed `[start, end]` window contains — today's explicit-array reading. */
const closed = (probes: string[], w: [string, string]) =>
    probes.filter((p) => ms(p) >= ms(w[0]) && ms(p) <= ms(w[1])).sort();

describe("#16179 — 'today' stops BEFORE tomorrow's first instant", () => {
    for (const c of CELLS) {
        for (const storage of STORAGE) {
            it(`${label(c)} · ${storage}: the row at the next day's 00:00:00.000 is NOT counted`, async () => {
                const probes = probesFor(c);
                const boundary = c.window[1];

                // CONTROL FIRST — a probe set that never touches the boundary
                // would pass while asserting nothing about this card.
                expect(probes, `${label(c)}: the boundary instant must be planted`).toContain(boundary);

                const expected = halfOpen(probes, c.window);
                expect(expected, 'the boundary instant must be OUTSIDE the expected set').not.toContain(boundary);

                await at(c.zone, c.instant, async () => {
                    await expect(
                        probesSelected(probes, { range: 'today', timezone: c.zone, storage }),
                    ).resolves.toEqual(expected);
                });
            });

            it(`${label(c)} · ${storage}: ⭐ an explicit [a, b] over the SAME window still counts b`, async () => {
                const probes = probesFor(c);
                const explicit: AnalyticsDateRange = [c.window[0], c.window[1]];

                // The published reading, unchanged: a caller-written timestamp
                // end is INCLUSIVE. ⛔ This is route 1's tripwire — a repair
                // that made `$lt` unconditional reddens HERE.
                const expected = closed(probes, c.window);
                expect(expected, 'the control must include the boundary instant').toContain(c.window[1]);

                await at(c.zone, c.instant, async () => {
                    await expect(
                        probesSelected(probes, { range: explicit, timezone: c.zone, storage }),
                    ).resolves.toEqual(expected);
                });
            });

            it(`${label(c)} · ${storage}: the two arms differ by EXACTLY the boundary instant`, async () => {
                const probes = probesFor(c);
                const explicit: AnalyticsDateRange = [c.window[0], c.window[1]];

                await at(c.zone, c.instant, async () => {
                    const token = await probesSelected(probes, { range: 'today', timezone: c.zone, storage });
                    const array = await probesSelected(probes, { range: explicit, timezone: c.zone, storage });

                    // Stated as data: the repair removed one instant from the
                    // token's answer and nothing at all from the array's.
                    expect(array.filter((p) => !token.includes(p))).toEqual([c.window[1]]);
                    expect(token.filter((p) => !array.includes(p))).toEqual([]);
                });
            });
        }
    }

    it('every window literal is a local midnight in its own zone — checked against `Intl`, not against the code under test', () => {
        for (const c of CELLS) {
            for (const bound of c.window) {
                // The clock half, from the tz database.
                expect(
                    localClock(bound, c.zone),
                    `${label(c)}: ${bound} is not midnight in ${c.zone}`,
                ).toMatch(/ 00:00:00$/);
                // The sub-second half, read off the literal itself.
                expect(bound, `${label(c)}: ${bound} carries a sub-second part`).toMatch(/\.000Z$/);
            }
        }
    });

    it('every window is exactly one calendar day apart and the cells are not all UTC', () => {
        for (const c of CELLS) {
            const [start, end] = c.window.map(ms);
            expect(end - start, `${label(c)}: window is not 24h`).toBe(86_400_000);
        }
        const nonUtcBoundaries = CELLS.filter((c) => !c.window[1].endsWith('T00:00:00.000Z'));
        expect(
            nonUtcBoundaries.length,
            'every cell ends at UTC midnight, so a repair that re-derived the bound as a UTC day would pass',
        ).toBeGreaterThan(0);
    });
});

describe('#16179 — two adjacent day windows PARTITION the midnight instant', () => {
    // The double-count, driven end to end: the same row, the same table, asked
    // on two consecutive days. Before the repair it answered `2` — counted by
    // the day it ends and by the day it begins.
    const ZONE = 'Asia/Shanghai';
    const MIDNIGHT = '2026-09-06T16:00:00.000Z'; // where 2026-09-07 begins in Shanghai

    for (const storage of STORAGE) {
        it(`${storage}: the row at midnight is counted by exactly one of the two days`, async () => {
            const probes = [MIDNIGHT];
            let hits = 0;

            // The day that ENDS at MIDNIGHT.
            await at(ZONE, '2026-09-06T12:00:00Z', async () => {
                const got = await probesSelected(probes, { range: 'today', timezone: ZONE, storage });
                hits += got.length;
            });
            // The day that BEGINS at MIDNIGHT.
            await at(ZONE, '2026-09-07T02:00:00Z', async () => {
                const got = await probesSelected(probes, { range: 'today', timezone: ZONE, storage });
                hits += got.length;
            });

            expect(hits, 'a row must belong to exactly one day — 2 is the double-count this card is about').toBe(1);
        });
    }
});

describe('#16179 — a bare `YYYY-MM-DD` end still means the WHOLE day (#4042 / #3777)', () => {
    // The other exclusive-end route, which this card must not disturb: a bare
    // day the CALLER wrote is still widened to `< nextUtcCalendarDay(day)`.
    for (const storage of STORAGE) {
        it(`${storage}: ['2026-09-06', '2026-09-06'] selects all of 2026-09-06 and nothing of the 7th`, async () => {
            const probes = [
                '2026-09-05T23:59:59.999Z',
                '2026-09-06T00:00:00.000Z',
                '2026-09-06T12:00:00.000Z',
                '2026-09-06T23:59:59.999Z',
                '2026-09-07T00:00:00.000Z',
            ];
            await expect(
                probesSelected(probes, { range: ['2026-09-06', '2026-09-06'], storage }),
            ).resolves.toEqual([
                '2026-09-06T00:00:00.000Z',
                '2026-09-06T12:00:00.000Z',
                '2026-09-06T23:59:59.999Z',
            ]);
        });
    }
});
