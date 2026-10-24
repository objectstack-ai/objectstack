/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10301 — the shared date path refuses a DATE-TIME spelled on a
 * calendar day that does not exist, the way objectui#10026 made it refuse a
 * date-only one.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 * objectui#10026 taught `toDisplayDate` to hand back an Invalid Date for
 * `2026-02-30`, but only on the date-only shape. The engine parses
 * `2026-02-30T10:00:00Z` just as happily and rolls it into March 2nd, so
 * `formatDateTime` rendered `Mar 2, 2026, 10:00 AM`: a real day nobody wrote,
 * with nothing to say so. The maintainer's ruling on objectui#10026 ("a
 * silently wrong day is the failure North Star rule 4 forbids") covers it;
 * triage graded this card an inherited branch of that ruling.
 *
 * ── What "the day" is ─────────────────────────────────────────────────────
 * The judgement reads the LEADING `YYYY-MM-DD` of the stored string, the day
 * the value was written on, never the day the parsed instant lands on in some
 * zone. A parsed `Date` always names a real day, so a check made after any
 * conversion could only ever miss a refusal. The offset case below is the
 * control on the other side: a real day written with an offset that moves
 * the instant into March in UTC must not be refused.
 *
 * ── Directions, predicted before the run ───────────────────────────────────
 *   pre-card sources         every refusal case reds with a rendered March
 *                            date; the controls stay green
 *   the new arm deleted      same as pre-card
 * The date-only refusal pins of objectui#10026 (`impossibleDay-10026` beside
 * this file) are untouched by this card and must stay green.
 */

import { describe, expect, it } from 'vitest';

import { formatMeasure } from '../dataset-format.js';
import {
  formatDate,
  formatDateTime,
  formatDateTimeCompactParts,
  formatRelativeDate,
  toDisplayDate,
} from '../date-display.js';

const EN = 'en-US';

/**
 * Date-times whose day does not exist, in the spellings the engine accepts:
 * `Z`, an offset, fractional seconds, no zone, and a space separator.
 */
const IMPOSSIBLE_DATETIMES = [
  '2026-02-30T10:00:00Z',
  '2024-02-31T08:15:00.000Z',
  '2025-02-29T10:00',
  '2026-04-31T23:59:59+09:00',
  '2026-02-30 10:00',
] as const;

/** A real day written with an offset: 2026-03-01T04:30Z, in UTC. */
const REAL_DAY_WITH_OFFSET = '2026-02-28T23:30:00-05:00';

/** The card's positive control: a real date-time. */
const REAL_DATETIME = '2026-02-28T10:00:00Z';

describe('premise: the engine does not refuse these date-times (objectui#10301)', () => {
  it('parses each one, so the refusal has to come from the shared path', () => {
    for (const v of IMPOSSIBLE_DATETIMES) {
      expect(Number.isNaN(Date.parse(v)), v).toBe(false);
    }
  });
});

describe('toDisplayDate refuses a date-time written on a nonexistent day (objectui#10301)', () => {
  it('hands back an Invalid Date, the answer the engine gives an unparsable value', () => {
    for (const v of IMPOSSIBLE_DATETIMES) {
      expect(Number.isNaN(toDisplayDate(v).getTime()), v).toBe(true);
    }
  });

  it('control: a real date-time is the engine instant, unchanged', () => {
    expect(toDisplayDate(REAL_DATETIME).getTime()).toBe(Date.parse(REAL_DATETIME));
    expect(toDisplayDate('2024-02-29T10:00:00Z').getTime()).toBe(Date.parse('2024-02-29T10:00:00Z'));
  });

  it('control: the day is read from the string, so an offset that moves the instant into March is not refused', () => {
    // In UTC this instant is March 1st, 04:30. The written day, February 28th,
    // is real, and the instant is kept exactly as the engine parsed it.
    expect(new Date(REAL_DAY_WITH_OFFSET).toISOString()).toBe('2026-03-01T04:30:00.000Z');
    expect(toDisplayDate(REAL_DAY_WITH_OFFSET).getTime()).toBe(Date.parse(REAL_DAY_WITH_OFFSET));
  });
});

describe('every function on the shared path answers with its own unparsable face (objectui#10301)', () => {
  it('formatDateTime, on both of its faces', () => {
    for (const v of IMPOSSIBLE_DATETIMES) {
      expect(formatDateTime(v, { locale: EN }), v).toBe(formatDateTime('not-a-date', { locale: EN }));
      expect(formatDateTime(v, { locale: EN, style: 'compact' }), v).toBe(
        formatDateTime('not-a-date', { locale: EN, style: 'compact' }),
      );
    }
  });

  it('formatDateTimeCompactParts answers null', () => {
    for (const v of IMPOSSIBLE_DATETIMES) {
      expect(formatDateTimeCompactParts(v, { locale: EN }), v).toBeNull();
    }
  });

  it('formatDate and formatRelativeDate', () => {
    for (const v of IMPOSSIBLE_DATETIMES) {
      expect(formatDate(v, undefined, { locale: EN }), v).toBe(formatDate('not-a-date', undefined, { locale: EN }));
      expect(formatRelativeDate(v, { locale: EN }), v).toBe(formatRelativeDate('not-a-date', { locale: EN }));
    }
  });

  it('a dataset measure agrees with the list cell on the refusal', () => {
    // The measure's datetime arm hands the string to `formatDateTime`, so it
    // inherits the refusal instead of judging the day itself.
    for (const v of IMPOSSIBLE_DATETIMES) {
      expect(formatMeasure(v, undefined, undefined, undefined, EN), v).toBe(formatDateTime('not-a-date', { locale: EN }));
    }
  });

  it('control: a real date-time displays as before', () => {
    // This suite runs in UTC (`vitest.config.mts` pins it).
    expect(formatDateTime(REAL_DATETIME, { locale: EN })).toBe('Feb 28, 2026, 10:00 AM');
    expect(formatDateTimeCompactParts(REAL_DATETIME, { locale: EN })).toEqual({ date: '2/28/2026', time: '10:00 am' });
  });

  it('control: a real day written with an offset renders its instant, not the marker', () => {
    expect(formatDateTime(REAL_DAY_WITH_OFFSET, { locale: EN })).toBe('Mar 1, 2026, 04:30 AM');
  });
});
