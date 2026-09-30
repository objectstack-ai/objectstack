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
 * A wall clock as a human writes it — calendar day plus an optional
 * time-of-day, with **no zone attached**. `2026-08-01 06:00:00` is this shape:
 * it names a reading on a clock, and only a reference timezone turns it into an
 * instant. Omitted time components default to 0, so {@link CalendarParts} alone
 * is midnight.
 */
export interface WallClockParts extends CalendarParts {
  /** 0-23. */
  hour?: number;
  minute?: number;
  second?: number;
  millisecond?: number;
}

/**
 * [#20599] The epoch milliseconds of a wall clock read as **UTC**: `Date.UTC`
 * without its two-digit-year remap. The zone-free sibling of
 * {@link zonedWallClockToUtcMs}, and the one construction this package and its
 * callers use to build a UTC instant from year / month / day / time parts.
 *
 * Not `Date.UTC(year, …)` and not `new Date(year, …)`: both read a year from 0
 * to 99 as 1900 + year (ECMA-262 `MakeFullYear`), so `0050-01-01` is built as
 * 1950-01-01 — while 0001..9999 is a `date`'s supported range ([#20280] a
 * `datetime`'s is 1000..9999; `isOutsideTemporalYearRange`).
 * `setUTCFullYear` takes the year as written.
 *
 * Every component rolls over past its end exactly as `Date.UTC` rolls it, and
 * callers rely on that: `month: 13` is January of the next year, `month: 0` is
 * December of the previous one, `day: 0` is the previous month's last day,
 * `day: 32` runs into the next month, and `hour: 24` is the next day's
 * midnight. Omitted time components default to 0. A `NaN` or non-finite
 * component, or an instant outside the `Date` range, gives `NaN`, as
 * `Date.UTC` does.
 */
export function wallClockToUtcMs(parts: WallClockParts): number {
  const dt = new Date(0);
  dt.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return dt.setUTCHours(parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0, parts.millisecond ?? 0);
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
 *
 * Date-only by contract: a `YYYY-MM-DD HH:mm:ss` argument is still `NaN` here.
 * Callers holding a wall clock with a time-of-day want
 * {@link zonedWallClockToUtcMs}, which this delegates its zone arithmetic to.
 */
export function zonedDateStartToUtcMs(ymd: string, tz?: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return NaN;
  return zonedWallClockToUtcMs(
    { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) },
    tz,
  );
}

/**
 * The UTC instant (epoch ms) at which a **wall clock** reading happens in
 * reference timezone `tz` — the general inverse of {@link calendarPartsInTz},
 * of which {@link zonedDateStartToUtcMs} is the midnight special case.
 *
 * `2026-08-01 06:00:00` in `Asia/Shanghai` is `2026-07-31T22:00:00Z`: a
 * different day, month and quarter. That gap is why this direction exists as a
 * shared primitive at all — bulk import (#8485) reads offset-free spreadsheet
 * cells, which are wall clocks and nothing more, and `new Date(cell)` resolves
 * them against the **process** `TZ`, i.e. a host setting rather than the
 * tenant's configured zone.
 *
 * DST-safe: the zone offset is read from the platform tz database via
 * `Intl.DateTimeFormat` (never hand-computed), and a two-pass resolution settles
 * the case where the offset differs side-to-side of the target instant. Two
 * wall clocks are not a bijection with instants, and this function resolves
 * both degenerate cases to the **earlier candidate instant** — in both, the
 * final pass reads the offset on the DST side of the transition (measured, not
 * merely intended — `datetime.test.ts` pins both):
 *  - a clock reading the zone **skips** (spring forward: `02:30` on a US
 *    spring-forward day) settles on the *post*-transition offset (EDT, −04),
 *    which places the instant just **before** the gap: it reads `01:30` EST
 *    locally, not `03:30` EDT. Note this is the opposite of Temporal's
 *    `'compatible'` disambiguation, which pushes a gap reading forward;
 *  - a clock reading that happens **twice** (fall back: `01:30` on a US
 *    fall-back day) resolves to its first occurrence, the one still on the
 *    pre-transition DST offset (EDT, −04).
 *
 * A spreadsheet cell naming a wall clock that its zone never had is ambiguous
 * by construction; what matters for an import is that the answer is
 * deterministic and host-independent, which both branches above are.
 *
 * FALLBACK — an unset, `'UTC'`, or invalid `tz` reads the wall clock **as UTC**,
 * never as the process-local clock. Every caller of this family already degrades
 * that way ({@link zonedDateStartToUtcMs}, and the export renderer's cell path),
 * and a host `TZ` fallback would reintroduce exactly the deployment-dependent
 * instant this primitive exists to remove. A parts object that produces an
 * invalid date (`NaN` components) returns `NaN`, as `Date.UTC` does.
 *
 * [#20599] A year from 0001 to 0099 is read as written, never as 1900 + year:
 * both the wall clock and the offset read below go through
 * {@link wallClockToUtcMs}, not `Date.UTC`. The offset read takes the zone's
 * year with its era, because `Intl`'s `year` part is an ERA year — 1 BC reads
 * `1` — and the first probe for a wall clock early on 0001-01-01 in a zone
 * west of UTC lands in year 0.
 */
export function zonedWallClockToUtcMs(parts: WallClockParts, tz?: string): number {
  const wallAsUtc = wallClockToUtcMs(parts);
  if (!tz || tz === 'UTC' || Number.isNaN(wallAsUtc)) return wallAsUtc;
  try {
    // The tz offset (local − UTC, in ms) at instant `t`: read t's wall clock in
    // `tz`, re-interpret those parts as UTC, and subtract t. `formatToParts`
    // resolves no finer than a second, so `t` is truncated to a whole second
    // first — otherwise a sub-second wall clock leaks its milliseconds into the
    // "offset" and shifts the answer by them (a real defect while generalising
    // this from the date-only form, where ms was always 0).
    const offsetAt = (t: number): number => {
      const whole = Math.floor(t / 1000) * 1000;
      const p = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        era: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).formatToParts(new Date(whole));
      const g = (k: string) => Number(p.find((x) => x.type === k)?.value);
      const eraYear = g('year');
      const year = p.find((x) => x.type === 'era')?.value === 'BC' ? 1 - eraYear : eraYear;
      return (
        wallClockToUtcMs({
          year,
          month: g('month'),
          day: g('day'),
          hour: g('hour'),
          minute: g('minute'),
          second: g('second'),
        }) - whole
      );
    };
    // Want U such that localParts(U) == the wall clock, i.e. U = wallAsUtc − offset(U).
    // Iterate from the zero-offset guess; converges in ≤2 steps off a DST edge.
    const off1 = offsetAt(wallAsUtc - offsetAt(wallAsUtc));
    return wallAsUtc - off1;
  } catch {
    return wallAsUtc; // unknown zone → the wall clock read as UTC
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
 * [#20600] `UNBOUNDED_ABOVE`, its type `UnboundedAbove` and the guard
 * `isUnboundedAbove` travel with the helper: the constant is the helper's answer
 * for `9999-12-31`, and every caller of one narrows it with the guard.
 */
export { nextUtcCalendarDay, utcInstantMs, UNBOUNDED_ABOVE, isUnboundedAbove } from '@objectstack/spec/data';
export type { UnboundedAbove } from '@objectstack/spec/data';

/**
 * Granularity of a canonical date-bucket key. Mirrors `@objectstack/spec`'s
 * `DateGranularity` enum but kept as a local literal union so this low-level
 * package needs no dependency on spec.
 */
export type BucketGranularity = 'day' | 'week' | 'month' | 'quarter' | 'year';

/**
 * The granularities that HAVE a canonical bucket key — the accepted set of
 * {@link bucketDateKey}, in ascending order.
 *
 * `@objectstack/spec`'s `TimeUpdateInterval` declares three more (`second`,
 * `minute`, `hour`) for which the contract defines no canonical key vocabulary
 * anywhere. Exported so a face that has to refuse one of those names the
 * accepted set FROM HERE: a hand-listed copy in a refusal message agrees with
 * this one on the day it is typed and never again.
 */
export const BUCKET_GRANULARITIES: readonly BucketGranularity[] = [
  'day',
  'week',
  'month',
  'quarter',
  'year',
];

/**
 * Is `value` one of the five granularities {@link bucketDateKey} can label?
 *
 * The guard a caller holding a wider vocabulary (`TimeUpdateInterval`) uses to
 * split "bucket it" from "refuse it" without restating either set.
 */
export function isBucketGranularity(value: unknown): value is BucketGranularity {
  return typeof value === 'string' && (BUCKET_GRANULARITIES as readonly string[]).includes(value);
}

/**
 * The canonical date-bucket KEY an instant falls in, as seen in a reference
 * timezone — the FORWARD direction of {@link bucketKeyToCalendarRange}, and the
 * one labeller the in-memory bucketing faces delegate to.
 *
 * ⚠️ **The label vocabulary is an output contract, not a display choice.** A
 * driver that advertises `supports.queryDateGranularity[g]` buckets that
 * granularity in SQL instead and `engine.aggregate` picks between the two per
 * query, so a label produced here must equal the label that driver's SQL
 * produces for the same instant, or a drill-down breaks when it crosses the
 * seam. `2026`, `2026-Q2`, `2026-06`, `2026-06-15`, `2026-W23` — editing them
 * means editing every driver's bucket expression too. The seam is enforced by
 * `checkDateBucketParity` (`@objectstack/verify`).
 *
 * `timezone` (ADR-0053 Phase 2) resolves the calendar day in a reference zone so
 * an instant near a tz day-boundary buckets where a user in that zone would
 * expect. An unset / `'UTC'` / invalid zone keeps UTC bucketing. The y/m/d are
 * taken in the reference zone and the ISO-week math then runs on a UTC date
 * built from those parts — the parts already carry the zone shift, so the week
 * boundary lands correctly without re-applying any offset.
 *
 * A finite NUMBER is read as epoch milliseconds — the form SQLite stores a
 * `Field.datetime` in, and what any driver that hands back raw storage values
 * yields. `new Date(String(1767225600000))` is an Invalid Date, so without this
 * branch such a row lands in the empty bucket while the pushed-down SQL buckets
 * it correctly (#3773) — the two paths must label the same instant identically
 * or a drill-down built on one breaks against the other.
 *
 * Returns `null` for a null/absent or unparseable instant — the same key the
 * pushed-down SQL yields, where the bucket expression propagates NULL (#3839).
 * Null and unparseable deliberately share one bucket: SQL cannot tell them apart
 * either (`strftime('%Y-%m', 'not-a-date')` is NULL), and splitting them here
 * would re-open the seam this function exists to close.
 *
 * [#20760] The year of every key is spelled with four digits
 * ({@link bucketKeyYear}): `0050`, `0050-Q2`, `0050-06`, `0050-06-15`,
 * `0049-W52` — what the drivers' bucket expressions answer for the same
 * instant. A `date` value keeps the years 0001..9999, and a `datetime` row
 * stored before the engine doors refused a year below 1000 can still hold one,
 * so 0001..0999 reach this function.
 */
export function bucketDateKey(
  value: unknown,
  granularity: BucketGranularity,
  timezone?: string,
): string | null {
  if (value == null) return null;
  const d =
    value instanceof Date
      ? value
      : typeof value === 'number'
        ? new Date(value)
        : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  const { year: y, month: m, day } = calendarPartsInTzOrUtc(d, timezone);
  switch (granularity) {
    case 'year':
      return bucketKeyYear(y);
    case 'quarter':
      return `${bucketKeyYear(y)}-Q${Math.floor((m - 1) / 3) + 1}`;
    case 'month':
      return `${bucketKeyYear(y)}-${String(m).padStart(2, '0')}`;
    case 'day':
      return bucketDayKey(y, m, day);
    case 'week':
      return isoWeekLabelFromCalendarDay(y, m, day);
    default:
      // Unreachable through `BucketGranularity`. Kept as the same echo
      // `@objectstack/objectql`'s `bucketDateValue` has always answered an
      // off-type JS caller — this function is that one's delegate, so it must
      // not change the answer for any input that already had one.
      return String(value);
  }
}

/**
 * [#20760] The year of a bucket key, spelled with four digits: `50` is
 * `0050`, `999` is `0999`, `2026` is `2026`.
 *
 * The ONE statement of the key's year spelling. Every key
 * {@link bucketDateKey} writes, the ISO week label, and the calendar bounds
 * {@link bucketKeyToCalendarRange} answers spell their year through it, so
 * the writer and the reader cannot disagree about it. It is the width the
 * drivers' bucket expressions answer (`strftime('%Y')` on SQLite, `YYYY` /
 * `IYYY` in PostgreSQL's `to_char`, `%Y` / `%x` in MySQL's `date_format`),
 * and `bucketDateKey`'s contract is that its label equals theirs.
 *
 * A year below 0 has no four-digit form and keeps its plain spelling (`-1`),
 * never a padded fragment such as `00-1`; a year past 9999 is longer than four
 * digits already. Neither is reached: at both engine doors a `date` value
 * names a year from 0001 to 9999 and a `datetime` one a year from 1000 to
 * 9999, and {@link bucketKeyToCalendarRange} reads neither spelling.
 */
function bucketKeyYear(year: number): string {
  return year >= 0 ? String(year).padStart(4, '0') : String(year);
}

/** [#20760] The `day` key (`YYYY-MM-DD`) of a calendar day, `month` 1-12. */
function bucketDayKey(year: number, month: number, day: number): string {
  return `${bucketKeyYear(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * ISO-8601 week label (Mon-start weeks, week 1 = the week of the first
 * Thursday) of a calendar day given that day's parts (`month` is 1-12).
 *
 * The ONE statement of the week rule in this package: {@link bucketDateKey}'s
 * `week` branch and {@link isoWeekLabelUtc} both call it, so the forward label
 * and the round-trip validator that checks it cannot drift apart.
 *
 * [#20599] Both days are built by {@link wallClockToUtcMs}, so a day in
 * 0001..0099 lands in its own ISO week, never in the 1900s one.
 *
 * [#20760] The label's year is the ISO week-numbering year, spelled with four
 * digits ({@link bucketKeyYear}). Early in January it can be the previous
 * calendar year: 0050-01-01 is in `0049-W52`.
 */
function isoWeekLabelFromCalendarDay(year: number, month: number, day: number): string {
  const target = new Date(wallClockToUtcMs({ year, month, day }));
  const dayNum = (target.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3); // shift to that week's Thursday
  const firstThursday = new Date(wallClockToUtcMs({ year: target.getUTCFullYear(), month: 1, day: 4 }));
  const weekNo =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${bucketKeyYear(target.getUTCFullYear())}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * ISO-8601 week label of a UTC calendar day — the forward-direction companion
 * used to *validate* a reconstructed week boundary below.
 */
function isoWeekLabelUtc(d: Date): string {
  return isoWeekLabelFromCalendarDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
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
 *
 * [#20599] Every bound is built by {@link wallClockToUtcMs}, so a key in
 * 0001..0099 (`0050`, `0050-Q1`, `0050-01`, `0050-01-01`) spans its own year,
 * never the 1900s one. The arms lean on its rollover, which is `Date.UTC`'s:
 * month 13 is next January (Q4's and December's end), and day 32 the next
 * month.
 *
 * [#20760] It reads exactly what {@link bucketDateKey} writes: a four-digit
 * year at every granularity, the week key included (`0050-W01`). The day and
 * week arms check a key against the label the writer gives the reconstructed
 * day, and every bound is spelled by the writer's own day key, so the reader
 * cannot drift from the writer. An unpadded key (`50-06`, `49-W52`) is not a
 * bucket key and answers `null`.
 */
export function bucketKeyToCalendarRange(
  key: string | null | undefined,
  granularity: BucketGranularity,
): { start: string; end: string } | null {
  if (typeof key !== 'string' || key.length === 0) return null;
  const fmt = (dt: Date) => bucketDayKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  /** Midnight UTC of `year`-`month`-`day`, `month` 1-12, rolled over past its end. */
  const utcDay = (year: number, month: number, day: number) =>
    new Date(wallClockToUtcMs({ year, month, day }));

  switch (granularity) {
    case 'year': {
      const m = /^(\d{4})$/.exec(key);
      if (!m) return null;
      const y = Number(m[1]);
      return { start: fmt(utcDay(y, 1, 1)), end: fmt(utcDay(y + 1, 1, 1)) };
    }
    case 'quarter': {
      const m = /^(\d{4})-Q([1-4])$/.exec(key);
      if (!m) return null;
      const y = Number(m[1]);
      const startMonth = (Number(m[2]) - 1) * 3 + 1; // Q1→1, Q2→4, Q3→7, Q4→10
      return {
        start: fmt(utcDay(y, startMonth, 1)),
        end: fmt(utcDay(y, startMonth + 3, 1)), // month 13 rolls Q4 into next year
      };
    }
    case 'month': {
      const m = /^(\d{4})-(\d{2})$/.exec(key);
      if (!m) return null;
      const mo = Number(m[2]);
      if (mo < 1 || mo > 12) return null;
      const y = Number(m[1]);
      return {
        start: fmt(utcDay(y, mo, 1)),
        end: fmt(utcDay(y, mo + 1, 1)),
      };
    }
    case 'day': {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
      if (!m) return null;
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      const start = utcDay(y, mo, d);
      if (fmt(start) !== key) return null; // reject an impossible day that rolled over
      return { start: key, end: fmt(utcDay(y, mo, d + 1)) };
    }
    case 'week': {
      const m = /^(\d{4})-W(\d{2})$/.exec(key);
      if (!m) return null;
      const isoYear = Number(m[1]);
      const week = Number(m[2]);
      if (week < 1 || week > 53) return null;
      // Monday of ISO week 1 is the Monday on/before Jan 4; add (week-1) weeks.
      const jan4 = utcDay(isoYear, 1, 4);
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
