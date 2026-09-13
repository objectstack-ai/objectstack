// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  DATE_RANGE_PRESETS,
  DATE_RANGE_PRESET_MACRO_WINDOWS,
  bareDateRangePresetComparandMessage,
  isDateRangePresetName,
  type DateRangePreset,
} from './date-range-presets';
import { DATE_MACRO_WRAPPED_RE, isDateMacroToken } from './date-macros.zod';
import { nextUtcCalendarDay } from './calendar-day';

describe('date-range preset vocabulary (#4614, re-homed by #8793)', () => {
  it('declares exactly the thirteen shipped preset names, in filter-bar order', () => {
    // Pinned literally: this list is a published vocabulary (dashboard
    // defaultRange / date-filter defaultValue accept it, filter comparands
    // refuse it), so a member appearing or vanishing must be a loud diff here,
    // never a side effect.
    expect([...DATE_RANGE_PRESETS]).toEqual([
      'today', 'yesterday',
      'this_week', 'last_week',
      'this_month', 'last_month',
      'this_quarter', 'last_quarter',
      'this_year', 'last_year',
      'last_7_days', 'last_30_days', 'last_90_days',
    ]);
  });

  it('isDateRangePresetName matches the declared names exactly — no superset', () => {
    for (const preset of DATE_RANGE_PRESETS) {
      expect(isDateRangePresetName(preset)).toBe(true);
    }
    // The refusal this predicate feeds judges the DECLARED vocabulary only.
    expect(isDateRangePresetName('last_60_days')).toBe(false); // undeclared sibling
    expect(isDateRangePresetName('Last 7 Days')).toBe(false);  // display spelling
    expect(isDateRangePresetName('LAST_7_DAYS')).toBe(false);  // case-sensitive
    expect(isDateRangePresetName('custom')).toBe(false);       // defaultRange-only sentinel
    expect(isDateRangePresetName('{30_days_ago}')).toBe(false); // the other vocabulary
    expect(isDateRangePresetName('')).toBe(false);
    expect(isDateRangePresetName(7)).toBe(false);
    expect(isDateRangePresetName(null)).toBe(false);
  });

  it('every prescribed macro window is spelled in the REAL macro vocabulary', () => {
    // The windows exist to be quoted in refusals. A prescription naming a token
    // the resolver does not know would send the author from one silent zero to
    // a loud FILTER_TOKEN_UNKNOWN — better, but still wrong. Ask the macro
    // vocabulary rather than trusting the table.
    for (const preset of DATE_RANGE_PRESETS) {
      const [start, end] = DATE_RANGE_PRESET_MACRO_WINDOWS[preset];
      for (const bound of end === null ? [start] : [start, end]) {
        const m = bound.match(DATE_MACRO_WRAPPED_RE);
        expect(m, `${preset} bound ${bound} must be a wrapped macro`).toBeTruthy();
        expect(isDateMacroToken(m![1]), `${preset} bound ${bound} must be a KNOWN macro`).toBe(true);
      }
    }
  });

  it('the rolling last_N_days windows prescribe {N_days_ago} with no upper macro', () => {
    expect(DATE_RANGE_PRESET_MACRO_WINDOWS.last_7_days).toEqual(['{7_days_ago}', null]);
    expect(DATE_RANGE_PRESET_MACRO_WINDOWS.last_30_days).toEqual(['{30_days_ago}', null]);
    expect(DATE_RANGE_PRESET_MACRO_WINDOWS.last_90_days).toEqual(['{90_days_ago}', null]);
  });

  it('the refusal message names the value, the operator, the macro fix and the ISO fallback', () => {
    const message = bareDateRangePresetComparandMessage('last_30_days', '$gte');
    expect(message).toContain('last_30_days');    // the offending value, quoted back
    expect(message).toContain('$gte');            // the position it sat in
    expect(message).toContain('{30_days_ago}');   // the spelling that works
    expect(message).toContain('2026-01-15');      // the ISO alternative
    // Attributable from the error alone by the customer-resolvable sentence —
    // never by a tracker id (#13156's strip).
    expect(message).toContain('Refused at authoring time so the error surfaces where the filter is written.');
    expect(message).not.toMatch(/(?<![#&])#\d{3,5}(?![0-9A-Za-z])/);
    // A calendar preset prescribes its window pair.
    const window = bareDateRangePresetComparandMessage('this_week', '$lt');
    expect(window).toContain('{week_start}');
    expect(window).toContain('{week_end}');
  });
});

/**
 * A frozen reference day for the extent pins below — Wednesday 2026-07-15.
 *
 * Nothing here calls a resolver: the two tables state, independently, the two
 * halves the prescription table has to connect. {@link TOKEN_DAY_ON_REFERENCE}
 * says what each MACRO TOKEN denotes (read off `DATE_MACRO_DESCRIPTIONS` in
 * `./date-macros.zod.ts` — "Monday 00:00 of this week", "Last day of this
 * month", "Start of yesterday"). {@link EXPECTED_WINDOW_DAYS} says what each
 * PRESET NAME denotes, which is decided by the name and by nothing else. The
 * pin then asks whether `DATE_RANGE_PRESET_MACRO_WINDOWS` joins them, which is
 * the only question it exists to answer — and the question a membership check
 * over the token vocabulary cannot reach, because both a right and a wrong end
 * token are perfectly good members (#17014).
 */
const REFERENCE_DAY = '2026-07-15'; // a Wednesday, mid-week / mid-month / mid-quarter

/** What each token used by a CLOSED entry denotes on {@link REFERENCE_DAY}. */
const TOKEN_DAY_ON_REFERENCE: Readonly<Record<string, string>> = {
  '{today}': '2026-07-15',
  '{yesterday}': '2026-07-14',
  '{week_start}': '2026-07-13', // Monday of that week
  '{week_end}': '2026-07-19', // Sunday of that week
  '{last_week_start}': '2026-07-06',
  '{last_week_end}': '2026-07-12',
  '{month_start}': '2026-07-01',
  '{month_end}': '2026-07-31',
  '{last_month_start}': '2026-06-01',
  '{last_month_end}': '2026-06-30',
  '{quarter_start}': '2026-07-01',
  '{quarter_end}': '2026-09-30',
  '{last_quarter_start}': '2026-04-01',
  '{last_quarter_end}': '2026-06-30',
  '{year_start}': '2026-01-01',
  '{year_end}': '2026-12-31',
  '{last_year_start}': '2025-01-01',
  '{last_year_end}': '2025-12-31',
};

/**
 * The window each preset NAME denotes on {@link REFERENCE_DAY}, as
 * `[firstDay, lastDay]` — or `null` for a ROLLING preset, whose upper bound is
 * the resolver's clock rather than any calendar day.
 *
 * Every declared preset must appear here (the census is asserted below), so a
 * preset added later cannot reach `main` without its author stating the days
 * it covers — which is the point at which picking the wrong end convention
 * becomes visible instead of silent.
 */
const EXPECTED_WINDOW_DAYS: Readonly<
  Record<DateRangePreset, readonly [first: string, last: string] | null>
> = {
  today: ['2026-07-15', '2026-07-15'],
  yesterday: ['2026-07-14', '2026-07-14'],
  this_week: ['2026-07-13', '2026-07-19'],
  last_week: ['2026-07-06', '2026-07-12'],
  this_month: ['2026-07-01', '2026-07-31'],
  last_month: ['2026-06-01', '2026-06-30'],
  this_quarter: ['2026-07-01', '2026-09-30'],
  last_quarter: ['2026-04-01', '2026-06-30'],
  this_year: ['2026-01-01', '2026-12-31'],
  last_year: ['2025-01-01', '2025-12-31'],
  last_7_days: null,
  last_30_days: null,
  last_90_days: null,
};

const DAY_MS = 86_400_000;
const midnightUtc = (day: string): number => Date.parse(`${day}T00:00:00.000Z`);

/**
 * How many whole days the prescribed `$between` pair actually selects, under
 * the platform's own bare-day bound rule: `>= start 00:00` and, because a
 * bare-day upper bound means "through that whole day",
 * `< nextUtcCalendarDay(end) 00:00` (ADR-0053 D-D, `./calendar-day.ts`).
 */
function prescribedDayCount(startDay: string, endDay: string): number {
  const exclusiveEnd = nextUtcCalendarDay(endDay);
  expect(exclusiveEnd, `${endDay} must be a real calendar day`).not.toBeNull();
  return (midnightUtc(exclusiveEnd!) - midnightUtc(startDay)) / DAY_MS;
}

describe('the prescribed window covers exactly the days the preset names (#17014)', () => {
  it('states an expected window for every declared preset, and for nothing else', () => {
    // The fence: a preset added to the vocabulary without a stated extent
    // fails here rather than silently inheriting whichever end convention its
    // author happened to reach for.
    expect(Object.keys(EXPECTED_WINDOW_DAYS).sort()).toEqual([...DATE_RANGE_PRESETS].sort());
  });

  it('the open arm is exactly the three ROLLING last_N_days windows', () => {
    // `end: null` is not a free choice — it says "this window has no calendar
    // upper bound at all". A preset that names a period always closes, `today`
    // included: `{ $gte: '{today}' }` also selects every day AFTER today on a
    // column that carries future dates.
    const open = DATE_RANGE_PRESETS.filter((p) => DATE_RANGE_PRESET_MACRO_WINDOWS[p][1] === null);
    expect(open).toEqual(['last_7_days', 'last_30_days', 'last_90_days']);
    for (const preset of DATE_RANGE_PRESETS) {
      expect(
        DATE_RANGE_PRESET_MACRO_WINDOWS[preset][1] === null,
        `${preset}: the open arm and the rolling family must be the same set`,
      ).toBe(EXPECTED_WINDOW_DAYS[preset] === null);
    }
  });

  it('every closed entry names its FIRST day as start and its LAST day as end', () => {
    for (const preset of DATE_RANGE_PRESETS) {
      const expected = EXPECTED_WINDOW_DAYS[preset];
      if (expected === null) continue;
      const [start, end] = DATE_RANGE_PRESET_MACRO_WINDOWS[preset];
      const startDay = TOKEN_DAY_ON_REFERENCE[start];
      const endDay = TOKEN_DAY_ON_REFERENCE[end!];
      expect(startDay, `${preset}: ${start} needs a denotation in TOKEN_DAY_ON_REFERENCE`).toBeTruthy();
      expect(endDay, `${preset}: ${end} needs a denotation in TOKEN_DAY_ON_REFERENCE`).toBeTruthy();
      expect(startDay, `${preset}: start must be the window's FIRST day`).toBe(expected[0]);
      // ⭐ The convention, and the whole defect: an end naming the day AFTER
      // the window resolves one day too wide, silently, on every backend.
      expect(endDay, `${preset}: end must be the window's LAST day, never the day after`).toBe(expected[1]);
    }
  });

  it('resolves the one-day presets to ONE day and the week presets to seven', () => {
    // Stated as concrete counts rather than as a re-derivation of the table,
    // because the defect was exactly a count: `['{yesterday}', '{today}']`
    // prescribed `>= yesterday 00:00 AND < tomorrow 00:00` — two days for a
    // one-day preset.
    expect(prescribedDayCount('2026-07-14', TOKEN_DAY_ON_REFERENCE[DATE_RANGE_PRESET_MACRO_WINDOWS.yesterday[1]!])).toBe(1);
    expect(prescribedDayCount('2026-07-15', TOKEN_DAY_ON_REFERENCE[DATE_RANGE_PRESET_MACRO_WINDOWS.today[1]!])).toBe(1);
    expect(prescribedDayCount('2026-07-13', TOKEN_DAY_ON_REFERENCE[DATE_RANGE_PRESET_MACRO_WINDOWS.this_week[1]!])).toBe(7);
    expect(prescribedDayCount('2026-07-06', TOKEN_DAY_ON_REFERENCE[DATE_RANGE_PRESET_MACRO_WINDOWS.last_week[1]!])).toBe(7);

    // And the full census, so a period preset cannot drift either.
    for (const preset of DATE_RANGE_PRESETS) {
      const expected = EXPECTED_WINDOW_DAYS[preset];
      if (expected === null) continue;
      const end = DATE_RANGE_PRESET_MACRO_WINDOWS[preset][1]!;
      expect(
        prescribedDayCount(expected[0], TOKEN_DAY_ON_REFERENCE[end]),
        `${preset}: prescribed extent must equal the named window`,
      ).toBe(prescribedDayCount(expected[0], expected[1]));
    }
  });

  it('the refusal prescribes a one-day window for a one-day preset', () => {
    const yday = bareDateRangePresetComparandMessage('yesterday', '$gte');
    expect(yday).toContain("{ $between: ['{yesterday}', '{yesterday}'] }");
    // ⛔ The day AFTER the window must not appear in a prescription for it.
    expect(yday).not.toContain("'{today}'");

    const today = bareDateRangePresetComparandMessage('today', '$lte');
    expect(today).toContain("{ $between: ['{today}', '{today}'] }");
    expect(today).not.toContain("'{tomorrow}'");
  });
});

describe('ui re-export stays the same declaration', () => {
  it('ui/dashboard.zod re-exports this vocabulary by reference', async () => {
    const ui = await import('../ui/dashboard.zod');
    expect(ui.DATE_RANGE_PRESETS).toBe(DATE_RANGE_PRESETS);
  });
});
