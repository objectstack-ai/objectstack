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
// The compareTo case below runs on these only. A forward preset has no retired
// spelling to compare against, and compareTo on a forward window compares the
// window with itself, which #30140 tracks.
const RETIRED_PRESETS = [...DATE_RANGE_PRESETS].filter((p) => !FORWARD_PRESETS.includes(p));

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

  it.each(RETIRED_PRESETS)(
    '%s keeps its previous-period window and trend label for a compareTo widget',
    (preset) => {
      const retired = RETIRED_PRESET_RANGES[preset];
      const retiredFilter = { created_at: { $gte: retired.from, $lte: retired.to } };
      const filter = { created_at: buildFilterCondition(dateDef, { preset }) };
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
