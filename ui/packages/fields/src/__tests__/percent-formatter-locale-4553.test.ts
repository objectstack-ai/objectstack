/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4553 phase 2 — `formatPercent` was the last formatter outside the
 * display-locale channel, and it was outside it in a different way from its
 * siblings.
 *
 * PR #4557 threaded the gantt tooltip's number and currency rows and measured
 * that percent could not follow: `formatPercent(value, precision)` took no
 * locale parameter, and its whole body was
 * `${percentDisplayValue(value).toFixed(precision)}%`. It built no
 * `Intl.NumberFormat` and never reached `formatDisplayNumber`, so its output
 * was not the MACHINE's locale (the defect its siblings had) but NO locale at
 * all: an ASCII decimal mark, never a grouping separator, byte-identical on
 * every machine on earth.
 *
 * That is why grouping and locale land together here. `1235%` is not merely
 * un-German — it is wrong in en-US too, where the number is `1,235%`. So the
 * English output MOVES, and that move is the fix, not a regression.
 *
 * ── Directions, predicted in writing BEFORE the run, then measured ───────
 * Runner: node v22.22.2 / ICU 78.2 / machine locale en-US.
 *
 *   en 1234.5 p0   `1235%`   → `1,235%`      RED — the grouping move
 *   de 1234.5 p0   `1235%`   → `1.235 %`     RED — separators inverted + NBSP
 *   de 80     p0   `80%`     → `80 %`        RED — de writes a no-break space
 *                                             before the sign; en does not
 *   de 12.5   p1   `12.5%`   → `12,5 %`      RED — the ruling's named form
 *   en 80     p0   `80%`     → `80%`         PIN, green both sides
 *   en 12.5   p1   `12.5%`   → `12.5%`       PIN, green both sides
 *   fraction scaling (0.8 → 80%)             PIN, green both sides
 *
 * The `en` pins are byte-identical because `en` and the runner's `en-US` agree
 * and because grouping only shows from four digits up — they are NOT evidence
 * the fix works; the `de` cases and the en GROUPING case carry that.
 *
 * Provider-less by construction (objectui#4514): these are pure-function cases
 * that touch no hook. The provider-mounted half of this card lives in
 * `PercentCellRenderer.locale.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import { formatPercent } from '../index';

/**
 * German puts a NO-BREAK SPACE (U+00A0) between the number and the percent
 * sign. Written as an escape rather than pasted, so the expectation is
 * readable and greppable in both spellings.
 */
const NBSP = '\u00a0';

describe('formatPercent groups its output (objectui#4553)', () => {
  /**
   * THE en RED CASE, and the one that justifies calling this a defect rather
   * than a localization nicety: four digits went out ungrouped in English too.
   */
  it('en groups from four digits up — the output MOVES, and that is the fix', () => {
    expect(formatPercent(1234.5, 'whole', 0, 'en')).toBe('1,235%');
    expect(formatPercent(1000000, 'whole', 0, 'en')).toBe('1,000,000%');
  });

  /** PIN, green both sides: below the grouping threshold nothing changes. */
  it('en output below the grouping threshold is byte-identical (must-not-change)', () => {
    expect(formatPercent(80, 'whole', 0, 'en')).toBe('80%');
    expect(formatPercent(12.5, 'whole', 1, 'en')).toBe('12.5%');
    expect(formatPercent(33.33, 'whole', 2, 'en')).toBe('33.33%');
    expect(formatPercent(0, 'fraction', 0, 'en')).toBe('0%');
  });
});

describe('formatPercent follows the display locale (objectui#4553)', () => {
  /**
   * The separators invert AND a no-break space appears before the sign, so the
   * German form cannot coincide with the machine's on this runner.
   */
  it('de inverts the separators and spaces the percent sign', () => {
    expect(formatPercent(1234.5, 'whole', 0, 'de')).toBe(`1.235${NBSP}%`);
    expect(formatPercent(12.5, 'whole', 1, 'de')).toBe(`12,5${NBSP}%`);
  });

  /**
   * Even with no separator in play, German still differs from English: the
   * space before the sign is part of the locale's percent CONVENTION, which is
   * what routing through `Intl` buys over appending a literal '%'.
   */
  it('de spaces the sign even for a value with no separators', () => {
    expect(formatPercent(80, 'whole', 0, 'de')).toBe(`80${NBSP}%`);
  });

  /** `Intl` accepts `'zh'` verbatim — no mapping table anywhere. */
  it('zh renders its own convention', () => {
    expect(formatPercent(1234.5, 'whole', 0, 'zh')).toBe('1,235%');
  });

  /**
   * A malformed tag from a tenant config must never take a cell down —
   * `formatDisplayNumber` catches it and retries without the locale.
   */
  it('a malformed locale tag falls back instead of throwing', () => {
    expect(() => formatPercent(80, 'whole', 0, 'not a locale')).not.toThrow();
    expect(formatPercent(80, 'whole', 0, 'not a locale')).toContain('80');
  });
});

describe('formatPercent keeps its existing contract (objectui#4553 must-not-change)', () => {
  /**
   * PIN: the fraction/whole scaling is `percentDisplayValue`'s, shared with the
   * dashboard measure formatter. The locale parameter must not have moved it.
   * Since objectui#11475 the storage is the caller's statement, not a guess
   * from the magnitude, so each call below names the storage it holds.
   */
  it('still scales a fraction-stored percent and passes a whole one through', () => {
    expect(formatPercent(0.8, 'fraction', 0, 'en')).toBe('80%');
    expect(formatPercent(0.5, 'fraction', 0, 'en')).toBe('50%');
    expect(formatPercent(0.075, 'fraction', 1, 'en')).toBe('7.5%');
    // Whole points are already in display magnitude and are NOT scaled again.
    expect(formatPercent(80, 'whole', 0, 'en')).toBe('80%');
    expect(formatPercent(100, 'whole', 0, 'en')).toBe('100%');
  });

  it('still honors the precision it is given', () => {
    expect(formatPercent(33.333, 'whole', 0, 'en')).toBe('33%');
    expect(formatPercent(33.333, 'whole', 1, 'en')).toBe('33.3%');
    expect(formatPercent(33.333, 'whole', 2, 'en')).toBe('33.33%');
  });

  it('still handles negatives', () => {
    expect(formatPercent(-45.5, 'whole', 1, 'en')).toBe('-45.5%');
  });

  /**
   * The locale parameter is OPTIONAL and last, matching `formatNumber(value,
   * decimals, locale)` and `formatCurrency(value, currency, locale)`. A caller
   * passing none still gets the runtime default locale — though it now also
   * gets grouping, which is the deliberate output move. Only the storage is
   * required (objectui#11475).
   */
  it('is callable with no locale, and with no precision either', () => {
    expect(() => formatPercent(80, 'whole')).not.toThrow();
    expect(formatPercent(80, 'whole')).toBe('80%');
    expect(formatPercent(80, 'whole', 0)).toBe('80%');
  });
});
