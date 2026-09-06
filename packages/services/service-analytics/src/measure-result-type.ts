// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { AggregationFunction } from '@objectstack/spec/data';

/**
 * #15768 — what a dataset MEASURE column's `fields[].type` should say.
 *
 * Every producer of `AnalyticsResult.fields` mints `{ name, type: 'number' }`
 * for a measure — `ObjectQLStrategy.buildFieldMeta`, `NativeSQLStrategy.
 * buildFieldMeta`, `evaluateAnalyticsQueryOverRows` (draft preview) and
 * `DatasetExecutor.runMeasurePass`'s supplementary/compare/derived appends.
 * That is true for most of the aggregate vocabulary and false for exactly one
 * corner of it, where the response then contradicts itself in one line:
 *
 * ```json
 * {"rows":[{"oldest_last_update_at":"2026-07-04T07:00:00.000Z"}],
 *  "fields":[{"name":"oldest_last_update_at","type":"number", … }]}
 * ```
 *
 * `min`/`max` return a value OF THE AGGREGATED FIELD'S OWN TYPE. Over a
 * `date` / `datetime` / `time` field that value is an instant, a calendar day
 * or a clock time — never a number — so a renderer that branches on the
 * declared type never reaches its temporal branch and falls through to a
 * numeric default.
 *
 * ## The population, enumerated rather than sampled
 *
 * `AggregationFunction` (`spec/data/query.zod.ts`) is a CLOSED vocabulary, so
 * "which aggregates does this rule speak about" has a finite answer, and every
 * member is answered here — no member falls through unconsidered:
 *
 * | aggregate        | result value                          | verdict |
 * |:-----------------|:--------------------------------------|:--------|
 * | `count`          | a row count                           | `number` — unchanged. Counting `datetime`s is still counting. |
 * | `count_distinct` | a cardinality                         | `number` — unchanged, same reason. |
 * | `sum`            | see below                             | `number` — unchanged. |
 * | `avg`            | see below                             | `number` — unchanged. |
 * | `min`            | a value of the aggregated field's type | temporal source ⇒ {@link MEASURE_RESULT_TYPE_TEMPORAL}. |
 * | `max`            | a value of the aggregated field's type | temporal source ⇒ {@link MEASURE_RESULT_TYPE_TEMPORAL}. |
 *
 * A measure with NO aggregate is a `derived` one (the two are mutually
 * exclusive in `DatasetMeasureSchema`). `computeDerived` coerces every operand
 * with `Number()`, so a derived measure is numeric BY CONSTRUCTION whatever its
 * operands were — it is answered here as "no correction", which leaves the
 * `number` its producer minted.
 *
 * **`sum`/`avg` over a temporal field is NOT a case a type is invented for.**
 * Nothing in the shipped stack refuses the pair: `dataset-compiler`'s
 * `aggregateToMetricType` checks only membership of the vocabulary, the three
 * source-field gates check only that the column EXISTS, and no lint rule pairs
 * an aggregate with a field type. It therefore reaches the driver, where what
 * comes back is decided by the backend and the storage form — a mean of epoch
 * integers on SQLite, a refusal from Postgres, which has no `avg(timestamptz)`.
 * There is no one value for a type to describe, so this rule leaves both alone
 * and the missing refusal is reported as its own finding rather than papered
 * over with a type that would be wrong on at least one backend.
 *
 * ## The field-type axis, and what it deliberately excludes
 *
 * Only the TEMPORAL family is corrected: `date`, `datetime`, `time`. That is
 * the population the card measured and the one the triage ruled on. `min`/`max`
 * over a `text` / `select` / `lookup` field returns a string and is still
 * described as `number` after this change — the same defect, a different
 * population, reported separately rather than absorbed here.
 *
 * ## Why `'time'` and not `'date'` / `'datetime'`
 *
 * `fields[].type` is not a `FieldType` position. A temporal DIMENSION column in
 * the very same response already carries `'time'` — `DatasetDimensionSchema`'s
 * `type: 'date'` compiles to a cube dimension of `type: 'time'`
 * (`dataset-compiler.dimensionType`), and both `buildFieldMeta`s copy that
 * through. `'time'` is the `DimensionType` vocabulary this position already
 * speaks (`string` / `number` / `boolean` / `time` / `geo`), so a consumer that
 * can draw a date axis at all already has the branch. Spelling a temporal
 * measure `'datetime'` would introduce a SECOND temporal word into one wire
 * position and leave every existing consumer's `'time'` branch unreached.
 */

/**
 * The `DimensionType` word this position uses for a temporal column — the same
 * one a `date` dimension column already carries in the same response.
 */
export const MEASURE_RESULT_TYPE_TEMPORAL = 'time';

/**
 * Source-field types whose stored value is temporal (`FieldType`, `spec/data/
 * field.zod.ts` → "Date & Time"). `min`/`max` over one of these returns that
 * same kind of value.
 */
export const TEMPORAL_SOURCE_FIELD_TYPES: ReadonlySet<string> = new Set([
  'date',
  'datetime',
  'time',
]);

/**
 * The corrected `fields[].type` for a measure column, or `undefined` for "this
 * rule has nothing to say — keep whatever the producer minted".
 *
 * Tiered "cannot answer, do not block", the same way every other chain reading
 * `sourceFieldMeta` is: an unknown field type, a host with no data engine
 * wired, and a relationship-path measure (`account.closed_at`, which
 * `sourceFieldMeta` cannot resolve because it looks a column up on the BASE
 * object) all answer `undefined` and leave the column exactly as it was.
 *
 * @param aggregate - the measure's declared `aggregate`; absent on a `derived`
 *   measure.
 * @param sourceFieldType - the DECLARED `FieldType` of the aggregated field,
 *   from `AnalyticsServiceConfig.sourceFieldMeta`.
 */
export function measureResultType(
  aggregate: AggregationFunction | undefined,
  sourceFieldType: string | undefined,
): string | undefined {
  // `count` / `count_distinct` / `sum` / `avg` — and a derived measure's absent
  // aggregate — all keep the `number` their producer minted. See the table above.
  if (aggregate !== 'min' && aggregate !== 'max') return undefined;
  if (sourceFieldType === undefined) return undefined;
  return TEMPORAL_SOURCE_FIELD_TYPES.has(sourceFieldType)
    ? MEASURE_RESULT_TYPE_TEMPORAL
    : undefined;
}
