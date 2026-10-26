/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4576 — a percent renders as `1.234,5 %` in a list cell and
 * `1.234,5%` as a dashboard measure. Two conventions for one number.
 *
 * `formatPercent` (`@object-ui/fields`) has gone through `Intl` since #4553, so
 * it gets the locale's percent CONVENTION — German writes a no-break space
 * before the sign. `formatMeasure` appended a LITERAL '%' to a decimal body, so
 * it got no space in any locale. The SCALING already agreed (both go through
 * `percentDisplayValue`); the CONVENTION did not, which is exactly what
 * `percentDisplayValue`'s doc comment promises can never happen.
 *
 * ── PREDICTIONS, written before the run ──
 * Reverse verification takes the fix out (`git diff` to a patch +
 * `git checkout --`, never `git stash`) and keeps these expectations.
 *
 * RED before the fix (the convention move):
 *   - every de-DE / fr-FR / ru-RU / es-ES case — they gain U+00A0 before '%'
 *   - the tr-TR case — the sign moves to the FRONT of the number
 *   - the ar-EG case — its own percent sign (U+066A) plus U+061C, not ASCII '%'
 *   - the cross-surface agreement cases, which is the card's actual complaint
 *
 * GREEN on BOTH sides (must-not-change pins, each labelled in place):
 *   - every en-US case, ordinary magnitude AND extreme — this is the discriminator
 *   - ja-JP / zh-CN, whose percent convention has no space either
 *   - the rounding-tie cases, which pin the route NOT taken (see below)
 *
 * Every case pins at least one locale whose convention has a space AND en-US,
 * because a lone de assertion is not falsifiable on a German runner. Runner
 * measured: node v22.22.2, ICU 78.2, machine locale en-US.
 *
 * ⚠️ The en cases are not decoration. The obvious way to adopt the locale's
 * convention is `Intl`'s `style: 'percent'`, but that style wants a FRACTION,
 * so a value already in percentage points must be divided by 100 for `Intl` to
 * multiply it straight back, and that round trip is lossy at rounding TIES.
 * Measured on this runner, on #4576's tie-dense grid (0.005 steps to 2,000,
 * precisions 0/1/2) and on `formatMeasure`'s call shape: 27,581 of 1,200,013
 * ordinary-magnitude en-US forms move that way (`0.175` at 2 decimals goes from
 * `0.18%` to `0.17%`), plus `MAX_SAFE_INTEGER` and everything from 1e23 up.
 * (#4590 re-measured the same route through `formatPercent` and reports 27,577
 * of 1,200,003 — a different form set, not a correction of this one.) The
 * implementation formats the percentage points DIRECTLY with the percent unit
 * instead, which was measured byte-identical on the affix across all 171 locale
 * tags tested and moves none of those 1,200,013 forms.
 *
 * No caller takes the divide-by-100 route today: `formatPercent` used to, and
 * moved to `style: 'percentPoints'` in #4590, so the route now survives only
 * where a test builds it in order to show it disagreeing. The tie and
 * extreme-magnitude cases below are what keep it that way: they go red if
 * anyone "simplifies" this into the divide-by-100 form.
 */

import { describe, it, expect } from 'vitest';
import { formatMeasure } from '../dataset-format';

// The locale's own percent affix, taken from `Intl` rather than hardcoded — the
// same CLDR convention both surfaces render, so comparing against it is a
// structural pin on "both surfaces use the locale's convention" rather than a
// restatement of today's CLDR data. Since #4590 the two reach that convention
// by different `Intl` options — `style: 'percent'` here, `style: 'percentPoints'`
// in both `formatMeasure` and `formatPercent` — and those were measured to
// produce a byte-identical affix across all 171 locale tags tested, so this
// stays a cross-route parity check rather than a tautology.
function percentAffix(locale: string): { prefix: string; suffix: string } {
  let prefix = '';
  let suffix = '';
  let seenNumber = false;
  for (const part of new Intl.NumberFormat(locale, { style: 'percent' }).formatToParts(1234.5)) {
    if (part.type === 'integer' || part.type === 'group' || part.type === 'decimal' || part.type === 'fraction') {
      seenNumber = true;
      continue;
    }
    if (part.type === 'minusSign' || part.type === 'plusSign') continue;
    if (seenNumber) suffix += part.value;
    else prefix += part.value;
  }
  return { prefix, suffix };
}

describe('formatMeasure percent — the locale\'s convention, not a literal sign (#4576)', () => {
  it('German puts a no-break space before the sign, as the list cell already did', () => {
    // U+00A0 written as an escape, never as a raw byte.
    expect(formatMeasure(0.608_333_333, '0.0%', undefined, undefined, 'de-DE')).toBe('60,8\u00a0%');
    expect(formatMeasure(1, '0.0%', undefined, 'fraction', 'de-DE')).toBe('100,0\u00a0%');
    expect(formatMeasure(80, '0.0%', undefined, 'whole', 'de-DE')).toBe('80,0\u00a0%');
    // en-US pinned alongside so the case is falsifiable on a German runner.
    expect(formatMeasure(0.608_333_333, '0.0%', undefined, undefined, 'en-US')).toBe('60.8%');
  });

  it('French and Russian do the same; Spanish too', () => {
    // fr-FR groups with U+202F (narrow no-break space) and spaces the sign with U+00A0.
    expect(formatMeasure(1234.5, '0.0%', undefined, 'whole', 'fr-FR')).toBe('1\u202f234,5\u00a0%');
    expect(formatMeasure(1234.5, '0.0%', undefined, 'whole', 'ru-RU')).toBe('1\u00a0234,5\u00a0%');
    expect(formatMeasure(1234.5, '0.0%', undefined, 'whole', 'es-ES')).toBe('1234,5\u00a0%');
    expect(formatMeasure(1234.5, '0.0%', undefined, 'whole', 'en-US')).toBe('1,234.5%');
  });

  it('Turkish puts the sign in FRONT — a convention a literal suffix can never reach', () => {
    // The strongest case in the file: no amount of "append '%'" produces this,
    // so it cannot pass by accident.
    expect(formatMeasure(1234.5, '0.0%', undefined, 'whole', 'tr-TR')).toBe('%1.234,5');
  });

  it('Arabic uses its OWN percent sign, not ASCII "%"', () => {
    const out = formatMeasure(50, '0%', undefined, 'whole', 'ar-EG');
    // U+066A ARABIC PERCENT SIGN, then U+061C ARABIC LETTER MARK.
    expect(out).toContain('\u066a');
    expect(out).not.toContain('%');
  });

  it('agrees with the locale\'s percent affix — the same one the list cell renders through', () => {
    for (const locale of ['de-DE', 'fr-FR', 'tr-TR', 'ar-EG', 'en-US', 'ja-JP', 'zh-CN']) {
      const { prefix, suffix } = percentAffix(locale);
      const out = formatMeasure(1234.5, '0.0%', undefined, 'whole', locale);
      expect(out.startsWith(prefix), `${locale} prefix`).toBe(true);
      expect(out.endsWith(suffix), `${locale} suffix`).toBe(true);
    }
  });

  // ── must-not-change pins ────────────────────────────────────────────────
  // GREEN on both sides of the fix. They are the discriminator: this card
  // changes a rendering CONVENTION, and English has no space in its convention,
  // so English must not move at all.

  it('MUST NOT CHANGE: ordinary-magnitude en-US is byte-identical', () => {
    // objectui#11475: a column the server does not annotate reads its `%`
    // pattern as a fraction (numeral's reading), so the whole-points rows say
    // `whole` the way the server annotates them; their bytes are unchanged.
    expect(formatMeasure(50, '0%', undefined, 'whole')).toBe('50%');
    expect(formatMeasure(0.75, '0%')).toBe('75%');
    expect(formatMeasure(0.608_333_333, '0.0%')).toBe('60.8%');
    expect(formatMeasure(0, '0%')).toBe('0%');
    expect(formatMeasure(1, '0%', undefined, 'whole')).toBe('1%');
    expect(formatMeasure(1, '0.0%', undefined, 'fraction')).toBe('100.0%');
    expect(formatMeasure(0.6667, '0.0%', undefined, 'fraction')).toBe('66.7%');
    expect(formatMeasure(0, '0.0%', undefined, 'fraction')).toBe('0.0%');
    expect(formatMeasure(1, '0.0%', undefined, 'whole')).toBe('1.0%');
    expect(formatMeasure(0.5, '0.0%', undefined, 'whole')).toBe('0.5%');
    expect(formatMeasure(80, '0.0%', undefined, 'whole')).toBe('80.0%');
    expect(formatMeasure(1234.5, '0.0%', undefined, 'whole', 'en-US')).toBe('1,234.5%');
  });

  it('MUST NOT CHANGE: ja-JP and zh-CN have no space in their convention either', () => {
    expect(formatMeasure(1234.5, '0.0%', undefined, 'whole', 'ja-JP')).toBe('1,234.5%');
    expect(formatMeasure(1234.5, '0.0%', undefined, 'whole', 'zh-CN')).toBe('1,234.5%');
  });

  it('MUST NOT CHANGE: rounding ties keep the AUTHORED decimal (the /100 route is refused)', () => {
    // 0.175 percentage points at 2 decimals. Formatted directly this is
    // `0.18%`. Divided by 100 for `Intl`'s `style: 'percent'` to multiply back,
    // the double lands below the tie and it becomes `0.17%`. This case is the
    // pin on which route is taken — it goes red the moment someone rewrites
    // this path as `style: 'percent'` on `display / 100`.
    expect(formatMeasure(0.175, '0.00%', undefined, 'whole')).toBe('0.18%');
    expect(formatMeasure(0.305, '0.00%', undefined, 'whole')).toBe('0.31%');
    expect(formatMeasure(0.35, '0.0%', undefined, 'whole')).toBe('0.4%');
  });

  it('a tie keeps its digits AND gains the German space \u2014 both halves at once', () => {
    // Deliberately NOT filed under "MUST NOT CHANGE": the German form moves
    // (it gains U+00A0), so this case is RED before the fix. Its job is to show
    // the two properties are independent \u2014 adopting the convention did not cost
    // the digits, which is the whole argument for the route taken.
    expect(formatMeasure(0.175, '0.00%', undefined, 'whole', 'de-DE')).toBe('0,18\u00a0%');
    expect(formatMeasure(0.175, '0.00%', undefined, 'whole', 'en-US')).toBe('0.18%');
  });

  it('MUST NOT CHANGE: extreme magnitudes keep every digit', () => {
    // The `/100` round trip corrupts both of these (measured:
    // `9,007,199,254,740,990%` and `99,999,999,999,999,990,000,000%`).
    // #4577 measured 24 of its 32,760 combinations moving that way and declined
    // the swap for it; this implementation does not move them at all.
    expect(formatMeasure(Number.MAX_SAFE_INTEGER, '0%', undefined, 'whole')).toBe(
      '9,007,199,254,740,991%',
    );
    expect(formatMeasure(1e21, '0%', undefined, 'fraction')).toBe(
      '100,000,000,000,000,000,000,000%',
    );
  });

  it('MUST NOT CHANGE: non-percent formats gain no sign, and the legacy "$" literal still leads', () => {
    expect(formatMeasure(1234.5, '0,0')).toBe('1,235');
    expect(formatMeasure(1234.5, '$0.0')).toBe('$1,234.5');
    expect(formatMeasure(1234.5, '$0.0%', undefined, 'whole')).toBe('$1,234.5%');
  });

  it('the legacy "$" literal still leads a German percent too \u2014 it sits OUTSIDE the affix', () => {
    // RED before the fix (the German form gains U+00A0). Pinned separately from
    // the must-not-change case above so that label stays honest.
    expect(formatMeasure(1234.5, '$0.0%', undefined, 'whole', 'de-DE')).toBe('$1.234,5\u00a0%');
  });

  it('MUST NOT CHANGE: a malformed locale tag degrades instead of throwing', () => {
    // `en_US` (underscore) is the likeliest tenant-config typo and throws from a
    // bare `Intl.NumberFormat`. The retry lives in `formatDisplayNumber`.
    expect(() => formatMeasure(50, '0%', undefined, 'whole', 'en_US')).not.toThrow();
    expect(formatMeasure(50, '0%', undefined, 'whole', 'en_US')).toMatch(/50.?%|%.?50/u);
  });
});
