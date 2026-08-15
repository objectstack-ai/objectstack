// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  DATE_RANGE_PRESETS,
  DATE_RANGE_PRESET_MACRO_WINDOWS,
  bareDateRangePresetComparandMessage,
  isDateRangePresetName,
} from './date-range-presets';
import { DATE_MACRO_WRAPPED_RE, isDateMacroToken } from './date-macros.zod';

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
    expect(message).toContain('#8793');           // attributable from the error alone
    // A calendar preset prescribes its window pair.
    const window = bareDateRangePresetComparandMessage('this_week', '$lt');
    expect(window).toContain('{week_start}');
    expect(window).toContain('{week_end}');
  });
});

describe('ui re-export stays the same declaration', () => {
  it('ui/dashboard.zod re-exports this vocabulary by reference', async () => {
    const ui = await import('../ui/dashboard.zod');
    expect(ui.DATE_RANGE_PRESETS).toBe(DATE_RANGE_PRESETS);
  });
});
