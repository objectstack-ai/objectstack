// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8690] Can a temporal field's storage rule READ this comparand at all?
 *
 * The one predicate behind the engine's temporal-comparand door
 * (`@objectstack/objectql`, `temporal-comparand-door.ts`) and the analytics
 * raw-SQL decline (`@objectstack/service-analytics`,
 * `NativeSQLStrategy.canHandle`). It lives in `core` because those two packages
 * do not depend on each other and a rule that exists twice is a rule that will
 * disagree with itself — the shape the 2026-08-12 ruling named by name.
 *
 * ## The defect it exists to close
 *
 * A `datetime` field filtered with a bare string the API cannot take literally
 * — `last_30_days`, `not-a-date-at-all` — was bound AS-IS all the way to the
 * driver, where the comparison is false for every row. Measured end to end on
 * `InMemoryDriver` with 51 rows seeded / 38 in-window:
 *
 * ```
 * $gte "last_30_days"       HTTP 200  count=0    <- silent zero (the defect)
 * $gte "not-a-date-at-all"  HTTP 200  count=0    <- silent zero
 * $gte "{30_days_ago}"      HTTP 200  count=38   <- the positive control
 * $gte "{TODAY}"            REFUSED   FILTER_TOKEN_UNKNOWN / 400
 * ```
 *
 * A `{placeholder}` the resolver does not know is refused loudly; a bare string
 * that is not a date was not validated at all. An empty chart is the hardest
 * failure to debug — it is indistinguishable from "there is genuinely no data".
 *
 * ## Why the KIND is an argument, and not something this file works out
 *
 * "Uninterpretable comparand" is a field-TYPED judgement, and `packages/spec`
 * says so outright (`filter.zod.ts`): a filter schema "is field-AGNOSTIC … it
 * never sees which column the operator is applied to". This module therefore
 * answers only the VALUE half — given a kind, can that kind's storage rule read
 * this value — and the caller, which owns object metadata, supplies the kind.
 * That split is what lets the rule sit below both consumers without dragging
 * field metadata down with it.
 *
 * ## Interpretability is defined by the DRIVERS' own totals, deliberately
 *
 * Each predicate below mirrors the total function that would receive the value
 * if the door let it through — `temporalStorageForm` (`temporal-storage-form.ts`,
 * the one rule both drivers read since #20176; before it, a copy in each).
 * That function is total on purpose: an input it cannot interpret is returned
 * UNCHANGED rather than becoming an invented instant. So, for a STRING, "the
 * driver would return it unchanged" is the first half of the definition of
 * uninterpretable.
 *
 * [#20549] The second half is the write door's: a string is also
 * uninterpretable when the rule READS it, but not as the value it names, and
 * the record validator refuses the same string as a written value for that
 * reason. Two readings, both `Date.parse`'s:
 *
 * - **A calendar day that does not exist.** `Date.parse` rolls
 *   `"2026-02-30T10:00:00Z"` over to March 2, so the comparand matched the
 *   row stored on March 2; the `date` rule keeps `"2026-02-30"` as written and
 *   compares it as text, and PostgreSQL refuses it (`22008`). Only a real
 *   leading `YYYY-MM-DD` is read now ({@link namesRealCalendarDay}), for a
 *   `date`, for the day part of a `datetime`, and for the day part of an
 *   instant on a `time` column.
 * - **A `datetime` string outside the ISO 8601 spellings the platform writes**
 *   ({@link ISO_DATETIME_WRITE_FORM}). `Date.parse` reads `"07/15/2026 10:00"`
 *   and `"2026/07/15 10:00"` in the SERVER PROCESS's zone, so the rows a filter
 *   matched were a property of the host; it reads `"07/08/2026"` month-first.
 *   A bare integer string is not one of them either: the rule reads it as
 *   epoch milliseconds, so `"2026"` meant two seconds after 1970 and matched
 *   every later row. Epoch milliseconds stay a comparand as a NUMBER, which no
 *   one can mistake for a year.
 *
 * Both halves together are the one rule for a string, and the record
 * validator's `date` / `datetime` arm asks this function rather than a copy of
 * it — so a string is refused as a comparand exactly when it is refused as a
 * written value.
 *
 * [#20240] One non-string class is uninterpretable by the same test's other
 * half — the rule cannot put it in the column's form. On a `date` column a
 * finite number or a `Date` becomes its UTC calendar day, and a year outside
 * the four-digit ones has no `YYYY-MM-DD` spelling: the rule keeps writing
 * `10000-01-01` / `-1-01-01` for the write and read paths, but as a comparand
 * that text orders as no day does (`10000-01-01` sorts below `2026-…`), and
 * PostgreSQL refuses `-1-01-01` outright. So such a comparand is judged
 * uninterpretable here, exactly as an unparseable string is, and refused by
 * the same doors.
 *
 * [#20264] That class is now the supported years, 0001..9999, on `date` AND
 * `datetime`, and in every spelling the kind's rule reads — a number, a `Date`
 * or a string. `datetime` spells an instant past 9999 `+010000-…` and one
 * before year 0 `-000001-…`, which sort as no instant does, and PostgreSQL
 * answers `22009` / `22007`; year 0 is refused on both kinds because
 * PostgreSQL's `DATE` and `timestamptz` have no year 0 (`22008`). The range is
 * `temporal-storage-form.ts`'s `isOutsideTemporalYearRange`, the one the
 * record validator asks of a written value too; this predicate only calls it.
 *
 * [#20480] A `time` column reads an instant by the `datetime` rule and keeps
 * its UTC time of day, and it can only keep one whose UTC year has a
 * four-digit spelling: the rule hands `+010000-01-01T10:00:00Z`,
 * `9999-12-31T23:00:00-02:00` (year 10000 in UTC), `-000001-…` and the number
 * or `Date` of any of them back unchanged, so the driver compared the raw
 * value with stored `HH:MM:SS` text — `$gt` answered 3 of 3 rows on memory and
 * SQLite and a 500 on PostgreSQL for the first, and the others answered 0 or
 * 3 rows by driver. Such an instant is uninterpretable on a `time` column, in
 * every spelling, and no time of day is read from it: the same rule as the
 * supported years of `date` and `datetime`, now covering the third kind.
 * Year 0 is not in this class — its instant spells `0000-…`, and the rule
 * keeps its time of day.
 *
 * ## Two things it deliberately does NOT judge
 *
 * - **Non-string comparands, save the year classes above.** A number is epoch
 *   milliseconds, a `Date` is an instant, `null` is a null test, and the
 *   `time` rule reads every finite one whose UTC year has four digits; so do
 *   the `date` and `datetime` rules for a year from 0001 to 9999. The #8690 refusal was scoped to strings by that
 *   card's own ruling — its triage queued "a non-interpretable bare string", and
 *   the maintainer ruling scoped its two options "to non-empty strings" so the
 *   empty-string cell stayed its own card. That scoped that change; it is not a
 *   standing rule that a non-string is never refused. [#20240] extends the
 *   refusal to the `date` class above by the triage direction on that card,
 *   [#20264] to `datetime` and the range 0001..9999 by triage's ruling, and
 *   [#20480] to a `time` column's instant outside the four-digit years.
 *   `NaN`, ±Infinity and an Invalid Date name no instant and no year, so they
 *   are not that class and stay unjudged, as before; no JSON body can carry
 *   one (JSON spells them `null`).
 * - **The EMPTY string.** Measured, `$gte ""` binds as `''` and every canonical
 *   UTC text sorts at or above it, so it returns every non-null row — a third
 *   behaviour again, and one the maintainer ruled stays its own card: "B and C
 *   scope to non-empty strings and must not decide it in passing". A
 *   whitespace-only string is the same cell (the drivers `trim()` before they
 *   test), so it is left alone too.
 */

import { classifyFilterToken } from '@objectstack/spec/data';
import { isOutsideTemporalYearRange, temporalStorageForm } from './temporal-storage-form.js';

/** Which temporal storage rule a declared field takes. */
export type TemporalComparandKind = 'datetime' | 'date' | 'time';

/**
 * The kind a declared field's `type` takes, or `null` for every non-temporal
 * field.
 *
 * The same three-way split `driver-memory`'s `indexTemporalFields` and
 * `SqlDriver.temporalFieldKind` make, so the door and the drivers cannot
 * disagree about which fields are temporal at all.
 */
export function temporalComparandKind(fieldType: unknown): TemporalComparandKind | null {
  if (fieldType === 'datetime') return 'datetime';
  if (fieldType === 'date') return 'date';
  if (fieldType === 'time') return 'time';
  return null;
}

/**
 * [#20525] [#20549] The ISO 8601 spellings a `datetime` STRING is read in,
 * after trimming — the ones the platform itself writes, each read the same on
 * every host by the `datetime` storage rule (`temporalStorageForm`):
 *
 * - `YYYY-MM-DD` — midnight UTC;
 * - `YYYY-MM-DDTHH:MM[:SS[.f…]]`, then `Z`, a `±HH:MM` / `±HHMM` offset, or
 *   nothing — a zone-naive wall clock is read AS UTC (ADR-0074);
 * - `YYYY-MM-DD HH:MM[:SS[.f…]]`, zone-naive only — read AS UTC the same way.
 *
 * Every other spelling is uninterpretable, as a comparand and as a written
 * value alike (the record validator asks {@link isUninterpretableTemporalComparand}).
 * `Date.parse` reads `"2026/07/15 10:00"`, `"07/15/2026 10:00"` or
 * `"15 July 2026 10:00"` in the SERVER PROCESS's zone and `"07/08/2026"`
 * month-first, so the instant was a property of the deployment host; the rule
 * reads a bare integer string such as `"2026"` as epoch milliseconds
 * (`1970-01-01T00:00:02.026Z`), never as the year it looks like. A space
 * separator carries no zone because the rule hands such a string to
 * `Date.parse` whole, and its non-ISO reading moves
 * `"0050-01-01 10:00+01:00"` to 1950. `T` and `Z` are upper case: a zone-naive
 * `"…t10:00"` is not the form the rule reads as UTC.
 */
const ISO_DATETIME_WRITE_FORM =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?| \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;

/**
 * [#20525] [#20549] Does the string's leading `YYYY-MM-DD` name a calendar day
 * that exists — month 01..12, day 01 to that month's length, February 29 only
 * in a leap year? Arithmetic, never a `Date` round trip: `Date.UTC` reads a
 * year 0..99 as 1900..1999, and `Date.parse` ROLLS an impossible day over
 * (`"2026-02-30"` is March 2), which is the defect this answers. A string with
 * no leading day answers `false`.
 */
function namesRealCalendarDay(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const length = month === 2 ? (leap ? 29 : 28) : month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
  return day <= length;
}

/**
 * `temporalStorageForm`'s `datetime` reading of a STRING, as a yes/no: one of
 * the {@link ISO_DATETIME_WRITE_FORM} spellings, on a calendar day that
 * exists, that the rule reads as an instant.
 *
 * The last step mirrors the rule: a bare `YYYY-MM-DD` is midnight UTC; a
 * zone-naive `YYYY-MM-DD[ T]HH:MM[:SS[.fff]]` has its wall clock read AS UTC;
 * anything else is handed to `Date.parse` exactly as the drivers hand it over
 * — which is what still refuses `T25:00` or a `+99:99` offset, both inside
 * the grammar's shape.
 *
 * [#20549] Before the first two steps this read every spelling `Date.parse`
 * reads and every bare integer string, which is the comparand door the write
 * door was narrower than — see the module note.
 */
function readsAsInstant(s: string): boolean {
  if (!ISO_DATETIME_WRITE_FORM.test(s) || !namesRealCalendarDay(s)) return false;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? `${s}T00:00:00.000Z`
    : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)
      ? `${s.replace(' ', 'T')}Z`
      : s;
  return Number.isFinite(Date.parse(iso));
}

/**
 * `temporalStorageForm`'s `date` reading of a STRING: its leading `YYYY-MM-DD`, and
 * nothing else — [#20549] when that day exists.
 *
 * Narrower than {@link readsAsInstant} on purpose, because the rule it mirrors
 * is narrower: the `date` rule collapses a leading calendar day and returns
 * every other string untouched. `2026/07/15` is therefore uninterpretable for a
 * `date` column even though `Date.parse` reads it — today it survives to the
 * driver and compares as text against `YYYY-MM-DD` values, which is the silent
 * wrong answer this door exists to stop. The rule keeps `"2026-02-30"` as
 * written, a day that does not exist: compared as text on memory and SQLite
 * (`200 []`), and a 500 on PostgreSQL.
 */
function readsAsCalendarDay(s: string): boolean {
  return namesRealCalendarDay(s);
}

/**
 * `temporalStorageForm`'s `time` reading: a bare wall clock whose components are in
 * range. Out-of-range (`25:00`) is uninterpretable — the rule it mirrors
 * returns such a value untouched rather than wrapping it.
 */
function readsAsWallClock(s: string): boolean {
  const m = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(s);
  if (!m) return false;
  return Number(m[1]) <= 23 && Number(m[2]) <= 59 && Number(m[3] ?? '0') <= 59;
}

/**
 * [#20480] Does the `time` rule keep a time of day for this instant — a
 * finite number, a `Date`, or a string {@link readsAsInstant} admits? It reads
 * one through the `datetime` rule and keeps the UTC time only when that rule
 * spells the instant with a four-digit year; any other instant it hands back
 * unchanged, which is the definition of uninterpretable this module starts
 * from. Asked of the rule itself rather than of a copy of its year arithmetic,
 * so the two cannot drift.
 */
function keepsTimeOfDay(value: unknown): boolean {
  const form = temporalStorageForm(value, 'time');
  return typeof form === 'string' && /^\d{2}:\d{2}:\d{2}(\.\d{3})?$/.test(form);
}

/**
 * Is `value` a comparand that a `kind` column's storage rule cannot read?
 *
 * `true` for a non-empty, non-placeholder STRING that the kind's rule would
 * hand back unchanged, or [#20549] would read as another value than it names
 * (an impossible calendar day, a `datetime` spelling outside
 * {@link ISO_DATETIME_WRITE_FORM}), and — on a `date` or `datetime` column — for a number,
 * a `Date` or a string the rule reads whose year falls outside 0001..9999
 * ([#20264], `isOutsideTemporalYearRange`), and — on a `time` column — for a
 * finite number, a valid `Date` or an instant string whose UTC year has no
 * four-digit spelling ([#20480]). Everything else — any other number
 * or `Date`, `null`, a `{ $field }` reference, filter structure, the empty
 * string, a `{token}` — answers `false`, each for a reason recorded in the
 * module note or below.
 *
 * A `{placeholder}` is stepped around rather than judged because it is another
 * layer's vocabulary and that layer already refuses the unknown ones loudly
 * (`FILTER_TOKEN_UNKNOWN` / 400, with the resolvable tokens listed). Both doors
 * that call this run BEFORE token resolution, so judging a placeholder here
 * would refuse `{30_days_ago}` — the platform's own correct spelling, and the
 * positive control this fix is pinned against.
 */
export function isUninterpretableTemporalComparand(
  kind: TemporalComparandKind,
  value: unknown,
): boolean {
  if (kind !== 'time' && (typeof value === 'number' || value instanceof Date)) {
    return isOutsideTemporalYearRange(value, kind);
  }
  // [#20480] NaN, ±Infinity and an Invalid Date name no instant: unjudged, as
  // on the other two kinds.
  if (kind === 'time' && (typeof value === 'number' ? Number.isFinite(value) : value instanceof Date && !Number.isNaN(value.getTime()))) {
    return !keepsTimeOfDay(value);
  }
  if (typeof value !== 'string') return false;
  const s = value.trim();
  // The empty-string cell is its own card — see the module note.
  if (s === '') return false;
  // Another layer's vocabulary, and it has its own loud refusal.
  if (classifyFilterToken(value) !== null) return false;
  if (kind === 'datetime') return !readsAsInstant(s) || isOutsideTemporalYearRange(s, kind);
  if (kind === 'date') return !readsAsCalendarDay(s) || isOutsideTemporalYearRange(s, kind);
  return !(readsAsWallClock(s) || (readsAsInstant(s) && keepsTimeOfDay(s)));
}
