// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Timezone-aware calendar utilities (ADR-0053 Phase 2).
 *
 * The one primitive everything else builds on is {@link calendarPartsInTz}:
 * the year/month/day an instant falls on *as seen in a reference timezone*.
 * It uses `Intl.DateTimeFormat().formatToParts()` so DST transitions are
 * handled by the platform's tz database — never hand-rolled offset math, which
 * is the classic source of off-by-one-hour bucket errors.
 *
 * This lives in `@objectstack/core` (not `@objectstack/formula`) because both
 * the ObjectQL aggregation engine and the analytics service need it and both
 * already depend on core, whereas neither depends on formula's public surface.
 * (`@objectstack/formula` keeps its own private copy for `today()`/`daysFromNow`
 * to avoid a layering dependency on core.)
 */

/** Calendar-day parts in a reference timezone. `month` is 1-12. */
export interface CalendarParts {
  year: number;
  month: number;
  day: number;
}

/**
 * The year/month/day an instant falls on in `tz`. Throws if `tz` is not a
 * valid IANA zone (callers treat that as a fall-through to UTC).
 */
export function calendarPartsInTz(d: Date, tz: string): CalendarParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * The calendar-day parts of an instant, in `tz` when it's a real non-UTC zone,
 * otherwise in UTC. Never throws: an unset, `'UTC'`, or invalid zone falls back
 * to the UTC calendar day. This is the safe entry point for bucketing code that
 * must degrade to the historical UTC behavior rather than error.
 */
export function calendarPartsInTzOrUtc(d: Date, tz?: string): CalendarParts {
  if (tz && tz !== 'UTC') {
    try {
      return calendarPartsInTz(d, tz);
    } catch {
      // unknown zone → fall through to UTC
    }
  }
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}
