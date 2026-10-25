/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The days a calendar draws: the week arithmetic `CalendarView`'s three grids
 * lay themselves out with, and the visible range read off it.
 *
 * Its own module (objectui#12081) because two components read it: the grids,
 * and `ObjectCalendar`, which reports the visible range to a host that fetches
 * for it (`onVisibleRangeChange`). Keeping it out of `CalendarView.tsx` also
 * keeps that report alive under a test that replaces the `CalendarView`
 * module with a stub. Not re-exported from the package index.
 */

import type { WeekdayIndex } from "@object-ui/i18n"

/**
 * How many days `date` lies after the start of its week, for a week that
 * starts on `weekStart` (objectui#11675): 0 on the first day, 6 on the last.
 */
function daysIntoWeek(date: Date, weekStart: WeekdayIndex): number {
  return (date.getDay() - weekStart + 7) % 7
}

/** `date` moved back, on the local calendar, to the first day of its week. */
export function getWeekStart(date: Date, weekStart: WeekdayIndex): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - daysIntoWeek(d, weekStart))
  return d
}

export function getMonthDays(date: Date, weekStart: WeekdayIndex): Date[] {
  const year = date.getFullYear()
  const month = date.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  // The grid's first row opens on the week's first day, so the days of the
  // previous month before the 1st fill the row up to it.
  const leadingDays = daysIntoWeek(firstDay, weekStart)
  const days: Date[] = []

  // Add previous month days
  for (let i = leadingDays - 1; i >= 0; i--) {
    const prevDate = new Date(firstDay.getTime())
    prevDate.setDate(prevDate.getDate() - (i + 1))
    days.push(prevDate)
  }

  // Add current month days
  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push(new Date(year, month, i))
  }

  // Add next month days
  const remainingDays = 42 - days.length
  for (let i = 1; i <= remainingDays; i++) {
    const nextDate = new Date(lastDay.getTime())
    nextDate.setDate(nextDate.getDate() + i)
    days.push(nextDate)
  }

  return days
}

/** Local midnight of `date`'s day, moved by `days` calendar days (DST-safe). */
function localMidnight(date: Date, days = 0): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/**
 * The days a calendar showing `date` in `view` draws, as a half-open range of
 * local midnights: `start` is the first day on screen and `end` the day after
 * the last (objectui#12081).
 *
 * Read off the SAME helpers the three grids draw with — `getMonthDays` for the
 * month grid (its leading and trailing days included), `getWeekStart` for the
 * week columns, the day itself for the day column — so the range a host fetches
 * for is the range drawn, under the locale's first day of the week.
 */
export function getVisibleDateRange(
  date: Date,
  view: "month" | "week" | "day",
  weekStart: WeekdayIndex,
): { start: Date; end: Date } {
  if (view === "month") {
    const days = getMonthDays(date, weekStart)
    return { start: localMidnight(days[0]), end: localMidnight(days[days.length - 1], 1) }
  }
  const start = localMidnight(view === "week" ? getWeekStart(date, weekStart) : date)
  return { start, end: localMidnight(start, view === "week" ? 7 : 1) }
}
