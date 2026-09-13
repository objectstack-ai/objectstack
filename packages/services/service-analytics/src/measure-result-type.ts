// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { AggregationFunction } from '@objectstack/spec/data';
import { isAggregateCompatibleWithFieldType } from '@objectstack/spec/data';

/**
 * What a dataset MEASURE column's `fields[].type` should say.
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
 * ## ⭐ The accepted set is NOT restated here — it is ASKED
 *
 * [#17560, director ruling, decision batch #127, 2026-09-13] This rule answers
 * for a pair only if `AGGREGATE_FIELD_TYPE_COMPATIBILITY` (`@objectstack/spec`,
 * #16353) ACCEPTS it, asked through `isAggregateCompatibleWithFieldType`. That
 * is what makes the two declarations agree BY CONSTRUCTION instead of by
 * review: a result type describes a value some backend can be asked for, and a
 * pair the table refuses is refused at the compile door before any query is
 * built (`dataset-compiler`), so no column descriptor is ever minted for one.
 *
 * ⛔ There is therefore no second account of which pairs are supported in this
 * package. A row changed in the spec changes this rule in the same commit.
 *
 * ## The aggregate axis, enumerated rather than sampled
 *
 * `AggregationFunction` (`spec/data/query.zod.ts`) is a CLOSED vocabulary, so
 * "which aggregates does this rule speak about" has a finite answer, and every
 * member is answered here — no member falls through unconsidered:
 *
 * | aggregate        | result value                           | verdict |
 * |:-----------------|:---------------------------------------|:--------|
 * | `count`          | a row count                            | `number` — unchanged. Counting `datetime`s is still counting. |
 * | `count_distinct` | a cardinality                          | `number` — unchanged, same reason. |
 * | `sum`            | a derived number                       | `number` — unchanged. |
 * | `avg`            | a derived number                       | `number` — unchanged. |
 * | `min`            | a value of the aggregated field's type | {@link MEASURE_RESULT_TYPE_TEMPORAL} over the temporal class; no correction over the rest of the ACCEPTED set. |
 * | `max`            | a value of the aggregated field's type | same as `min`. |
 *
 * A measure with NO aggregate is a `derived` one (the two are mutually
 * exclusive in `DatasetMeasureSchema`). `computeDerived` coerces every operand
 * with `Number()`, so a derived measure is numeric BY CONSTRUCTION whatever its
 * operands were — it is answered here as "no correction", which leaves the
 * `number` its producer minted.
 *
 * ## The field-type axis — three rows, because the table decides the fourth
 *
 * The `min` / `max` rows of `AGGREGATE_FIELD_TYPE_COMPATIBILITY` accept the
 * numeric class, the temporal class and the boolean class, and refuse every
 * other `FieldType`. So this rule has exactly three populations to answer for,
 * and the refused remainder is not one of them:
 *
 * | accepted class | members | `min`/`max` verdict |
 * |:---|:---|:---|
 * | temporal | date, datetime, time | {@link MEASURE_RESULT_TYPE_TEMPORAL} — the value is an instant, a calendar day or a clock time. |
 * | `NUMERIC_VALUE_TYPES` | number, currency, percent, rating, slider, progress, summary | no correction — the producer's `number` is CORRECT, not merely unexamined. |
 * | `BOOLEAN_VALUE_TYPES` | boolean, toggle | no correction — three readings disagree (see below). |
 *
 * Everything else — the text family, option types, references, multi-option and
 * file classes, structured JSON, `vector`, `autonumber` and `formula` — is
 * REFUSED by the table, so the pair never reaches a response for a type to
 * describe. This rule answers `undefined` for all of it, and asks the table
 * rather than carrying a list.
 *
 * ### ⚠️ What was retired here, and the reversal that retired it
 *
 * Until #17560 this rule ALSO answered `'string'` for `min` / `max` over the
 * string-valued classes (`STRING_SOURCE_FIELD_TYPES`: `STRING_VALUE_TYPES`,
 * `SINGLE_OPTION_TYPES`, `REFERENCE_VALUE_TYPES` and `autonumber`, #15768), and
 * answered a TRANSLATED wire word for `min` / `max` over a `formula` field from
 * its declared `returnType` (`FORMULA_RETURN_TYPE_RESULT`, #16236). Both
 * branches described pairs the table REFUSES, which is the contradiction
 * decision batch #127 settled — in the table's favour, in one pass, for all 74
 * unenforced `min` / `max` pairs. The measurements behind those branches were
 * never wrong about the VALUE (`min` over a column of zero-padded record
 * numbers really does answer padded TEXT on SQLite); they were answers to a
 * question the platform has now stopped asking, because the pair is refused
 * before a backend sees it. ⛔ The branches are retired, not narrowed: an
 * accept-set this rule cannot express is an accept-set it cannot drift from.
 *
 * ### `boolean` / `toggle`: three readings, and they do not agree
 *
 * - **Postgres** has no `min`/`max` over `boolean` at all — `function
 *   min(boolean) does not exist`, SQLSTATE 42883. There is no value.
 * - **SQLite**, measured directly here, answers `0` / `1` as JS **numbers**:
 *   a `boolean` column has NUMERIC affinity and the aggregate alias is not a
 *   declared column, so `formatOutput`'s `booleanFields` pass — keyed to
 *   declared `Field.boolean` COLUMNS — does not reach it.
 * - The same SQLite pair recorded at `SqlDriver.aggregate()` in the earlier
 *   driver-level measurement reads `false` / `true`, i.e. JS **booleans**.
 *
 * So the three readings disagree about whether there is a value at all, and
 * about whether the one backend that answers reports a number or a boolean.
 * `DimensionType` does carry a `boolean` word, so a correction is SPELLABLE
 * here — which is exactly why it is not made: spelling it would ship one of
 * three disagreeing readings as a published declaration. The column keeps the
 * `number` it has (the accurate word for the raw SQLite value).
 *
 * ⚠️ ⛔ This is NOT a missing refusal. `AGGREGATE_FIELD_TYPE_COMPATIBILITY`
 * ACCEPTS `sum` / `avg` / `min` / `max` over `boolean` / `toggle` — #16685
 * ruled A, landed as #16750, on the authority of maintainer ruling #11152 — so
 * the pair is deliberately allowed and the compile leg never refuses it. This
 * is the one accepted class where the rule declines, and it declines because
 * the readings disagree, not because the pair is unsupported.
 *
 * ### `summary` is NUMERIC — the correction is not needed, not merely skipped
 *
 * Both shipped statements agree: `summary` is a member of the spec's
 * `NUMERIC_VALUE_TYPES` (so `valueSchemaFor` answers `z.number().finite()`)
 * and `driver-sql`'s DDL answers with a numeric column. Since #16318 that
 * column is the exact decimal `NUMERIC_COLUMN_REPRESENTATION` states — `col =
 * table.decimal(name, 65, 30)` on a NEW table, where it was `col =
 * table.float(name)` before and still is on every table created earlier. The
 * producer's `number` is the CORRECT word either way and no correction
 * applies; ⛔ nothing in this rule reads the column's precision.
 *
 * ## Why `'time'`, and not a `FieldType` spelling
 *
 * `fields[].type` is not a `FieldType` position. It speaks `DimensionType`
 * (`string` / `number` / `boolean` / `time` / `geo`), and the word this rule
 * mints is ALREADY carried by dimension columns in the very same response:
 * `dataset-compiler.dimensionType` maps a `date` dimension to `'time'`, and
 * both `buildFieldMeta`s copy that through. A consumer that can draw a date
 * axis already has the branch. Spelling a temporal measure `'datetime'` would
 * introduce a SIXTH word into a five-word wire vocabulary and leave every
 * existing branch unreached.
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
 *
 * ⛔ This is the SHAPE of the answer for a class the table already accepts, not
 * a second statement of WHICH pairs are accepted — that question is asked of
 * `isAggregateCompatibleWithFieldType` first, on every call.
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
 * `undefined` is also the answer for every ACCEPTED pair whose `min`/`max` has
 * no single backend-independent value (booleans) and for every pair the spec
 * table REFUSES — the second group is refused at the compile door, so it has no
 * response for a type to describe. Those are VERDICTS, not gaps; the module
 * header records the measurement behind each one.
 *
 * @param aggregate - the measure's declared `aggregate`; absent on a `derived`
 *   measure.
 * @param sourceFieldType - the DECLARED `FieldType` of the aggregated field,
 *   from `AnalyticsServiceConfig.sourceFieldMeta`. Typed `string` because this
 *   is what a HOST answered at runtime and a host can answer a word this
 *   contract does not accept; the spec predicate fails closed on one.
 */
export function measureResultType(
  aggregate: AggregationFunction | undefined,
  sourceFieldType: string | undefined,
): string | undefined {
  // `count` / `count_distinct` / `sum` / `avg` — and a derived measure's absent
  // aggregate — all keep the `number` their producer minted. See the table above.
  if (aggregate !== 'min' && aggregate !== 'max') return undefined;
  if (sourceFieldType === undefined) return undefined;
  // [#17560] Agreement by CONSTRUCTION with the one table: a pair the spec
  // refuses gets no result type here, because it gets no response at all. ⛔ The
  // refused set is never restated — it is asked.
  if (!isAggregateCompatibleWithFieldType(aggregate, sourceFieldType)) return undefined;
  if (TEMPORAL_SOURCE_FIELD_TYPES.has(sourceFieldType)) return MEASURE_RESULT_TYPE_TEMPORAL;
  // The rest of the ACCEPTED set: the numeric class, where the producer's
  // `number` is already correct, and the boolean class, where three readings
  // disagree about what the aggregate even returns.
  return undefined;
}
