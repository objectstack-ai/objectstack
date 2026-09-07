// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14852 — the `{TODAY() +/- n}` / `{NOW() +/- n}` offset branch resolves on
 * ONE calendar (UTC), the same one the bare forms already render on.
 *
 * ## Why this file cannot be written to run only at `TZ=UTC`
 *
 * The two spellings — local `setDate(getDate() + n)` and UTC
 * `setUTCDate(getUTCDate() + n)` — are behaviourally INDISTINGUISHABLE at
 * `TZ=UTC`, which is precisely why nothing in CI ever went red on the defect
 * and why it shipped. Every case below therefore fakes BOTH halves of the
 * environment: a DST-observing zone (`process.env.TZ`, re-read by V8 on the
 * next `Date` operation) AND an instant whose day shift crosses that zone's
 * own transition.
 *
 * ## The mechanism, stated once
 *
 * `setDate` preserves WALL-CLOCK time, so shifting the local calendar by n
 * days moves the INSTANT by exactly n x 24h only while every local day in the
 * window is 24 hours long. Across a spring-forward that window is 23 hours;
 * across a fall-back, 25. The rendering is `toISOString()` — UTC. So a flip
 * needs TWO conditions AT ONCE:
 *
 *   1. the local day shift straddles the transition  -> the instant moves
 *      23h or 25h instead of n x 24h; and
 *   2. that one hour of slack crosses a UTC midnight -> the rendered DAY, not
 *      merely the instant, comes out wrong.
 *
 * Condition (2) is what pins the instants below to the UTC hour [00:00, 01:00)
 * for a forward offset and [23:00, 24:00) for a backward one: those are the
 * only hours where one hour of slack changes which UTC day you land on.
 * Condition (1) is what pins the DAY to each zone's own transition. Miss
 * either and the cell is GREEN against the broken code — a single-point sweep
 * is exactly what let the identical two-calendar shape sit unnoticed in a
 * hotcrm test helper for months (`objectstack-ai/hotcrm#1462`).
 *
 * NOTE the direction is not one-signed: spring-forward renders a day EARLY
 * (23h falls short of the midnight it had to cross), fall-back renders a day
 * LATE (25h overshoots one). Both are pinned.
 *
 * ## The inline control is load-bearing
 *
 * Each cell also evaluates the OLD mixed spelling directly and asserts it
 * DISAGREES with the truth. Without that, a green run would be ambiguous
 * between "the fix works" and "these instants are not actually in a transition
 * window" — the second being the failure mode that hid this bug. With it, the
 * file proves its own instants are live before it credits the fix.
 *
 * ## Deliberately NOT pinned here
 *
 * Whether these tokens should be timezone-AWARE at all is a separate and
 * larger question (#14852 explicitly does not propose it). The bare
 * `{TODAY()}` resolves to the UTC day, and the controls below hold it there in
 * every zone; this file only makes the offset branch AGREE with the bare one.
 */

import { describe, it, expect, vi } from 'vitest';
import { interpolateString } from './template.js';

const ctx = {} as any;

function tpl(expr: string, vars: Record<string, unknown> = {}): unknown {
    return interpolateString(`{${expr}}`, new Map(Object.entries(vars)), ctx);
}

const REAL_TZ = process.env.TZ;

/** Run `fn` with the process on `zone` and the clock frozen at `instant`. */
function at<T>(zone: string, instant: string, fn: () => T): T {
    process.env.TZ = zone;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(instant));
    try {
        return fn();
    } finally {
        vi.useRealTimers();
        if (REAL_TZ === undefined) delete process.env.TZ;
        else process.env.TZ = REAL_TZ;
    }
}

/** The defect, spelled out: day arithmetic on the LOCAL calendar, rendered on UTC. */
function mixedCalendarSpelling(instant: string, n: number): string {
    const d = new Date(instant);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
}

/**
 * The truth, computed from NEITHER spelling: the instant plus n x 24h, in UTC.
 * `{TODAY() + n}` means "n days after the UTC day it is now", and a UTC day is
 * always 24 hours — so this is the definition, not a second implementation.
 */
function utcDayShift(instant: string, n: number): string {
    return new Date(Date.parse(instant) + n * 86_400_000).toISOString().slice(0, 10);
}

interface Cell {
    zone: string;
    /** Frozen clock, always written in UTC. */
    instant: string;
    offset: number;
    /** The same instant as local wall clock, so the window is readable. */
    local: string;
    kind: 'spring-forward' | 'fall-back';
}

/**
 * Red cells — every one MEASURED, not guessed: each is an instant at which the
 * mixed spelling actually disagrees with the truth in that zone, taken from a
 * 34-zone x 30-minute sweep of 2026. Both hemispheres, both transition
 * directions, and three zones whose standard offset is not a whole hour
 * (St_Johns -03:30, Chatham +12:45, Adelaide +09:30 via Sydney's sibling rule)
 * so a whole-hour assumption cannot hide in the fix.
 */
const DST_CELLS: Cell[] = [
    { zone: 'America/New_York',    instant: '2026-03-08T00:30:00Z', offset:  1, local: 'Sat 2026-03-07 19:30 EST',  kind: 'spring-forward' },
    { zone: 'America/New_York',    instant: '2026-03-08T23:30:00Z', offset: -1, local: 'Sun 2026-03-08 19:30 EDT',  kind: 'spring-forward' },
    { zone: 'America/New_York',    instant: '2026-10-31T23:30:00Z', offset:  1, local: 'Sat 2026-10-31 19:30 EDT',  kind: 'fall-back' },
    { zone: 'America/New_York',    instant: '2026-11-02T00:30:00Z', offset: -1, local: 'Sun 2026-11-01 19:30 EST',  kind: 'fall-back' },
    { zone: 'America/Los_Angeles', instant: '2026-03-08T00:30:00Z', offset:  1, local: 'Sat 2026-03-07 16:30 PST',  kind: 'spring-forward' },
    { zone: 'America/St_Johns',    instant: '2026-03-08T00:30:00Z', offset:  1, local: 'Sat 2026-03-07 21:00 NST',  kind: 'spring-forward' },
    { zone: 'Europe/London',       instant: '2026-03-29T00:30:00Z', offset:  1, local: 'Sun 2026-03-29 00:30 GMT',  kind: 'spring-forward' },
    { zone: 'Europe/Berlin',       instant: '2026-03-29T00:30:00Z', offset:  1, local: 'Sun 2026-03-29 01:30 CET',  kind: 'spring-forward' },
    { zone: 'Asia/Jerusalem',      instant: '2026-03-27T23:30:00Z', offset: -1, local: 'Sat 2026-03-28 02:30 IDT',  kind: 'spring-forward' },
    { zone: 'Australia/Sydney',    instant: '2026-10-03T00:30:00Z', offset:  1, local: 'Sat 2026-10-03 10:30 AEST', kind: 'spring-forward' },
    { zone: 'Australia/Adelaide',  instant: '2026-10-03T00:30:00Z', offset:  1, local: 'Sat 2026-10-03 10:00 ACST', kind: 'spring-forward' },
    { zone: 'Pacific/Auckland',    instant: '2026-09-26T00:30:00Z', offset:  1, local: 'Sat 2026-09-26 12:30 NZST', kind: 'spring-forward' },
    { zone: 'Pacific/Chatham',     instant: '2026-09-26T00:30:00Z', offset:  1, local: 'Sat 2026-09-26 13:15 +1245', kind: 'spring-forward' },
    { zone: 'America/Santiago',    instant: '2026-09-06T00:30:00Z', offset:  1, local: 'Sat 2026-09-05 20:30 -04',  kind: 'spring-forward' },
];

const label = (c: Cell) => `${c.zone} @ ${c.instant} (${c.local}) {TODAY() ${c.offset > 0 ? '+' : '-'} ${Math.abs(c.offset)}}`;

describe('#14852 {TODAY() +/- n} resolves on one calendar, across DST transitions', () => {
    for (const c of DST_CELLS) {
        it(`${c.kind}: ${label(c)}`, () => {
            const expr = `TODAY() ${c.offset > 0 ? '+' : '-'} ${Math.abs(c.offset)}`;
            at(c.zone, c.instant, () => {
                const expected = utcDayShift(c.instant, c.offset);

                // CONTROL FIRST — if this passes, the cell is not in a
                // transition window and the assertion below would be vacuous.
                // (It is the whole reason a TZ=UTC-only test is worthless here.)
                expect(
                    mixedCalendarSpelling(c.instant, c.offset),
                    `${label(c)}: the mixed spelling must DISAGREE here, otherwise this cell pins nothing`,
                ).not.toBe(expected);

                expect(tpl(expr), label(c)).toBe(expected);
            });
        });
    }

    it('every red cell is live — the control disagrees in all of them', () => {
        const live = DST_CELLS.filter((c) =>
            at(c.zone, c.instant, () => mixedCalendarSpelling(c.instant, c.offset) !== utcDayShift(c.instant, c.offset)),
        );
        expect(live.length, 'a cell that no longer flips has stopped guarding the fix').toBe(DST_CELLS.length);
    });

    it('both directions are represented — a day EARLY and a day LATE', () => {
        const dirs = new Set(
            DST_CELLS.map((c) =>
                at(c.zone, c.instant, () =>
                    mixedCalendarSpelling(c.instant, c.offset) < utcDayShift(c.instant, c.offset) ? 'early' : 'late',
                ),
            ),
        );
        expect([...dirs].sort()).toEqual(['early', 'late']);
    });
});

describe('#14852 the offset branch serves NOW() too — same mutation, same calendar', () => {
    for (const c of DST_CELLS.filter((x) => x.offset === 1).slice(0, 4)) {
        it(`${c.zone} @ ${c.instant}: {NOW() + 1} is exactly +24h`, () => {
            at(c.zone, c.instant, () => {
                expect(tpl('NOW() + 1')).toBe(new Date(Date.parse(c.instant) + 86_400_000).toISOString());
            });
        });
    }
});

describe('#14852 the offset may come from a variable — same branch', () => {
    it('{TODAY() + days} with days=1 lands on the UTC day too', () => {
        const c = DST_CELLS[0];
        at(c.zone, c.instant, () => {
            expect(tpl('TODAY() + days', { days: 1 })).toBe(utcDayShift(c.instant, 1));
        });
    });
});

// ── Fences: what this change must NOT have moved ──────────────────────────

describe('#14852 fences — the bare forms and the non-DST zones are untouched', () => {
    const ALL_ZONES = [...new Set(DST_CELLS.map((c) => c.zone))];

    it('bare {TODAY()} still resolves to the UTC day in every zone, including inside a transition window', () => {
        for (const c of DST_CELLS) {
            at(c.zone, c.instant, () => {
                expect(tpl('TODAY()'), `${c.zone} @ ${c.instant}`).toBe(c.instant.slice(0, 10));
            });
        }
    });

    it('bare {NOW()} still renders the instant itself', () => {
        for (const zone of ALL_ZONES) {
            at(zone, '2026-03-08T00:30:00Z', () => {
                expect(tpl('NOW()'), zone).toBe('2026-03-08T00:30:00.000Z');
            });
        }
    });

    it('zones that do not observe DST are unaffected — both spellings already agreed there', () => {
        for (const zone of ['UTC', 'Asia/Shanghai', 'Asia/Kolkata', 'Australia/Perth']) {
            for (const instant of ['2026-03-08T00:30:00Z', '2026-10-31T23:30:00Z', '2026-06-15T12:00:00Z']) {
                at(zone, instant, () => {
                    expect(mixedCalendarSpelling(instant, 1), `${zone} @ ${instant}`).toBe(utcDayShift(instant, 1));
                    expect(tpl('TODAY() + 1'), `${zone} @ ${instant}`).toBe(utcDayShift(instant, 1));
                });
            }
        }
    });

    it('an ordinary instant in a DST zone is unaffected — the local day is 24h there', () => {
        for (const zone of ALL_ZONES) {
            at(zone, '2026-06-15T12:00:00Z', () => {
                expect(mixedCalendarSpelling('2026-06-15T12:00:00Z', 1), zone).toBe('2026-06-16');
                expect(tpl('TODAY() + 1'), zone).toBe('2026-06-16');
            });
        }
    });

    it('a large offset still lands on the UTC day (the consumers use +90 and +120)', () => {
        const c = DST_CELLS[0];
        at(c.zone, c.instant, () => {
            expect(tpl('TODAY() + 90')).toBe(utcDayShift(c.instant, 90));
            expect(tpl('TODAY() + 120')).toBe(utcDayShift(c.instant, 120));
        });
    });

    it('the process timezone is restored after every case', () => {
        expect(process.env.TZ).toBe(REAL_TZ);
    });
});
