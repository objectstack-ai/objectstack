/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { isValueDomainMember } from '@objectstack/spec/shared';

/**
 * The stored shape of a quiet-hours window, as the messaging service reads it
 * (`parseQuietHours` / `quietHoursDeferral` in `@objectstack/service-messaging`):
 * `start` and `end` are `HH:MM` wall-clock times in `tz`, an absent `tz` means
 * UTC, and a window whose start is later than its end runs past midnight.
 */
export interface QuietHoursValue {
  tz?: string;
  start: string;
  end: string;
}

/**
 * What the control can make of a stored value.
 *
 *  - `empty`: no window is stored (`null` / `undefined`).
 *  - `window`: exactly the stored shape, kept verbatim so a part the person
 *    does not edit is written back byte for byte.
 *  - `unreadable`: anything else. It is shown as stored and never rewritten
 *    unless the person chooses to replace it.
 */
export type QuietHoursReading =
  | { kind: 'empty' }
  | { kind: 'window'; window: QuietHoursValue }
  | { kind: 'unreadable' };

/** The keys the stored shape may carry. Any other key makes the value unreadable. */
const QUIET_HOURS_KEYS: ReadonlySet<string> = new Set(['tz', 'start', 'end']);

/**
 * The `HH:MM` the service accepts: one or two hour digits, two minute digits,
 * hours 0 to 23 and minutes 0 to 59 (its `parseHHMM`).
 */
const HH_MM = /^(\d{1,2}):(\d{2})$/;

/** True when `text` is a time the service reads as a wall-clock minute. */
export function isQuietHoursTime(text: unknown): text is string {
  if (typeof text !== 'string') return false;
  const match = HH_MM.exec(text);
  if (!match) return false;
  return Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

/** Read a stored quiet-hours value into the control. */
export function readQuietHours(value: unknown): QuietHoursReading {
  if (value === null || value === undefined) return { kind: 'empty' };
  if (typeof value !== 'object' || Array.isArray(value)) return { kind: 'unreadable' };
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !QUIET_HOURS_KEYS.has(key))) return { kind: 'unreadable' };
  const { tz, start, end } = record;
  if (!isQuietHoursTime(start) || !isQuietHoursTime(end)) return { kind: 'unreadable' };
  if (tz !== undefined && (typeof tz !== 'string' || tz === '')) return { kind: 'unreadable' };
  return { kind: 'window', window: tz === undefined ? { start, end } : { tz, start, end } };
}

/** The zone a window runs in: its own, or UTC when it names none. */
export function quietHoursZone(window: Pick<QuietHoursValue, 'tz'>): string {
  return window.tz ?? 'UTC';
}

/** The value an `input type="time"` takes for a stored time: the hour padded to two digits. */
export function timeInputValue(time: string): string {
  return time.length === 4 ? `0${time}` : time;
}

/** True when the window runs past midnight: its start is later than its end. */
export function runsPastMidnight(start: string, end: string): boolean {
  return timeInputValue(start) > timeInputValue(end);
}

/** True when start and end are the same minute, which the service reads as no window at all. */
export function isEmptyWindow(start: string, end: string): boolean {
  return timeInputValue(start) === timeInputValue(end);
}

let zoneListCache: readonly string[] | undefined;

/**
 * The time zones the picker offers: UTC first, then every zone ICU lists
 * (`Intl.supportedValuesOf('timeZone')`), kept only where the spec's
 * `iana_time_zone` membership test agrees. The enumeration omits `UTC`, which
 * is why it is added. A runtime without `Intl.supportedValuesOf` offers UTC
 * alone; a stored zone is still shown.
 */
export function quietHoursZones(): readonly string[] {
  if (zoneListCache) return zoneListCache;
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const candidates = typeof supported === 'function' ? supported('timeZone') : [];
  const listed = candidates.filter((zone) => zone !== 'UTC' && isValueDomainMember('iana_time_zone', zone));
  zoneListCache = ['UTC', ...listed];
  return zoneListCache;
}
