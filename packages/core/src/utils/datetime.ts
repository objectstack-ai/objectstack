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

/**
 * The UTC instant (epoch ms) at which calendar day `ymd` (`YYYY-MM-DD`) *begins*
 * in reference timezone `tz` — i.e. local **midnight** of that day rendered as a
 * UTC instant. The inverse direction of {@link calendarPartsInTz}.
 *
 * DST-safe: the zone offset is read from the platform tz database via
 * `Intl.DateTimeFormat` (never hand-computed), and a two-pass resolution settles
 * the rare case where the offset differs side-to-side of the target instant. An
 * unset, `'UTC'`, invalid, or unparseable input returns plain UTC midnight.
 *
 * Used by date-bucket drill ranges (#1752): a `datetime` field buckets on the
 * reference-tz calendar, so its bucket boundary is that tz's midnight instant.
 */
export function zonedDateStartToUtcMs(ymd: string, tz?: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  const wallAsUtc = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  if (!tz || tz === 'UTC' || Number.isNaN(wallAsUtc)) return wallAsUtc;
  try {
    // The tz offset (local − UTC, in ms) at instant `t`: read t's wall clock in
    // `tz`, re-interpret those parts as UTC, and subtract t.
    const offsetAt = (t: number): number => {
      const p = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).formatToParts(new Date(t));
      const g = (k: string) => Number(p.find((x) => x.type === k)?.value);
      return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - t;
    };
    // Want U such that localParts(U) == midnight, i.e. U = wallAsUtc − offset(U).
    // Iterate from the zero-offset guess; converges in ≤2 steps off a DST edge.
    const off1 = offsetAt(wallAsUtc - offsetAt(wallAsUtc));
    return wallAsUtc - off1;
  } catch {
    return wallAsUtc; // unknown zone → UTC midnight
  }
}

/**
 * Calendar-day bound semantics (ADR-0053 D-D) now live in `@objectstack/spec`,
 * beside the date-macro vocabulary they give meaning to — the fifth consumer
 * (`@objectstack/formula`'s RLS write-side `check` evaluator) cannot depend on
 * this package, and a second copy of the rule is exactly the divergence #3777
 * catalogued.
 *
 * Re-exported here so the published `@objectstack/core` surface is unchanged
 * for the drivers and analytics strategies that already import it from here.
 */
export { nextUtcCalendarDay, utcInstantMs } from '@objectstack/spec/data';

/**
 * Granularity of a canonical date-bucket key. Mirrors `@objectstack/spec`'s
 * `DateGranularity` enum but kept as a local literal union so this low-level
 * package needs no dependency on spec.
 */
export type BucketGranularity = 'day' | 'week' | 'month' | 'quarter' | 'year';

/**
 * ISO-8601 week label (Mon-start weeks, week 1 = the week of the first
 * Thursday) of a UTC calendar day. The forward-direction companion used to
 * *validate* a reconstructed week boundary; it mirrors the week branch of
 * `@objectstack/objectql`'s `bucketDateValue` (kept in lockstep by the
 * round-trip parity test in objectql).
 */
function isoWeekLabelUtc(d: Date): string {
  const target = new Date(d.getTime());
  const dayNum = (target.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3); // shift to that week's Thursday
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const weekNo =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * The half-open calendar span `[start, end)` of a canonical date-bucket KEY,
 * as `YYYY-MM-DD` strings (`start` inclusive, `end` exclusive — the next
 * bucket's first day).
 *
 * The input MUST be the canonical key produced by `bucketDateValue` /
 * `buildDateBucketExpr` (`2026`, `2026-Q2`, `2026-06`, `2026-06-15`,
 * `2026-W23`) — NEVER a localized / humanized display label. The span is pure,
 * timezone-naive calendar arithmetic; a caller that needs instant bounds for a
 * `datetime` field in a reference timezone layers that on top (and, per
 * ADR-0053, a `date` field compares against these `YYYY-MM-DD` bounds directly).
 *
 * Returns `null` for the empty bucket, an unparseable key, or a key that is
 * shape-valid but out of range (e.g. `2026-13`, a `-W53` in a 52-week year,
 * `2026-02-30`). Callers drop the range and fall back to an unscoped (superset)
 * drill rather than emit a wrong bound.
 *
 * `key` admits `null` because that IS the empty bucket's key on both aggregation
 * paths (#3839); callers pass a grouped row's dimension value straight through
 * rather than casting a lie.
 */
export function bucketKeyToCalendarRange(
  key: string | null | undefined,
  granularity: BucketGranularity,
): { start: string; end: string } | null {
  if (typeof key !== 'string' || key.length === 0) return null;
  const fmt = (dt: Date) =>
    `${String(dt.getUTCFullYear()).padStart(4, '0')}-${String(dt.getUTCMonth() + 1).padStart(
      2,
      '0',
    )}-${String(dt.getUTCDate()).padStart(2, '0')}`;

  switch (granularity) {
    case 'year': {
      const m = /^(\d{4})$/.exec(key);
      if (!m) return null;
      const y = Number(m[1]);
      return { start: fmt(new Date(Date.UTC(y, 0, 1))), end: fmt(new Date(Date.UTC(y + 1, 0, 1))) };
    }
    case 'quarter': {
      const m = /^(\d{4})-Q([1-4])$/.exec(key);
      if (!m) return null;
      const y = Number(m[1]);
      const startMonth = (Number(m[2]) - 1) * 3; // Q1→0, Q2→3, Q3→6, Q4→9
      return {
        start: fmt(new Date(Date.UTC(y, startMonth, 1))),
        end: fmt(new Date(Date.UTC(y, startMonth + 3, 1))), // Date.UTC rolls Q4 into next year
      };
    }
    case 'month': {
      const m = /^(\d{4})-(\d{2})$/.exec(key);
      if (!m) return null;
      const mo = Number(m[2]);
      if (mo < 1 || mo > 12) return null;
      const y = Number(m[1]);
      return {
        start: fmt(new Date(Date.UTC(y, mo - 1, 1))),
        end: fmt(new Date(Date.UTC(y, mo, 1))),
      };
    }
    case 'day': {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
      if (!m) return null;
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      const start = new Date(Date.UTC(y, mo - 1, d));
      if (fmt(start) !== key) return null; // reject an impossible day that rolled over
      return { start: key, end: fmt(new Date(Date.UTC(y, mo - 1, d + 1))) };
    }
    case 'week': {
      const m = /^(\d{4})-W(\d{2})$/.exec(key);
      if (!m) return null;
      const isoYear = Number(m[1]);
      const week = Number(m[2]);
      if (week < 1 || week > 53) return null;
      // Monday of ISO week 1 is the Monday on/before Jan 4; add (week-1) weeks.
      const jan4 = new Date(Date.UTC(isoYear, 0, 4));
      const jan4Dow = (jan4.getUTCDay() + 6) % 7; // Mon=0..Sun=6
      const start = new Date(jan4.getTime());
      start.setUTCDate(jan4.getUTCDate() - jan4Dow + (week - 1) * 7);
      if (isoWeekLabelUtc(start) !== key) return null; // reject -W53 overflow etc.
      const end = new Date(start.getTime());
      end.setUTCDate(start.getUTCDate() + 7);
      return { start: fmt(start), end: fmt(end) };
    }
    default:
      return null;
  }
}
