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
 * driver would return it unchanged" IS the definition of uninterpretable, and
 * defining it any other way would refuse comparands that work today.
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
 * That is why this is not `utcInstantMs` (`@objectstack/spec/data`), which is
 * the stricter canonical reader: it rejects a bare epoch-millisecond string and
 * every non-ISO spelling `Date.parse` accepts, both of which the drivers read
 * correctly today. Refusing those would be a narrowing this card did not ask
 * for and no measurement supports.
 *
 * ## Two things it deliberately does NOT judge
 *
 * - **Non-string comparands, save the year class above.** A number is epoch
 *   milliseconds, a `Date` is an instant, `null` is a null test, and the
 *   `time` rule reads every finite one; so do the `date` and `datetime` rules
 *   for a year from 0001 to 9999. The #8690 refusal was scoped to strings by that
 *   card's own ruling — its triage queued "a non-interpretable bare string", and
 *   the maintainer ruling scoped its two options "to non-empty strings" so the
 *   empty-string cell stayed its own card. That scoped that change; it is not a
 *   standing rule that a non-string is never refused. [#20240] extends the
 *   refusal to the `date` class above by the triage direction on that card,
 *   and [#20264] to `datetime` and the range 0001..9999 by triage's ruling.
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
import { isOutsideTemporalYearRange } from './temporal-storage-form.js';

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
 * `temporalStorageForm`'s `datetime` reading, as a yes/no.
 *
 * Mirrors it step for step: a bare integer in either sign is epoch
 * milliseconds; a bare `YYYY-MM-DD` is midnight UTC; a zone-naive
 * `YYYY-MM-DD[ T]HH:MM[:SS[.fff]]` has its wall clock read AS UTC; anything
 * else is handed to `Date.parse` exactly as the drivers hand it over.
 */
function readsAsInstant(s: string): boolean {
  if (/^-?\d+$/.test(s)) return Number.isFinite(new Date(Number(s)).getTime());
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? `${s}T00:00:00.000Z`
    : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)
      ? `${s.replace(' ', 'T')}Z`
      : s;
  return Number.isFinite(Date.parse(iso));
}

/**
 * `temporalStorageForm`'s `date` reading of a STRING: its leading `YYYY-MM-DD`, and
 * nothing else.
 *
 * Narrower than {@link readsAsInstant} on purpose, because the rule it mirrors
 * is narrower: the `date` rule collapses a leading calendar day and returns
 * every other string untouched. `2026/07/15` is therefore uninterpretable for a
 * `date` column even though `Date.parse` reads it — today it survives to the
 * driver and compares as text against `YYYY-MM-DD` values, which is the silent
 * wrong answer this door exists to stop.
 */
function readsAsCalendarDay(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(s);
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
 * Is `value` a comparand that a `kind` column's storage rule cannot read?
 *
 * `true` for a non-empty, non-placeholder STRING that the kind's rule would
 * hand back unchanged, and — on a `date` or `datetime` column — for a number,
 * a `Date` or a string the rule reads whose year falls outside 0001..9999
 * ([#20264], `isOutsideTemporalYearRange`). Everything else — any other number
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
  if (typeof value !== 'string') return false;
  const s = value.trim();
  // The empty-string cell is its own card — see the module note.
  if (s === '') return false;
  // Another layer's vocabulary, and it has its own loud refusal.
  if (classifyFilterToken(value) !== null) return false;
  if (kind === 'datetime') return !readsAsInstant(s) || isOutsideTemporalYearRange(s, kind);
  if (kind === 'date') return !readsAsCalendarDay(s) || isOutsideTemporalYearRange(s, kind);
  return !(readsAsWallClock(s) || readsAsInstant(s));
}
