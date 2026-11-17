/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34382 — a timesheet bound to a `datetime` date field queries the
 * week it places records in.
 *
 * Records are placed on the viewer's LOCAL day (`dayKeyOf`), and a typed cell
 * writes the instant of local noon (`dateFieldValue`). A bare `YYYY-MM-DD`
 * comparand is read by the data layer as UTC midnight, so a date-time week
 * bounded by day keys disagrees with the placement everywhere off UTC: east of
 * UTC the first morning of the week is never fetched, and at UTC+13 a cell typed
 * on the first day is written before the window and vanishes on the re-read.
 * `weekQueryBounds` bounds a date-time week by the instants of local midnight.
 *
 * ── ⚠️ The zone cases run ONLY when driven, in a FORKS child ────────────────
 * `process.env.TZ` written inside a test of the normal run does not move the
 * zone (the root config runs `pool: 'threads'`), so these cases are skipped
 * there and `scripts/__tests__/date-only-zone-pins-10183.test.ts` runs them on
 * the forks pool and fails unless every one ran and passed. Each zone opens
 * with a rig case, so a child whose zone did not move reds.
 */

import { describe, expect, it } from 'vitest';
import { dateFieldValue, dayKeyOf, weekQueryBounds } from '../timesheetModel';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** UTC+13 in November — New Zealand daylight time, the card's worst case. */
const FAR_EAST = 'Pacific/Auckland';
/** UTC-8 in November — the other direction. */
const WEST = 'America/Los_Angeles';

/** A fixed instant: 01:00 on the 17th in Auckland, 04:00 on the 16th in Los Angeles. */
const INSTANT = '2026-11-16T12:00:00.000Z';

const WEEK_START = '2026-11-16';
const WEEK_END = '2026-11-23';

function enter(zone: string): void {
  process.env.TZ = zone;
}

/** The written value is inside `[from, to)` and reads back on `day`. */
function staysOnItsDay(day: string): void {
  const [from, to] = weekQueryBounds(WEEK_START, WEEK_END, 'datetime');
  const written = dateFieldValue(day, 'datetime');
  expect(written >= from && written < to).toBe(true);
  expect(dayKeyOf(written)).toBe(day);
}

describe.runIf(DRIVEN)('timesheet date-time week at UTC+13 (objectstack#34382)', () => {
  it('rig: the zone really moved', () => {
    enter(FAR_EAST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(FAR_EAST);
    expect(new Date(INSTANT).getHours()).toBe(1);
  });

  it('bounds the week by the instants of local midnight, not by UTC days', () => {
    enter(FAR_EAST);
    expect(weekQueryBounds(WEEK_START, WEEK_END, 'datetime')).toEqual([
      '2026-11-15T11:00:00.000Z',
      '2026-11-22T11:00:00.000Z',
    ]);
  });

  it('keeps a cell typed on the first day inside the week it was typed in', () => {
    enter(FAR_EAST);
    // Local noon on the 16th is 23:00Z on the 15th: before a day-key bound.
    expect(dateFieldValue(WEEK_START, 'datetime')).toBe('2026-11-15T23:00:00.000Z');
    staysOnItsDay(WEEK_START);
    staysOnItsDay('2026-11-22');
  });

  it('control: a date field keeps its day keys', () => {
    enter(FAR_EAST);
    expect(weekQueryBounds(WEEK_START, WEEK_END, 'date')).toEqual([WEEK_START, WEEK_END]);
    expect(dateFieldValue(WEEK_START, 'date')).toBe(WEEK_START);
  });
});

describe.runIf(DRIVEN)('timesheet date-time week at UTC-8 (objectstack#34382)', () => {
  it('rig: the zone really moved', () => {
    enter(WEST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date(INSTANT).getHours()).toBe(4);
  });

  it('bounds the week by the instants of local midnight, not by UTC days', () => {
    enter(WEST);
    expect(weekQueryBounds(WEEK_START, WEEK_END, 'datetime')).toEqual([
      '2026-11-16T08:00:00.000Z',
      '2026-11-23T08:00:00.000Z',
    ]);
  });

  it('keeps a cell typed on the last day inside the week it was typed in', () => {
    enter(WEST);
    staysOnItsDay(WEEK_START);
    staysOnItsDay('2026-11-22');
  });
});
