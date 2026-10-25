/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9269 — the grid column-summary footer's percent branch stops
 * re-spelling `percentDisplayValue` and stops appending a literal '%'.
 *
 * `formatSummaryLabel`'s `colType === 'percent'` arm held a hand-inlined copy
 * of the declared source's body plus an ASCII percent sign:
 *
 *   const decimals = column?.precision ?? 0;
 *   const pct = (value > -1 && value < 1) ? value * 100 : value;
 *   formatted = `${pct.toFixed(decimals)}%`;
 *
 * ⚠️ That block is quoted as HISTORY and left verbatim. Line 1 has since
 * moved again: objectui#9295 answered the member question this card fenced,
 * and the arm now reads `column?.scale ?? 0`.
 *
 * Line 2 is `percentDisplayValue` in `@object-ui/core` character for
 * character, so the SCALING agreed — by duplication, not by reference. The
 * CONVENTION was not taken at all. `percentDisplayValue`'s own doc comment
 * makes that the judgement rather than a style preference: "If a third surface
 * ever needs percent display, it takes BOTH halves from here — the scaling AND
 * the convention — or this promise breaks again in the same place."
 *
 * ── What this file measures ─────────────────────────────────────────────
 * The claim is AGREEMENT BETWEEN TWO SURFACES — the footer and the list cell
 * directly above it — so every moving row compares the hook's own label
 * against the declared source computed in the same run (`formatPercent`, which
 * applies `percentDisplayValue` and renders through the locale's percent
 * affix). A hand-written expected string would restate one side and could not
 * fail for the reason the card names.
 *
 * ⭐ A two-surface comparison is blind to a JOINT move: a repair that dragged
 * both sides would keep the equality true. That is what the absolute-byte
 * controls are for, and it is the one place a literal is the right instrument.
 *
 * ── Which rows can actually fire ────────────────────────────────────────
 * ⛔ The `en` rows below four digits are NOT controls for this card: a bare
 * '%' and the locale affix coincide there, so they read the same either way.
 * They are overshoot detectors, pinned to exact bytes. The rows that MOVE —
 * and therefore the ones that measure the repair — are `de-DE` (no-break space
 * before the sign), `tr-TR` (the sign moves to the FRONT of the number) and
 * four-digit `en` (grouping).
 *
 * ── Directions, predicted in writing BEFORE the first run ───────────────
 *   en 0.25 / 1 / -5 / 12.3     GREEN on the base tree — sanity, not controls
 *   en 1234.5                   RED on the base tree  (1235%  -> 1,235%)
 *   de-DE 0.25 / 1234.5         RED on the base tree  (25%    -> 25 %,
 *                                                      1235%  -> 1.235 %)
 *   tr-TR 0.25 / 1234.5         RED on the base tree  (25%    -> %25,
 *                                                      1235%  -> %1.235)
 *   the prefix guard            GREEN on the base tree
 */

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderHook } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { formatPercent } from '@object-ui/fields';
import { percentDisplayValue } from '@object-ui/core';
import { useColumnSummary } from '../useColumnSummary';

/**
 * The UI language is held at `en` while the TENANT locale moves. That is the
 * real precedence `useDisplayLocale` implements (tenant locale outranks UI
 * language), and holding the language still keeps the footer's PREFIX in
 * English so the assertions below can name the whole label rather than
 * fishing a substring out of it.
 */
function wrapper(locale: string) {
  return ({ children }: { children: React.ReactNode }) => (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <LocalizationProvider value={{ locale }}>{children}</LocalizationProvider>
    </I18nProvider>
  );
}

/** The footer label the hook itself produces for a one-row percent column. */
function summaryLabel(
  stored: number,
  locale: string,
  column: Record<string, unknown> = {},
  fieldMetadata?: Record<string, Record<string, unknown>>,
): string {
  const cols: any[] = [{ field: 'rate', summary: 'sum', type: 'percent', ...column }];
  const { result } = renderHook(() => useColumnSummary(cols, [{ rate: stored }], fieldMetadata as never), {
    wrapper: wrapper(locale),
  });
  return result.current.summaries.get('rate')?.label ?? '';
}

/**
 * objectui#11475 — the column above declares no field, so it reads the spec's
 * answer for a percent that declares nothing: a FRACTION. A row that means
 * percentage POINTS says so the way a field does, with `max: 100`, read off the
 * field metadata (the footer reads `max` from the field only).
 */
const WHOLE = { rate: { type: 'percent', max: 100 } };

/**
 * The prefix is MEASURED, not assumed.
 *
 * Every expectation below is spelled `PREFIX + <the declared source's bytes>`,
 * so a bundle change to `grid.summary.sum` / `grid.summary.pattern` would
 * otherwise reach this file as a percent failure. Reading it off a column with
 * no percent type at all keeps the two concerns separable: if this case is the
 * red one, the prefix moved and the percent arm is not implicated.
 */
const PREFIX = 'Sum: ';

describe('the grid summary percent arm takes BOTH halves from the declared source (objectui#9269)', () => {
  it('the label prefix this file builds on is the one the bundle produces', () => {
    const cols: any[] = [{ field: 'rate', summary: 'sum' }];
    const { result } = renderHook(() => useColumnSummary(cols, [{ rate: 25 }]), {
      wrapper: wrapper('en'),
    });
    expect(result.current.summaries.get('rate')?.label).toBe(`${PREFIX}25`);
  });

  /**
   * The card's nine-row table, asserted as an agreement table. The right-hand
   * side is COMPUTED from the declared source in the same run, so each row
   * measures the footer against the list-cell path rather than against a
   * literal this file chose.
   */
  it.each([
    ['en', 0.25],
    ['en', 1],
    ['en', -5],
    ['en', 12.3],
    ['en', 1234.5],
    ['de-DE', 0.25],
    ['de-DE', 1234.5],
    ['tr-TR', 0.25],
    ['tr-TR', 1234.5],
  ])('%s / stored %p reads the same in the footer as at the declared source', (locale, stored) => {
    expect(summaryLabel(stored, locale)).toBe(`${PREFIX}${formatPercent(stored, 'fraction', 0, locale)}`);
    expect(summaryLabel(stored, locale, {}, WHOLE)).toBe(`${PREFIX}${formatPercent(stored, 'whole', 0, locale)}`);
  });

  /**
   * ⭐ THE ROWS THAT MOVE, each with the negative that names what was retired.
   *
   * The retired spelling is reconstructed here from `percentDisplayValue` plus
   * a literal '%' — exactly the two halves the deleted expression held — so
   * these lines fail if the arm ever grows a second local affix rule again,
   * and they are the only lines in this file that can distinguish "took the
   * convention" from "kept the scaling".
   *
   * ⛔ Deliberately no `en` row below four digits here: `25%` is BOTH the
   * retired spelling and the declared one, so such a row could not fail.
   */
  it.each([
    ['en', 1234.5],
    ['de-DE', 0.25],
    ['de-DE', 1234.5],
    ['tr-TR', 0.25],
    ['tr-TR', 1234.5],
  ])('%s / stored %p no longer reads as the inlined expression plus a literal sign', (locale, stored) => {
    const retired = `${PREFIX}${percentDisplayValue(stored, 'fraction').toFixed(0)}%`;
    expect(summaryLabel(stored, locale)).not.toBe(retired);
  });

  /**
   * `tr-TR` on its own, as bytes.
   *
   * It is the row that cannot pass by accident: the percent sign is on the
   * OTHER SIDE of the number, so no spacing or separator coincidence can make
   * the old output equal the new one. Spelled as an absolute as well as an
   * agreement, because an agreement alone would survive a joint move.
   */
  it('tr-TR puts the percent sign in FRONT, as the declared source does', () => {
    expect(summaryLabel(0.25, 'tr-TR')).toBe(`${PREFIX}%25`);
    expect(summaryLabel(1234.5, 'tr-TR', {}, WHOLE)).toBe(`${PREFIX}%1.235`);
  });

  /**
   * The overshoot detectors. These agree today and must still agree at the
   * SAME bytes afterwards — the `it.each` agreement table above cannot see a
   * move that drags both sides together.
   */
  //
  // objectui#11475 split this table by STORAGE. The `0.25` row is unmoved. The
  // `1` / `-5` / `12.3` rows were percentage points to the magnitude guess; on
  // a column that declares nothing they are a fraction now, and they keep
  // their old bytes only where the field declares whole points (`WHOLE`).
  it.each([
    [0.25, undefined, '25%'],
    [1, undefined, '100%'],
    [-5, undefined, '-500%'],
    [12.3, undefined, '1,230%'],
    [1, WHOLE, '1%'],
    [-5, WHOLE, '-5%'],
    [12.3, WHOLE, '12%'],
  ] as const)('en row %p (field %j) reads exactly %p', (stored, field, bytes) => {
    const storage = field ? 'whole' : 'fraction';
    expect(summaryLabel(stored, 'en', {}, field as never)).toBe(`${PREFIX}${bytes}`);
    expect(summaryLabel(stored, 'en', {}, field as never)).toBe(`${PREFIX}${formatPercent(stored, storage, 0, 'en')}`);
  });

  /**
   * The SCALING half asserted against its owning function directly, so the
   * fraction/points boundary has a pin that does not route through the percent
   * renderer's own behaviour.
   *
   * `en` only, deliberately: pulling the numerals back out of a `de-DE` or
   * `tr-TR` string would need this file to re-implement the separators it is
   * testing.
   */
  it.each([[0.25], [1], [-1], [-5], [12.3], [1234.5]])(
    'takes its magnitude for %p from percentDisplayValue, not from a local predicate',
    (stored) => {
      const numerals = summaryLabel(stored, 'en').slice(PREFIX.length).replace(/[^\d.-]/g, '');
      expect(Number(numerals)).toBe(Number(percentDisplayValue(stored, 'fraction').toFixed(0)));
    },
  );

  /**
   * `decimals` comes from `column.scale`.
   *
   * ⭐ This case used to read `column.precision` and fenced the member as an
   * explicitly NOT MEASURED question. objectui#9295 ANSWERED it: the spec
   * declares `precision` as the column's total digit count and `scale` as its
   * decimal places, so the percent arm joined the currency arm on `scale` and
   * the branch this case pinned is gone. The CLAIM is unchanged — the footer
   * honours the width the column declares — only the member that declares it.
   *
   * The repair itself is pinned in `useColumnSummary.percentScale-9295`; this
   * case keeps objectui#9269's convergence claim true across it.
   *
   * objectui#11588 then moved the declaration from the column to the FIELD:
   * `ListColumnSchema` declares no `scale`, and the footer reads it off the
   * field metadata only. The claim is unchanged again — only where it sits.
   */
  it('still honours the width declared by the field scale', () => {
    const declared = { rate: { type: 'percent', scale: 2 } };
    expect(summaryLabel(0.12345, 'en', {}, declared)).toBe(
      `${PREFIX}${formatPercent(0.12345, 'fraction', 2, 'en')}`,
    );
    expect(summaryLabel(0.12345, 'de-DE', {}, declared)).toBe(
      `${PREFIX}${formatPercent(0.12345, 'fraction', 2, 'de-DE')}`,
    );
  });
});
