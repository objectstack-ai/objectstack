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
import { zonedDateStartToUtcMs } from './datetime.js';
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
