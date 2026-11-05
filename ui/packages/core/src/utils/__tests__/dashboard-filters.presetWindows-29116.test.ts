/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Dashboard date presets read the spec's window table, not a local copy.
 *
 * `dashboard-filters` used to keep its own preset → bounds table
 * (`PRESET_RANGES`) holding the spec's thirteen windows in the `{current_*}`
 * period spelling. It now lowers every preset through
 * `DATE_RANGE_PRESET_MACRO_WINDOWS`, which spells the current period with the
 * bare aliases (`{month_start}`). These pins hold three things:
 *
 *  1. every preset emits exactly the spec's window, so there is one table;
 *  2. the new spelling resolves to the same calendar days as the retired one
 *     on every preset, on reference dates that straddle week, month, quarter
 *     and year boundaries, so the rows a dashboard returns are unchanged, and
 *     so is the comparison window and trend label a metric widget derives
 *     from the same condition;
 *  3. a stored dashboard that carries the `{current_*}` spelling itself, as a
 *     custom range or as a bare macro default, still filters.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DATE_RANGE_PRESET_MACRO_WINDOWS } from '@objectstack/spec/data';
import {
  buildFilterCondition,
  resolveDashboardFilterDefs,
  resetDashboardFilterWarnings,
  DATE_RANGE_FILTER_NAME,
  DATE_RANGE_PRESETS,
  type DashboardFilterDef,
} from '../dashboard-filters';
import { resolveDateMacros } from '../date-macros';
import { shiftFilterByCompareTo, compareToTrendLabelKey } from '../compare-to';

const dateDef: DashboardFilterDef = {
  name: DATE_RANGE_FILTER_NAME,
  field: 'created_at',
  type: 'dateRange',
};

/**
 * The retired local table, verbatim from `dashboard-filters.ts` at main
 * 39951d2a — the behaviour this change must keep.
 */
const RETIRED_PRESET_RANGES: Record<string, { from: string; to: string }> = {
  today: { from: '{today}', to: '{today}' },
  yesterday: { from: '{yesterday}', to: '{yesterday}' },
  this_week: { from: '{current_week_start}', to: '{current_week_end}' },
  last_week: { from: '{last_week_start}', to: '{last_week_end}' },
  this_month: { from: '{current_month_start}', to: '{current_month_end}' },
  last_month: { from: '{last_month_start}', to: '{last_month_end}' },
  this_quarter: { from: '{current_quarter_start}', to: '{current_quarter_end}' },
  last_quarter: { from: '{last_quarter_start}', to: '{last_quarter_end}' },
  this_year: { from: '{current_year_start}', to: '{current_year_end}' },
  last_year: { from: '{last_year_start}', to: '{last_year_end}' },
  last_7_days: { from: '{7_days_ago}', to: '{today}' },
  last_30_days: { from: '{30_days_ago}', to: '{today}' },
  last_90_days: { from: '{90_days_ago}', to: '{today}' },
};

/** The presets the spec added after the retired table, which never held them. */
const FORWARD_PRESETS: readonly string[] = ['next_month', 'next_quarter', 'next_30_days'];
// A forward preset has no retired spelling to compare against, so the
// retired-spelling cases run on these only. The compareTo case runs on all 16.
const RETIRED_PRESETS = [...DATE_RANGE_PRESETS].filter((p) => !FORWARD_PRESETS.includes(p));

/**
 * The previous-period and previous-year windows and the trend label of every
 * retired preset at REFERENCE_NOWS[0], Wednesday 2026-07-15.
 *
 * CONTROL rows (`today`, `this_*`): as read off `compare-to.ts` at main
 * b7075d99, before #30140, and unchanged by #30197.
 *
 * #30197 rows: an already-past window used to compare with itself
 * (`yesterday` with 07-14, `last_month` with June) and `last_N_days` (N + 1
 * days through today) with the N days that end yesterday. Each now compares
 * with the period just before it: 07-13; the week of 06-29; May; Q1; 2024;
 * and for `last_7_days` (07-08..07-15, 8 days) the 8 days 06-30..07-07.
 */
const RETIRED_COMPARE_AT_REFERENCE: Record<string, {
  label: string;
  previousPeriod: [string, string];
  previousYear: [string, string];
}> = {
  today: { label: 'vsYesterday', previousPeriod: ['2026-07-14', '2026-07-14'], previousYear: ['2025-07-15', '2025-07-15'] },
  yesterday: { label: 'vsPreviousPeriod', previousPeriod: ['2026-07-13', '2026-07-13'], previousYear: ['2025-07-14', '2025-07-14'] },
  this_week: { label: 'vsLastWeek', previousPeriod: ['2026-07-06', '2026-07-12'], previousYear: ['2025-07-14', '2025-07-20'] },
  last_week: { label: 'vsPreviousPeriod', previousPeriod: ['2026-06-29', '2026-07-05'], previousYear: ['2025-07-07', '2025-07-13'] },
  this_month: { label: 'vsLastMonth', previousPeriod: ['2026-06-01', '2026-06-30'], previousYear: ['2025-07-01', '2025-07-31'] },
  last_month: { label: 'vsPreviousPeriod', previousPeriod: ['2026-05-01', '2026-05-31'], previousYear: ['2025-06-01', '2025-06-30'] },
  this_quarter: { label: 'vsLastQuarter', previousPeriod: ['2026-04-01', '2026-06-30'], previousYear: ['2025-07-01', '2025-09-30'] },
  last_quarter: { label: 'vsPreviousPeriod', previousPeriod: ['2026-01-01', '2026-03-31'], previousYear: ['2025-04-01', '2025-06-30'] },
  this_year: { label: 'vsLastYear', previousPeriod: ['2025-01-01', '2025-12-31'], previousYear: ['2025-01-01', '2025-12-31'] },
  last_year: { label: 'vsPreviousPeriod', previousPeriod: ['2024-01-01', '2024-12-31'], previousYear: ['2024-01-01', '2024-12-31'] },
  last_7_days: { label: 'vsPreviousPeriod', previousPeriod: ['2026-06-30', '2026-07-07'], previousYear: ['2025-07-08', '2025-07-15'] },
  last_30_days: { label: 'vsPreviousPeriod', previousPeriod: ['2026-05-15', '2026-06-14'], previousYear: ['2025-06-15', '2025-07-15'] },
  last_90_days: { label: 'vsPreviousPeriod', previousPeriod: ['2026-01-15', '2026-04-15'], previousYear: ['2025-04-16', '2025-07-15'] },
};

/**
 * The forward presets' comparison at REFERENCE_NOWS[0], a Wednesday,
 * 2026-07-15 (#30140). `previousPeriod` is the window immediately before the
 * current one: July for August, Q3 for Q4, and for the 31 days from today
 * through 2026-08-14 the 31 days that end yesterday.
 */
const FORWARD_COMPARE_AT_REFERENCE: Record<string, {
  label: string;
  previousPeriod: [string, string];
  previousYear: [string, string];
}> = {
  next_month: { label: 'vsThisMonth', previousPeriod: ['2026-07-01', '2026-07-31'], previousYear: ['2025-08-01', '2025-08-31'] },
  next_quarter: { label: 'vsThisQuarter', previousPeriod: ['2026-07-01', '2026-09-30'], previousYear: ['2025-10-01', '2025-12-31'] },
  next_30_days: { label: 'vsPreviousPeriod', previousPeriod: ['2026-06-14', '2026-07-14'], previousYear: ['2025-07-15', '2025-08-14'] },
};

/** Whole calendar days from ISO day `a` to ISO day `b`. */
const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Reference instants (local time, which is what `resolveDateMacros` reads):
 * a mid-quarter Wednesday, a Sunday that closes a week, a Monday that opens
 * one, the last day of a quarter, the first day of a year, and a leap day.
 */
const REFERENCE_NOWS = [
  new Date(2026, 6, 15, 10, 30),
  new Date(2026, 6, 19, 23, 59),
  new Date(2026, 6, 20, 0, 0),
  new Date(2026, 8, 30, 12, 0),
  new Date(2027, 0, 1, 0, 0),
  new Date(2028, 1, 29, 8, 0),
];

describe('dashboard date presets lower through the spec window table', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetDashboardFilterWarnings();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('covers the thirteen presets the retired table did, plus the three forward ones', () => {
    expect([...DATE_RANGE_PRESETS].filter((p) => !FORWARD_PRESETS.includes(p)).sort())
      .toEqual(Object.keys(RETIRED_PRESET_RANGES).sort());
    expect(DATE_RANGE_PRESETS).toHaveLength(16);
  });

  it.each(FORWARD_PRESETS)('%s resolves to real days ahead of today in the client resolver', (preset) => {
    const condition = buildFilterCondition(dateDef, { preset }) as { $gte: string; $lte: string };
    for (const now of REFERENCE_NOWS) {
      const resolved = resolveDateMacros(condition, now);
      expect(resolved.$gte, `${preset} @ ${now.toString()}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(resolved.$lte, `${preset} @ ${now.toString()}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(resolved.$lte > resolved.$gte, `${preset} @ ${now.toString()}`).toBe(true);
    }
    // Pinned on a mid-quarter Wednesday, 2026-07-15.
    const expected = {
      next_month: { $gte: '2026-08-01', $lte: '2026-08-31' },
      next_quarter: { $gte: '2026-10-01', $lte: '2026-12-31' },
      next_30_days: { $gte: '2026-07-15', $lte: '2026-08-14' },
    }[preset];
    expect(resolveDateMacros(condition, REFERENCE_NOWS[0])).toEqual(expected);
  });

  it('the client resolves next_month_end and next_quarter_end across a year rollover', () => {
    // Seen from a Q4 day, next quarter and next month fall in the next year.
    const q4 = new Date(2026, 11, 10, 12, 0);
    expect(resolveDateMacros({ $gte: '{next_quarter_start}', $lte: '{next_quarter_end}' }, q4))
      .toEqual({ $gte: '2027-01-01', $lte: '2027-03-31' });
    expect(resolveDateMacros({ $gte: '{next_month_start}', $lte: '{next_month_end}' }, q4))
      .toEqual({ $gte: '2027-01-01', $lte: '2027-01-31' });
    // A month-end day: next month is February, and 2028 is a leap year.
    expect(resolveDateMacros('{next_month_end}', new Date(2028, 0, 31, 12, 0))).toBe('2028-02-29');
  });

  it.each([...DATE_RANGE_PRESETS])('emits the spec window for %s', (preset) => {
    const [start, end] = DATE_RANGE_PRESET_MACRO_WINDOWS[preset];
    expect(buildFilterCondition(dateDef, { preset })).toEqual({ $gte: start, $lte: end });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(RETIRED_PRESETS)(
    '%s resolves to the same days under the retired {current_*} spelling',
    (preset) => {
      const retired = RETIRED_PRESET_RANGES[preset];
      const retiredCondition = { $gte: retired.from, $lte: retired.to };
      const condition = buildFilterCondition(dateDef, { preset }) as { $gte: string; $lte: string };
      for (const now of REFERENCE_NOWS) {
        const resolved = resolveDateMacros(condition, now);
        // A real date on both bounds, not a token passed through unresolved.
        expect(resolved.$gte, `${preset} @ ${now.toString()}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(resolved.$lte, `${preset} @ ${now.toString()}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(resolved, `${preset} @ ${now.toString()}`).toEqual(resolveDateMacros(retiredCondition, now));
      }
    },
  );

  it('pins a compareTo expectation for every one of the 16 presets', () => {
    expect(
      Object.keys({ ...RETIRED_COMPARE_AT_REFERENCE, ...FORWARD_COMPARE_AT_REFERENCE }).sort(),
    ).toEqual([...DATE_RANGE_PRESETS].sort());
  });

  it.each([...DATE_RANGE_PRESETS])(
    '%s compares with the right window and trend label for a compareTo widget',
    (preset) => {
      const filter = { created_at: buildFilterCondition(dateDef, { preset }) };
      const expected = RETIRED_COMPARE_AT_REFERENCE[preset] ?? FORWARD_COMPARE_AT_REFERENCE[preset];
      const at = REFERENCE_NOWS[0];
      expect(shiftFilterByCompareTo(filter, { kind: 'previousPeriod' }, at).created_at).toEqual({
        $gte: expected.previousPeriod[0],
        $lte: expected.previousPeriod[1],
      });
      expect(shiftFilterByCompareTo(filter, { kind: 'previousYear' }, at).created_at).toEqual({
        $gte: expected.previousYear[0],
        $lte: expected.previousYear[1],
      });
      expect(compareToTrendLabelKey({ kind: 'previousPeriod' }, filter)).toBe(expected.label);
      expect(compareToTrendLabelKey({ kind: 'previousYear' }, filter)).toBe('vsLastYear');

      if (!FORWARD_PRESETS.includes(preset)) {
        // A retired preset keeps the window and label its retired spelling had.
        const retired = RETIRED_PRESET_RANGES[preset];
        const retiredFilter = { created_at: { $gte: retired.from, $lte: retired.to } };
        for (const now of REFERENCE_NOWS) {
          for (const kind of ['previousPeriod', 'previousYear'] as const) {
            expect(shiftFilterByCompareTo(filter, { kind }, now), `${preset} ${kind} @ ${now.toString()}`).toEqual(
              shiftFilterByCompareTo(retiredFilter, { kind }, now),
            );
          }
        }
        expect(compareToTrendLabelKey({ kind: 'previousPeriod' }, filter)).toBe(
          compareToTrendLabelKey({ kind: 'previousPeriod' }, retiredFilter),
        );
      }

      // Every preset's previous period ends the day before its own window
      // starts, on every reference date, so it never overlaps it and never is
      // it (#30140, #30197).
      for (const now of REFERENCE_NOWS) {
        const current = resolveDateMacros(filter, now).created_at as { $gte: string; $lte: string };
        const previous = shiftFilterByCompareTo(filter, { kind: 'previousPeriod' }, now).created_at as {
          $gte: string;
          $lte: string;
        };
        const label = `${preset} @ ${now.toString()}`;
        expect(daysBetween(previous.$lte, current.$gte), label).toBe(1);
        if (/_days$|^today$|^yesterday$|_week$/.test(preset)) {
          // A rolling window, a day or a week: the same number of days.
          expect(daysBetween(previous.$gte, previous.$lte), label).toBe(daysBetween(current.$gte, current.$lte));
        } else {
          // A month, quarter or year: the whole period just before, from its first day.
          expect(previous.$gte.endsWith('-01'), label).toBe(true);
        }
      }

      // previousYear from a leap day reads the year before on 28 February, so
      // a February window stays February (#30197).
      expect(
        shiftFilterByCompareTo(filter, { kind: 'previousYear' }, new Date(2028, 1, 29, 8, 0)),
        `${preset} previousYear @ 2028-02-29`,
      ).toEqual(resolveDateMacros(filter, new Date(2027, 1, 28, 8, 0)));
    },
  );

  it('an unknown preset name still misses, prototype member names included', () => {
    for (const preset of ['last_60_days', 'This_Month', 'constructor', 'toString', '__proto__']) {
      warn.mockClear();
      expect(buildFilterCondition(dateDef, { preset }), preset).toBeUndefined();
      expect(warn, preset).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0]), preset).toContain(`unknown date range preset "${preset}"`);
    }
  });

  it('a non-preset date default is not lifted to a preset, prototype member names included', () => {
    for (const defaultValue of ['last_60_days', 'constructor', 'toString']) {
      const [def] = resolveDashboardFilterDefs({
        globalFilters: [{ name: 'when', field: 'created_at', type: 'date', defaultValue }],
      } as any);
      expect(def.defaultValue, defaultValue).toBe(defaultValue);
    }
    const [def] = resolveDashboardFilterDefs({
      globalFilters: [{ name: 'when', field: 'created_at', type: 'date', defaultValue: 'this_quarter' }],
    } as any);
    expect(def.defaultValue).toEqual({ preset: 'this_quarter' });
  });
});

describe('a stored dashboard written in the {current_*} spelling still filters', () => {
  beforeEach(() => resetDashboardFilterWarnings());

  it('a custom range bounded by {current_*} tokens selects the same days as the preset', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const stored = { from: '{current_month_start}', to: '{current_month_end}' };
      const condition = buildFilterCondition(dateDef, stored);
      expect(condition).toEqual({ $gte: '{current_month_start}', $lte: '{current_month_end}' });
      for (const now of REFERENCE_NOWS) {
        expect(resolveDateMacros(condition, now)).toEqual(
          resolveDateMacros(buildFilterCondition(dateDef, { preset: 'this_month' }), now),
        );
      }
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('a date global filter defaulting to a {current_*} token keeps it and passes it through', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const [def] = resolveDashboardFilterDefs({
        globalFilters: [
          { name: 'opened', field: 'created_at', type: 'date', defaultValue: '{current_quarter_start}' },
        ],
      } as any);
      expect(def.defaultValue).toBe('{current_quarter_start}');
      const condition = buildFilterCondition(def, def.defaultValue);
      expect(condition).toBe('{current_quarter_start}');
      const now = new Date(2026, 6, 15, 10, 30);
      expect(resolveDateMacros(condition, now)).toBe('2026-07-01');
      expect(resolveDateMacros('{quarter_start}', now)).toBe('2026-07-01');
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
