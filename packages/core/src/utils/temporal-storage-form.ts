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
 * are uninterpretable — a string this rule hands back unchanged, and [#20240] a
 * number or `Date` on a `date` column whose UTC year falls outside 0..9999, the
 * four-digit years a `YYYY-MM-DD` day can spell — is the question
 * `isUninterpretableTemporalComparand` (`temporal-comparand.ts`) answers for
 * the doors that refuse them.
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
 *   year below 0 or above 9999 has no `YYYY-MM-DD` form, keeps its unpadded
 *   spelling (`10000-01-01`, `-1-01-01`) for the write and read paths that
 *   call this rule, and is refused as a comparand by the temporal-comparand
 *   door.
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
  if (value == null) return value;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? value : value.toISOString();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (s === '') return value;
  // A bare integer (in either JS or string form) is epoch milliseconds — the
  // shape better-sqlite3 wrote for every `Date` bound before the canon (#3912).
  if (/^-?\d+$/.test(s)) {
    const d = new Date(Number(s));
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? `${s}T00:00:00.000Z`
    : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)
      ? `${s.replace(' ', 'T')}Z`
      : s;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
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
    // text (`'9' > '0'`). A year below 0 or above 9999 has no `YYYY-MM-DD`
    // form at all; it keeps the spelling it always had, and the
    // temporal-comparand door refuses it as a comparand before it reaches a
    // comparison (`isUninterpretableTemporalComparand`, `temporal-comparand.ts`).
    const y = instant.getUTCFullYear();
    const yyyy = y >= 0 ? String(y).padStart(4, '0') : String(y);
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
