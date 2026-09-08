// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Aggregate × field-type compatibility — the ONE table saying which
 * `AggregationFunction` may be applied to a field of which `FieldType`
 * (#16353; director ruling, decision batch #59, 2026-09-06: "both legs, table
 * in spec"). A `DatasetMeasure` pairs an `aggregate` with a `field`; this
 * table is the contract both consumer legs execute — the compile-time refusal
 * in the dataset compiler (#16099) and the authoring-time lint rule — so the
 * two cannot drift into two accounts of one pair.
 *
 * ## Why this exists
 *
 * Nothing between author and driver correlated a measure's `aggregate` with
 * the field's type. `avg` over a `Field.datetime` compiled to `AVG(col)` and
 * reached the backend, where the answer is a property of the dialect rather
 * than of the data: one SQL family averages whatever the column's storage form
 * is, another rejects the call outright. Two backends, one metadata document,
 * two answers — the shape Prime Directive #12 exists to remove. Which pairs
 * are accepted is therefore a narrowing of a published acceptance set,
 * declared ONCE here and refused at authoring / compile time — never
 * tolerated in a consumer with a fallback.
 *
 * ## The rule
 *
 * | Aggregate | Accepted field types |
 * |---|---|
 * | `count`, `count_distinct` | every `FieldType` — counting rows or distinct values reads no arithmetic off the value |
 * | `sum` | the numeric class EXCEPT `percent` — a rate does not add (see `isIncoherentAggregate`) |
 * | `avg` | the numeric class, `percent` included |
 * | `min`, `max` | the numeric class plus the temporal class — both return a value of the field's OWN type (#15768) |
 * | every other pair | refused |
 *
 * ## How the ruling's categories resolve against the real membership
 *
 * The ruling named its buckets by category ("numeric", "`integer`-class",
 * "temporal"); this file resolves each against the `FieldType` enum through
 * the `field-value.zod` semantic classes — the sets the SQL DDL actually
 * stores by:
 *
 * - **numeric** = `NUMERIC_VALUE_TYPES`: `number`, `currency`, `percent`,
 *   `rating`, `slider`, `progress`, `summary`. "`integer`-class" is not a
 *   `FieldType` member — `integer` / `int` are driver-internal column aliases
 *   (`type-compat.ts`, `sql-driver.ts`) — so it resolves to the integer-valued
 *   authorable members `rating`, `slider`, `progress`, which the driver stores
 *   as REAL columns beside `number`. `summary` is a roll-up persisted as a
 *   numeric column.
 * - **temporal** = `CALENDAR_DATE_TYPES` ∪ `INSTANT_TYPES` ∪ `CLOCK_TIME_TYPES`:
 *   `date`, `datetime`, `time`. The ruling named the first two; `time` is the
 *   third temporal class and takes the same treatment: its stored form is a
 *   dialect question exactly like the other two (native TIME on Postgres and
 *   MySQL `TIME(3)`, canonical `HH:MM:SS[.fff]` TEXT on SQLite — #3994), the
 *   canonical form orders chronologically on every one of them, and
 *   `AnalyticsResult.fields[].type` already describes `min` / `max` over it as
 *   temporal (#15768, `TEMPORAL_SOURCE_FIELD_TYPES`). So it sits beside the
 *   two members the ruling named.
 * - **everything else** — the text family, booleans, option types, references,
 *   files, structured JSON, `vector`, and the computed `formula` /
 *   `autonumber` — is refused for `sum` / `avg` / `min` / `max`, the ruling's
 *   "every other pair: refused". `formula` carries a declared `returnType`,
 *   but it is VIRTUAL in SQL storage (no column is emitted), so no arithmetic
 *   aggregate can be lowered to it whatever that type says; `autonumber` is a
 *   formatted string.
 *
 * Two rows the ruling's default covers are recorded here as OVERRIDES of
 * existing opinions, not as settled ground — the row stands as ruled, the
 * text says only what this tree can defend:
 *
 * - **Booleans** (`boolean`, `toggle`) are refused for the four arithmetic /
 *   order aggregates by the ruling's default, yet the runtime already ANSWERS
 *   them: maintainer ruling #11152 pins that booleans aggregate as numbers on
 *   every face with no per-aggregate exception (`AGGREGATION_CASES` in
 *   `aggregation-conformance.ts`: `sum(flag)=3`, `avg(flag)=0.5`,
 *   `min(flag)=0`, `max(flag)=1`, six backends), and `driver-sql` casts a
 *   boolean aggregand to `int` on Postgres to make that hold (#11635). So the
 *   refusal is NOT grounded in backend divergence — the backends agree. Whether
 *   booleans belong in these rows is a collision between two rulings (batch
 *   #59 and #11152) and is referred to the maintainer as its own decision; the
 *   row is left exactly as batch #59 stated it until that decision lands.
 * - **The string classes** (`STRING_VALUE_TYPES`, `SINGLE_OPTION_TYPES`,
 *   `REFERENCE_VALUE_TYPES`, `autonumber`) are refused for `min` / `max` here,
 *   while `service-analytics`' `measureResultType` (#15768,
 *   `STRING_SOURCE_FIELD_TYPES`) already types `min` / `max` over them as a
 *   supported `'string'` result. The refusal is defensible — the ORDER of
 *   strings is collation-dependent, so two backends can return two different
 *   "smallest" values — but it overrides that existing opinion, and is
 *   recorded as such rather than presented as agreement.
 *
 * ## Relation to `isIncoherentAggregate`
 *
 * That predicate (`aggregation-policy.ts`) is the SEMANTIC opinion — "does
 * this number mean anything" — and `sum` × `percent` is refused here on its
 * authority. It also flags `count_distinct` × `percent`, which this table
 * ACCEPTS: the ruling reads `count_distinct` as "any type", and counting
 * distinct rates is backend-consistent even where it is odd. The two stay
 * separate on purpose: this table answers "can every backend give one
 * answer", the lint warning answers "is that answer meaningful".
 *
 * ## What this module deliberately does NOT do
 *
 * It refuses nothing itself. The refusals are the two consumer legs; a
 * consumer that cannot resolve a field's type (a relationship PATH it has no
 * metadata for) must NOT call the predicate with a guess — "cannot answer, do
 * not block" is the consumer's tier, not this table's.
 */

import type { AggregationFunction } from './query.zod';
import { FieldType } from './field.zod';

/**
 * The numeric class — the `NUMERIC_VALUE_TYPES` membership, spelled out here
 * rather than imported so that a type joining that class elsewhere is a
 * DECISION in this file (the pin test holds the two equal), never a silent
 * widening of what a backend is asked to add up.
 */
const NUMERIC_AGGREGATE_FIELD_TYPES = [
  'number', 'currency', 'percent', 'rating', 'slider', 'progress', 'summary',
] as const satisfies readonly FieldType[];

/** The numeric class minus the rate: what `sum` may add. */
const ADDITIVE_AGGREGATE_FIELD_TYPES = [
  'number', 'currency', 'rating', 'slider', 'progress', 'summary',
] as const satisfies readonly FieldType[];

/** The temporal class: `min` / `max` return a value of the field's own type. */
const TEMPORAL_AGGREGATE_FIELD_TYPES = [
  'date', 'datetime', 'time',
] as const satisfies readonly FieldType[];

/** Every declared `FieldType` — the `count` / `count_distinct` row. */
const ANY_FIELD_TYPE: readonly FieldType[] = Object.freeze([...FieldType.options]);

/**
 * Which `FieldType`s each `AggregationFunction` may be applied to. Total over
 * `AggregationFunction` (the `Record` key type makes a missing row a `tsc`
 * error) and total over `FieldType` (a type is classified by being in, or out
 * of, every row). Consumers read it through
 * {@link isAggregateCompatibleWithFieldType}; the table is exported so a
 * refusal can NAME the accepted set in its message.
 */
export const AGGREGATE_FIELD_TYPE_COMPATIBILITY: Readonly<Record<AggregationFunction, readonly FieldType[]>> =
  Object.freeze({
    count: ANY_FIELD_TYPE,
    count_distinct: ANY_FIELD_TYPE,
    sum: Object.freeze([...ADDITIVE_AGGREGATE_FIELD_TYPES]),
    avg: Object.freeze([...NUMERIC_AGGREGATE_FIELD_TYPES]),
    min: Object.freeze([...NUMERIC_AGGREGATE_FIELD_TYPES, ...TEMPORAL_AGGREGATE_FIELD_TYPES]),
    max: Object.freeze([...NUMERIC_AGGREGATE_FIELD_TYPES, ...TEMPORAL_AGGREGATE_FIELD_TYPES]),
  });

/**
 * May `aggregate` be applied to a field of `fieldType`? The single predicate
 * both consumer legs call, so one pair cannot be accepted at authoring and
 * refused at compile time.
 *
 * Fail-closed on vocabulary AND on shape: a value outside `AggregationFunction`
 * or outside `FieldType` answers `false`, and so does anything that is not a
 * string at all. The second half is load-bearing for a refusal gate: the lint
 * leg judges metadata BEFORE it is parsed, so the value it hands in may be an
 * array or an object, and a property-key lookup alone would coerce
 * `['count']` or `{ toString: () => 'sum' }` to a member spelling and let the
 * pair through. The `string` parameter types are a convenience of the
 * signature, not a tolerance — off-vocabulary or off-shape input is refused,
 * never mapped.
 */
export function isAggregateCompatibleWithFieldType(aggregate: string, fieldType: string): boolean {
  if (typeof aggregate !== 'string' || typeof fieldType !== 'string') return false;
  if (!Object.prototype.hasOwnProperty.call(AGGREGATE_FIELD_TYPE_COMPATIBILITY, aggregate)) return false;
  const row: readonly string[] = AGGREGATE_FIELD_TYPE_COMPATIBILITY[aggregate as AggregationFunction];
  return row.includes(fieldType);
}
