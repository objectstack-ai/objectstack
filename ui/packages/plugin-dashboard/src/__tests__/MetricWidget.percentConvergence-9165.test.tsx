/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9165 — the metric tile's percent branch stops holding a SECOND copy
 * of the percent display rule.
 *
 * `formatMetricValue`'s trailing-`%` branch used to decide fraction-vs-points
 * itself, spelled inside out:
 *
 *   const v = value > 1 ? value : value * 100;
 *   return `${v.toFixed(decimals)}%`;
 *
 * That is `percentDisplayValue`'s rule written the other way round — a
 * pass-through guarded by a greater-than-one test with the multiply in the else
 * arm — so it scaled everything at or below 1 and passed through everything
 * above. objectui#9071's census concluded the `plugin-detail` chip held the
 * only copy in the tree ("the only `num <= 1` spelling in the repo"): true of
 * the SPELLING, false of the DRIFT, because a literal `num <= 1` grep cannot
 * see this one.
 *
 * ── What this file measures, and why it is two different assertions ──────
 * The card's claim is AGREEMENT BETWEEN TWO SURFACES, so the primary case
 * compares the tile's own rendered DOM text against the declared source
 * (`formatPercent`, which applies `percentDisplayValue`) — never against a
 * hand-written expected string. A hand-written string would restate one side
 * and could not fail for the reason the card names.
 *
 * ⭐ But a two-surface comparison is blind to a JOINT move: if a repair
 * overshot and dragged BOTH surfaces, the equality would still hold. That is
 * what the two LIT CONTROLS are for, and it is the one place a literal is the
 * correct instrument: `0.25 -> 25%` and `12.3 -> 12%` already agree today, so
 * they are pinned to their exact bytes. If they move, the repair overshot and
 * this file says so. The two assertions are not redundant — neither can fail
 * for the other's reason.
 *
 * ── Directions, predicted in writing BEFORE the run ──────────────────────
 *   1, -1, -5        RED before the repair (tile rendered 100% / -100% / -500%)
 *   0.25, 12.3       GREEN on BOTH forms — they are the controls
 *   convention pins  RED before the repair (bare '%' + toFixed, no locale affix)
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocalizationProvider } from '@object-ui/i18n';
import { formatPercent } from '@object-ui/fields';
import { percentDisplayValue } from '@object-ui/core';
import { MetricWidget } from '../MetricWidget';

const LOCALE = 'en';

/**
 * The tile's OWN rendered output, read off the DOM it produced.
 *
 * Deliberately NOT a call to `formatMetricValue` (it is private) and
 * deliberately not a reconstruction: the card's measurement was "what a
 * `MetricWidget` with `format: '0%'` shows", so that is what is read. The value
 * lives in the single `.tabular-nums` node of the card body; no `trend` prop is
 * passed, which is what keeps that selector unambiguous.
 */
function tileText(value: number, format = '0%', locale: string = LOCALE): string {
  const { container, unmount } = render(
    <LocalizationProvider value={{ locale }}>
      <MetricWidget label="Ratio" value={value} format={format} />
    </LocalizationProvider>,
  );
  const text = container.querySelector('.tabular-nums')?.textContent ?? '';
  unmount();
  return text;
}

describe('MetricWidget percent branch agrees with the declared source (objectui#9165)', () => {
  /**
   * The card's disagreement table, now asserted as an agreement table. The
   * right-hand side is COMPUTED from the declared source in the same run — the
   * list-cell path that reaches `percentDisplayValue` — so this case measures
   * the two surfaces against each other rather than against a literal.
   *
   * Rows 1 / -1 / -5 are the three the card measured as disagreeing (the tile
   * showed 100% / -100% / -500%); rows 0.25 / 12.3 already agreed.
   *
   * objectui#11475 — the source's STORAGE is now stated, not guessed from the
   * value. A tile holds no field, and numeral's `%` multiplies by 100, so the
   * tile states a fraction; the agreement is with the cell's own call at that
   * storage.
   */
  it.each([[1], [-1], [-5], [0.25], [12.3]])(
    'stored %p renders the same on the tile as at the declared source',
    (stored) => {
      expect(tileText(stored)).toBe(formatPercent(stored, 'fraction', 0, LOCALE));
    },
  );

  /**
   * ⭐ THE LIT CONTROLS — the only literals in this file, and they earn it.
   *
   * These two agree today and must still agree at the SAME bytes afterwards.
   * The `it.each` above cannot see a joint move (both sides shifting together
   * keeps the equality true), so overshoot is detectable only against an
   * absolute. If either of these moves, the repair took something the card did
   * not authorise and this case is the one that fails.
   */
  //
  // objectui#11475 moved the `12.3` row on purpose: the magnitude guess read
  // it as points (`12%`); the `%` pattern states a fraction, so it reads
  // `1,230%`. The `0.25` row is the control that card left unmoved.
  it.each([
    [0.25, '25%'],
    [12.3, '1,230%'],
  ])('leaves the already-agreeing control %p at exactly %p', (stored, unmoved) => {
    expect(tileText(stored)).toBe(unmoved);
    // and it is still an agreement, not merely an unmoved byte string
    expect(tileText(stored)).toBe(formatPercent(stored, 'fraction', 0, LOCALE));
  });

  /**
   * The SCALING half, asserted against the owning function directly rather than
   * through `formatPercent`, so the boundary decision has a pin that does not
   * depend on the percent renderer's own behaviour.
   *
   * `percentDisplayValue` was then the symmetric `value > -1 && value < 1`.
   * Since objectui#11475 it scales at a STATED storage, and the tile states a
   * fraction (its `%` pattern), so every row is multiplied by 100.
   */
  it.each([[1], [-1], [-5], [0.25], [12.3]])(
    'takes its magnitude for %p from percentDisplayValue, not from a local predicate',
    (stored) => {
      const numerals = tileText(stored).replace(/[^\d.-]/g, '');
      expect(Number(numerals)).toBe(Number(percentDisplayValue(stored, 'fraction').toFixed(0)));
    },
  );
});

describe('MetricWidget percent branch takes the CONVENTION half too (objectui#9165)', () => {
  /**
   * `percentDisplayValue`'s doc comment is explicit that a third surface "takes
   * BOTH halves from here — the scaling AND the convention — or this promise
   * breaks again in the same place", and objectui#4576 is the round this repo
   * already paid for taking only one of them.
   *
   * This case is what makes the convention half FALSIFIABLE: the five-row table
   * above passes under a scaling-only repair too, because a bare `%` and the
   * locale affix coincide in `en` below four digits. These two rows do not
   * coincide — one on grouping, one on the affix itself — so they are the rows
   * that can fail for the reason this half exists.
   */
  it('groups a four-digit percent the way the declared source does', () => {
    // en moves from `1235%` to `1,235%` at four digits — objectui#4553 recorded
    // that move as the fix, not as a regression.
    // (objectui#11475: at the tile's stated fraction storage this is
    // `123,450%`; still a grouped figure, which is what this row tests.)
    expect(tileText(1234.5)).toBe(formatPercent(1234.5, 'fraction', 0, LOCALE));
    expect(tileText(1234.5)).not.toBe(`${percentDisplayValue(1234.5, 'fraction').toFixed(0)}%`);
  });

  it("renders a non-en session under that locale's percent convention", () => {
    // de writes a NO-BREAK SPACE before the sign; the retired local rule
    // appended a bare ASCII '%' in every locale. Asserting against the declared
    // source keeps the expectation out of this file, and the second line is the
    // negative that names what was retired.
    expect(tileText(1234.5, '0%', 'de-DE')).toBe(formatPercent(1234.5, 'fraction', 0, 'de-DE'));
    expect(tileText(1234.5, '0%', 'de-DE')).not.toBe(
      `${percentDisplayValue(1234.5, 'fraction').toFixed(0)}%`,
    );
  });

  it('still honours the decimal count parsed off the numeral pattern', () => {
    // `decimals` comes from the format PATTERN here, not from a field's
    // declared scale — that is this surface's own contract and the repair does
    // not move it.
    expect(tileText(0.12345, '0.00%')).toBe(formatPercent(0.12345, 'fraction', 2, LOCALE));
  });
});
