/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4576 — `style: 'percentPoints'`, the option that lets a caller
 * holding percentage POINTS render the locale's percent convention without
 * `Intl`'s x100 re-scaling.
 *
 * The distinction is the whole of this card. `Intl`'s `style: 'percent'` wants a
 * FRACTION, so a caller with percentage points has to divide by 100 for `Intl`
 * to multiply straight back — and that round trip is lossy at rounding ties.
 * Both spellings exist here so the choice is made once, by name, at the call
 * site, instead of being re-derived (wrongly) at each one.
 *
 * ── PREDICTIONS, written before the run ──
 * The whole file is RED before the fix: `style: 'percentPoints'` does not exist
 * on `DisplayNumberFormatOptions`, so it fails to compile under `tsc` and every
 * case falls through to plain decimal formatting under vitest (`80` instead of
 * `80%`). The two `style: 'percent'` cases are the exception — they are GREEN on
 * both sides, and are here to pin the CONTRAST rather than the new behaviour.
 *
 * Every no-break space is written as a `\u00a0` escape, never as a raw byte.
 * Runner measured: node v22.22.2, ICU 78.2, machine locale en-US.
 */

import { describe, it, expect } from 'vitest';
import { formatDisplayNumber } from '../number-display';

describe('formatDisplayNumber — style: percentPoints (#4576)', () => {
  it('does NOT re-scale: 80 points renders as 80%, where style:percent would say 8,000%', () => {
    expect(formatDisplayNumber(80, { locale: 'en-US', style: 'percentPoints' })).toBe('80%');
    // GREEN on both sides — the contrast, not the new behaviour. `percent`
    // treats the same number as a fraction, which is what makes a caller
    // holding points need the other spelling.
    expect(formatDisplayNumber(80, { locale: 'en-US', style: 'percent' })).toBe('8,000%');
  });

  it('carries the locale percent CONVENTION, including the no-break space and the prefix position', () => {
    expect(
      formatDisplayNumber(1234.5, {
        locale: 'de-DE',
        style: 'percentPoints',
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    ).toBe('1.234,5\u00a0%');
    // Turkish moves the sign to the FRONT — unreachable by appending a literal.
    expect(
      formatDisplayNumber(1234.5, {
        locale: 'tr-TR',
        style: 'percentPoints',
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    ).toBe('%1.234,5');
    expect(
      formatDisplayNumber(1234.5, {
        locale: 'en-US',
        style: 'percentPoints',
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    ).toBe('1,234.5%');
  });

  it('produces the SAME percent affix as style:percent, across every locale the console ships', () => {
    // The structural claim behind the implementation choice: `style: 'unit'` /
    // `unit: 'percent'` was measured to give a byte-identical affix to
    // `style: 'percent'` across all 171 locale tags tested. These are the ten
    // the repo ships locale packs for, plus four whose convention differs most.
    const tags = ['en', 'zh', 'ja', 'ko', 'de', 'fr', 'es', 'pt', 'ru', 'ar',
                  'tr-TR', 'bn-IN', 'sv-SE', 'cs-CZ'];
    for (const locale of tags) {
      const points = formatDisplayNumber(1234.5, {
        locale,
        style: 'percentPoints',
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
      // The same magnitude expressed as a fraction, through `Intl`'s own percent.
      const fraction = new Intl.NumberFormat(locale, {
        style: 'percent',
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(12.345);
      expect(points, `affix parity for ${locale}`).toBe(fraction);
    }
  });

  it('keeps the AUTHORED decimal at rounding ties, where the /100 round trip does not', () => {
    // Measured on objectui#4576's tie-dense grid (0.005 steps to 2,000,
    // precisions 0/1/2) and on `formatDisplayNumber` / `formatMeasure`'s call
    // shape: 27,581 of 1,200,013 ordinary-magnitude en-US forms differ between
    // the two routes. These are three of them. (objectui#4590 re-measured the
    // same route through `formatPercent` and reports 27,577 of 1,200,003 — a
    // different form set, not a correction of this one.)
    for (const [value, digits, expected] of [
      [0.175, 2, '0.18%'],
      [0.305, 2, '0.31%'],
      [0.35, 1, '0.4%'],
    ] as const) {
      expect(
        formatDisplayNumber(value, {
          locale: 'en-US',
          style: 'percentPoints',
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        }),
      ).toBe(expected);
      // and the route this option exists to avoid, shown failing to agree
      expect(
        new Intl.NumberFormat('en-US', {
          style: 'percent',
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        }).format(value / 100),
      ).not.toBe(expected);
    }
  });

  it('keeps every digit at the top of the double range', () => {
    expect(
      formatDisplayNumber(Number.MAX_SAFE_INTEGER, { locale: 'en-US', style: 'percentPoints' }),
    ).toBe('9,007,199,254,740,991%');
    expect(formatDisplayNumber(1e23, { locale: 'en-US', style: 'percentPoints' })).toBe(
      '100,000,000,000,000,000,000,000%',
    );
  });

  it('still survives a malformed locale tag by retrying without it', () => {
    // `en_US` (underscore) throws from a bare `Intl.NumberFormat`; the retry is
    // the one in `formatDisplayNumber`, shared with every other style.
    expect(() => formatDisplayNumber(50, { locale: 'en_US', style: 'percentPoints' })).not.toThrow();
    expect(formatDisplayNumber(50, { locale: 'en_US', style: 'percentPoints' })).toBe('50%');
  });

  it('a declared currency still wins — money is never a percentage', () => {
    // Nothing in the repo passes both; the pin records which one governs so a
    // future caller cannot discover it by accident.
    expect(
      formatDisplayNumber(1234.5, {
        locale: 'en-US',
        style: 'percentPoints',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    ).toBe('$1,234.50');
  });

  it('the grouping policy applies to percentages as it does to everything else', () => {
    // scale 0 with no currency is an ordinal → ungrouped, in this style too.
    expect(
      formatDisplayNumber(1234, { locale: 'en-US', style: 'percentPoints', scale: 0 }),
    ).toBe('1234%');
    expect(formatDisplayNumber(1234, { locale: 'en-US', style: 'percentPoints' })).toBe('1,234%');
  });
});
