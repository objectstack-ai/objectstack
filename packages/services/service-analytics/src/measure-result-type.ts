// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { AggregationFunction } from '@objectstack/spec/data';
import {
  REFERENCE_VALUE_TYPES,
  SINGLE_OPTION_TYPES,
  STRING_VALUE_TYPES,
} from '@objectstack/spec/data';

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
 * or a clock time; over a `text` / `select` / `lookup` field it is a string —
 * never a number — so a renderer that branches on the declared type never
 * reaches its temporal or textual branch and falls through to a numeric
 * default.
 *
 * ## The aggregate axis, enumerated rather than sampled
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
 * | `min`            | a value of the aggregated field's type | {@link MEASURE_RESULT_TYPE_TEMPORAL} / {@link MEASURE_RESULT_TYPE_STRING} per the field-type table. |
 * | `max`            | a value of the aggregated field's type | {@link MEASURE_RESULT_TYPE_TEMPORAL} / {@link MEASURE_RESULT_TYPE_STRING} per the field-type table. |
 *
 * A measure with NO aggregate is a `derived` one (the two are mutually
 * exclusive in `DatasetMeasureSchema`). `computeDerived` coerces every operand
 * with `Number()`, so a derived measure is numeric BY CONSTRUCTION whatever its
 * operands were — it is answered here as "no correction", which leaves the
 * `number` its producer minted.
 *
 * **`sum`/`avg` over a temporal field is NOT a case a type is invented for —
 * and since #16737 it is not a case that reaches a type at all.** This rule
 * left the pair alone because what came back was decided by the backend and the
 * storage form (SQLite coerces the column's canonical UTC text and answers the
 * average YEAR; Postgres has no `avg(timestamptz)` and refuses at 42883), so
 * there was no one value for a type to describe. The missing refusal was
 * reported as its own finding rather than papered over with a type that would
 * be wrong on at least one backend — and that finding is now closed:
 * `dataset-compiler` refuses the pair at COMPILE time against
 * `AGGREGATE_FIELD_TYPE_COMPATIBILITY` (`@objectstack/spec`, #16353; the
 * compile leg of #16099), so no such measure can be queried and no column
 * descriptor is ever minted for one. The rows below are unchanged: `sum`/`avg`
 * still keep the `number` their producer minted, which is correct for the
 * numeric fields they may now be applied to.
 *
 * ## The field-type axis: every `FieldType` member, by MEASURED value class
 *
 * The verdict per member is not a judgement call about what a type "feels
 * like". It is read off the two shipped statements of what the type STORES —
 * `@objectstack/spec`'s runtime value contract (`data/field-value.zod.ts`,
 * ADR-0104 D1) and `driver-sql`'s DDL column switch — and the sets below are
 * COMPOSED FROM the spec's classes rather than re-listing their members, the
 * way `driver-sql`'s own `JSON_COLUMN_TYPES` composes from them. A type moved
 * between classes upstream moves here with it; a type ADDED to the enum lands
 * as a failure of the enum-walking pin in
 * `__tests__/measure-result-type.test.ts` rather than silently inheriting the
 * flat `number` this rule exists to correct.
 *
 * | value class (spec) | members | `min`/`max` verdict |
 * |:---|:---|:---|
 * | `STRING_VALUE_TYPES` | text, textarea, email, url, phone, password, secret, markdown, html, richtext, code, color, signature, qrcode | {@link MEASURE_RESULT_TYPE_STRING} — `valueSchemaFor` answers `z.string()`; the DDL gives every one a string/TEXT column. |
 * | `SINGLE_OPTION_TYPES` | select, radio | {@link MEASURE_RESULT_TYPE_STRING} — the stored value is ONE option code, and `optionCodes` stringifies a declared code before the value schema is built (`String(o.value)`), so a numerically-spelled option still stores text. |
 * | `REFERENCE_VALUE_TYPES` | lookup, master_detail, tree, user | {@link MEASURE_RESULT_TYPE_STRING} — all four share `ReferenceIdValueSchema` (`z.string()`); the stored value is the referenced row's id, never the expanded record. |
 * | `autonumber` | autonumber | {@link MEASURE_RESULT_TYPE_STRING} — measured, not assumed (see below). |
 * | temporal | date, datetime, time | {@link MEASURE_RESULT_TYPE_TEMPORAL}. |
 * | `NUMERIC_VALUE_TYPES` | number, currency, percent, rating, slider, progress, summary | no correction — the producer's `number` is CORRECT, not merely unexamined. |
 * | `BOOLEAN_VALUE_TYPES` | boolean, toggle | no correction — no single answer across backends (see below). |
 * | `MULTI_OPTION_TYPES` | multiselect, checkboxes, tags | no correction — an array in a JSON column (see below). |
 * | `FILE_REFERENCE_TYPES` | image, file, avatar, video, audio | no correction — the stored form is mid-migration (see below). |
 * | `STRUCTURED_JSON_TYPES` | json, composite, repeater, record, location, address, vector | no correction — an object in a JSON column (see below). |
 * | `formula` | formula | {@link FORMULA_RETURN_TYPE_RESULT} — TRANSLATED from the field's own declared `returnType`. |
 * | `formula`, `returnType` ABSENT | formula | no correction — do not answer, keep the word the producer minted (see below). |
 *
 * ### `autonumber` is a STRING, measured on three independent readings
 *
 * The open question was whether the stored value is an integer counter or the
 * rendered record number. All three shipped statements say the latter:
 * `renderAutonumber` returns `value: prefix + String(seq).padStart(width,'0')
 * + suffix` — a string by construction, and zero-padded under the contract
 * default format `{0000}`; `driver-sql`'s DDL switch answers
 * `col = table.string(name)` for it; and `RUNTIME_OWNED_FIELD_TYPES` makes the
 * runtime, not a caller, the producer of that string. Measured directly on
 * SQLite, `min`/`max` over a column of padded record numbers returns the
 * padded text (`'0003'` / `'0012'`), typeof `string`.
 *
 * The spec's value contract answers `z.unknown()` here — "producer-owned,
 * explicitly open" — which is a statement about what a CALLER may write, not
 * about what the producer emits. Reading that openness as "unknowable" is what
 * would have made this member a guess; reading the producer is what makes it a
 * measurement.
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
 * ⚠️ ⛔ This is NOT a missing refusal, and it is no longer referred onward.
 * `AGGREGATE_FIELD_TYPE_COMPATIBILITY` ACCEPTS `sum` / `avg` / `min` / `max`
 * over `boolean` / `toggle` — #16685 ruled A, landed as #16750, on the
 * authority of maintainer ruling #11152 — so the pair is deliberately allowed
 * and the compile leg (#16737) never judges it. What stays open here is only
 * the RESULT-TYPE question above: three readings that disagree about what the
 * one answering backend reports. A refusal would not settle it, and none is
 * owed.
 *
 * ### The JSON-column classes: array- and object-valued types
 *
 * `MULTI_OPTION_TYPES` and `STRUCTURED_JSON_TYPES` are `JSON_COLUMN_TYPES` in
 * `driver-sql`, so the aggregate is taken over a JSON column: `jsonb` has no
 * `min` on Postgres, while SQLite compares the serialized TEXT. Same shape as
 * the boolean case — backend-decided, no single value to describe — and the
 * same owner.
 *
 * `FILE_REFERENCE_TYPES` is left alone for a second, additive reason: its
 * stored form is mid-migration under ADR-0104 D3. The value contract's stored
 * schema is already the opaque `sys_file` id (`FileReferenceIdValueSchema`, a
 * string) while the DDL still gives these types a JSON column for the pre-D3
 * inline metadata object. Two shipped statements, two different stored forms;
 * correcting to either would describe half the deployments.
 *
 * ### `formula`: answered from the field's own DECLARED result type
 *
 * A formula field's result type IS declared — `FieldSchema.returnType`
 * (`number` / `text` / `boolean` / `date`), whose own JSDoc names "dataset
 * measures" as its FIRST intended consumer. This rule could not read it: its
 * input was the declared `FieldType` alone, because that was all
 * `AnalyticsServiceConfig.sourceFieldMeta` returned (`{ type?,
 * defaultCurrency?, max? }`), so `'formula'` arrived as a bare word with the
 * answer sitting one key away in the metadata. [#16236] That hook now carries
 * `returnType` and this rule takes it as a third input.
 *
 * ⚠️ **The mapping is a TRANSLATION, never a relay.** `returnType` speaks the
 * AUTHORING vocabulary; `fields[].type` speaks `DimensionType`. Two of the four
 * members are not wire words at all — `text` is `'string'` there and `date` is
 * `'time'` — so passing the literal through would put a word into the response
 * that no consumer branches on, which is the same mistake the section below
 * ("Why `'string'` and `'time'`") already records for the `FieldType` axis. The
 * table is {@link FORMULA_RETURN_TYPE_RESULT}; the pin that holds it a
 * translation is in `__tests__/formula-return-type-measure.test.ts` and is one
 * invariant over the whole enum rather than four expectations: NO member of
 * `returnType` is answered by its own spelling.
 *
 * The two members whose spelling the wire vocabulary happens to share are not
 * relayed either, and each for the reason its `FieldType` row already carries:
 *
 * - `returnType: 'number'` → **no correction**, identical to the
 *   `NUMERIC_VALUE_TYPES` row. The producer's `'number'` is already the correct
 *   word, so this rule has nothing to add.
 * - `returnType: 'boolean'` → **no correction**, identical to the
 *   `BOOLEAN_VALUE_TYPES` row. Three readings disagree about what a `min`/`max`
 *   over a boolean returns, or whether it returns at all; minting `'boolean'`
 *   would ship one of them as a published declaration.
 *
 * ### `formula` with NO `returnType` — a ROW, not an implied code path
 *
 * `returnType` is OPTIONAL: "absent when the type can't be proven (an
 * ambiguous/`dyn` expression)". So a formula field whose type could not be
 * proven at authoring reaches this rule as `'formula'` with nothing behind it,
 * and the verdict is: **do not answer — keep the word the producer minted.**
 * An unproven formula's measure column stays `number`, and the ABSENCE is not
 * itself read as an answer.
 *
 * That is the same "cannot answer, do not block" tier every other reader of
 * `sourceFieldMeta` already uses (an unknown field type, a host with no data
 * engine wired, a relationship-path measure), which is why it needed no new
 * design — and it is written down HERE, as a row in this table, precisely so it
 * does not become a behaviour that exists only inside a `?.` in the code path.
 * A word outside the declared four is the same tier: a host answers at runtime
 * and can answer anything, and an unrecognised one is left alone, never guessed
 * at — the same treatment the `FieldType` axis gives an unrecognised `type`.
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
 * applies; ⛔ nothing in this rule reads the column's precision. That a
 * roll-up may declare `summaryOperations.function: 'min'` over a non-numeric
 * child field — which `aggregateSummaryValue` returns verbatim, into that
 * numeric column — is a defect one layer down in the same family; it is filed,
 * and it is a statement about `summary`'s own storage, not about what this
 * rule should say for the declared type. ⚠️ The exact column REFUSES that
 * verbatim text where the float column refused it too, so the retype neither
 * creates nor closes it.
 *
 * ## What this rule deliberately cannot see: `multiple`
 *
 * `sourceFieldMeta` returns no `multiple` flag, so a `select` / `radio` /
 * `lookup` / `user` field declared `multiple: true` — stored as a JSON array —
 * is indistinguishable here from its single-valued form and is corrected to
 * `string` with the rest of its class. That is the safe direction rather than
 * an oversight: where the backend answers at all it is SQLite comparing the
 * serialized TEXT, which is a string; where it does not answer (Postgres over
 * `jsonb`) there is no response for any word to mis-describe.
 *
 * ## Why `'string'` and `'time'`, and not `FieldType` spellings
 *
 * `fields[].type` is not a `FieldType` position. It speaks `DimensionType`
 * (`string` / `number` / `boolean` / `time` / `geo`), and both words this rule
 * mints are ALREADY carried by dimension columns in the very same response:
 * `dataset-compiler.dimensionType` maps a `date` dimension to `'time'` and a
 * `lookup` dimension to `'string'`, and both `buildFieldMeta`s copy that
 * through. A consumer that can draw a date axis or render a text column
 * already has the branch. Spelling a textual measure `'text'`, or a temporal
 * one `'datetime'`, would introduce a SIXTH word into a five-word wire
 * vocabulary and leave every existing branch unreached.
 */

/**
 * The `DimensionType` word this position uses for a temporal column — the same
 * one a `date` dimension column already carries in the same response.
 */
export const MEASURE_RESULT_TYPE_TEMPORAL = 'time';

/**
 * The `DimensionType` word this position uses for a string-valued column — the
 * same one a `lookup` or `string` dimension column already carries in the same
 * response (`dataset-compiler.dimensionType`).
 */
export const MEASURE_RESULT_TYPE_STRING = 'string';

/**
 * The four members of `FieldSchema.returnType` (`packages/spec/src/data/
 * field.zod.ts`). Spelled here rather than imported because the spec exports
 * the schema, not a named type for this key; `__tests__/formula-return-type-
 * measure.test.ts` reads the enum off `FieldSchema` itself and reds if the two
 * ever disagree, so the drift guard is mechanical rather than a promise.
 */
export type FormulaReturnType = 'number' | 'text' | 'boolean' | 'date';

/**
 * [#16236] `FieldSchema.returnType` → the `DimensionType` word a `min`/`max`
 * over that formula field's value should carry, or `undefined` for "no
 * correction — keep the word the producer minted".
 *
 * ⚠️ **A TRANSLATION between two closed vocabularies, ⛔ never a relay.** The
 * left column is the AUTHORING vocabulary a formula's result type is declared
 * in; the right is the five-word wire vocabulary `AnalyticsResult.fields[].type`
 * speaks. `text` and `date` do not exist on the right at all.
 *
 * | `returnType` | verdict | why |
 * |:---|:---|:---|
 * | `text` | `'string'` | the wire spelling for a string column, already carried by `lookup`/`string` dimension columns in the same response |
 * | `date` | `'time'` | the wire spelling for a temporal column, already carried by a `date` dimension column in the same response |
 * | `number` | no correction | identical to the `NUMERIC_VALUE_TYPES` row — the producer's `'number'` is already right |
 * | `boolean` | no correction | identical to the `BOOLEAN_VALUE_TYPES` row — three readings disagree on what the aggregate even returns |
 *
 * ⭐ No member is answered by its own spelling, on ANY row — which is what makes
 * a reintroduced pass-through detectable by one invariant instead of four
 * hand-written expectations. See the module header for the long form.
 */
export const FORMULA_RETURN_TYPE_RESULT: Readonly<Record<FormulaReturnType, string | undefined>> = {
  text: MEASURE_RESULT_TYPE_STRING,
  date: MEASURE_RESULT_TYPE_TEMPORAL,
  number: undefined,
  boolean: undefined,
};

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
 * Source-field types whose stored value is a STRING. `min`/`max` over one of
 * these returns a string.
 *
 * Composed from `@objectstack/spec`'s value classes rather than re-listing
 * their members, so membership is owned where the stored shape is declared
 * (ADR-0104 D1) and cannot drift from it — the same construction `driver-sql`
 * uses for `JSON_COLUMN_TYPES`. `autonumber` is the one local extra: the spec
 * classes it as producer-owned/open, and the string is established from the
 * producer instead (see the module header).
 */
export const STRING_SOURCE_FIELD_TYPES: ReadonlySet<string> = new Set<string>([
  // Plain strings: text/textarea/email/url/phone/password/secret, the rich
  // bodies (markdown/html/richtext/code), and color/signature/qrcode.
  ...STRING_VALUE_TYPES,
  // One declared option code — select/radio.
  ...SINGLE_OPTION_TYPES,
  // The referenced row's id — lookup/master_detail/tree/user.
  ...REFERENCE_VALUE_TYPES,
  // The rendered record number, zero-padded under the default `{0000}`.
  'autonumber',
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
 * `undefined` is also the answer for every field type whose `min`/`max` has no
 * single backend-independent value — booleans, the JSON-column classes, the
 * mid-migration file types — and for a `formula` field whose declared
 * `returnType` is absent or unrecognised. Those are VERDICTS, not gaps; the
 * module header records the measurement behind each one.
 *
 * @param aggregate - the measure's declared `aggregate`; absent on a `derived`
 *   measure.
 * @param sourceFieldType - the DECLARED `FieldType` of the aggregated field,
 *   from `AnalyticsServiceConfig.sourceFieldMeta`.
 * @param formulaReturnType - [#16236] the aggregated field's declared
 *   `FieldSchema.returnType`, from the same hook. Read for `sourceFieldType ===
 *   'formula'` and for nothing else: it is that member's own declared key, not
 *   a general override of the table above.
 *
 *   ⚠️ Typed `string`, not {@link FormulaReturnType}, for the reason its sibling
 *   `sourceFieldType` is: this is what a HOST answered at runtime, and a host
 *   can answer a word this contract does not accept. An unrecognised one lands
 *   in the "cannot answer" tier rather than being coerced into the table.
 */
export function measureResultType(
  aggregate: AggregationFunction | undefined,
  sourceFieldType: string | undefined,
  formulaReturnType?: string,
): string | undefined {
  // `count` / `count_distinct` / `sum` / `avg` — and a derived measure's absent
  // aggregate — all keep the `number` their producer minted. See the table above.
  if (aggregate !== 'min' && aggregate !== 'max') return undefined;
  if (sourceFieldType === undefined) return undefined;
  if (TEMPORAL_SOURCE_FIELD_TYPES.has(sourceFieldType)) return MEASURE_RESULT_TYPE_TEMPORAL;
  if (STRING_SOURCE_FIELD_TYPES.has(sourceFieldType)) return MEASURE_RESULT_TYPE_STRING;
  // [#16236] The one member whose answer is declared on a SECOND key. ⛔ The
  // literal is never relayed — {@link FORMULA_RETURN_TYPE_RESULT} translates it
  // into the wire vocabulary, and answers `undefined` for the two members whose
  // own `FieldType` rows already answer "no correction".
  if (sourceFieldType === 'formula') {
    if (formulaReturnType === undefined) return undefined;
    // Widened on the RECORD, not the key: an out-of-contract word from a host
    // reads back as `undefined`, which is this rule's "cannot answer" tier.
    const table = FORMULA_RETURN_TYPE_RESULT as Readonly<Record<string, string | undefined>>;
    return table[formulaReturnType];
  }
  return undefined;
}
