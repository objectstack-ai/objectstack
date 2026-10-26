/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10026 — the shared date path refuses a calendar day that does not
 * exist, visibly, with the marker it already renders for an unparsable value.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 * One concept, two answers. The filter builder's `isRealCalendarDate`
 * refused `2024-02-31` at the AUTHORING boundary, while `formatDate` — behind
 * every date cell, card, gantt tooltip and dataset measure — accepted
 * `2026-02-30` and rendered `Mar 2`: a real day nobody wrote, with nothing to
 * say so. ECMAScript's parse accepts a day of `01`-`31` for any month and
 * rolls the surplus forward; only an out-of-range MONTH is `NaN`.
 *
 * ── The ruling (maintainer, option A) ────────────────────────────────────
 * `isRealCalendarDate` MOVES into `@object-ui/core` beside `formatDate` (the
 * filter builder imports it from there), and `formatDate` renders such a day
 * with the SAME visible marker it uses for an unparsable value — not blank,
 * not a third shape. So every assertion on the refused face below compares
 * against the formatter's own answer for `not-a-date`, read at run time: the
 * marker is the module's, and this file does not get to design one.
 *
 * ── Directions, MEASURED on three ablated trees ───────────────────────────
 *   pre-card sources       the first describe reds (`isRealCalendarDate` is
 *                          not a function there); every refusal case reds
 *                          with a rendered March date (`Mar 2`)
 *   refusal deleted from   every refusal case reds; the first describe stays
 *   `toDisplayDate`        green — the judgement exists, nothing asks it
 *   `Date.UTC` restored in exactly the two year-below-100 cases red, plus the
 *   the moved function     sibling suite's two-digit-year case
 * The valid-leap-day controls are green in all three: they guard against a
 * refusal that over-reaches.
 */

import { describe, expect, it } from 'vitest';

import {
  formatDate,
  formatDateTime,
  formatDateTimeCompactParts,
  formatRelativeDate,
  isRealCalendarDate,
  toDisplayDate,
} from '../date-display.js';

const EN = 'en-US';

/** The three days the card and the ruling name; none of them exists. */
const IMPOSSIBLE_DAYS = ['2026-02-30', '2024-02-31', '2025-02-29'] as const;

describe('isRealCalendarDate — the one judgement, moved from the filter builder (objectui#10026)', () => {
  it('accepts a day that exists, leap days included', () => {
    for (const v of ['2024-02-29', '2000-02-29', '2026-08-01', '2026-01-31', '2026-12-31']) {
      expect(isRealCalendarDate(v), v).toBe(true);
    }
  });

  it('refuses a day its month does not have, and an out-of-range month or day', () => {
    for (const v of [
      ...IMPOSSIBLE_DAYS,
      '1900-02-29', // a century that is not a leap year
      '2026-04-31',
      '2026-02-00',
      '2026-00-10',
      '2026-13-01',
    ]) {
      expect(isRealCalendarDate(v), v).toBe(false);
    }
  });

  it('refuses every shape but the date-only ISO one', () => {
    for (const v of ['2026-2-3', '2024-02-29T10:00', ' 2024-02-29', '', 'not-a-date']) {
      expect(isRealCalendarDate(v), JSON.stringify(v)).toBe(false);
    }
  });

  it('reads a year below 100 as that year, not as 1900+y', () => {
    // `Date.UTC(26, …)` is 1926, so the pre-move body answered `false` for a
    // real day in year 26 — and refusing through it would have dashed every
    // such value on the display path, which renders them (objectui#10110).
    expect(isRealCalendarDate('0026-08-01')).toBe(true);
    expect(isRealCalendarDate('0000-02-29')).toBe(true);
    expect(isRealCalendarDate('0100-02-29')).toBe(false);
  });
});

describe('formatDate refuses an impossible day with its unparsable marker (objectui#10026)', () => {
  const MARKER = formatDate('not-a-date', undefined, { locale: EN });

  it('premise: the engine does not refuse these days, so the refusal belongs to the path', () => {
    for (const v of IMPOSSIBLE_DAYS) {
      expect(Number.isNaN(Date.parse(v)), v).toBe(false);
    }
  });

  it('the marker is visible — not blank', () => {
    expect(MARKER.trim()).not.toBe('');
  });

  it('renders each impossible day as that marker, on every face formatDate draws', () => {
    for (const v of IMPOSSIBLE_DAYS) {
      expect(formatDate(v, undefined, { locale: EN }), v).toBe(MARKER);
      expect(formatDate(v, 'short', { locale: EN }), v).toBe(MARKER);
      expect(formatDate(v, 'relative', { locale: EN }), v).toBe(MARKER);
      expect(formatDate(v, undefined, { locale: EN, style: 'short' }), v).toBe(MARKER);
    }
  });

  it('control: a real leap day still renders as itself', () => {
    expect(formatDate('2024-02-29', undefined, { locale: EN })).toBe('Feb 29, 2024');
    expect(formatDate('2024-02-29', 'short', { locale: EN })).toBe("Feb 29, '24");
  });

  it('control: a year below 100 still renders, not as the marker', () => {
    expect(formatDate('0026-08-01', undefined, { locale: EN })).not.toBe(MARKER);
  });
});

describe('every function on the shared path refuses it the same way (objectui#10026)', () => {
  it('formatRelativeDate answers with its own unparsable face', () => {
    for (const v of IMPOSSIBLE_DAYS) {
      expect(formatRelativeDate(v, { locale: EN }), v).toBe(formatRelativeDate('not-a-date', { locale: EN }));
    }
  });

  it('formatDateTime answers with its own unparsable face, on both of its faces', () => {
    for (const v of IMPOSSIBLE_DAYS) {
      expect(formatDateTime(v, { locale: EN }), v).toBe(formatDateTime('not-a-date', { locale: EN }));
      expect(formatDateTime(v, { locale: EN, style: 'compact' }), v).toBe(
        formatDateTime('not-a-date', { locale: EN, style: 'compact' }),
      );
    }
  });

  it('formatDateTimeCompactParts answers null, as it does for an unparsable value', () => {
    expect(formatDateTimeCompactParts('not-a-date', { locale: EN })).toBeNull();
    for (const v of IMPOSSIBLE_DAYS) {
      expect(formatDateTimeCompactParts(v, { locale: EN }), v).toBeNull();
    }
  });

  it('toDisplayDate itself hands back an Invalid Date, which every other caller already answers', () => {
    for (const v of IMPOSSIBLE_DAYS) {
      expect(Number.isNaN(toDisplayDate(v).getTime()), v).toBe(true);
    }
    // Control: a real leap day is still local midnight of the day it names.
    const leap = toDisplayDate('2024-02-29');
    expect([leap.getFullYear(), leap.getMonth() + 1, leap.getDate(), leap.getHours()]).toEqual([2024, 2, 29, 0]);
  });
});
