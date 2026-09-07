// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15825 — DEFECT 1 of 2: `parseDateRangeString()` built its window BOUNDARY
 * on the LOCAL calendar and rendered it as UTC.
 *
 * ## What this file pins, and what it deliberately does not
 *
 * `new Date(y, m, d)` constructs LOCAL midnight; `toISOString()` renders that
 * instant in UTC. So in any process not sitting at UTC the `'today'` bucket
 * was the LOCAL day expressed as a UTC range, shifted by the zone's offset.
 * This is wrong on EVERY day of the year — ⛔ not only across a DST
 * transition — which is why every cell below is an ORDINARY instant with no
 * transition anywhere near it. That is the whole reason defect 1 is the
 * cheaper of the two to pin, and why it is pinned first.
 *
 * Defect 2 (the `last N ...` legs doing LOCAL day/month/year arithmetic) is a
 * separate spelling in a separate branch and is pinned in a separate file,
 * `memory-analytics-date-range-dst.test.ts`. ⛔ Fixing either one does not fix
 * the other: this file goes red against `Date.UTC` reverted even when every
 * `setUTCDate` is in place, and its sibling goes red against `setDate`
 * restored even when the boundary is `Date.UTC`. Each was ablated separately.
 *
 * ## Why the assertions are about ROWS
 *
 * The window is internal; what a user sees is which rows an analytics answer
 * counted. The defect earns its priority from a platform DISAGREEMENT — the
 * rest of the platform resolves a bare date to the UTC day (`@objectstack/core`'s
 * `{today}` macro, `{TODAY()}` in flow templates) — so the same question asked
 * through this path and through a flow token selected different rows in one
 * deployment. These cases therefore drive the real public entry,
 * `MemoryAnalyticsService.query()`, and assert on the row set it returns.
 *
 * ## The inline control is load-bearing
 *
 * Each cell also evaluates the OLD spelling directly and asserts it DISAGREES
 * with the UTC day. Without it a green run would be ambiguous between "the fix
 * works" and "this zone's offset happens to be zero at this instant" — and the
 * fences at the bottom show that second state is real: at `TZ=UTC` the two
 * spellings are IDENTICAL, which is exactly why nothing in CI ever reddened.
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

/** The defect, spelled out: LOCAL midnight, rendered on the UTC calendar. */
function localMidnightSpelling(): string {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate()).toISOString();
}

/**
 * The truth, computed from NEITHER spelling: the start of the UTC day the
 * frozen instant falls in. `'today'` means "the UTC day it is now", and the
 * instant is written in UTC, so this is a slice — not a second implementation.
 */
function utcDayStart(instant: string): string {
    return `${instant.slice(0, 10)}T00:00:00.000Z`;
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
async function probesSelected(instants: string[], range = 'today'): Promise<string[]> {
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
    return result.rows
        .map((row) => String(row['events.probe']))
        .sort();
}

interface Cell {
    zone: string;
    /** Frozen clock, always written in UTC. */
    instant: string;
    /** The zone's UTC offset at that instant, for readability only. */
    offset: string;
}

/**
 * Ordinary instants — ⛔ no DST transition is involved in any of them, which
 * is the point. Both signs of offset, and three zones whose offset is not a
 * whole number of hours (Kolkata +05:30, Chatham +12:45, Kathmandu +05:45) so
 * a whole-hour assumption cannot hide in the repair.
 */
const CELLS: Cell[] = [
    { zone: 'Asia/Shanghai',       instant: '2026-09-05T12:00:00Z', offset: '+08:00' },
    { zone: 'Asia/Tokyo',          instant: '2026-09-05T20:30:00Z', offset: '+09:00' },
    { zone: 'America/Los_Angeles', instant: '2026-09-05T12:00:00Z', offset: '-07:00' },
    { zone: 'America/Los_Angeles', instant: '2026-01-15T12:00:00Z', offset: '-08:00' },
    { zone: 'America/New_York',    instant: '2026-06-15T02:00:00Z', offset: '-04:00' },
    { zone: 'Europe/Berlin',       instant: '2026-09-05T21:30:00Z', offset: '+02:00' },
    { zone: 'Asia/Kolkata',        instant: '2026-09-05T19:00:00Z', offset: '+05:30' },
    { zone: 'Pacific/Chatham',     instant: '2026-06-15T12:00:00Z', offset: '+12:45' },
    { zone: 'Asia/Kathmandu',      instant: '2026-09-05T19:00:00Z', offset: '+05:45' },
    { zone: 'Pacific/Kiritimati',  instant: '2026-09-05T09:00:00Z', offset: '+14:00' },
    { zone: 'Pacific/Niue',        instant: '2026-09-05T12:00:00Z', offset: '-11:00' },
];

const label = (c: Cell) => `${c.zone} (${c.offset}) @ ${c.instant}`;

const MS_DAY = 86_400_000;

describe("#15825 defect 1 — the 'today' window boundary is the UTC day, in every zone", () => {
    for (const c of CELLS) {
        it(`${label(c)}: 'today' selects the UTC day, not the local one`, async () => {
            await at(c.zone, c.instant, async () => {
                const truth = utcDayStart(c.instant);
                const buggy = localMidnightSpelling();

                // CONTROL FIRST — if these agree, this zone has no offset at
                // this instant and every assertion below would be vacuous.
                expect(
                    buggy,
                    `${label(c)}: the local-midnight spelling must DISAGREE with the UTC day, otherwise this cell pins nothing`,
                ).not.toBe(truth);

                const truthMs = Date.parse(truth);
                const buggyMs = Date.parse(buggy);

                // Probes chosen so that BOTH directions of the shift are
                // caught: the row exactly on the UTC boundary (dropped when
                // the window starts late) and the row on the local boundary
                // (wrongly counted when the window starts early). All sit far
                // from the window's upper bound, so nothing here depends on
                // whether that bound is open or closed.
                const probes = [
                    new Date(truthMs).toISOString(),               // in  — first instant of the UTC day
                    new Date(truthMs - 1).toISOString(),           // out — last instant of the previous UTC day
                    new Date(truthMs + MS_DAY / 2).toISOString(),  // in  — midday, unambiguous anchor
                    new Date(buggyMs).toISOString(),               // the local boundary
                    new Date(buggyMs - 1).toISOString(),
                ];

                const expected = probes
                    .filter((iso) => {
                        const t = Date.parse(iso);
                        return t >= truthMs && t < truthMs + MS_DAY;
                    })
                    .sort();

                await expect(probesSelected(probes)).resolves.toEqual(expected);
            });
        });
    }

    it('every cell is live — the local-midnight spelling disagrees in all of them', async () => {
        const live: string[] = [];
        for (const c of CELLS) {
            await at(c.zone, c.instant, async () => {
                if (localMidnightSpelling() !== utcDayStart(c.instant)) live.push(label(c));
            });
        }
        expect(live.length, 'a cell that no longer shifts has stopped guarding the fix').toBe(CELLS.length);
    });

    it('both directions are represented — a window starting EARLY and one starting LATE', async () => {
        const dirs = new Set<string>();
        for (const c of CELLS) {
            await at(c.zone, c.instant, async () => {
                dirs.add(localMidnightSpelling() < utcDayStart(c.instant) ? 'early' : 'late');
            });
        }
        expect([...dirs].sort()).toEqual(['early', 'late']);
    });
});

// ── Fences: what this change must NOT have moved ──────────────────────────

describe('#15825 defect 1 fences', () => {
    it('⛔ at TZ=UTC the two spellings are INDISTINGUISHABLE — a UTC-only test proves nothing', async () => {
        for (const instant of ['2026-09-05T12:00:00Z', '2026-01-15T23:59:00Z', '2026-06-15T00:00:00Z']) {
            await at('UTC', instant, async () => {
                expect(localMidnightSpelling(), instant).toBe(utcDayStart(instant));
            });
        }
    });

    it('an explicit array dateRange is untouched — it never reaches the parser', async () => {
        await at('Asia/Shanghai', '2026-09-05T12:00:00Z', async () => {
            const driver = new InMemoryDriver({
                initialData: {
                    events: [
                        { id: 1, probe: 'in', created_at: new Date('2026-09-05T00:00:00.000Z') },
                        { id: 2, probe: 'out', created_at: new Date('2026-09-07T00:00:00.000Z') },
                    ],
                },
            });
            await driver.connect();
            const service = new MemoryAnalyticsService({ driver, cubes: [CUBE] });
            const result = await service.query(asQuery({
                cube: 'events',
                measures: ['events.count'],
                dimensions: ['events.probe'],
                timeDimensions: [{
                    dimension: 'events.createdAt',
                    dateRange: ['2026-09-05', '2026-09-05'],
                }],
            }));
            expect(result.rows.map((r) => r['events.probe'])).toEqual(['in']);
        });
    });

    it('the unrecognised-range fallback carries no calendar — same answer in every zone', async () => {
        // This repair touched only the two legs that BUILD a window. The
        // `return [range, range]` fallback is untouched, and this fence holds
        // it that way: its answer must not depend on the process timezone.
        //
        // ⚠️ It is deliberately NOT asserted to be a sensible answer. Measured
        // 2026-09-05: an unparseable `dateRange` reaches mingo as
        // `{$gte: '<garbage>', $lte: '<garbage>'}` and, under BSON cross-type
        // ordering, matches EVERY `Date`-typed row — so the time filter is
        // silently dropped rather than refused. That is a different defect
        // class from this card's (vocabulary, not calendar) and is filed
        // separately; ⛔ it is not repaired here.
        const probes = [
            '2020-01-01T00:00:00.000Z',
            '2026-09-05T06:00:00.000Z',
            '2099-01-01T00:00:00.000Z',
        ];
        const answers: string[] = [];
        for (const zone of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles', 'Pacific/Chatham']) {
            await at(zone, '2026-09-05T12:00:00Z', async () => {
                answers.push(JSON.stringify(await probesSelected(probes, 'not a range at all')));
            });
        }
        expect(new Set(answers).size, `the fallback answered differently per zone: ${answers.join(' | ')}`).toBe(1);
    });

    it('the process timezone is restored after every case', () => {
        expect(process.env.TZ).toBe(REAL_TZ);
    });
});
