/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `calendar.initialDate` — the date a calendar opens on (`@objectstack/spec`
 * `CalendarConfigSchema.initialDate`). Two forms, and absence:
 *
 *   - absent: today.
 *   - a wrapped date-macro token (`{today}`, `{next_month_start}`,
 *     `{3_months_from_now}`): the date the token resolves to when the calendar
 *     opens, through `resolveDateMacros` — the resolver filter values already
 *     use, so there is no second grammar here.
 *   - a record anchor, `first_record` / `next_record`: the earliest start date
 *     among the records the view's filter selects (on or after the start of
 *     today for `next_record`), read with its own one-row query because the
 *     calendar fetches only what it draws. No qualifying record ⇒ today.
 *
 * The calendar shows the period (month, week or day of the active mode) that
 * holds the date. `ObjectCalendar` seeds it once on mount; user navigation owns
 * the date afterwards. Not re-exported from the package index.
 */

import {
  convertSortToQueryParams,
  extractRecords,
  mergeFilterNodes,
  resolveDateMacros,
  toDisplayDate,
} from '@object-ui/core';

/** The record anchors `calendar.initialDate` accepts beside a date-macro token. */
export type CalendarRecordAnchor = 'first_record' | 'next_record';

export function isCalendarRecordAnchor(value: unknown): value is CalendarRecordAnchor {
  return value === 'first_record' || value === 'next_record';
}

/**
 * The date a date-macro `initialDate` opens on, or `null` for every other
 * value: absent, a record anchor, or a token the client resolver leaves as it
 * found it. `null` means the caller opens on today.
 */
export function resolveInitialDateMacro(initialDate: unknown, now: Date = new Date()): Date | null {
  if (typeof initialDate !== 'string' || initialDate === '' || isCalendarRecordAnchor(initialDate)) return null;
  const resolved = resolveDateMacros(initialDate, now);
  if (typeof resolved !== 'string' || resolved === initialDate) return null;
  const date = toDisplayDate(resolved);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The one-row query a record anchor reads: the view's filter, plus a start date
 * that is present (`first_record`) or on or after `todayBound` (`next_record`),
 * sorted by the start date ascending, one row.
 *
 * `todayBound` is the start of today spelled the way the start field stores it:
 * the caller knows the field's declared type, this function does not.
 */
export function recordAnchorQuery(
  anchor: CalendarRecordAnchor,
  startDateField: string,
  filter: unknown,
  todayBound: string,
): Record<string, unknown> {
  const bound = anchor === 'next_record'
    ? [startDateField, '>=', todayBound]
    : [startDateField, 'is_not_null'];
  const $filter = mergeFilterNodes(filter, bound);
  return {
    ...($filter !== undefined ? { $filter } : {}),
    $orderby: convertSortToQueryParams([{ field: startDateField, order: 'asc' }]),
    $top: 1,
  };
}

/**
 * The date a record anchor opens on, read off the one-row answer: the first
 * record's start value, read the way the calendar places an event on its day.
 * `null` when no record qualifies or its start value is not a date.
 */
export function anchorDateFromResult(result: unknown, startDateField: string): Date | null {
  const value = extractRecords(result)[0]?.[startDateField];
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return null;
  const date = toDisplayDate(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
