// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16322 — the ONE lowering of `timeDimensions[].dateRange`'s closed preset
 * vocabulary, and the ONE refusal for a string outside it.
 *
 * ## What this file is guarding against, stated as the measurement
 *
 * Before this module existed, `driver-memory` was the only face that resolved
 * a `dateRange` string at all, and it understood exactly one preset. Driving
 * its BUILT dist over five probe rows (2020, 2026-08-31, 2026-09-05, now,
 * 2099) on `b834b48e7a`: `today` selected 1/5 and **the other twelve declared
 * presets selected 5/5 — 2020 and 2099 included** — because each fell to a
 * `[range, range]` fallback whose two bounds were the preset's own NAME. The
 * two SQL strategies lowered the same names to the point window
 * `col >= 'last_30_days' AND col <= 'last_30_days'` (measured on the dataset
 * door in the same run). So a VALID preset was accepted by the schema and then
 * answered with all of history on one backend and a nonsense comparison on the
 * other.
 *
 * ⇒ every assertion below is about a property that measurement violated:
 * every declared name resolves, the windows are distinct and tile, they move
 * with the reference timezone, and a name outside the vocabulary is a REFUSAL
 * rather than a window.
 *
 * ## ⛔ The list is never restated here either
 *
 * The cases iterate `DATE_RANGE_PRESETS` itself, so a name added to that module
 * without a window here fails at this file rather than at a dashboard.
 */

import { describe, it, expect } from 'vitest';
import {
  DATE_RANGE_PRESETS,
  DATE_RANGE_PRESET_MACRO_WINDOWS,
  analyticsDateRangeRefusalMessage,
  type DateRangePreset,
} from '@objectstack/spec/data';
import { resolveFilterToken } from './filter-tokens.js';
import { zonedDateStartToUtcMs, nextUtcCalendarDay } from './datetime.js';
import {
  resolveAnalyticsDateRangePreset,
  resolveAnalyticsDateRangeString,
  analyticsDateRangeUnrecognizedError,
} from './analytics-date-range.js';

/** A frozen reference instant, deliberately mid-week, mid-month, mid-quarter. */
const NOW = new Date('2026-09-09T12:34:56.789Z');

/** The rolling family — the only presets whose upper bound is NOW. */
const ROLLING: readonly DateRangePreset[] = ['last_7_days', 'last_30_days', 'last_90_days'];

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Reference instants the END pin sweeps, chosen so a wrong shift cannot hide in
 * a tidy month: two DST transition days (a 23- and a 25-hour calendar day in
 * the zones below), both year boundaries, a quarter/month boundary, and a
 * February.
 */
const SWEEP_INSTANTS = [
    '2026-09-09T12:34:56.789Z',
    '2026-01-01T00:30:00.000Z',
    '2026-02-28T10:00:00.000Z',
    '2026-03-08T08:00:00.000Z',   // America/New_York starts DST — a 23-hour day
    '2026-03-31T23:00:00.000Z',   // Pacific/Chatham's DST-end week, and a quarter edge
    '2026-04-05T02:00:00.000Z',   // Pacific/Chatham ends DST — a 25-hour day
    '2026-11-01T05:30:00.000Z',   // America/New_York ends DST — a 25-hour day
    '2026-12-31T23:59:00.000Z',
].map((iso) => new Date(iso));

const SWEEP_ZONES: ReadonlyArray<string | undefined> = [
    undefined,
    'Asia/Shanghai',
    'America/New_York',
    'Pacific/Chatham',
];

describe('#16322 — every declared preset resolves to a real window', () => {
    it('resolves all thirteen, and none of them is the name of the preset', () => {
        for (const preset of DATE_RANGE_PRESETS) {
            const w = resolveAnalyticsDateRangePreset(preset, { now: NOW });
            expect(w.start, preset).toMatch(ISO_INSTANT);
            expect(w.end, preset).toMatch(ISO_INSTANT);
            // The defect this replaces, stated directly: the fallback returned
            // the preset's own name as BOTH bounds.
            expect(w.start, preset).not.toBe(preset);
            expect(w.end, preset).not.toBe(preset);
            expect(Date.parse(w.start), preset).toBeLessThan(Date.parse(w.end));
        }
    });

    it('⛔ never emits a bare `YYYY-MM-DD` — the road that would re-cut the window at UTC midnight', () => {
        // Measured on #16042/#16179: `boundary()` renders a zone's midnight
        // INSTANT, and a bare day handed downstream is widened by
        // `nextUtcCalendarDay` and cut at `T00:00:00Z`, i.e. UTC midnight —
        // eight hours late for `Asia/Shanghai`, silently.
        for (const preset of DATE_RANGE_PRESETS) {
            for (const tz of [undefined, 'Asia/Shanghai', 'America/New_York']) {
                const w = resolveAnalyticsDateRangePreset(preset, { now: NOW, timezone: tz });
                expect(w.start, `${preset} @ ${tz}`).toMatch(ISO_INSTANT);
                expect(w.end, `${preset} @ ${tz}`).toMatch(ISO_INSTANT);
            }
        }
    });

    it('the thirteen windows are DISTINCT — the fallback made twelve of them identical', () => {
        const seen = new Set(
            DATE_RANGE_PRESETS.map((p) => {
                const w = resolveAnalyticsDateRangePreset(p, { now: NOW });
                return `${w.start}..${w.end}`;
            }),
        );
        expect(seen.size).toBe(DATE_RANGE_PRESETS.length);
    });
});

describe('#16322 — the START of every window is the token the spec already prescribes', () => {
    // The single-sourcing that matters: `DATE_RANGE_PRESET_MACRO_WINDOWS` is
    // what the REFUSAL message tells an author to write instead of a preset
    // name, so a resolver that opened its window somewhere else would hand out
    // a prescription that does not reproduce the answer.
    it.each([...DATE_RANGE_PRESETS])('%s opens where the prescription says', (preset) => {
        for (const tz of [undefined, 'Asia/Shanghai']) {
            const prescribedStartToken = DATE_RANGE_PRESET_MACRO_WINDOWS[preset][0]
                .replace(/^\{|\}$/g, '');
            const day = String(resolveFilterToken(prescribedStartToken, { now: NOW, timezone: tz }));
            const expected = new Date(zonedDateStartToUtcMs(day, tz)).toISOString();
            expect(resolveAnalyticsDateRangePreset(preset, { now: NOW, timezone: tz }).start)
                .toBe(expected);
        }
    });
});

describe('#16322 — the upper bound is half-open for a calendar window, and NOW for a rolling one', () => {
    it('the ten calendar presets are endExclusive, the three rolling ones are not', () => {
        for (const preset of DATE_RANGE_PRESETS) {
            const w = resolveAnalyticsDateRangePreset(preset, { now: NOW });
            expect(w.endExclusive, preset).toBe(!ROLLING.includes(preset));
        }
    });

    it('a rolling window ends at the reference instant exactly', () => {
        for (const preset of ROLLING) {
            expect(resolveAnalyticsDateRangePreset(preset, { now: NOW }).end).toBe(NOW.toISOString());
        }
    });

    it('adjacent calendar windows TILE — no instant belongs to both, none falls between', () => {
        // The #16179 defect as a property: an inclusive upper bound made two
        // adjacent day windows overlap at midnight and counted a row stamped
        // there TWICE. Tiling is the shape that cannot do that.
        const pairs: Array<[DateRangePreset, DateRangePreset]> = [
            ['yesterday', 'today'],
            ['last_week', 'this_week'],
            ['last_month', 'this_month'],
            ['last_quarter', 'this_quarter'],
            ['last_year', 'this_year'],
        ];
        for (const [earlier, later] of pairs) {
            const a = resolveAnalyticsDateRangePreset(earlier, { now: NOW });
            const b = resolveAnalyticsDateRangePreset(later, { now: NOW });
            expect(a.end, `${earlier} → ${later}`).toBe(b.start);
            expect(a.endExclusive, earlier).toBe(true);
        }
    });

    it("`today`'s window is the one #16179 pinned — it stops before tomorrow begins", () => {
        const w = resolveAnalyticsDateRangePreset('today', { now: NOW });
        expect(w).toEqual({
            start: '2026-09-09T00:00:00.000Z',
            end: '2026-09-10T00:00:00.000Z',
            endExclusive: true,
        });
    });
});

describe('#16322 — the window is anchored on the SUPPLIED timezone, both halves', () => {
    // The two halves fail independently and each failure is silent (#16042):
    // WHICH calendar day the window is on, and WHERE that day begins.
    it("`today` in Asia/Shanghai is the Shanghai day, opening at Shanghai's midnight", () => {
        // Instant taken from `memory-analytics-date-range-timezone.test.ts`'s
        // measured cell: 20:00Z is already the NEXT calendar day in Shanghai.
        const at = new Date('2026-09-06T20:00:00Z');
        expect(resolveAnalyticsDateRangePreset('today', { now: at, timezone: 'Asia/Shanghai' }))
            .toEqual({
                start: '2026-09-06T16:00:00.000Z',
                end: '2026-09-07T16:00:00.000Z',
                endExclusive: true,
            });
        expect(resolveAnalyticsDateRangePreset('today', { now: at })).toEqual({
            start: '2026-09-06T00:00:00.000Z',
            end: '2026-09-07T00:00:00.000Z',
            endExclusive: true,
        });
    });

    it("`last_7_days` opens seven days before the ZONE's day, at that zone's midnight", () => {
        // The reinstated #16042 reading, in preset spelling: the retired pin
        // measured Asia/Shanghai opening at 2026-08-30T16:00:00.000Z against
        // UTC's 2026-08-30T00:00:00.000Z.
        const at = new Date('2026-09-06T20:00:00Z');
        expect(resolveAnalyticsDateRangePreset('last_7_days', { now: at, timezone: 'Asia/Shanghai' }).start)
            .toBe('2026-08-30T16:00:00.000Z');
        expect(resolveAnalyticsDateRangePreset('last_7_days', { now: at }).start)
            .toBe('2026-08-30T00:00:00.000Z');
    });

    it('an unknown zone degrades to UTC rather than throwing', () => {
        expect(resolveAnalyticsDateRangePreset('today', { now: NOW, timezone: 'Mars/Olympus' }))
            .toEqual(resolveAnalyticsDateRangePreset('today', { now: NOW }));
    });

    it("a zone whose offset is not a whole hour still opens at that zone's midnight", () => {
        // Pacific/Chatham is +12:45 — a whole-hour assumption in the lowering
        // would land 15 minutes off and nothing else would notice.
        const w = resolveAnalyticsDateRangePreset('today', {
            now: new Date('2026-06-15T12:00:00Z'),
            timezone: 'Pacific/Chatham',
        });
        expect(w.start).toBe('2026-06-15T11:15:00.000Z');
    });
});

describe('#16322 — a string outside the vocabulary is REFUSED, not widened', () => {
    const OUTSIDE = [
        'not a range at all',
        'Last 7 Days',    // case — the vocabulary is case-sensitive
        'last 7 days',    // the relative dialect #16041 closed
        'last_60_days',   // a plausible near-miss that was never declared
        '',
        '2026-09-09',     // a single ISO day is an explicit window's JOB, not a preset
    ];

    it.each(OUTSIDE)('refuses %j with the ADR-0112 envelope', (bad) => {
        let thrown: (Error & { code?: string; status?: number }) | null = null;
        try {
            resolveAnalyticsDateRangeString(bad);
        } catch (e) {
            thrown = e as Error & { code?: string; status?: number };
        }
        expect(thrown, 'an unresolvable window must be a refusal, never a window').not.toBeNull();
        expect(thrown!.code).toBe('ANALYTICS_DATE_RANGE_UNRECOGNIZED');
        expect(thrown!.status).toBe(400);
    });

    it('speaks the SPEC\'s wording — one condition, one sentence (#5240)', () => {
        // ⛔ Not a second convention: the schema door answers this same text,
        // so an author correcting the value reads the same prescription
        // wherever the refusal reached them.
        for (const bad of OUTSIDE) {
            expect(analyticsDateRangeUnrecognizedError(bad).message)
                .toBe(analyticsDateRangeRefusalMessage(bad));
        }
    });

    it('every DECLARED name is accepted by the same door that refuses those', () => {
        // The control. Without it a refusal that rejected EVERYTHING would pass
        // every assertion above.
        for (const preset of DATE_RANGE_PRESETS) {
            expect(() => resolveAnalyticsDateRangeString(preset, { now: NOW })).not.toThrow();
        }
        expect(resolveAnalyticsDateRangeString('today', { now: NOW }))
            .toEqual(resolveAnalyticsDateRangePreset('today', { now: NOW }));
    });
});

describe('#17341 — the END of every calendar window is one CALENDAR day after the prescription', () => {
    // The docblock above `PRESET_WINDOW_TOKENS` records WHY this table states
    // its own ends instead of reading `DATE_RANGE_PRESET_MACRO_WINDOWS`: that
    // table is written for `$between`, whose bare-day upper bound covers the
    // whole day, so its end names the day BEFORE the one this table stops at.
    //
    // ⛔ That sentence carried a hand-typed count ("the eight period presets")
    // and went false the moment the spec corrected `today` and `yesterday` to
    // close on their own last day — a count is a census and a census goes
    // stale silently. Nothing here counts: the two families are READ OFF the
    // prescription, so an eleventh preset reds this file instead of rotting
    // that sentence.
    const PRESCRIBED_CLOSED = DATE_RANGE_PRESETS.filter(
        (p) => DATE_RANGE_PRESET_MACRO_WINDOWS[p][1] !== null,
    );
    const PRESCRIBED_OPEN = DATE_RANGE_PRESETS.filter(
        (p) => DATE_RANGE_PRESET_MACRO_WINDOWS[p][1] === null,
    );

    it('the split is DERIVED from the spec table, and it is the same one `endExclusive` draws', () => {
        // Two partitions of one vocabulary, computed from opposite sides: the
        // spec's open arm, and this module's rolling family. They must be the
        // same set — if they ever diverge, one of the two docblock sentences
        // that name a family is describing presets that are not in it.
        expect(PRESCRIBED_CLOSED.length + PRESCRIBED_OPEN.length).toBe(DATE_RANGE_PRESETS.length);
        expect([...PRESCRIBED_OPEN].sort()).toEqual([...ROLLING].sort());
        for (const preset of PRESCRIBED_CLOSED) {
            expect(resolveAnalyticsDateRangePreset(preset, { now: NOW }).endExclusive, preset).toBe(true);
        }
        // The control: without it a filter that selected NOTHING would pass
        // every assertion below by vacuity.
        expect(PRESCRIBED_CLOSED.length).toBeGreaterThan(0);
        expect(PRESCRIBED_OPEN.length).toBeGreaterThan(0);
    });

    it.each([...PRESCRIBED_CLOSED])(
        "%s stops before the day AFTER the prescription's inclusive last day",
        (preset) => {
            const prescribedEnd = DATE_RANGE_PRESET_MACRO_WINDOWS[preset][1]!.replace(/^\{|\}$/g, '');
            for (const now of SWEEP_INSTANTS) {
                for (const tz of SWEEP_ZONES) {
                    const where = `${preset} @ ${tz ?? 'UTC'} @ ${now.toISOString()}`;
                    const lastDay = String(resolveFilterToken(prescribedEnd, { now, timezone: tz }));
                    const stopsBefore = nextUtcCalendarDay(lastDay);
                    expect(stopsBefore, where).not.toBeNull();
                    const expected = new Date(zonedDateStartToUtcMs(stopsBefore!, tz)).toISOString();
                    expect(resolveAnalyticsDateRangePreset(preset, { now, timezone: tz }).end, where)
                        .toBe(expected);
                }
            }
        },
    );

    it('a CALENDAR day, not 86_400_000 ms — the DST cell that tells the two apart', () => {
        // Pacific/Chatham leaves DST on the first Sunday of April, so
        // 2026-04-05 is 25 hours long there — and it is exactly the day
        // `this_week`'s prescription names as its last. A "+ one day" written
        // in milliseconds lands an hour inside the window, silently, and every
        // other assertion in this file still passes.
        const now = new Date('2026-04-05T02:00:00.000Z');
        const tz = 'Pacific/Chatham';
        const lastDay = String(resolveFilterToken('week_end', { now, timezone: tz }));
        const lastDayStart = zonedDateStartToUtcMs(lastDay, tz);
        const end = Date.parse(resolveAnalyticsDateRangePreset('this_week', { now, timezone: tz }).end);
        expect(end - lastDayStart).toBe(25 * 60 * 60 * 1000);
        expect(end - lastDayStart).not.toBe(24 * 60 * 60 * 1000);
    });

    it('the open-arm presets have no end to be earlier — `null` on BOTH sides', () => {
        for (const preset of PRESCRIBED_OPEN) {
            expect(DATE_RANGE_PRESET_MACRO_WINDOWS[preset][1], preset).toBeNull();
            const w = resolveAnalyticsDateRangePreset(preset, { now: NOW });
            expect(w.endExclusive, preset).toBe(false);
            expect(w.end, preset).toBe(NOW.toISOString());
        }
    });
});
