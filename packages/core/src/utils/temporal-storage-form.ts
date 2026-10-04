// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20176] THE storage form of a temporal value — one rule, read by every face
 * that compares one.
 *
 * ADR-0053 fixes one LOGICAL storage form per temporal field type:
 *
 * | Field type | Stored as | Why |
 * |---|---|---|
 * | `datetime` | canonical UTC ISO text, `YYYY-MM-DDTHH:MM:SS.sssZ` (`Date#toISOString`) | fixed width + UTC, so text order IS chronological order, and it is the wire form (D-B) |
 * | `date` | `YYYY-MM-DD` | a timezone-naive calendar day (Phase 1) |
 * | `time` | `HH:MM:SS`, `.fff` only when non-zero | a timezone-naive wall clock (D-C1); `.` sorts below every digit, so the two widths still sort chronologically |
 *
 * A filter comparand must be put into the column's form before it is compared,
 * or the comparison is decided by the two sides' SHAPES disagreeing rather than
 * by their values. Three faces apply that pairing:
 *
 * - `driver-sql` — on write (`formatInput`), on read presentation and on every
 *   `where` comparand (`coerceFilterValue`, public as `temporalFilterValue`).
 *   A MySQL `datetime` then takes a PHYSICAL spelling of the same instant
 *   (`mysqlDatetimeLiteral`), which stays the driver's: it is a dialect's
 *   literal syntax, not a second rule.
 * - `driver-memory` — on write and on every `where` comparand
 *   (`coerceTemporalValue`).
 * - `@objectstack/objectql` — a per-aggregation `filter` and `having`, which
 *   the engine evaluates itself over the rows a driver returned
 *   (`having-filter.ts`, with the column's class from the object's declaration
 *   or the aggregated row's).
 *
 * Each driver used to carry its own copy of the three functions below, word for
 * word; the engine carried none and compared type-blind, so an ISO instant
 * against a `date` column counted 1 row where the same condition in a `where`
 * counted 3. The copies agreed shape for shape when they were lifted here
 * (measured on 71 shapes × 3 kinds: `Date`s valid, invalid and out of range,
 * epoch numbers and strings, bare days, zone-naive and zone-explicit
 * timestamps, wall clocks in and out of range, junk, `null`, structures) — so
 * this is a move, not a change, for either driver.
 *
 * ## Form only, never bound semantics
 *
 * The function is operator-blind. The whole-day reading of a bare
 * `YYYY-MM-DD` used as an UPPER bound on a `datetime` column (`$lte`, a
 * `$between` max → `< nextUtcCalendarDay(day)`, ADR-0053 D-D) is a separate,
 * operator-sensitive rule every emitter applies BEFORE this one, from
 * `@objectstack/spec/data`'s `nextUtcCalendarDay`.
 *
 * ## Total, on purpose
 *
 * `null` / `undefined`, the empty string, an out-of-range wall clock
 * (`'25:00'`), an Invalid Date and unparseable junk come back UNCHANGED rather
 * than as an invented value — a value the rule cannot interpret is never
 * silently rewritten, so junk keeps failing its comparison. Which comparands
 * are uninterpretable — a string this rule hands back unchanged, and a value
 * outside the supported years below — is the question
 * `isUninterpretableTemporalComparand` (`temporal-comparand.ts`) answers for
 * the doors that refuse them.
 *
 * ## [#20264] The supported years: a `date` 0001 to 9999, a `datetime` 1000 to 9999
 *
 * A `date` value names a year from 0001 to 9999, and [#20280] a `datetime`
 * value a year from 1000 to 9999, or it is refused: `INVALID_FILTER` / 400 as
 * a comparand, at the engine's temporal-comparand door (`where`, a
 * per-aggregation `filter`, `having`), and `VALIDATION_FAILED` / 400 as a
 * written value, at the record validator. Both doors ask
 * {@link isOutsideTemporalYearRange}, so there is one range per kind.
 *
 * - Above 9999 the forms stop being fixed-width text: `toISOString()` spells
 *   `+010000-01-01T00:00:00.000Z`, which sorts below every four-digit year, and
 *   PostgreSQL refuses it.
 * - Below 0001 there is year 0 and before. PostgreSQL's `DATE` and
 *   `timestamptz` have no year 0 (`0000-06-15` is `date/time field value out of
 *   range`), and a negative year's spelling (`-000001-…`) orders as no instant
 *   does.
 * - Every shipped backend holds 0001..9999 for a `date`. [#20280] A `datetime`
 *   starts at 1000, MySQL's documented `DATETIME` floor: MySQL documents its
 *   `DATETIME` from year 1000 only, and reads a stored `DATETIME` in years
 *   0001..0099 back a century late through its client's instant parser, which
 *   ADR-0053 D-F2 keeps. The range is the contract on every backend, never a
 *   dialect's: a `datetime` before 1000 is refused on SQLite, PostgreSQL and
 *   the in-memory driver too, which would have held it.
 *
 * The rule itself stays total: a year outside the range keeps the spelling
 * `toISOString()` or the unpadded year gives it on the write and read paths
 * that call this function — no ordered form is invented — and the doors refuse
 * it before it gets there.
 */

import type { TemporalComparandKind } from './temporal-comparand.js';

/**
 * The storage form of `value` for a column of `kind` — see the module note for
 * the table.
 *
 * - `datetime`: a `Date` → its ISO text; a finite number, or a bare integer
 *   string in either sign → epoch milliseconds; a bare `YYYY-MM-DD` → midnight
 *   UTC, stated explicitly so it is never re-read in a server's local zone; a
 *   zone-naive `YYYY-MM-DD[ T]HH:MM[:SS[.fff]]` → its wall clock read AS UTC
 *   (the rule `CURRENT_TIMESTAMP`-written rows take on read, ADR-0074); any
 *   other string → whatever `Date.parse` reads, re-spelled in UTC. `Z`
 *   everywhere: `'…T12:00+08:00'` and `'…T04:00Z'` are one instant but sort
 *   differently as text.
 * - `date`: a `Date` → its UTC calendar day (the UTC clock, never the host's —
 *   `SqlDriver.toDateOnly` records why); a finite number → epoch milliseconds,
 *   read as the `Date` of that value and so its UTC calendar day (a time of
 *   day is dropped, never rounded); a string → its leading `YYYY-MM-DD`. The
 *   year of a `Date` or a number is padded to four digits (`0999-06-15`); a
 *   year outside 0001..9999 has no `YYYY-MM-DD` form, keeps its unpadded
 *   spelling (`10000-01-01`, `0-06-15`, `-1-01-01`) for the write and read
 *   paths that call this rule, and is refused by the doors in front of them
 *   (see the module note's supported years).
 * - `time`: a bare `HH:MM[:SS[.f…]]` in range → `HH:MM:SS`, `.fff` kept only
 *   when non-zero (fractions beyond milliseconds truncated); anything else is
 *   read as an INSTANT by the `datetime` rule and keeps its UTC time of day.
 *
 * An array is NOT mapped — a caller comparing a list maps its members, the way
 * the drivers' `coerceFilterValue` / `coerceTemporalValue` do.
 */
export function temporalStorageForm(value: unknown, kind: TemporalComparandKind): unknown {
  if (kind === 'datetime') return canonicalUtcDatetime(value);
  if (kind === 'time') return canonicalTimeOfDay(value);
  return canonicalCalendarDay(value);
}

function canonicalUtcDatetime(value: unknown): unknown {
  const ms = instantMs(value);
  return ms === undefined ? value : new Date(ms).toISOString();
}

/**
 * The instant the `datetime` rule reads `value` as, in epoch milliseconds, or
 * `undefined` when it reads none — the one reading {@link canonicalUtcDatetime}
 * spells and [#20264] {@link isOutsideTemporalYearRange} takes the year of.
 */
function instantMs(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? undefined : t;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? undefined : t;
  }
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  if (s === '') return undefined;
  // A bare integer (in either JS or string form) is epoch milliseconds — the
  // shape better-sqlite3 wrote for every `Date` bound before the canon (#3912).
  if (/^-?\d+$/.test(s)) return instantMs(Number(s));
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? `${s}T00:00:00.000Z`
    : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)
      ? `${s.replace(' ', 'T')}Z`
      : s;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * [#20264] The supported years of each kind, the first and the last inclusive —
 * [#20280] a `date` from 0001, a `datetime` from 1000, MySQL's documented
 * `DATETIME` floor (see the module note); both to 9999. The one range
 * {@link isOutsideTemporalYearRange} judges a value by. The `date` entry's
 * first year is also the year the `date` rule pads to four digits from
 * ({@link canonicalCalendarDay}).
 *
 * [#20846] Exported so a refusal can NAME the range it refused a value for —
 * the record validator's and the import's sentence for a readable value in a
 * year outside it — from this one source, never from a copy of its numbers.
 */
export const SUPPORTED_TEMPORAL_YEARS: Readonly<
  Record<'date' | 'datetime', Readonly<{ first: number; last: number }>>
> = Object.freeze({
  date: Object.freeze({ first: 1, last: 9999 }),
  datetime: Object.freeze({ first: 1000, last: 9999 }),
});

/**
 * [#20264] Does `value` name a year outside the supported years for a column
 * of `kind` — 0001..9999 for a `date`, [#20280] 1000..9999 for a `datetime`?
 * The one range both doors ask — the temporal-comparand door on a comparand,
 * the record validator on a written value; see the module note.
 *
 * The year is the one the kind's rule reads:
 *
 * - `datetime`: the UTC year of the instant {@link canonicalUtcDatetime}
 *   reads, so `9999-12-31T23:59:59-01:00` (year 10000 in UTC) is outside and
 *   [#20280] `1000-01-01T00:00:00+08:00` (year 999 in UTC) is outside too.
 * - `date`: a string's leading `YYYY-MM-DD` year; otherwise — a number, a
 *   `Date`, or a string with no leading day that still names an instant, such
 *   as `+010000-01-01T00:00:00.000Z` — the UTC year of that instant, whose UTC
 *   calendar day the rule takes.
 * - `time`: never. A wall clock has no year.
 *
 * A finite number past ±8.64e15 names an instant the `Date` type cannot hold,
 * a year past ±271821, so it is outside. `null`, `NaN`, ±Infinity, an Invalid
 * Date and a string that names no instant name no year: `false`, and whether
 * such a value is refused is the caller's other question.
 */
export function isOutsideTemporalYearRange(value: unknown, kind: TemporalComparandKind): boolean {
  if (kind === 'time') return false;
  if (typeof value === 'number' && Number.isFinite(value) && instantMs(value) === undefined) return true;
  let year: number | undefined;
  if (kind === 'date' && typeof value === 'string') {
    const day = /^(\d{4})-\d{2}-\d{2}/.exec(value.trim());
    if (day) year = Number(day[1]);
  }
  if (year === undefined) {
    const ms = instantMs(value);
    if (ms === undefined) return false;
    year = new Date(ms).getUTCFullYear();
  }
  const { first, last } = SUPPORTED_TEMPORAL_YEARS[kind];
  return year < first || year > last;
}

function canonicalCalendarDay(value: unknown): unknown {
  if (value == null) return value;
  // [#20203] A finite number is epoch milliseconds — the reading the
  // `datetime` rule above gives it — so it names the instant `new Date(value)`
  // names and takes that `Date`'s UTC calendar day, through the one conversion
  // below. A number and its `Date` therefore always agree; a number the `Date`
  // range cannot hold (past ±8.64e15), `NaN` and ±Infinity come back unchanged.
  const instant = typeof value === 'number' && Number.isFinite(value) ? new Date(value) : value;
  if (instant instanceof Date) {
    if (Number.isNaN(instant.getTime())) return value;
    // [#20240] The year is padded to four digits, the width `YYYY-MM-DD`
    // declares and the ISO-string and bare-day arms below already produce:
    // `0999-06-15`, never `999-06-15`, which sorted above every padded day as
    // text (`'9' > '0'`). [#20264] The padding covers 0001..0999, the padded
    // part of a `date`'s supported years: a year outside 0001..9999 — year 0
    // included, which PostgreSQL's `DATE` does not have — has no `YYYY-MM-DD`
    // form here; it keeps its unpadded spelling, and the doors refuse it
    // before it reaches a comparison or a write
    // ({@link isOutsideTemporalYearRange}). [#20280] The `date` floor, never
    // the `datetime` one: a calendar day in 0001..0999 is a supported `date`.
    const y = instant.getUTCFullYear();
    const yyyy = y >= SUPPORTED_TEMPORAL_YEARS.date.first ? String(y).padStart(4, '0') : String(y);
    const m = String(instant.getUTCMonth() + 1).padStart(2, '0');
    const d = String(instant.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${m}-${d}`;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  }
  return value;
}

function canonicalTimeOfDay(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    const s = value.trim();
    if (s === '') return value;
    const m = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(s);
    if (m) {
      const [, hh, mm, ss = '00', frac] = m;
      if (Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59) return value;
      const ms = frac ? `${frac}000`.slice(0, 3) : '000';
      return ms === '000' ? `${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}.${ms}`;
    }
  }
  // Not a bare wall clock — a `Date`, epoch ms, or a full / zone-naive
  // timestamp: an instant. Read it by the ONE instant rule, keep its UTC time.
  const instant = canonicalUtcDatetime(value);
  if (typeof instant === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(instant)) {
    const time = instant.slice(11, 23);
    return time.endsWith('.000') ? time.slice(0, 8) : time;
  }
  return value;
}
