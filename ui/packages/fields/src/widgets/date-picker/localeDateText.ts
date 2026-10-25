/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The text a record form's date picker shows and reads (objectui#12622).
 *
 * The picker's text box is spelled in the DISPLAY locale (`useDisplayLocale()`,
 * the tag every date renderer formats with), not the machine's. The native
 * `<input type="date">` it replaces on the form path took its placeholder and
 * its digit order from the browser, so an English console showed a Chinese
 * machine's `年/月/日`.
 *
 * Both directions go through the native control's own value shapes, so the
 * value the form writes is unchanged:
 *
 *   - `date`: `YYYY-MM-DD` (what `toDateInputValue` hands in, and what
 *     `<input type="date">` emitted);
 *   - `datetime`: the local wall clock `YYYY-MM-DDTHH:mm` (what
 *     `toDateTimeInputValue` hands in), which the caller turns back into an
 *     ISO instant with `fromDateTimeInputValue`, exactly as `DateTimeField`
 *     does for `datetime-local`.
 *
 * Formatting reads `Intl` with Latin digits (`numberingSystem: 'latn'`), so a
 * typed date is always read back by the digit groups it was shown with; the
 * ORDER of year, month and day, and the separators, are the locale's.
 */

import { isRealCalendarDate } from '@object-ui/core';

type DatePart = 'year' | 'month' | 'day';

/** A fixed day whose month, day and year are all distinct numbers. */
const PROBE = Date.UTC(2026, 10, 23, 13, 5);

const pad2 = (n: number) => String(n).padStart(2, '0');

function dateFormat(locale: string, withTime: boolean): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
    numberingSystem: 'latn',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : null),
  };
  // The display locale and nothing else (objectui#9909: no hard-coded tag on
  // a display path). A malformed tag is answered exactly as the read-only face
  // beside it answers it: `formatDate` hands `Intl` the same tag unguarded.
  return new Intl.DateTimeFormat(locale, options);
}

/** The order the locale writes year, month and day in. */
function dateOrder(locale: string): DatePart[] {
  return dateFormat(locale, false)
    .formatToParts(PROBE)
    .map((p) => p.type)
    .filter((t): t is DatePart => t === 'year' || t === 'month' || t === 'day');
}

function partsOf(text: string): { y: number; m: number; d: number; h: number; mi: number } | null {
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3], h: m[4] ? +m[4] : 0, mi: m[5] ? +m[5] : 0 };
}

/**
 * The display text for a native-shaped value (`YYYY-MM-DD`, or
 * `YYYY-MM-DDTHH:mm` when `withTime`). `''` for an empty or unreadable value.
 */
export function formatLocaleDateText(value: string, locale: string, withTime: boolean): string {
  const p = partsOf(value);
  if (!p) return '';
  // The wall clock is formatted as a UTC instant in the UTC zone, so the text
  // is the value's own digits in every viewer's zone.
  return dateFormat(locale, withTime).format(Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi));
}

/**
 * The pattern the text box expects, for its placeholder: the locale's own
 * order and separators with `YYYY` / `MM` / `DD` (and `HH` / `mm`) in place of
 * the digits.
 */
export function localeDatePattern(locale: string, withTime: boolean): string {
  const tokens: Record<string, string> = { year: 'YYYY', month: 'MM', day: 'DD', hour: 'HH', minute: 'mm' };
  return dateFormat(locale, withTime)
    .formatToParts(PROBE)
    .map((part) => (part.type === 'dayPeriod' ? 'AM/PM' : tokens[part.type] ?? part.value))
    .join('');
}

/** The locale's own afternoon marker (`PM`, `下午`, …), lower-cased. */
function pmMarker(locale: string): string | undefined {
  const parts = new Intl.DateTimeFormat(dateFormat(locale, true).resolvedOptions().locale, {
    hour: 'numeric',
    hour12: true,
    timeZone: 'UTC',
  }).formatToParts(PROBE);
  return parts.find((p) => p.type === 'dayPeriod')?.value.toLowerCase();
}

/**
 * Reads what was typed into the text box.
 *
 * Returns `''` for blank text, the native-shaped value for a real day (and a
 * real clock time when `withTime`), and `null` for text that names no real
 * date. Accepted:
 *
 *   - the locale's own digit order, with any separators (`10/16/2026` in `en`,
 *     `2026/10/16` in `zh`, `16.10.2026` in `de`);
 *   - an ISO date `2026-10-16`, in every locale (a four-digit first group is
 *     read as the year);
 *   - a two-digit year, read in this century;
 *   - with `withTime`: an hour and minute after the date, 24-hour, or 12-hour
 *     with `AM` / `PM` or the locale's own afternoon marker. With no time, the
 *     time is midnight.
 */
export function parseLocaleDateText(text: string, locale: string, withTime: boolean): string | null {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const groups = trimmed.match(/\d+/g) ?? [];
  if (groups.length < 3) return null;

  const order: DatePart[] = (groups[0] ?? '').length === 4 ? ['year', 'month', 'day'] : dateOrder(locale);
  if (order.length !== 3) return null;
  const date: Record<DatePart, string> = { year: '', month: '', day: '' };
  order.forEach((part, i) => {
    date[part] = groups[i] ?? '';
  });
  if (date.year.length === 2) date.year = `20${date.year}`;
  if (date.year.length !== 4 || date.month.length > 2 || date.day.length > 2) return null;
  const day = `${date.year}-${pad2(Number(date.month))}-${pad2(Number(date.day))}`;
  if (!isRealCalendarDate(day)) return null;

  const rest = groups.slice(3);
  if (!withTime) return rest.length === 0 ? day : null;

  if (rest.length === 0) return `${day}T00:00`;
  const [hourText = '', minuteText = '0'] = rest;
  if (rest.length > 3 || hourText.length > 2 || minuteText.length > 2) return null;
  let hour = Number(hourText);
  const minute = Number(minuteText);
  const lower = trimmed.toLowerCase();
  const marker = pmMarker(locale);
  const pm = /\bp\.?\s?m\.?/.test(lower) || (!!marker && lower.includes(marker));
  const am = /\ba\.?\s?m\.?/.test(lower);
  if (pm || am) {
    if (hour < 1 || hour > 12) return null;
    if (pm && hour < 12) hour += 12;
    if (am && hour === 12) hour = 0;
  }
  if (hour > 23 || minute > 59) return null;
  return `${day}T${pad2(hour)}:${pad2(minute)}`;
}

/** The local calendar day of `d` as `YYYY-MM-DD`. */
export function toLocalDay(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local midnight of a `YYYY-MM-DD` day, for the calendar to select. */
export function fromLocalDay(day: string): Date | undefined {
  const p = partsOf(day.slice(0, 10));
  return p ? new Date(p.y, p.m - 1, p.d) : undefined;
}
