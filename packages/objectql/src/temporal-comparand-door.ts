// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8690] The TEMPORAL-comparand door, at the engine's single filter collection
 * point — the third gate on the seam that already carries the #5869 shape gate
 * and the #8296 unmaterializable-field gate, answering a third question about
 * the same predicate: *can the column's own storage rule read this value at
 * all.*
 *
 * ## The defect
 *
 * A `datetime` field filtered with a bare string the API cannot take literally
 * was bound as-is, compared false for every row, and answered `HTTP 200` with
 * an empty result set and no diagnostic. Measured end to end on a real driver
 * with a declared `datetime` field, 51 rows seeded / 38 in-window:
 *
 * ```
 * $gte "last_30_days"       HTTP 200  count=0    <- silent zero (the defect)
 * $gte "not-a-date-at-all"  HTTP 200  count=0    <- silent zero
 * $gte "{30_days_ago}"      HTTP 200  count=38   <- positive control
 * $gte "{TODAY}"            REFUSED   FILTER_TOKEN_UNKNOWN / 400
 * $gte "{not_a_token}"      REFUSED   FILTER_TOKEN_UNKNOWN / 400
 * ```
 *
 * The asymmetry is the whole card: an unknown `{placeholder}` is refused
 * loudly, with the resolvable tokens listed — while a bare string that is not a
 * date is not validated anywhere. And `last_7_days` / `last_30_days` /
 * `last_90_days` are REAL declared preset names in the dashboard schema. The
 * shipped console lowers them to `{N_days_ago}` macros before they reach the
 * API, so the console path is safe; a saved report, an integration, an MCP
 * client or an AI-authored query sends the preset name itself and gets a silent
 * zero. An empty chart is the hardest failure to debug — indistinguishable from
 * "there is genuinely no data", and it cost one downstream project a
 * workaround, a CI guard and three re-measurements over three weeks.
 *
 * ## Why HERE — the ruling, and the two seams that measurement ruled out
 *
 * Maintainer ruling, 2026-08-15 (delegated adjudication) — option B, with C
 * shipped alongside, explicitly not A:
 *
 * > refuse the uninterpretable temporal comparand at the ObjectQL engine's
 * > single filter collection point, per the #7872 precedent and the 2026-08-12
 * > Q1=B ruling ("the door refuses or narrows every comparand BEFORE the driver
 * > runs").
 *
 * Refusing "a comparand a temporal field cannot interpret" requires holding the
 * comparand and the field's declared TYPE at the same moment, and two earlier
 * seams were measured and cannot:
 *
 * - `packages/core`'s `resolveFilterTokens` is field-AGNOSTIC by construction —
 *   its context is `now` / `timezone` / `userId` / `orgId`, it never sees an
 *   object or a field, and it returns the tree by reference for every
 *   non-placeholder string.
 * - `packages/rest` binds no comparands at all (zero hits for
 *   `temporalFilterValue` / `coerceFilterValue` / `storageDatetimeValue` under
 *   its `src`, against 8 files under `packages/drivers` — the reverse-check that
 *   makes the zero non-vacuous).
 *
 * The only other seam holding both facts is the driver layer — four packages
 * each mirroring one function (they sat under the #5499 investment freeze when
 * this door was placed; it was lifted on 2026-08-11, and it is not what rules
 * that seam out), where the pass-through is a DELIBERATE contract with
 * counter-pins asserting it (`sql-driver-temporal-dialect.test.ts` asserts
 * `temporalFilterValue('t','at','not-a-date') === 'not-a-date'` on purpose) and
 * where `storageDatetimeValue` is shared with the WRITE path and the legacy
 * read-repair, so refusing there would also reject ingest of pre-convention
 * data. That option was rejected by name.
 *
 * This seam has what neither of the others has: `lowerWhereFilterArray` is
 * handed `this._registry.getObject(object)` — the declared field map — at the
 * moment it sees the caller's `where`, on every verb (`find` / `findOne` /
 * `count` / `aggregate` / `update` / `delete`), through both doors (the array
 * sugar and the already-lowered `FilterCondition` object the protocol face
 * hands over). One gate, four backends inherit one answer.
 *
 * ## Envelope
 *
 * `INVALID_FILTER` / 400 — this package's VALUE-shape envelope (#5869 / #7047),
 * reused rather than minted, because the verdict is about the comparand's
 * value. Its neighbour {@link assertFilterIsMaterializable} answers
 * `INVALID_FIELD` for the deliberately different fact that the NAME has no
 * column. Not `FILTER_TOKEN_UNKNOWN` either: nothing here is a token, and
 * borrowing that code would send a caller looking for a placeholder they never
 * wrote.
 *
 * ## Scope — three boundaries, each ruled rather than chosen here
 *
 * - **Non-empty strings only, among strings.** The empty-string cell stays its
 *   own card by ruling ("B and C scope to non-empty strings and must not decide
 *   it in passing"); measured, `$gte ""` binds as `''` and returns every
 *   non-null row — 51 of 51, not the 38 the card's table records, which is a
 *   transcription error its own prose corrects.
 * - **`{placeholder}` strings are stepped around**, not judged. This gate runs
 *   BEFORE `resolveWhereTokens` (which is where it must run — the refusal has
 *   to precede the driver), so judging one would refuse `{30_days_ago}`, the
 *   platform's own correct spelling. Unknown tokens keep their existing loud
 *   refusal one layer down.
 * - **Non-string comparands are not judged, save the year classes.** A number
 *   is epoch milliseconds and a `Date` is an instant; the `datetime` and `time`
 *   rules read both, [#20480] a `time` column only when the instant's UTC year
 *   has four digits (below). [#20240] On a `date` field, one whose UTC calendar day
 *   falls in a year outside the four-digit ones has no `YYYY-MM-DD` form, so
 *   it is refused here in its own words (below); every other number and `Date`
 *   is read as before. The #8690 ruling scoped THAT change to strings; it did
 *   not rule non-strings out of this door.
 *
 * ## [#20264] The supported years, 0001..9999
 *
 * A `date` or `datetime` comparand whose year falls outside 0001..9999 is
 * refused here, in the year class's own words, whatever its spelling — a
 * number, a `Date`, or a string the kind's rule reads (`+010000-01-01T…Z`,
 * `-000001-…`, `0000-06-15`). Measured before this on InMemoryDriver and
 * SqlDriver on SQLite and PostgreSQL 16: a `datetime` comparand for year 10000
 * or −1 counted `$gt` / `$lt` / `$eq` 7 / 0 / 0 on memory and SQLite (its
 * extended-year text sorts below every four-digit year) and answered 500 on
 * PostgreSQL; year 0 answered 500 on PostgreSQL, on both kinds, in every
 * spelling. `@objectstack/core`'s `isOutsideTemporalYearRange` is the range;
 * the predicate this door calls asks it, and so does the record validator's
 * write door, so the two doors cannot disagree about a year.
 *
 * ## [#20549] A value the rule reads as another value than it names
 *
 * A string comparand is refused here exactly when the record validator refuses
 * it as a written value, because both ask `@objectstack/core`'s one predicate.
 * Two classes joined it from the write door, measured before this on
 * InMemoryDriver and SqlDriver on SQLite and PostgreSQL 16, the process in
 * America/New_York, through `engine.find`:
 *
 * ```
 * datetime $eq "2026-02-30T10:00:00Z"   200, the row at 2026-03-02T10:00Z   (rolled over)
 * datetime $eq "07/15/2026 10:00"       200, the row at 2026-07-15T14:00Z   (the process zone)
 * date     $eq "2026-02-30"             200 [] on memory and SQLite, 500 on PostgreSQL
 * ```
 *
 * These are not junk: the rule reads each one, as the wrong value, so each
 * answered rows. Their refusal says so in its own words ({@link misreadClassOf})
 * rather than in the junk class's "compare false for EVERY row".
 *
 * ## [#20480] An instant on a `time` column outside the four-digit years
 *
 * A `time` column keeps the UTC time of day of an instant, and only of one
 * whose UTC year has four digits; any other it hands back as written. Measured
 * before this, the process in America/New_York, over three rows
 * `09:00:00` / `10:30:00` / `12:00:00`:
 *
 * ```
 * time $gt "+010000-01-01T10:00:00Z"     3 of 3 on memory and SQLite, 500 on PostgreSQL
 * time $gt "9999-12-31T23:00:00-02:00"   0 on memory and SQLite, 500 on PostgreSQL
 * time $gt <the number of that instant>  0 on memory, 3 on SQLite, 500 on PostgreSQL
 * ```
 *
 * The right answer for 10:00 is 2 (the 2026 instant at 10:00Z answers 2 / 1).
 * Each is refused here now, in every spelling, and no time of day is read from
 * it; core's `isOutsideTemporalYearRange` on the instant names the class.
 *
 * ## [#20263] The third position: `having`
 *
 * `engine.aggregate` evaluates `having` itself, over the aggregated rows, so no
 * driver ever reads it and nothing in front of it judged its comparands. A
 * comparand the column's storage rule cannot read was compared as written:
 * `{ last_placed: { $lt: 'not-a-date' } }` on `max(placed_on)` kept every
 * group with a 200, while the same bound on `where` answered 400. Measured on
 * InMemoryDriver, SqlDriver on SQLite and on PostgreSQL, through
 * `engine.aggregate` and `POST /data/:object/query`, on both `having` paths.
 *
 * {@link assertHavingTemporalComparandsInterpretable} runs the same walk and
 * the same predicate, so a rule `@objectstack/core` changes reaches all three
 * positions at once. Two things differ, and each is the position's own fact:
 *
 * - **The kind comes from the aggregated column's class**, the one #20127
 *   derives off the query and the declaration (`aggregatedRowColumnClasses`):
 *   `min` / `max` of a temporal field keeps its kind, a groupBy projection
 *   takes its field's, a `day` bucket is a `date`; `count` / `sum` / `avg`, a
 *   coarser bucket and every other column are not temporal and are not judged.
 * - **The text operators are not judged.** On `where` a text operator aimed at
 *   a temporal field never reaches this door: the text-operator declared-type
 *   door refuses it one step earlier, because "not a date value" is the wrong
 *   thing to tell an author whose operator no comparand could make runnable
 *   (#15661). That door does not front `having`, and by its ruling the row
 *   beneath it stays answered there, so this door steps over those operators
 *   rather than answer them in the words #15661 retired.
 *
 * @see `@objectstack/core`'s `temporal-comparand.ts` — the value-half predicate,
 *   shared with the analytics raw-SQL decline so one rule cannot exist twice.
 * @see https://github.com/objectstack-ai/objectstack/issues/8690
 */

import {
  isOutsideTemporalYearRange,
  isUninterpretableTemporalComparand,
  temporalComparandKind,
  type TemporalComparandKind,
} from '@objectstack/core';
import { isTextFilterOperator } from '@objectstack/spec/data';
import { invalidFilterError } from './filter-comparand-shape.js';
import { temporalKindOf, type AggregatedColumnClass } from './having-filter.js';

/** What the door found, for the message and for the analytics-side decline. */
export interface UninterpretableTemporalComparand {
  /** The filter key: a declared field, or [#20263] a `having` column. */
  field: string;
  kind: TemporalComparandKind;
  /**
   * A non-empty string — or, on a `date` or `datetime` field, a number or
   * `Date` whose year falls outside 0001..9999 ([#20240], [#20264]), and on a
   * `time` field one whose UTC year has no four-digit spelling ([#20480]).
   */
  value: unknown;
  /** The `where.…` (or `having.…`, `aggregations[i].filter.…`) key path the offending comparand sits at. */
  path: string;
}

/**
 * [#20263] What one filter position supplies to the walk: the storage kind of
 * the column a KEY names (`null` = not temporal, or not known), and whether an
 * operator's comparands are judged at all.
 */
interface WalkScope {
  kindOf: (key: string) => TemporalComparandKind | null;
  judgesOperator: (op: string) => boolean;
}

/**
 * A plain object — filter STRUCTURE rather than a comparand. Same
 * classification the #5869 gate and `driver-memory`'s own gate make: a `Date`
 * is a comparand even though `typeof` calls it an object.
 */
function isFilterNode(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && !(value instanceof Date)
  );
}

/** A `{ $field: 'other_column' }` reference is not a literal — never judged. */
function isFieldReference(value: unknown): boolean {
  return isFilterNode(value) && typeof (value as { $field?: unknown }).$field === 'string';
}

/**
 * Walk one `FilterCondition` and return the FIRST comparand a declared temporal
 * field's storage rule cannot read, or `null`.
 *
 * Exported because the same walk answers the analytics strategy's routing
 * question ("would the engine door refuse this?") — though that consumer reaches
 * the value-half predicate directly, having no field map of its own.
 *
 * Structure discarded the same three conservative ways the sibling gates
 * discard it: `$and` / `$or` / `$not` are descended, any OTHER `$` key at node
 * level is skipped WITHOUT descending (an unrecognised combinator leaves the
 * fields beneath it ungated — a hole, not a false 400, which is the right
 * failure direction for a gate that exists to stop wrong answers), and a dotted
 * key names a field of a DIFFERENT object whose map this door has not resolved.
 */
export function findUninterpretableTemporalComparand(
  schema: unknown,
  where: unknown,
  path = 'where',
  depth = 0,
): UninterpretableTemporalComparand | null {
  // A registry-less host must not invent a verdict about a field map it cannot
  // see — the same early return `assertFilterIsMaterializable` makes.
  const fields = (schema as { fields?: Record<string, unknown> } | undefined)?.fields;
  if (!fields || typeof fields !== 'object') return null;
  return walkCondition(
    {
      kindOf: (key) => temporalComparandKind((fields[key] as { type?: unknown } | undefined)?.type),
      judgesOperator: () => true,
    },
    where,
    path,
    depth,
  );
}

/**
 * The walk itself, shared by every position: the node structure is judged the
 * same way wherever the condition sits; only the {@link WalkScope} differs.
 */
function walkCondition(
  scope: WalkScope,
  node: unknown,
  path: string,
  depth: number,
): UninterpretableTemporalComparand | null {
  if (depth > 32) return null;
  if (!isFilterNode(node)) return null;

  for (const [key, value] of Object.entries(node)) {
    const here = `${path}.${key}`;
    if (key === '$and' || key === '$or') {
      if (Array.isArray(value)) {
        for (const [index, arm] of value.entries()) {
          const hit = walkCondition(scope, arm, `${here}[${index}]`, depth + 1);
          if (hit) return hit;
        }
      }
      continue;
    }
    if (key === '$not') {
      const hit = walkCondition(scope, value, here, depth + 1);
      if (hit) return hit;
      continue;
    }
    if (key.startsWith('$')) continue;
    if (key.includes('.')) continue;
    const kind = scope.kindOf(key);
    if (!kind) continue;
    const hit = judgeFieldComparands(kind, key, value, here, scope.judgesOperator);
    if (hit) return hit;
  }
  return null;
}

/** One temporal field's constraint: `{ at: <spec> }`. */
function judgeFieldComparands(
  kind: TemporalComparandKind,
  field: string,
  spec: unknown,
  path: string,
  judgesOperator: (op: string) => boolean,
): UninterpretableTemporalComparand | null {
  // Not filter structure → an implicit-equality comparand, judged at this path.
  if (!isFilterNode(spec)) return judgeComparand(kind, field, spec, path);
  // A field spec with no `$` key is a deep-equality / nested-relation condition;
  // the #5869 gate records why descending into one would invent a contract no
  // backend agrees with.
  const keys = Object.keys(spec);
  if (!keys.some((k) => k.startsWith('$'))) return null;
  if (isFieldReference(spec)) return null;
  for (const op of keys) {
    if (!op.startsWith('$')) continue;
    if (!judgesOperator(op)) continue;
    const comparand = spec[op];
    // Every MEMBER of a list operator is a comparand in its own right — the
    // same split the #7872 type door makes at the shared compile face.
    if (Array.isArray(comparand)) {
      for (const [index, member] of comparand.entries()) {
        const hit = judgeComparand(kind, field, member, `${path}.${op}[${index}]`);
        if (hit) return hit;
      }
      continue;
    }
    const hit = judgeComparand(kind, field, comparand, `${path}.${op}`);
    if (hit) return hit;
  }
  return null;
}

function judgeComparand(
  kind: TemporalComparandKind,
  field: string,
  value: unknown,
  path: string,
): UninterpretableTemporalComparand | null {
  if (isFieldReference(value)) return null;
  if (!isUninterpretableTemporalComparand(kind, value)) return null;
  return { field, kind, value, path };
}

/** A short, bounded rendering — the comparand came off the wire (#5869's bound). */
function preview(value: unknown): string {
  const text = value instanceof Date
    ? `Date ${Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()}`
    : typeof value === 'string' ? JSON.stringify(value) : String(value);
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

/**
 * The remedy sentence, per kind. Deliberately names the platform's OWN
 * relative-date spelling first: the measured caller is one holding a declared
 * preset name (`last_30_days`) that the console would have lowered to
 * `{30_days_ago}`, so the fix a caller needs is almost always "wrap it as the
 * token the resolver knows", not "compute an instant yourself".
 */
const REMEDY: Record<TemporalComparandKind, string> = {
  datetime:
    'Write an ISO-8601 instant ("2026-07-15T00:00:00.000Z") on a calendar day that exists, '
    + 'a bare "YYYY-MM-DD" (read as midnight UTC), epoch milliseconds as a number, or a '
    + 'relative-date placeholder the resolver knows, e.g. "{30_days_ago}" / "{current_month_start}".',
  date:
    'Write a "YYYY-MM-DD" calendar day that exists, or a relative-date placeholder the resolver '
    + 'knows, e.g. "{30_days_ago}" / "{current_month_start}".',
  time:
    'Write an "HH:MM" / "HH:MM:SS" wall clock (timezone-naive, ADR-0053 D-C1).',
};

/**
 * [#20240] [#20264] The year class, per kind: what the comparand's year is,
 * what it would do past this door, and the forms that carry a year the field
 * can compare. Only `date` and `datetime` have a year; `time` is never in
 * this class.
 */
const YEAR_CLASS: Record<'date' | 'datetime', { year: string; misorder: string; remedy: string }> = {
  date: {
    year: 'whose calendar day falls outside the years 0001 to 9999',
    misorder: 'does not sort as a day',
    remedy: 'Write a "YYYY-MM-DD" calendar day in the years 0001 to 9999, or an epoch-millisecond '
      + 'number or Date whose UTC calendar day falls in those years.',
  },
  datetime: {
    year: 'an instant whose UTC year falls outside the years 0001 to 9999',
    misorder: 'does not sort as an instant',
    remedy: 'Write an ISO-8601 instant, epoch milliseconds or a Date whose UTC year falls in the '
      + 'years 0001 to 9999.',
  },
};

/**
 * [#20264] The year class of a hit, or `undefined` when the comparand is
 * refused for being unreadable at all — the range itself is core's
 * `isOutsideTemporalYearRange`, never re-derived here.
 */
function yearClassOf(hit: UninterpretableTemporalComparand): (typeof YEAR_CLASS)['date'] | undefined {
  if (hit.kind === 'time' || !isOutsideTemporalYearRange(hit.value, hit.kind)) return undefined;
  return YEAR_CLASS[hit.kind];
}

/**
 * [#20549] A comparand the storage rule READS, but not as the value it names —
 * the two readings the write door refused first, and `@objectstack/core`'s one
 * rule now refuses at both doors. Such a comparand does not compare false for
 * every row, as junk does: it answers rows, the wrong ones. Each class says
 * why, and what the value would have done, per position.
 */
interface MisreadClass {
  why: string;
  where: string;
  having: string;
}

const IMPOSSIBLE_DAY: MisreadClass = {
  why: 'whose calendar day does not exist',
  where: 'Read as written it rolls over into another day or compares as text, and answers the wrong '
    + 'rows or a database error.',
  having: 'Compared with each group, it rolls over into another day or compares as text, and keeps the '
    + 'wrong groups.',
};

function notAnIsoSpelling(kind: TemporalComparandKind): MisreadClass {
  const parser = 'Outside those spellings the server\'s own parser decides the instant: a zone-less '
    + 'spelling in the server\'s time zone, a slashed day in a guessed order, a bare integer as epoch '
    + 'milliseconds';
  return {
    why: `which is not one of the ISO 8601 spellings a ${kind} comparand is read in`,
    where: `${parser}. The rows it matched would depend on the host rather than on the filter.`,
    having: `${parser}. The groups it kept would depend on the host rather than on the filter.`,
  };
}

/**
 * [#20480] An instant on a `time` column whose UTC year has no four-digit
 * spelling: the rule keeps no time of day from it and hands it back as
 * written, so it compared as text or as a number with stored `HH:MM:SS`.
 */
const TIME_OUTSIDE_FOUR_DIGIT_YEARS: MisreadClass = {
  why: 'an instant whose UTC year falls outside the years 0001 to 9999, so no time of day is read from it',
  where: 'It would reach the driver as written and compare as text or as a number, answering the wrong '
    + 'rows or a database error.',
  having: 'Compared with each group as written, it would keep the wrong groups.',
};

/**
 * [#20549] The misread class of a hit, or `undefined` for a comparand the rule
 * cannot read at all (junk, the #8690 class) — for the message only. The
 * verdict is core's, and the leading day is judged by asking core's predicate
 * of it, so the calendar arithmetic is never re-derived here.
 */
function misreadClassOf(hit: UninterpretableTemporalComparand): MisreadClass | undefined {
  // [#20480] The range is core's, asked of the instant the `datetime` rule
  // reads — the reading a `time` column takes of every non-wall-clock value.
  if (hit.kind === 'time' && isOutsideTemporalYearRange(hit.value, 'datetime')) return TIME_OUTSIDE_FOUR_DIGIT_YEARS;
  if (typeof hit.value !== 'string') return undefined;
  const s = hit.value.trim();
  const day = /^\d{4}-\d{2}-\d{2}/.exec(s)?.[0];
  if (day !== undefined && isUninterpretableTemporalComparand('date', day) && !isOutsideTemporalYearRange(day, 'date')) {
    return IMPOSSIBLE_DAY;
  }
  if (hit.kind !== 'date' && (/^-?\d+$/.test(s) || Number.isFinite(Date.parse(s)))) {
    return notAnIsoSpelling(hit.kind);
  }
  return undefined;
}

/**
 * Refuse every comparand a declared temporal field's storage rule cannot read.
 *
 * Runs on the CALLER's own `where`, before the middleware chain composes
 * RLS / sharing / tenant predicates onto the AST — deliberately, and for the
 * reason its neighbour records: an injected read filter is the platform's own,
 * not a declaration the caller can fix, and refusing one would turn a policy
 * into a 400 nobody can act on.
 *
 * [#20334] `path` roots the refusal at the position the filter sits in:
 * `where` by default, `aggregations[i].filter` for a per-aggregation filter,
 * the root the list-shape and comparand-type doors already name there.
 */
export function assertTemporalComparandsInterpretable(
  object: string,
  operation: string,
  schema: unknown,
  where: unknown,
  path = 'where',
): void {
  const hit = findUninterpretableTemporalComparand(schema, where, path);
  if (!hit) return;
  // [#20240] [#20264] A comparand whose year falls outside 0001..9999 gets
  // words that say so. It does not compare false for every row as junk does:
  // its text orders as no day or instant does, so it answers the WRONG rows
  // (or, on PostgreSQL, a database error).
  const yearClass = yearClassOf(hit);
  if (yearClass) {
    throw invalidFilterError(
      `${operation}('${object}'): filter on '${hit.field}' compares a declared ${hit.kind} field `
      + `against ${preview(hit.value)} at ${hit.path}, ${yearClass.year}, the years a ${hit.kind} `
      + `value may name, so it is not a ${hit.kind} value this platform can interpret. It `
      + `would reach the driver in a form that ${yearClass.misorder} and answer the wrong rows, or a `
      + `database error. The filter was NOT applied. ${yearClass.remedy}`,
    );
  }
  // [#20549] A comparand the rule reads as another value than it names.
  const misread = misreadClassOf(hit);
  if (misread) {
    throw invalidFilterError(
      `${operation}('${object}'): filter on '${hit.field}' compares a declared ${hit.kind} field `
      + `against ${preview(hit.value)} at ${hit.path}, ${misread.why}, so it is not a ${hit.kind} `
      + `value this platform can interpret. ${misread.where} The filter was NOT applied. `
      + REMEDY[hit.kind],
    );
  }
  throw invalidFilterError(
    `${operation}('${object}'): filter on '${hit.field}' compares a declared ${hit.kind} `
    + `field against ${preview(hit.value)} at ${hit.path}, which is not a ${hit.kind} value `
    + 'this platform can interpret. It would reach the driver as written, compare false for '
    + 'EVERY row, and return 200 with an empty result — indistinguishable from "there is no '
    + `data". The filter was NOT applied. ${REMEDY[hit.kind]}`,
  );
}

/**
 * [#20263] Which aggregated column a `having` key names, in the words the
 * author wrote it: `max(placed_on)`, `the day bucket of opened_at`, `the
 * groupBy field placed_on`. For the message only — the column's CLASS comes
 * from `aggregatedRowColumnClasses`, which reads an aggregation alias after the
 * groupBy projections, so an aggregation is looked up first here too.
 */
function havingColumnSource(column: string, groupBy: unknown, aggregations: unknown): string {
  for (const a of Array.isArray(aggregations) ? aggregations : []) {
    const agg = a as { alias?: unknown; function?: unknown; field?: unknown } | null;
    if (agg?.alias === column) return `${String(agg.function)}(${String(agg.field)})`;
  }
  for (const g of Array.isArray(groupBy) ? groupBy : []) {
    if (g === column) return `the groupBy field ${column}`;
    const item = g as { alias?: unknown; field?: unknown; dateGranularity?: unknown } | null;
    if ((item?.alias ?? item?.field) !== column) continue;
    return item?.dateGranularity == null
      ? `the groupBy field ${String(item?.field)}`
      : `the ${String(item.dateGranularity)} bucket of ${String(item?.field)}`;
  }
  return 'an aggregated column';
}

/**
 * [#20263] Refuse every `having` comparand its aggregated column's storage rule
 * cannot read, before any driver is asked for a row.
 *
 * The same walk and the same `@objectstack/core` predicate as `where` — see
 * the module note's `having` section for the two differences: the kind is the
 * column's CLASS (`classes`, #20127's `aggregatedRowColumnClasses`, handed in
 * rather than derived again), and the text operators are stepped over.
 * `ObjectQL.aggregate` calls it on the caller's own `having`, after every
 * other `having` door, so a clause those refuse keeps their refusal.
 */
export function assertHavingTemporalComparandsInterpretable(
  object: string,
  having: unknown,
  classes: ReadonlyMap<string, AggregatedColumnClass | undefined>,
  query: { groupBy?: unknown; aggregations?: unknown },
): void {
  const hit = walkCondition(
    {
      kindOf: (key) => temporalKindOf(classes.get(key)) ?? null,
      judgesOperator: (op) => !isTextFilterOperator(op),
    },
    having,
    'having',
    0,
  );
  if (!hit) return;
  const column = `\`having\` on '${hit.field}' (${havingColumnSource(hit.field, query.groupBy, query.aggregations)}, `
    + `a ${hit.kind} column)`;
  // The year class, in its own words, as on `where` (#20240, #20264).
  const yearClass = yearClassOf(hit);
  if (yearClass) {
    throw invalidFilterError(
      `aggregate('${object}'): ${column} compares against ${preview(hit.value)} at ${hit.path}, `
      + `${yearClass.year}, the years a ${hit.kind} value may name, so it is not a ${hit.kind} `
      + 'value this platform can interpret. Compared with each group, it '
      + `${yearClass.misorder} and would keep the wrong groups. The \`having\` was NOT applied. `
      + yearClass.remedy,
    );
  }
  // [#20549] The misread classes, in their own words, as on `where`.
  const misread = misreadClassOf(hit);
  if (misread) {
    throw invalidFilterError(
      `aggregate('${object}'): ${column} compares against ${preview(hit.value)} at ${hit.path}, `
      + `${misread.why}, so it is not a ${hit.kind} value this platform can interpret. `
      + `${misread.having} The \`having\` was NOT applied. ${REMEDY[hit.kind]}`,
    );
  }
  throw invalidFilterError(
    `aggregate('${object}'): ${column} compares against ${preview(hit.value)} at ${hit.path}, `
    + `which is not a ${hit.kind} value this platform can interpret. Compared with each group as `
    + 'written, it would keep no group or every group, a 200 indistinguishable from a real answer. '
    + `The \`having\` was NOT applied. ${REMEDY[hit.kind]}`,
  );
}
