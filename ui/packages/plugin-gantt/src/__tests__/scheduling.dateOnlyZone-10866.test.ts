/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10866 — the working-calendar reschedule counts the chart's own
 * calendar days.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * The scheduler's working calendar floored every instant to UTC midnight and
 * keyed weekends and holidays by the UTC day (`getUTCDay`, `toISOString()`).
 * That agreed with a date-only value only while the value was READ as UTC
 * midnight. Since objectui#10866 a date-only value reads as LOCAL midnight of
 * its day, which is also how `GanttView`'s own day columns fold weekends and
 * holidays (`isWorkingColumn` keys by the local day). Left on UTC, a
 * successor pushed past a Friday landed on Sunday 17:00 west of UTC, and on
 * the Friday itself at 08:00 east of it. The calendar now floors to the local
 * day and keys it the way the columns do.
 *
 * ── ⚠️ The zone cases run ONLY when driven, in a FORKS child ────────────────
 * `process.env.TZ` written inside a test of the normal run does not move the
 * zone (the root config runs `pool: 'threads'`), so the zone cases are
 * skipped there and `scripts/__tests__/date-only-zone-pins-10183.test.ts`
 * runs them on the forks pool and fails unless every one ran and passed. Each
 * zone opens with a rig case, so a child whose zone did not move reds instead
 * of going quietly green. The suite-zone case runs in the normal run too; it
 * cannot tell the repair from its absence, because UTC is the one offset where
 * the local and the UTC day agree.
 */

import { describe, expect, it } from 'vitest';
import { computeProjectReschedule, type SchedulableTask, type WorkingCalendar } from '../scheduling';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** UTC-7 in October — the card's direction. */
const WEST = 'America/Los_Angeles';
/** UTC+8 — the control. */
const EAST = 'Asia/Shanghai';

/** A fixed instant: 21:00 on the 5th in the west, 12:00 on the 6th in the east. */
const INSTANT = '2026-10-06T04:00:00.000Z';

function enter(zone: string): void {
  process.env.TZ = zone;
}

/** Local calendar parts of a `Date`: year, month (1-based), day, hour. */
const parts = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()];

/** Local midnight of an October 2026 day — how a date-only value reads now. */
const oct = (day: number) => new Date(2026, 9, day);

/**
 * A: Friday the 9th, one day. B: one working day, after A. Its seeded start
 * (Monday the 5th) violates the link, so the reschedule moves it.
 */
function tasks(): SchedulableTask[] {
  return [
    { id: 'A', start: oct(9), end: oct(10) },
    { id: 'B', start: oct(5), end: oct(6), dependencies: ['A'] },
  ];
}

/** Where B lands, as local calendar parts of its start and end. */
function landing(cal: WorkingCalendar): { start: number[]; end: number[] } {
  const change = computeProjectReschedule(tasks(), cal).find((c) => String(c.id) === 'B');
  expect(change, 'B was not moved').toBeDefined();
  return { start: parts(change!.start), end: parts(change!.end) };
}

const OVER_WEEKEND = { start: [2026, 10, 12, 0], end: [2026, 10, 13, 0] };
const OVER_HOLIDAY = { start: [2026, 10, 13, 0], end: [2026, 10, 14, 0] };

describe('working-calendar reschedule, in the suite zone (objectui#10866)', () => {
  it('a successor of a Friday task starts on Monday; a Monday holiday pushes it to Tuesday', () => {
    expect(landing({ skipWeekends: true })).toEqual(OVER_WEEKEND);
    expect(landing({ skipWeekends: true, holidays: new Set(['2026-10-12']) })).toEqual(OVER_HOLIDAY);
  });
});

function zoneCases(zone: string, instantHour: number) {
  it('rig: the zone really moved', () => {
    enter(zone);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
    expect(new Date(INSTANT).getHours()).toBe(instantHour);
  });

  it('a successor of a Friday task starts on Monday the 12th at local midnight', () => {
    enter(zone);
    expect(landing({ skipWeekends: true })).toEqual(OVER_WEEKEND);
  });

  it('a holiday keyed `2026-10-12` is the local Monday, and pushes it to Tuesday', () => {
    enter(zone);
    expect(landing({ skipWeekends: true, holidays: new Set(['2026-10-12']) })).toEqual(OVER_HOLIDAY);
  });
}

describe.runIf(DRIVEN)('working-calendar reschedule west of UTC (objectui#10866)', () => {
  zoneCases(WEST, 21);
});

describe.runIf(DRIVEN)('working-calendar reschedule east of UTC, the control (objectui#10866)', () => {
  zoneCases(EAST, 12);
});
