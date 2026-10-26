/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4576, asserted where the two surfaces can actually be compared.
 *
 * The card's complaint is a CROSS-PACKAGE one: the same stored number renders
 * `1.234,5 %` through `formatPercent` (this package, the list cell) and
 * `1.234,5%` through `formatMeasure` (`@object-ui/core`, the dashboard measure).
 * Neither package's own suite can see that — `core` sits below this one and
 * cannot import `formatPercent` — so the agreement is pinned here, the one
 * place both are in scope.
 *
 * This file adds no implementation. `formatPercent` was untouched by #4576; it
 * has rendered through `Intl` since #4553 / PR #4565 and was the SIDE the measure
 * formatter moved onto.
 *
 * ── objectui#4590 ──
 * The last case in this file was a NOT-a-defect pin recording that the two
 * surfaces still disagreed at rounding TIES. #4590 closed that at the
 * `formatPercent` end (it now renders percentage points directly, through the
 * same `style: 'percentPoints'` the measure uses), so that pin is now an
 * AGREEMENT pin. It is declared in place, at the case itself.
 *
 * ── PREDICTIONS, written before the run ──
 * RED before the fix: every locale whose percent convention has a space or a
 * different sign — de, fr, es, ru, tr, ar. `formatMeasure` returned a literal
 * '%' with no space, `formatPercent` returned the locale's convention.
 * GREEN on both sides: en-US, ja-JP, zh-CN, whose convention is a bare
 * trailing '%' — the must-not-change half, and the reason this was invisible in
 * an English session for three cards running.
 *
 * Runner measured: node v22.22.2, ICU 78.2, machine locale en-US.
 */

import { describe, it, expect } from 'vitest';
import { formatMeasure } from '@object-ui/core';
import { formatPercent } from '../index';

/**
 * Strip the digits out of a rendered percentage, leaving only the CONVENTION —
 * the sign, its position and any separator before it. Comparing conventions
 * rather than whole strings is deliberate: the two formatters are reached with
 * different scaling inputs and different decimal widths, and it is the
 * convention, not the digits, that #4576 is about.
 */
function convention(rendered: string): string {
  return rendered.replace(/[\d]/gu, '#').replace(/#+/gu, '#');
}

describe('a percent renders under ONE convention in a cell and in a measure (#4576)', () => {
  it.each([
    ['de-DE'],
    ['fr-FR'],
    ['es-ES'],
    ['ru-RU'],
    ['tr-TR'],
    ['ar-EG'],
    // must-not-change half — no space in the convention, identical before and after
    ['en-US'],
    ['ja-JP'],
    ['zh-CN'],
  ])('%s renders the same percent convention on both surfaces', (locale) => {
    // The same underlying value on both paths: `formatPercent` takes the STORED
    // value and scales it through `percentDisplayValue`; `formatMeasure` is
    // told the column is already in whole percentage points.
    const cell = formatPercent(0.805, 'fraction', 1, locale);
    const measure = formatMeasure(80.5, '0.0%', undefined, 'whole', locale);
    expect(convention(measure)).toBe(convention(cell));
  });

  it('the German case the card was filed for, spelled out', () => {
    // Both `1.234,5` followed by U+00A0 and the sign. Before #4576 the measure
    // had no space.
    expect(formatPercent(1234.5, 'whole', 1, 'de-DE')).toBe('1.234,5\u00a0%');
    expect(formatMeasure(1234.5, '0.0%', undefined, 'whole', 'de-DE')).toBe('1.234,5\u00a0%');
  });

  it('MUST NOT CHANGE: English was always identical on both paths, and stays so', () => {
    expect(formatPercent(1234.5, 'whole', 1, 'en-US')).toBe('1,234.5%');
    expect(formatMeasure(1234.5, '0.0%', undefined, 'whole', 'en-US')).toBe('1,234.5%');
  });

  it('AGREEMENT pin — the two now round ties the same way (was NOT-a-defect, closed by #4590)', () => {
    // ── PIN MOVED (objectui#4590) ──
    // This case was a NOT-a-defect pin: it asserted the two surfaces DISAGREED
    // at rounding ties, recorded honestly rather than omitted, and said the gap
    // was #4565's residue rather than #4576's business. #4590 closed it at the
    // `formatPercent` end, so the pin flips from recording a divergence to
    // asserting the agreement.
    //
    // Before:  formatPercent(1.005, 2, 'en-US')  ->  '1.00%'   (the artefact)
    //          formatMeasure(1.005, …)           ->  '1.01%'   (the faithful one)
    // After:   both -> '1.01%'.
    //
    // The cause was `formatPercent` dividing by 100 so `Intl`'s
    // `style: 'percent'` could multiply back — lossy at ties, because the
    // quotient's shortest decimal representation is not the authored one.
    // `formatMeasure` had already moved onto `style: 'percentPoints'` in #4576;
    // the cell now renders through the same option, so there is one route and
    // no second rounding behaviour to keep in step.
    expect(formatPercent(1.005, 'whole', 2, 'en-US')).toBe('1.01%');
    expect(formatMeasure(1.005, '0.00%', undefined, 'whole', 'en-US')).toBe('1.01%');
    // …and asserted as an AGREEMENT rather than two coincidences, so a future
    // divergence at either end fails here whatever the two happen to render.
    expect(formatPercent(1.005, 'whole', 2, 'en-US')).toBe(
      formatMeasure(1.005, '0.00%', undefined, 'whole', 'en-US'),
    );
  });
});
