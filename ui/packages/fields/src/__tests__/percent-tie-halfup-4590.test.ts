/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4590 — `formatPercent` rounds a tie the wrong way, because it renders
 * a value that is ALREADY in percentage points through `Intl`'s
 * `style: 'percent'`, which wants a FRACTION.
 *
 * The old body divided by 100 so `Intl` could multiply straight back:
 *
 *     formatDisplayNumber(displayValue / 100, { style: 'percent', … })
 *
 * That round trip is not value-preserving. `Intl` formats from the SHORTEST
 * decimal representation of the double it is handed, and `displayValue / 100`
 * has a different shortest representation from `displayValue`: `1.005` is
 * `1.005`, but `1.005 / 100` is `0.010049999999999999`, which percent-scales to
 * `1.0049999999999999` and rounds DOWN. The DIVISION loses the digit, not the
 * rounding. It is therefore a numeral defect and not a convention one — it
 * reproduces identically in every locale, in Arabic-Indic digits too.
 *
 * The fix is the option #4576 / PR #4589 put in `@object-ui/core` for exactly
 * this: `style: 'percentPoints'` formats the points DIRECTLY (`Intl`'s
 * `style: 'unit'` / `unit: 'percent'` / `unitDisplay: 'narrow'`), which was
 * measured to give a byte-identical percent affix to `style: 'percent'` across
 * all 171 locale tags tested.
 *
 * ── PREDICTIONS, written before the run ─────────────────────────────────────
 * Runner measured: node v22.22.2, ICU 78.2, machine locale en-US.
 *
 *   RED before the fix — the numerals:
 *     formatPercent(1.005, 2, 'en-US')   `1.00%`  → `1.01%`
 *     formatPercent(1.025, 2, 'en-US')   `1.02%`  → `1.03%`
 *     formatPercent(1.45,  1, 'en-US')   `1.4%`   → `1.5%`
 *     formatPercent(1.055, 2, 'en-US')   `1.05%`  → `1.06%`
 *     formatPercent(99999.995, 2, 'en')  `99,999.99%` → `100,000.00%`
 *     MAX_SAFE_INTEGER p0   `9,007,199,254,740,990%` → `…991%`
 *     1e23            p0    `99,999,999,999,999,990,000,000%`
 *                           → `100,000,000,000,000,000,000,000%`
 *     the same four ties in de-DE / tr-TR / ar-EG — the locale-independence
 *     claim, red in every one of them
 *
 *   GREEN ON BOTH SIDES — the must-not-change set, and the STOP condition if
 *   any of it moves (this card is NUMERAL-only; a convention move is a defect
 *   in the fix, not a pin to update):
 *     the percent CONVENTION of all ten locales at 1234.5 p1 — de/fr/ru/sv's
 *     no-break space, tr's PREFIX sign, ar's U+066A + U+061C, en/ja/zh's bare
 *     suffix, fr's U+202F group separator, bn's Bengali digits
 *     the sign position and glyph on negatives (sv-SE's U+2212 included)
 *     the affix parity check against `Intl`'s own `style: 'percent'`
 *     `percentDisplayValue`'s fraction/whole scaling — upstream of the render
 *     and deliberately untouched by this card
 *
 * MEASURED, this call shape, old route vs new: 10 locales x 18 values x 4
 * precisions = 720 combinations — 0 convention diffs, 130 numeral diffs (13 per
 * locale, the SAME 13 in every locale). On the wide en-US grid the issue
 * quantified (0.005 steps to 2000, precisions 0/1/2) 27,577 of 1,200,003 forms
 * move. Every one is a last-digit-off-by-one.
 *
 * Every non-ASCII byte below is written as a `\u` escape, never pasted.
 */

import { describe, it, expect } from 'vitest';
import { formatPercent } from '../index';

/** U+00A0 NO-BREAK SPACE — de/fr/ru/sv put one before the percent sign. */
const NBSP = '\u00a0';
/** U+202F NARROW NO-BREAK SPACE — fr's group separator. */
const NNBSP = '\u202f';
/** U+066A ARABIC PERCENT SIGN, U+061C ARABIC LETTER MARK. */
const ARABIC_PERCENT = '\u066a';
const ALM = '\u061c';

describe('formatPercent rounds a tie half-up on the authored decimal (#4590)', () => {
  /**
   * MOVING PINS — the issue's measured table, verbatim. Each was the artefact
   * of the `/ 100` round trip; the right-hand column is half-up on the decimal
   * the author actually wrote.
   */
  it.each([
    [1.005, 2, '1.01%', '1.00%'],
    [1.025, 2, '1.03%', '1.02%'],
    [1.45, 1, '1.5%', '1.4%'],
    [1.055, 2, '1.06%', '1.05%'],
  ])('formatPercent(%s, %s) is %s (was %s)', (value, precision, expected) => {
    // Every row is already in percentage points (objectui#11475 made the
    // storage an argument; these rows were always the whole-points arm).
    expect(formatPercent(value, 'whole', precision, 'en-US')).toBe(expected);
  });

  /**
   * A tie that carries into a new digit COLUMN rather than just flipping the
   * last one — the round trip lost the carry as well as the digit.
   */
  it('carries across the grouping boundary: 99999.995 to 2 decimals', () => {
    // was `99,999.99%`
    expect(formatPercent(99999.995, 'whole', 2, 'en-US')).toBe('100,000.00%');
  });

  /**
   * The defect is in the VALUE, not the convention, so it must reproduce in
   * every locale — including one that writes the sign in front and one that
   * uses neither ASCII digits nor an ASCII sign.
   */
  it('the same ties move in every locale — this is a numeral defect', () => {
    expect(formatPercent(1.005, 'whole', 2, 'de-DE')).toBe(`1,01${NBSP}%`); // was `1,00 %`
    expect(formatPercent(1.45, 'whole', 1, 'de-DE')).toBe(`1,5${NBSP}%`); // was `1,4 %`
    expect(formatPercent(1.005, 'whole', 2, 'tr-TR')).toBe('%1,01'); // was `%1,00`
    // U+0661 U+066B U+0660 U+0661 — Arabic-Indic `1`, decimal separator, `0`, `1`
    expect(formatPercent(1.005, 'whole', 2, 'ar-EG')).toBe(
      `\u0661\u066b\u0660\u0661${ARABIC_PERCENT}${ALM}`,
    ); // was `\u0661\u066b\u0660\u0660` + the same affix
  });
});

describe('formatPercent keeps every digit at the top of the double range (#4590)', () => {
  /**
   * MOVING PINS, before/after verbatim. `Number.MAX_SAFE_INTEGER` percentage
   * points used to render with its last digit replaced by a zero, and 1e23 used
   * to render as a number that is not 1e23 at all. Both are the same artefact
   * as the ties, at the other end of the range: divide by 100 and the shortest
   * representation of the quotient no longer round-trips.
   */
  it('MAX_SAFE_INTEGER keeps its last digit', () => {
    // was `9,007,199,254,740,990%` — a 1 turned into a 0
    expect(formatPercent(Number.MAX_SAFE_INTEGER, 'whole', 0, 'en-US')).toBe('9,007,199,254,740,991%');
  });

  it('1e23 renders as 1e23', () => {
    // was `99,999,999,999,999,990,000,000%`
    expect(formatPercent(1e23, 'whole', 0, 'en-US')).toBe('100,000,000,000,000,000,000,000%');
  });
});

describe('MUST NOT CHANGE: the locale percent CONVENTION (#4590 is numeral-only)', () => {
  /**
   * The affix is what `style: 'percentPoints'` promises to preserve, so this is
   * the half that proves the fix did not become a convention change. Byte-exact
   * strings, chosen at a magnitude and precision where no tie is in play — they
   * are GREEN on both sides of the fix, and a diff here is a STOP condition.
   */
  it.each([
    ['en-US', '1,234.5%'],
    ['de-DE', `1.234,5${NBSP}%`],
    ['fr-FR', `1${NNBSP}234,5${NBSP}%`],
    ['tr-TR', '%1.234,5'], // sign in FRONT
    ['ar-EG', `\u0661\u066c\u0662\u0663\u0664\u066b\u0665${ARABIC_PERCENT}${ALM}`],
    ['ja-JP', '1,234.5%'],
    ['zh-CN', '1,234.5%'],
    ['ru-RU', `1${NBSP}234,5${NBSP}%`],
    ['sv-SE', `1${NBSP}234,5${NBSP}%`],
    ['bn-IN', `\u09e7,\u09e8\u09e9\u09ea.\u09eb%`],
  ])('%s renders its own percent convention, unchanged', (locale, expected) => {
    expect(formatPercent(1234.5, 'whole', 1, locale)).toBe(expected);
  });

  /**
   * Sign POSITION and sign GLYPH are convention too — Turkish puts the minus
   * outside its prefixed percent sign, Arabic leads with U+061C, and Swedish
   * uses U+2212 MINUS SIGN rather than ASCII hyphen-minus. None of it moves.
   */
  it.each([
    ['en-US', '-45.5%'],
    ['de-DE', `-45,5${NBSP}%`],
    ['tr-TR', '-%45,5'],
    ['ar-EG', `${ALM}-\u0664\u0665\u066b\u0665${ARABIC_PERCENT}${ALM}`],
    ['sv-SE', `\u221245,5${NBSP}%`],
  ])('%s keeps its negative-sign convention', (locale, expected) => {
    expect(formatPercent(-45.5, 'whole', 1, locale)).toBe(expected);
  });

  /**
   * The parity claim asserted rather than trusted: the affix `formatPercent`
   * now produces must be the one `Intl`'s OWN `style: 'percent'` produces for
   * the same locale. Comparing the affix alone (digits stripped) is deliberate
   * — the numerals are exactly what this card moves, so a whole-string compare
   * would re-assert the defect.
   */
  it('the affix is byte-identical to Intl style:percent, for every locale here', () => {
    const affix = (rendered: string) => rendered.replace(/[\p{Nd}]/gu, '');
    for (const locale of ['en-US', 'de-DE', 'fr-FR', 'tr-TR', 'ar-EG', 'ja-JP',
                          'zh-CN', 'ru-RU', 'sv-SE', 'bn-IN']) {
      const cell = formatPercent(1234.5, 'whole', 1, locale);
      const intl = new Intl.NumberFormat(locale, {
        style: 'percent',
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(12.345);
      expect(affix(cell), `percent affix for ${locale}`).toBe(affix(intl));
    }
  });
});

describe('MUST NOT CHANGE: percent SCALING is upstream of the render (#4590)', () => {
  /**
   * The SCALING decides WHICH number gets rendered; this card changes only HOW
   * that number is rendered. Pinned so a future reader cannot mistake the two
   * halves for one.
   *
   * objectui#11475 moved the scaling's INPUT: it was a guess from the value's
   * magnitude (a stored fraction below 1 scaled by 100, a value at or above 1
   * passed through), and it is now the storage the caller states. The render
   * half below is untouched by that.
   */
  it('a stored fraction still scales, a stored whole number still does not', () => {
    expect(formatPercent(0.8, 'fraction', 0, 'en-US')).toBe('80%');
    expect(formatPercent(0.5, 'fraction', 0, 'en-US')).toBe('50%');
    expect(formatPercent(0.075, 'fraction', 1, 'en-US')).toBe('7.5%');
    expect(formatPercent(80, 'whole', 0, 'en-US')).toBe('80%');
    expect(formatPercent(100, 'whole', 0, 'en-US')).toBe('100%');
    // There is no boundary any more (objectui#11475): a `1` is 1% when the
    // storage is whole points and 100% when it is a fraction.
    expect(formatPercent(1, 'whole', 0, 'en-US')).toBe('1%');
    expect(formatPercent(1, 'fraction', 0, 'en-US')).toBe('100%');
    // The tie cases above are whole points, authored just above 1.
    expect(formatPercent(0.9999, 'fraction', 0, 'en-US')).toBe('100%');
  });

  it('a malformed locale tag still falls back instead of throwing', () => {
    expect(() => formatPercent(80, 'whole', 0, 'not a locale')).not.toThrow();
    expect(formatPercent(80, 'whole', 0, 'not a locale')).toContain('80');
  });

  it('is still callable with no locale and no precision', () => {
    expect(formatPercent(80, 'whole')).toBe('80%');
    expect(formatPercent(80, 'whole', 0)).toBe('80%');
  });
});
