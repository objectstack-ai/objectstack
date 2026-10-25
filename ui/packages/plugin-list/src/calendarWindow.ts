/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The date window a list view fetches for the calendar it hosts
 * (objectui#12081 item 2).
 *
 * A calendar hosted by `ListView` draws the rows of ListView's own fetch. That
 * fetch used to be the one unpaged window every non-grid kind gets — the first
 * `DEFAULT_LIST_FETCH_BATCH_SIZE` (100) records of the object, with no date
 * condition — so a month holding more than 100 matching records was drawn from
 * whichever 100 came first, and the rest never appeared (measured on
 * objectstack-ai/hotclm#87: 122 contracts, up to 22 never drawn). Triage's
 * direction for the card, verbatim: "Fetch the visible date window, filtered on
 * the calendar's date field, and page through it. ⛔ No bigger cap."
 *
 * So the calendar's fetch is narrowed to the days it draws, and walked in
 * fetch-batch steps until the window is exhausted or the platform's non-grid
 * ceiling is reached (objectui#7210, ruling a′, whose footnote ListView draws
 * when it bites). This module holds the pure half of that: the window, the
 * filter node it becomes, and the walk. Not exported from the package index.
 */

import { NON_GRID_ROW_CEILING } from '@object-ui/core';

/**
 * A fetch window over local calendar days, spelled `YYYY-MM-DD`: `from` is the
 * first day asked for and `to` the day after the last, so the window is
 * half-open. Held as two strings so it is compared, stored and keyed by VALUE.
 */
export interface CalendarWindow {
  from: string;
  to: string;
}

/** The range a calendar reports: local midnights, `end` exclusive. */
export interface CalendarVisibleRange {
  start: Date;
  end: Date;
}

/** `date` as the local calendar day it falls on, `YYYY-MM-DD`. */
function localDay(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** `date` moved by `days` days on the local calendar (DST-safe: `setDate`). */
function moveDays(date: Date, days: number): Date {
  const moved = new Date(date);
  moved.setDate(moved.getDate() + days);
  return moved;
}

/**
 * The window to fetch for a reported range: the drawn days, widened by ONE day
 * on each side.
 *
 * The widening is what makes a day-bounded comparison safe on every stored
 * shape. A date-time is stored as a UTC instant, and the calendar places it on
 * the LOCAL day it falls on; the two differ by up to fourteen hours, so an event
 * at 01:00 on the first visible day in UTC+8 is stored on the previous UTC day
 * and would fall outside an unwidened `from`. One day covers every offset, and a
 * date-only value (`YYYY-MM-DD`, compared as written) is covered either way. The
 * extra day on each side is fetched and not drawn: the grids place an event by
 * its day, so a row outside the drawn days costs a row of the batch and nothing
 * on screen.
 */
export function calendarWindowFor(range: CalendarVisibleRange): CalendarWindow {
  return { from: localDay(moveDays(range.start, -1)), to: localDay(moveDays(range.end, 1)) };
}

/**
 * The window to fetch before the calendar has reported any range: one that
 * covers whatever month grid it can open on today.
 *
 * The hosted calendar opens on today, in the month view (`ListView` hands it no
 * date and no `defaultView`). Its month grid is six weeks that open on the
 * locale's first day of the week, so it starts at most six days before the 1st
 * and ends at most fourteen days after the last day of the month (a 28-day
 * month that opens on the week's first day). Covering that bound means this
 * window holds every day of the grid whatever the locale, so the calendar's
 * first report, which is the exact grid, falls inside it and asks for nothing
 * more. It also means a list view always has a window to fetch: one whose
 * calendar never reports a range (a host's own `object-calendar` renderer)
 * still draws today's month instead of nothing.
 */
export function initialCalendarWindow(now: Date = new Date()): CalendarWindow {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstOfNext = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return calendarWindowFor({ start: moveDays(first, -6), end: moveDays(firstOfNext, 14) });
}

/** Does `outer` hold every day of `inner`? (`YYYY-MM-DD` compares as written.) */
export function calendarWindowCovers(outer: CalendarWindow, inner: CalendarWindow): boolean {
  return outer.from <= inner.from && inner.to <= outer.to;
}

/**
 * The filter node that selects a window's records on the calendar's date
 * field(s), plus the records that have no start date at all.
 *
 *   - Without an end field, an event is a day: its start falls in the window.
 *   - With one, an event is a span, and it is drawn on every day it touches, so
 *     it is selected when it starts before the window ends AND either starts or
 *     ends inside the window or after it opens. A span with no end is a day
 *     again, which the `start >= from` arm covers.
 *   - ⛔ The records with NO start date are selected too. They are not on the
 *     grid: `ObjectCalendar` counts them under the grid in its "Unscheduled"
 *     area, which exists so that their absence from the grid is said rather
 *     than silent (`bc5870c9f`). A window on the start field alone would drop
 *     every one of them, and the area with them.
 *
 * Built in the filter AST the rest of this package sends (`mergeFilterNodes`
 * joins it to the view's own filter under one `and`): `and` / `or` heads and
 * `[field, operator, value]` triples, `is_null` as a 2-tuple. The bounds are
 * `YYYY-MM-DD` strings, the spelling the date macros resolve to.
 */
export function calendarWindowFilter(
  window: CalendarWindow,
  startField: string,
  endField?: string,
): unknown[] {
  const inWindow = endField
    ? ['and', [startField, '<', window.to], ['or', [startField, '>=', window.from], [endField, '>=', window.from]]]
    : ['and', [startField, '>=', window.from], [startField, '<', window.to]];
  return ['or', inWindow, [startField, 'is_null']];
}

/** What {@link fetchCalendarWindow} brings back. */
export interface CalendarWindowRows {
  /**
   * The window's records, at most {@link NON_GRID_ROW_CEILING} + 1: the walk
   * stops one row past the ceiling, the probe row `applyNonGridRowCeiling`
   * reads truncation from.
   */
  data: any[];
  /** The window's size when the adapter reported one (`QueryResult.total`). */
  total?: number;
}

/**
 * Walk a window in fetch-batch steps: `$top` is the batch (or the rows still
 * wanted, at the end), `$skip` moves by what came back, and the walk stops at
 * the first short batch or one row past the ceiling.
 *
 * ⛔ The step is the batch, never a bigger `$top`: the batch is the unit the
 * protocol is asked in (objectui#9853), and the ceiling is a stop condition,
 * not a request size.
 *
 * `extract` reads the rows out of one answer: the caller's own reader, so the
 * walk accepts exactly the envelopes the caller's single fetch accepts.
 * `isCurrent` is asked after every answer: when it says no, a newer request
 * owns the screen and the walk returns `null` without asking for more.
 */
export async function fetchCalendarWindow(
  find: (params: Record<string, unknown>) => Promise<unknown>,
  params: Record<string, unknown>,
  batch: number,
  extract: (result: unknown) => any[],
  isCurrent: () => boolean,
): Promise<CalendarWindowRows | null> {
  const wanted = NON_GRID_ROW_CEILING + 1;
  const data: any[] = [];
  let total: number | undefined;
  while (data.length < wanted) {
    const top = Math.min(batch, wanted - data.length);
    const result = await find({ ...params, $top: top, ...(data.length > 0 ? { $skip: data.length } : {}) });
    if (!isCurrent()) return null;
    const rows = extract(result);
    const reported = result && typeof result === 'object' ? (result as { total?: unknown }).total : undefined;
    if (typeof reported === 'number') total = reported;
    data.push(...rows);
    if (rows.length < top) break;
  }
  return { data, ...(total !== undefined ? { total } : {}) };
}
