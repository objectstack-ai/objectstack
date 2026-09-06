// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16042 — `parseDateRangeString()` accepted `AnalyticsQuery.timezone` and
 * never read it, so `dateRange: 'today'` answered on the UTC calendar for a
 * caller who had said which calendar they meant.
 *
 * ## What this file pins
 *
 * ⭐ The one claim the card is about: **a supplied non-UTC `timezone` changes
 * which rows `'today'` selects** — both halves of that, because they fail
 * independently and each failure is silent:
 *
 *   1. WHICH calendar day the window is anchored to. `Asia/Shanghai` is
 *      already on 2026-09-07 while UTC is still on 2026-09-06.
 *   2. WHERE that day BEGINS as an instant. `Asia/Kolkata` is on the SAME
 *      calendar day as UTC at its cell's instant, and its window still starts
 *      5h30 earlier — so that cell goes red against a repair that resolves the
 *      day in the zone and then cuts it at UTC midnight, which is the shape a
 *      `proxyDay()`-only reading of the card produces.
 *
 * ## Why the assertions are about ROWS, and what the "before" is
 *
 * The window is internal; what a caller sees is which rows the answer counted.
 * So every cell drives the real public entry, `MemoryAnalyticsService.query()`,
 * and asserts the row set — and it asserts the **before** in the same test:
 * the identical query with no `timezone` must still return the UTC row set
 * (#15825's case, which this must not disturb), and the two row sets must
 * DIFFER. That difference is the defect, stated as data.
 *
 * ## The inline controls are load-bearing
 *
 * A cell whose zone offset happened to be 0 at its instant would assert
 * nothing while passing, so each cell first asserts its two windows disagree,
 * and the fences at the bottom assert that every cell is live, that both
 * directions are represented (a zone a day AHEAD of UTC and one a day BEHIND),
 * that at least one cell shares UTC's calendar day (half 2 alone), and that at
 * least one window is 23 hours long (the spring-forward day, which is why the
 * end bound is a calendar step and never `+ 86_400_000`).
 *
 * ⚠️ Every window literal below was computed independently of the code under
 * test, from `Intl.DateTimeFormat` alone, by scanning for the instant at which
 * the zone's local clock reads `00:00` — never from `@objectstack/core`'s
 * primitives, which are what the repair uses. They are data, not a second
 * implementation.
 *
 * ⛔ No probe is placed exactly ON a window's end instant, and a guard below
 * asserts that. The call site's upper bound is INCLUSIVE for a full-timestamp
 * end (`nextUtcCalendarDay` widens only a bare `YYYY-MM-DD`, so it returns
 * `null` here and the bound falls back to `$lte`), which is a separate,
 * pre-existing question this card does not touch.
 */

import { describe, it, expect, vi } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';
import { AnalyticsQuerySchema } from '@objectstack/spec/data';
import type { AnalyticsQuery, Cube } from '@objectstack/spec/data';

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

/** Ask `range` over rows planted at `instants`; answer which probes came back. */
async function probesSelected(
    instants: string[],
    opts: { range?: string; timezone?: string } = {},
): Promise<string[]> {
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
    const query: AnalyticsQuery = {
        cube: 'events',
        measures: ['events.count'],
        dimensions: ['events.probe'],
        timeDimensions: [{ dimension: 'events.createdAt', dateRange: opts.range ?? 'today' }],
    };
    if (opts.timezone !== undefined) query.timezone = opts.timezone;
    const result = await service.query(asQuery(query));
    return result.rows.map((row) => String(row['events.probe'])).sort();
}

interface Cell {
    zone: string;
    /** Frozen clock, always written in UTC. */
    instant: string;
    /** That zone's local calendar day and clock at `instant`, for readability. */
    local: string;
    /** `'today'` on the UTC calendar — half-open `[start, end)`. */
    utcWindow: [string, string];
    /** `'today'` on `zone`'s calendar — half-open `[start, end)`. */
    tzWindow: [string, string];
}

/**
 * ⭐ Both signs of offset, two zones whose offset is not a whole number of
 * hours (Kolkata +05:30, Chatham +12:45), the two extremes of the tz database
 * (Kiritimati +14:00, Niue −11:00), a cell that shares UTC's calendar day
 * (Kolkata), and one spring-forward day whose window is 23 hours long
 * (New York, 2026-03-08).
 */
const CELLS: Cell[] = [
    {
        zone: 'Asia/Shanghai', instant: '2026-09-06T20:00:00Z', local: '2026-09-07 04:00',
        utcWindow: ['2026-09-06T00:00:00.000Z', '2026-09-07T00:00:00.000Z'],
        tzWindow: ['2026-09-06T16:00:00.000Z', '2026-09-07T16:00:00.000Z'],
    },
    {
        zone: 'America/Los_Angeles', instant: '2026-09-06T04:00:00Z', local: '2026-09-05 21:00',
        utcWindow: ['2026-09-06T00:00:00.000Z', '2026-09-07T00:00:00.000Z'],
        tzWindow: ['2026-09-05T07:00:00.000Z', '2026-09-06T07:00:00.000Z'],
    },
    {
        zone: 'Asia/Kolkata', instant: '2026-09-06T12:00:00Z', local: '2026-09-06 17:30',
        utcWindow: ['2026-09-06T00:00:00.000Z', '2026-09-07T00:00:00.000Z'],
        tzWindow: ['2026-09-05T18:30:00.000Z', '2026-09-06T18:30:00.000Z'],
    },
    {
        zone: 'America/New_York', instant: '2026-03-08T12:00:00Z', local: '2026-03-08 08:00',
        utcWindow: ['2026-03-08T00:00:00.000Z', '2026-03-09T00:00:00.000Z'],
        tzWindow: ['2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'],
    },
    {
        zone: 'Pacific/Kiritimati', instant: '2026-09-06T12:00:00Z', local: '2026-09-07 02:00',
        utcWindow: ['2026-09-06T00:00:00.000Z', '2026-09-07T00:00:00.000Z'],
        tzWindow: ['2026-09-06T10:00:00.000Z', '2026-09-07T10:00:00.000Z'],
    },
    {
        zone: 'Pacific/Niue', instant: '2026-09-06T05:00:00Z', local: '2026-09-05 18:00',
        utcWindow: ['2026-09-06T00:00:00.000Z', '2026-09-07T00:00:00.000Z'],
        tzWindow: ['2026-09-05T11:00:00.000Z', '2026-09-06T11:00:00.000Z'],
    },
    {
        zone: 'Pacific/Chatham', instant: '2026-06-15T12:00:00Z', local: '2026-06-16 00:45',
        utcWindow: ['2026-06-15T00:00:00.000Z', '2026-06-16T00:00:00.000Z'],
        tzWindow: ['2026-06-15T11:15:00.000Z', '2026-06-16T11:15:00.000Z'],
    },
];

const label = (c: Cell) => `${c.zone} @ ${c.instant} (local ${c.local})`;
const ms = (iso: string) => Date.parse(iso);
const iso = (t: number) => new Date(t).toISOString();
const inWindow = (t: number, w: [string, string]) => t >= ms(w[0]) && t < ms(w[1]);

/**
 * Probes that discriminate the two windows in BOTH directions — rows the zone
 * day contains and the UTC day does not, and the reverse. The `+ 30min` probe
 * sits just past the zone day's end: it is outside the correct window in every
 * cell, and inside a window whose end was computed as `start + 86_400_000` on
 * the 23-hour spring-forward day.
 */
function probesFor(c: Cell): string[] {
    const [tzStart, tzEnd] = c.tzWindow.map(ms);
    const [utcStart, utcEnd] = c.utcWindow.map(ms);
    const raw = [
        tzStart,
        tzStart - 1,
        tzStart + Math.floor((tzEnd - tzStart) / 2),
        tzEnd - 1,
        tzEnd + 30 * 60_000,
        utcStart,
        utcStart - 1,
        utcEnd - 1,
    ];
    return [...new Set(raw)].map(iso);
}

describe("#16042 — a supplied `timezone` decides which calendar day 'today' is", () => {
    for (const c of CELLS) {
        it(`${label(c)}: 'today' is answered on the zone's calendar, not UTC's`, async () => {
            const probes = probesFor(c);

            // CONTROL FIRST — a cell whose two windows coincide would pass
            // while asserting nothing.
            expect(
                c.tzWindow[0],
                `${label(c)}: the zone window must differ from the UTC window, otherwise this cell pins nothing`,
            ).not.toBe(c.utcWindow[0]);

            // ⛔ Guard: no probe may sit exactly on a window END. The call
            // site's upper bound is inclusive for a full-timestamp end, which
            // is a separate question — a probe there would pin THAT instead.
            for (const p of probes) {
                expect(p, `${label(c)}: probe sits on a window end`).not.toBe(c.tzWindow[1]);
                expect(p, `${label(c)}: probe sits on a window end`).not.toBe(c.utcWindow[1]);
            }

            const expectedTz = probes.filter((p) => inWindow(ms(p), c.tzWindow)).sort();
            const expectedUtc = probes.filter((p) => inWindow(ms(p), c.utcWindow)).sort();

            // The defect, stated as data: the two answers are different rows.
            expect(
                expectedTz,
                `${label(c)}: the zone's row set must differ from UTC's, otherwise this cell pins nothing`,
            ).not.toEqual(expectedUtc);

            await at(c.zone, c.instant, async () => {
                // AFTER — the zone is honoured.
                await expect(probesSelected(probes, { timezone: c.zone })).resolves.toEqual(expectedTz);
                // BEFORE — the same query with no timezone still answers on
                // UTC, the chain's terminal fallback (#15825's case).
                await expect(probesSelected(probes)).resolves.toEqual(expectedUtc);
                // …and the terminal fallback spelled out explicitly.
                await expect(probesSelected(probes, { timezone: 'UTC' })).resolves.toEqual(expectedUtc);
            });
        });
    }

    it('every cell is live — its zone window differs from the UTC window', () => {
        const dead = CELLS.filter((c) => c.tzWindow[0] === c.utcWindow[0]).map(label);
        expect(dead, 'a cell that no longer shifts has stopped guarding the fix').toEqual([]);
    });

    it('both directions are represented — a zone a day AHEAD of UTC and one BEHIND', () => {
        const dirs = new Set(
            CELLS.map((c) => {
                const tzDay = c.local.slice(0, 10);
                const utcDay = c.instant.slice(0, 10);
                return tzDay === utcDay ? 'same' : tzDay > utcDay ? 'ahead' : 'behind';
            }),
        );
        expect([...dirs].sort()).toEqual(['ahead', 'behind', 'same']);
    });

    it("at least one cell shares UTC's calendar day — half 2 (the day's START) alone", () => {
        // This is the cell a `proxyDay()`-only repair fails: same calendar day,
        // different starting instant.
        const sameDay = CELLS.filter((c) => c.local.slice(0, 10) === c.instant.slice(0, 10));
        expect(sameDay.map(label).length).toBeGreaterThan(0);
        for (const c of sameDay) expect(c.tzWindow[0]).not.toBe(c.utcWindow[0]);
    });

    it('at least one window is 23 hours long — the spring-forward day', () => {
        const spans = CELLS.map((c) => (ms(c.tzWindow[1]) - ms(c.tzWindow[0])) / 3_600_000);
        expect(spans, 'no cell exercises a DST-shortened day, so `+ 86_400_000` would pass').toContain(23);
    });
});

describe('#16042 — the resolution is host-independent and degrades to UTC', () => {
    const c = CELLS[0]; // Asia/Shanghai

    it('the answer does not depend on the PROCESS timezone', async () => {
        const probes = probesFor(c);
        const expectedTz = probes.filter((p) => inWindow(ms(p), c.tzWindow)).sort();
        for (const hostZone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Chatham']) {
            await at(hostZone, c.instant, async () => {
                await expect(
                    probesSelected(probes, { timezone: c.zone }),
                    `host TZ=${hostZone} changed the answer`,
                ).resolves.toEqual(expectedTz);
            });
        }
    });

    it('an unknown zone degrades to UTC rather than throwing', async () => {
        const probes = probesFor(c);
        const expectedUtc = probes.filter((p) => inWindow(ms(p), c.utcWindow)).sort();
        await at('Asia/Tokyo', c.instant, async () => {
            await expect(probesSelected(probes, { timezone: 'Mars/Olympus' })).resolves.toEqual(expectedUtc);
        });
    });
});

describe("#16042 — `last N …` anchors on the zone's calendar too", () => {
    const c = CELLS[0]; // Asia/Shanghai: local day 2026-09-07, UTC day 2026-09-06

    it("'last 7 days' starts 7 days before the ZONE's day, at the zone's midnight", async () => {
        // 7 days before Shanghai's 2026-09-07 is 2026-08-31; that day begins at
        // 2026-08-30T16:00:00.000Z. Computed independently: Shanghai is +08:00
        // year-round, so its midnight is the previous day's 16:00Z.
        const tzStart = '2026-08-30T16:00:00.000Z';
        const utcStart = '2026-08-30T00:00:00.000Z'; // 7 days before UTC's 2026-09-06
        expect(tzStart).not.toBe(utcStart);

        // The upper bound of a `last N` window is the current INSTANT, so a
        // probe must sit before it; both probes do.
        const probes = [utcStart, tzStart, iso(ms(tzStart) - 1)];

        await at('Asia/Tokyo', c.instant, async () => {
            // AFTER — the window opens at Shanghai's midnight, so the probe one
            // millisecond earlier is OUT.
            await expect(probesSelected(probes, { range: 'last 7 days', timezone: c.zone })).resolves.toEqual(
                [tzStart].sort(),
            );
            // BEFORE — with no timezone the window opens 16 hours earlier, at
            // UTC midnight, and takes all three probes. That extra row IS the
            // defect, in the `last N` leg.
            await expect(probesSelected(probes, { range: 'last 7 days' })).resolves.toEqual(
                [...probes].sort(),
            );
        });
    });
});
