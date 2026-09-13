// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A dataset measure's `fields[].type` must describe the value sitting beside it
 * in the same response.
 *
 * Measured on a real boot (`@objectstack/cli` 17.3.0, SQLite dev datasource),
 * `POST /api/v1/analytics/dataset/query` answered a `min` over a
 * `Field.datetime` column with:
 *
 * ```json
 * {"rows":[{"oldest_last_update_at":"2026-07-04T07:00:00.000Z","untouched_over_30d":3}],
 *  "fields":[{"name":"oldest_last_update_at","type":"number","label":"Oldest touch","format":"relative"},
 *            {"name":"untouched_over_30d","type":"number","label":"Untouched > 30 days"}]}
 * ```
 *
 * The value is an ISO instant; the metadata beside it says `number`. Every
 * producer of this shape minted a flat `'number'` for every measure, so a
 * renderer that branches on the declared type could never reach a temporal
 * branch for the column.
 *
 * ## ⚠️ [#17560] The STRING half of this file is RETIRED — the reversal, named
 *
 * This file also used to pin a second population end to end: a `min` over a
 * `text` / `select` / `lookup` / `autonumber` column returns a string and was
 * described as `number` too, so `measureResultType` answered `'string'` for it
 * (#15768). `AGGREGATE_FIELD_TYPE_COMPATIBILITY` REFUSED exactly those pairs
 * the whole time, and the director ruling of decision batch #127 (2026-09-13,
 * #17560) settled the contradiction in the table's favour: the string classes
 * stay refused, the non-string classes are refused and enforced, `formula` is
 * refused on the table's storage ground, and the compile leg judges all six
 * aggregates through one `DATASET_INVALID` / 400 door.
 *
 * ⇒ Those measures cannot be compiled at all now, so there is no response for a
 * type to describe. The cases are re-aimed rather than deleted — section E
 * drives the same pairs through the same door and pins the REFUSAL, and the
 * shared fixture below keeps only pairs the table accepts. ⛔ Do not re-add a
 * measure over a refused type to that fixture: it compiles every measure in ONE
 * dataset, so one refused pair reds every case in sections B–E.
 *
 * ## Where the assembly point is, and how this file proves it is the real one
 *
 * The triage seat recorded that it could not find the production code behind
 * `fields[].type` — its grep landed only on test constants. There are FOUR
 * producers of the measure descriptor, not one:
 *
 *   - `ObjectQLStrategy.buildFieldMeta`      (`strategies/objectql-strategy.ts`)
 *   - `NativeSQLStrategy.buildFieldMeta`     (`strategies/native-sql-strategy.ts`)
 *   - `evaluateAnalyticsQueryOverRows`       (`preview-evaluator.ts`, draft preview)
 *   - `DatasetExecutor.runMeasurePass` + its compare / derived appends
 *
 * — each spelling `{ name: m, type: 'number' }` and none of them knowing the
 * aggregated field's declared type. What they all pass through is
 * `AnalyticsService.queryDataset`'s ADR-0021 result-column enrichment, the same
 * block that already resolves `label` / `format` / `currency` / `percentScale`
 * from the AUTHORED measure plus `sourceFieldMeta`; the REST face relays that
 * method's return verbatim (`res.json(result)` in `rest-server.ts`, the
 * `POST {basePath}/analytics/dataset/query` route). So the correction is made
 * there, once.
 *
 * Section C is the CONTROL for that claim: the same selection is driven down
 * the ObjectQL-aggregate path AND the native-SQL path — two different
 * `buildFieldMeta` producers — and both move together, which is only possible
 * if the value the wire carries is decided downstream of both. Section B drives
 * the supplementary-sub-query producer (every base measure filter-scoped, the
 * card's own shape) and the `__compare` producer for the same reason.
 *
 * ## Section A walks BOTH closed vocabularies
 *
 * `AggregationFunction` and `FieldType` are both closed enums, so "which pairs
 * does this rule speak about" has a finite answer and every member of each axis
 * carries an explicit verdict here. A member ADDED to either enum lands as a
 * failure of the exhaustiveness guard rather than silently inheriting the flat
 * `number` — which is the whole point of walking the enum instead of sampling
 * it. The `why` column on each row is the MEASUREMENT behind the verdict, not
 * a preference; `measure-result-type.ts`'s header carries the long form.
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Reverting ONLY the two-line call site in `analytics-service.ts` (leaving
 * `measure-result-type.ts` in place) must turn RED every assertion that expects
 * `'time'` — sections B and C — and leave section A (the rule in isolation) and
 * section D (the columns the rule deliberately does not touch) GREEN. Ordinary direction: the change CORRECTS a value on existing
 * entries, mints no column and removes no limb, so nothing downstream can gain
 * or lose a finding. Measured: recorded in the PR body.
 */

import { describe, it, expect } from 'vitest';
import {
  AggregationFunction,
  FieldType,
  isAggregateCompatibleWithFieldType,
} from '@objectstack/spec/data';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import {
  measureResultType,
  MEASURE_RESULT_TYPE_TEMPORAL,
} from '../measure-result-type.js';

const CTX = { tenantId: 'org_A' } as ExecutionContext;

// ─────────────────────────────────────────────────────────────────────────────
// A) both CLOSED vocabularies, enumerated rather than sampled
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One row per member of `AggregationFunction`, with what the member answers and
 * why. `corrects` says whether the member is one this rule speaks about at all;
 * `undefined` for the other four means "this rule says nothing — the producer's
 * `'number'` stands", which is the CORRECT answer rather than an omission.
 */
const AGGREGATE_VOCABULARY: ReadonlyArray<{
  fn: (typeof AggregationFunction.options)[number];
  corrects: boolean;
  why: string;
}> = [
  { fn: 'count', corrects: false, why: 'a row count is a number however the counted column is typed' },
  { fn: 'count_distinct', corrects: false, why: 'a cardinality is a number, same reason as count' },
  { fn: 'sum', corrects: false, why: 'unrefused and backend-decided over a non-numeric column — no single value to type' },
  { fn: 'avg', corrects: false, why: 'same as sum: an epoch mean on SQLite, a refusal on Postgres' },
  { fn: 'min', corrects: true, why: 'returns a value of the aggregated field own type' },
  { fn: 'max', corrects: true, why: 'returns a value of the aggregated field own type' },
];

/**
 * The bucket each `FieldType` member lands in. [#17560] The first question is
 * no longer "what does this type store" but "does the TABLE accept the pair at
 * all" — `AGGREGATE_FIELD_TYPE_COMPATIBILITY` decides, and the
 * `bucket-agrees-with-the-table` case below proves this column is a reading of
 * it rather than a second opinion beside it:
 *
 *  - `refused-by-the-table` — `min` / `max` over this type is refused, so the
 *    measure never compiles and there is no response for a type to describe.
 *    The 37 members here are the population decision batch #127 enforced:
 *    the string-ish classes, the multi-option / file / structured-JSON classes,
 *    `vector`, `autonumber` and `formula`.
 *  - `temporal` — the stored value's kind is established by BOTH shipped
 *    statements of it (the spec value contract and driver-sql's DDL), so the
 *    wire word follows from a measurement.
 *  - `numeric-correct` — the producer's `number` is right; there is nothing to
 *    correct. Not the same thing as "unexamined".
 *  - `accepted-no-single-answer` — the table ACCEPTS the pair (booleans
 *    aggregate as numbers on every backend, #11152 / #16750), and yet the three
 *    readings of what `min` over one returns do not converge. Left uncorrected
 *    on purpose, and deliberately NOT the same bucket as a refused pair: one is
 *    "the platform will not answer this", the other is "the platform answers and
 *    this rule declines to name the word".
 */
type FieldTypeBucket =
  | 'refused-by-the-table'
  | 'temporal'
  | 'numeric-correct'
  | 'accepted-no-single-answer';

const EXPECTED_BY_BUCKET: Record<FieldTypeBucket, string | undefined> = {
  'refused-by-the-table': undefined,
  temporal: MEASURE_RESULT_TYPE_TEMPORAL,
  'numeric-correct': undefined,
  'accepted-no-single-answer': undefined,
};

/** The buckets whose members the spec table ACCEPTS for `min` / `max`. */
const ACCEPTED_BUCKETS: ReadonlySet<FieldTypeBucket> = new Set<FieldTypeBucket>([
  'temporal', 'numeric-correct', 'accepted-no-single-answer',
]);

/**
 * One row per member of `FieldType` — the enumerated verdict the card asks for.
 * The three `undefined` buckets are deliberately kept APART even though they
 * answer the same value: "the producer is already right", "no backend-
 * independent answer exists" and "the answer is not on this input" are
 * different findings, and collapsing them into one default branch is exactly
 * how the uncertain members would get silently swallowed.
 */
const FIELD_TYPE_VERDICTS: ReadonlyArray<{
  type: (typeof FieldType.options)[number];
  bucket: FieldTypeBucket;
  why: string;
}> = [
  // ── the plain-string class: spec `STRING_VALUE_TYPES`, a string/TEXT column ──
  // ⚠️ [#17560] Every row in this block used to read `bucket: 'string'`, and the
  // `why` recorded the measurement behind the stored shape. The measurements
  // still hold; the QUESTION was retired. `min`/`max` over these types is
  // refused by `AGGREGATE_FIELD_TYPE_COMPATIBILITY`, the table was NOT amended
  // (decision batch #127), and a refused pair never reaches a response.
  { type: 'text', bucket: 'refused-by-the-table', why: 'a TEXT column, and text ORDER is collation-dependent — two backends, two "smallest"' },
  { type: 'textarea', bucket: 'refused-by-the-table', why: 'a TEXT column, same collation argument' },
  { type: 'email', bucket: 'refused-by-the-table', why: 'a TEXT column, same collation argument' },
  { type: 'url', bucket: 'refused-by-the-table', why: 'a TEXT column, same collation argument' },
  { type: 'phone', bucket: 'refused-by-the-table', why: 'a TEXT column, same collation argument' },
  { type: 'password', bucket: 'refused-by-the-table', why: 'stored plaintext-or-hashed, masked on read — ordering it is meaningless as well as dialect-decided' },
  { type: 'secret', bucket: 'refused-by-the-table', why: 'stores an opaque sys_secret ref, masked on read — same as password' },
  { type: 'markdown', bucket: 'refused-by-the-table', why: 'a multi-line body in a TEXT column' },
  { type: 'html', bucket: 'refused-by-the-table', why: 'a multi-line body in a TEXT column' },
  { type: 'richtext', bucket: 'refused-by-the-table', why: 'a multi-line body in a TEXT column' },
  { type: 'code', bucket: 'refused-by-the-table', why: 'the editor contents verbatim, in a TEXT column' },
  { type: 'color', bucket: 'refused-by-the-table', why: 'a color code string' },
  { type: 'signature', bucket: 'refused-by-the-table', why: 'a data-URI string' },
  { type: 'qrcode', bucket: 'refused-by-the-table', why: 'a data-URI string' },
  // ── one declared option code: spec `SINGLE_OPTION_TYPES` ──
  { type: 'select', bucket: 'refused-by-the-table', why: 'one option code; the smallest CODE is not the first option and is collation-decided' },
  { type: 'radio', bucket: 'refused-by-the-table', why: 'one option code, same branch as select' },
  // ── the referenced row id: spec `REFERENCE_VALUE_TYPES` ──
  { type: 'lookup', bucket: 'refused-by-the-table', why: 'the referenced row id — ordering ids answers a question about ids, not about records' },
  { type: 'master_detail', bucket: 'refused-by-the-table', why: 'same ReferenceIdValueSchema as lookup' },
  { type: 'tree', bucket: 'refused-by-the-table', why: 'same ReferenceIdValueSchema as lookup' },
  { type: 'user', bucket: 'refused-by-the-table', why: 'a lookup fixed to sys_user; identical storage' },
  // ── the rendered record number ──
  { type: 'autonumber', bucket: 'refused-by-the-table', why: 'a zero-padded string (renderAutonumber, DDL table.string) — padded text orders lexicographically, so `0010` sorts before `9`' },
  // ── the temporal family: the one class this rule still answers for ──
  { type: 'date', bucket: 'temporal', why: 'a calendar day, stored YYYY-MM-DD' },
  { type: 'datetime', bucket: 'temporal', why: 'an ISO instant with explicit zone' },
  { type: 'time', bucket: 'temporal', why: 'a wall-clock time of day' },
  // ── genuinely numeric: the producer is already right ──
  { type: 'number', bucket: 'numeric-correct', why: 'spec NUMERIC_VALUE_TYPES; a numeric column' },
  { type: 'currency', bucket: 'numeric-correct', why: 'a bare number on the wire (ADR-0104 header)' },
  { type: 'percent', bucket: 'numeric-correct', why: 'spec NUMERIC_VALUE_TYPES; a numeric column' },
  { type: 'rating', bucket: 'numeric-correct', why: 'spec NUMERIC_VALUE_TYPES; a numeric column' },
  { type: 'slider', bucket: 'numeric-correct', why: 'spec NUMERIC_VALUE_TYPES; a numeric column' },
  { type: 'progress', bucket: 'numeric-correct', why: 'spec NUMERIC_VALUE_TYPES; a numeric column' },
  { type: 'summary', bucket: 'numeric-correct', why: 'spec NUMERIC_VALUE_TYPES and a numeric DDL column — both shipped statements say numeric' },
  // ── ACCEPTED by the table, and the readings still do not converge ──
  { type: 'boolean', bucket: 'accepted-no-single-answer', why: 'Postgres has no min(boolean) at all; SQLite answers 0/1 as numbers; the driver seam has been recorded answering false/true — yet #11152 / #16750 keep the pair accepted' },
  { type: 'toggle', bucket: 'accepted-no-single-answer', why: 'a boolean rendered as a switch — same column, same three readings, same accepted row' },
  // ── refused: an array or an object in a JSON column ──
  { type: 'multiselect', bucket: 'refused-by-the-table', why: 'an array in a JSON column: no min over jsonb on Postgres, serialized TEXT on SQLite' },
  { type: 'checkboxes', bucket: 'refused-by-the-table', why: 'an array in a JSON column, same as multiselect' },
  { type: 'tags', bucket: 'refused-by-the-table', why: 'a free-form array in a JSON column, same as multiselect' },
  { type: 'image', bucket: 'refused-by-the-table', why: 'stored form mid-migration (ADR-0104 D3): contract says opaque id, DDL still a JSON column' },
  { type: 'file', bucket: 'refused-by-the-table', why: 'stored form mid-migration, same as image' },
  { type: 'avatar', bucket: 'refused-by-the-table', why: 'stored form mid-migration, same as image' },
  { type: 'video', bucket: 'refused-by-the-table', why: 'stored form mid-migration, same as image' },
  { type: 'audio', bucket: 'refused-by-the-table', why: 'stored form mid-migration, same as image' },
  { type: 'composite', bucket: 'refused-by-the-table', why: 'an object in a JSON column' },
  { type: 'repeater', bucket: 'refused-by-the-table', why: 'an array of objects in a JSON column' },
  { type: 'record', bucket: 'refused-by-the-table', why: 'a name-keyed map in a JSON column' },
  { type: 'location', bucket: 'refused-by-the-table', why: 'a {lat,lng} object in a JSON column' },
  { type: 'address', bucket: 'refused-by-the-table', why: 'a structured object in a JSON column' },
  { type: 'vector', bucket: 'refused-by-the-table', why: 'a number array in a JSON column' },
  { type: 'json', bucket: 'refused-by-the-table', why: 'the untyped escape hatch — the value contract is explicitly open (z.unknown())' },
  // ── refused on STORAGE ground, which no declared returnType can move ──
  // ⚠️ [#17560] This row used to read `declared-elsewhere`: the answer was on a
  // SECOND key (`FieldSchema.returnType`, #16236) that `measureResultType` took
  // as a third input. Decision batch #127 refused the pair on the table's own
  // ground — a formula is VIRTUAL in SQL storage, no column is emitted, so no
  // aggregate can be lowered to it whatever `returnType` says — so the third
  // input had no reader left and went with the branch.
  { type: 'formula', bucket: 'refused-by-the-table', why: 'VIRTUAL in SQL storage: no column is emitted, so there is nothing for an aggregate to be lowered to' },
];

describe('A) measureResultType covers both closed vocabularies, member by member', () => {
  it('the aggregate table enumerates every declared member, and only declared members', () => {
    // A member ADDED to the spec enum lands here as a failure rather than
    // silently falling through `measureResultType` as "nothing to say" — which
    // is exactly how a new aggregate would inherit the flat `number`.
    expect([...AGGREGATE_VOCABULARY.map((v) => v.fn)].sort())
      .toEqual([...AggregationFunction.options].sort());
  });

  it('the field-type table enumerates every declared member, and only declared members', () => {
    // The same guard on the other axis, and the one this card is about: a new
    // FieldType cannot fall through unconsidered. It must be given a bucket
    // here — including the honest buckets, which answer `undefined`.
    expect([...FIELD_TYPE_VERDICTS.map((v) => v.type)].sort())
      .toEqual([...FieldType.options].sort());
  });

  it('every bucket is populated — the split is real, not four names for one branch', () => {
    const buckets = new Set(FIELD_TYPE_VERDICTS.map((v) => v.bucket));
    expect([...buckets].sort()).toEqual([
      'accepted-no-single-answer', 'numeric-correct', 'refused-by-the-table', 'temporal',
    ]);
  });

  it('⭐ [#17560] the bucket column IS the spec table, not a second opinion beside it', () => {
    // The agreement this card makes structural: `measureResultType` asks
    // `isAggregateCompatibleWithFieldType` before it answers, so a row whose
    // bucket disagrees with the table is a row that would ship two accounts of
    // one pair. Walked over every member of the enum, both selecting aggregates.
    for (const { type, bucket } of FIELD_TYPE_VERDICTS) {
      const acceptedHere = ACCEPTED_BUCKETS.has(bucket);
      expect(isAggregateCompatibleWithFieldType('min', type), `min × ${type}`).toBe(acceptedHere);
      expect(isAggregateCompatibleWithFieldType('max', type), `max × ${type}`).toBe(acceptedHere);
    }
  });

  it('⭐ [#17560] a pair the table REFUSES never carries a result type — by construction', () => {
    // The half of the agreement that lives in this package: the rule declines
    // for every refused pair, so it cannot describe a column the compile door
    // will not let exist. Not vacuous — the negative control is the next line.
    const refused = FIELD_TYPE_VERDICTS.filter((v) => v.bucket === 'refused-by-the-table');
    expect(refused.length).toBe(37);
    for (const { type } of refused) {
      expect(measureResultType('min', type), `min × ${type}`).toBeUndefined();
      expect(measureResultType('max', type), `max × ${type}`).toBeUndefined();
    }
    // NEGATIVE CONTROL: the one accepted class this rule does answer for still
    // answers, so the assertion above is about refusal and not about silence.
    expect(measureResultType('min', 'datetime')).toBe(MEASURE_RESULT_TYPE_TEMPORAL);
  });

  for (const { type, bucket, why } of FIELD_TYPE_VERDICTS) {
    const expected = EXPECTED_BY_BUCKET[bucket];
    it(`min/max over ${type} → ${expected ?? 'no correction'} [${bucket}] (${why})`, () => {
      expect(measureResultType('min', type)).toBe(expected);
      expect(measureResultType('max', type)).toBe(expected);
    });

    it(`the non-min/max aggregates over ${type} are never corrected`, () => {
      for (const { fn, corrects } of AGGREGATE_VOCABULARY) {
        if (corrects) continue;
        expect(measureResultType(fn, type)).toBeUndefined();
      }
    });
  }

  it('a derived measure (no aggregate) is never corrected — computeDerived coerces with Number()', () => {
    expect(measureResultType(undefined, 'datetime')).toBeUndefined();
    expect(measureResultType(undefined, 'text')).toBeUndefined();
  });

  it('an unanswerable source field is left alone ("cannot answer, do not block")', () => {
    // No data engine wired, an object/field the host does not know, or a
    // relationship-path measure `sourceFieldMeta` cannot resolve.
    expect(measureResultType('min', undefined)).toBeUndefined();
    expect(measureResultType('max', undefined)).toBeUndefined();
  });

  it('a field type outside the enum entirely is left alone, not defaulted', () => {
    // A driver-internal alias or an unrecognised string reaching this input is
    // the same "cannot answer" tier — never a guess at `string`.
    expect(measureResultType('min', 'integer')).toBeUndefined();
    expect(measureResultType('min', 'not_a_field_type')).toBeUndefined();
  });

  it('the minted word is the DimensionType spelling, not a FieldType one', () => {
    // The wire vocabulary here is `string` / `number` / `boolean` / `time` /
    // `geo`. A sixth word would leave every existing consumer branch unreached.
    // ⚠️ [#17560] `MEASURE_RESULT_TYPE_STRING` stood beside this constant until
    // the string branch was retired; `time` is the one word this rule mints now.
    expect(MEASURE_RESULT_TYPE_TEMPORAL).toBe('time');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// the fixture — the card shape: a `min` over a `Field.datetime`, plus the
// string-family population and the controls that must not move
// ─────────────────────────────────────────────────────────────────────────────

const dataset = DatasetSchema.parse({
  name: 'task_metrics',
  label: 'Task Metrics',
  object: 'duly_task',
  dimensions: [
    { name: 'status', field: 'status', type: 'string', label: 'Status' },
    // The dated axis `compareTo` shifts. Its own descriptor is the control in
    // section D: a temporal DIMENSION column has always said `time`.
    { name: 'touched_on', field: 'last_update_at', type: 'date', label: 'Touched' },
    // The OTHER control in section D: a lookup DIMENSION column has always said
    // `string` — the reason the corrected measure spelling is `string` too.
    { name: 'by_owner', field: 'owner_id', type: 'lookup', label: 'Owner' },
  ],
  measures: [
    // The card's measure, verbatim in shape: `min` over a datetime, carrying a
    // measure-scoped filter (which is what routes it down the supplementary
    // sub-query producer).
    { name: 'oldest_last_update_at', aggregate: 'min', field: 'last_update_at', label: 'Oldest touch', format: 'relative', filter: { status: 'open' } },
    // `max` over the same column, unfiltered → the primary `buildFieldMeta` producer.
    { name: 'newest_last_update_at', aggregate: 'max', field: 'last_update_at', label: 'Newest touch' },
    // ⚠️ [#17560] Five measures stood here — `first_subject` / `last_subject`
    // (`text`), `first_status_code` (`select`), `first_owner_id` (`lookup`) and
    // `first_case_no` (`autonumber`) — pinning the STRING population end to
    // end, and two more below pinned `min` over `json` and over `formula`. All
    // seven pair an aggregate with a field type
    // `AGGREGATE_FIELD_TYPE_COMPATIBILITY` REFUSES, and since decision batch
    // #127 the compile leg judges every aggregate, so this dataset would not
    // compile at all with any of them in it. They are re-aimed the way #16737
    // re-aimed its two: what they covered that is still coverable moves to a
    // pair the table accepts, and the refusal itself is pinned in section E
    // through the same door. ⛔ Do not point any measure here back at a refused
    // type — one refused pair reds every case in sections B–E.
    { name: 'max_estimate', aggregate: 'max', field: 'estimate_hours', label: 'Largest estimate', filter: { status: 'open' } },
    // The controls that must NOT move.
    { name: 'task_count', aggregate: 'count', label: 'Tasks' },
    { name: 'counted_touches', aggregate: 'count', field: 'last_update_at', label: 'Touched' },
    // `count` over a TEXT column — the table accepts `count` over every type,
    // so a refused MEASURE class does not make the column unmentionable.
    { name: 'counted_subjects', aggregate: 'count', field: 'subject', label: 'Subjects' },
    // ⚠️ [#16737] These two used to aggregate `last_update_at`, and section D's
    // comment on them read "nothing refuses the pair". That is no longer true:
    // `sum` / `avg` over a temporal field is now refused at COMPILE time
    // (`dataset-compiler`, the #16099 leg), so a dataset declaring the pair
    // cannot exist to be queried. What these two are here to pin is unchanged —
    // that `sum` / `avg` keep saying `number` — so they moved to the numeric
    // column and keep pinning it. ⛔ Do not point them back at a temporal field:
    // that pins a shape the platform refuses, and the suite would be asserting
    // the absence of this card's fix.
    { name: 'summed_touches', aggregate: 'sum', field: 'estimate_hours', label: 'Summed estimates' },
    { name: 'avg_touch', aggregate: 'avg', field: 'estimate_hours', label: 'Average estimate' },
    { name: 'min_estimate', aggregate: 'min', field: 'estimate_hours', label: 'Smallest estimate' },
    { name: 'min_flag', aggregate: 'min', field: 'is_urgent', label: 'Min urgency flag' },
    { name: 'min_child_total', aggregate: 'min', field: 'child_total', label: 'Min child total' },
    { name: 'touch_ratio', derived: { op: 'ratio', of: ['counted_touches', 'task_count'] }, label: 'Touch ratio' },
  ],
});

/**
 * The declared `FieldType` of each aggregated column — one member of every
 * bucket section A enumerates, so the end-to-end sections exercise the real
 * split rather than one representative.
 */
const FIELD_TYPES: Record<string, string> = {
  last_update_at: 'datetime',   // temporal — ACCEPTED
  estimate_hours: 'number',     // numeric-correct — ACCEPTED
  is_urgent: 'boolean',         // accepted-no-single-answer — ACCEPTED
  child_total: 'summary',       // numeric-correct — ACCEPTED
  // ⚠️ [#17560] These five stay DECLARED because dimensions and `count`
  // measures above still name them, and because section E drives `min` / `max`
  // over them through the door to pin the refusal. ⛔ No measure in the fixture
  // above pairs a selecting aggregate with any of them.
  subject: 'text',              // refused for min/max
  status: 'select',             // refused for min/max
  owner_id: 'lookup',           // refused for min/max
  payload: 'json',              // refused for min/max
  margin: 'formula',            // refused for min/max — VIRTUAL in SQL storage
};

const sourceFieldMeta = (_object: string, field: string) =>
  FIELD_TYPES[field] ? { type: FIELD_TYPES[field] } : undefined;

const OLDEST = '2026-07-04T07:00:00.000Z';
const NEWEST = '2026-08-30T09:15:00.000Z';

/**
 * The grid every fake producer below answers with — one column per measure the
 * fixture above still declares. [#17560] The string columns it used to carry
 * (the values SQLite really answers for `min`/`max` over TEXT) went with the
 * measures that read them: the platform refuses those pairs, so no producer can
 * be asked for the column.
 */
const GRID = [{
  status: 'open',
  oldest_last_update_at: OLDEST,
  newest_last_update_at: NEWEST,
  task_count: 3,
  counted_touches: 3,
  counted_subjects: 3,
  summed_touches: 12,
  avg_touch: 4,
  min_estimate: 2,
  max_estimate: 6,
  min_flag: 0,
  min_child_total: 7,
}];

/** The ObjectQL-aggregate path — one `buildFieldMeta` producer. */
function objectqlService() {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    sourceFieldMeta,
    executeAggregate: async () => GRID.map((r) => ({ ...r })),
  });
}

/** The native-SQL path — the OTHER `buildFieldMeta` producer. */
function nativeSqlService() {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    sourceFieldMeta,
    executeRawSql: async () => GRID.map((r) => ({ ...r })),
  });
}

/** `name → type` for the response's column metadata. */
function typeOf(fields: Awaited<ReturnType<AnalyticsService['queryDataset']>>['fields'], name: string) {
  return fields.find((f) => f.name === name)?.type;
}

// ─────────────────────────────────────────────────────────────────────────────
// B) the temporal shape, end to end through queryDataset
// ─────────────────────────────────────────────────────────────────────────────

describe('B) a min/max over a datetime is described as temporal, not number', () => {
  it('the measured response: the ISO value and its metadata no longer contradict each other', async () => {
    const result = await objectqlService().queryDataset(
      dataset,
      { dimensions: ['status'], measures: ['oldest_last_update_at'] },
      CTX,
    );
    // The value beside the metadata — an ISO instant, exactly as the card recorded.
    expect(result.rows[0]?.oldest_last_update_at).toBe(OLDEST);
    // …and the metadata now says so. This is the assertion the card is about.
    expect(result.fields.find((f) => f.name === 'oldest_last_update_at')).toMatchObject({
      name: 'oldest_last_update_at',
      type: 'time',
      label: 'Oldest touch',
      format: 'relative',
    });
  });

  it('the SUPPLEMENTARY-sub-query producer is covered: every base measure filter-scoped', async () => {
    // With `oldest_last_update_at` the only measure and it carrying a filter,
    // `runMeasurePass` issues no primary query at all and appends the measure
    // descriptor itself. Same corrected type.
    const result = await objectqlService().queryDataset(
      dataset,
      { dimensions: [], measures: ['oldest_last_update_at'] },
      CTX,
    );
    expect(typeOf(result.fields, 'oldest_last_update_at')).toBe('time');
  });

  it('the PRIMARY buildFieldMeta producer is covered: an unfiltered max', async () => {
    const result = await objectqlService().queryDataset(
      dataset,
      { dimensions: ['status'], measures: ['newest_last_update_at'] },
      CTX,
    );
    expect(result.rows[0]?.newest_last_update_at).toBe(NEWEST);
    expect(typeOf(result.fields, 'newest_last_update_at')).toBe('time');
  });

  it('the __compare producer is covered: a period-over-period column of a temporal measure', async () => {
    const result = await objectqlService().queryDataset(
      dataset,
      {
        dimensions: ['status'],
        measures: ['newest_last_update_at'],
        timeDimensions: [{ dimension: 'touched_on', dateRange: ['2026-08-01', '2026-08-31'] }],
        compareTo: { kind: 'previousPeriod' as const, dimension: 'touched_on' },
      },
      CTX,
    );
    // The compare column exists and carries the same corrected type as the base
    // column it is meant to be subtracted from.
    expect(typeOf(result.fields, 'newest_last_update_at__compare')).toBe('time');
    expect(typeOf(result.fields, 'newest_last_update_at')).toBe('time');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C) the control that identifies the assembly point
// ─────────────────────────────────────────────────────────────────────────────

describe('C) both strategy producers move together — the correction is downstream of both', () => {
  it('ObjectQL-aggregate and native-SQL answer the same column metadata', async () => {
    const selection = {
      dimensions: ['status'],
      measures: ['newest_last_update_at', 'max_estimate', 'task_count'],
    };
    const viaObjectql = await objectqlService().queryDataset(dataset, selection, CTX);
    const viaNativeSql = await nativeSqlService().queryDataset(dataset, selection, CTX);

    const shape = (r: Awaited<ReturnType<AnalyticsService['queryDataset']>>) =>
      r.fields.map((f) => ({ name: f.name, type: f.type }));

    expect(shape(viaObjectql)).toEqual(shape(viaNativeSql));
    expect(typeOf(viaObjectql.fields, 'newest_last_update_at')).toBe('time');
    expect(typeOf(viaNativeSql.fields, 'newest_last_update_at')).toBe('time');
    // [#17560] The second measure used to be a `min` over a `text` column
    // asserting `'string'`; that pair is refused now, so the non-temporal half
    // of this control is an ACCEPTED pair the rule declines to correct — which
    // is the same claim about the assembly point: both producers answer alike.
    expect(typeOf(viaObjectql.fields, 'max_estimate')).toBe('number');
    expect(typeOf(viaNativeSql.fields, 'max_estimate')).toBe('number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D) what the rule deliberately leaves alone
// ─────────────────────────────────────────────────────────────────────────────

describe('D) the columns that are genuinely numeric keep saying number', () => {
  it('count / count_distinct over the SAME datetime column, sum / avg over a numeric one, and a derived measure', async () => {
    const result = await objectqlService().queryDataset(
      dataset,
      {
        dimensions: ['status'],
        measures: ['task_count', 'counted_touches', 'summed_touches', 'avg_touch', 'touch_ratio'],
      },
      CTX,
    );
    // `count` over a datetime genuinely IS a number — a rule that typed it
    // otherwise would be a new bug, so this is a load-bearing control.
    expect(typeOf(result.fields, 'task_count')).toBe('number');
    expect(typeOf(result.fields, 'counted_touches')).toBe('number');
    // `sum`/`avg` keep saying `number`, which is correct for them over the
    // numeric column they now aggregate. [#16737] Over a TEMPORAL column the
    // pair no longer reaches a type at all — it is refused at compile time, and
    // `aggregate-datetime-measure-refusal.test.ts` is where that is pinned.
    expect(typeOf(result.fields, 'summed_touches')).toBe('number');
    expect(typeOf(result.fields, 'avg_touch')).toBe('number');
    // A derived measure has no aggregate and is numeric by construction.
    expect(typeOf(result.fields, 'touch_ratio')).toBe('number');
  });

  it('count over a TEXT column is still a number — counting strings is counting', async () => {
    const result = await objectqlService().queryDataset(
      dataset,
      { dimensions: ['status'], measures: ['counted_subjects'] },
      CTX,
    );
    expect(typeOf(result.fields, 'counted_subjects')).toBe('number');
  });

  it('min over a NUMBER field is untouched', async () => {
    const result = await objectqlService().queryDataset(
      dataset,
      { dimensions: ['status'], measures: ['min_estimate'] },
      CTX,
    );
    expect(typeOf(result.fields, 'min_estimate')).toBe('number');
  });

  it('a temporal DIMENSION column keeps the `time` it always carried — one word, not two', async () => {
    // The reason the corrected measure spelling is `time` and not `datetime`:
    // this position already says `time` for a date axis, and both words in one
    // wire position would leave every existing `time` branch unreached.
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      sourceFieldMeta,
      executeAggregate: async () => [{ touched_on: '2026-07-04', task_count: 3 }],
    });
    const result = await svc.queryDataset(dataset, { dimensions: ['touched_on'], measures: ['task_count'] }, CTX);
    expect(typeOf(result.fields, 'touched_on')).toBe('time');
  });

  it('a lookup DIMENSION column still says `string` — grouping BY a reference is untouched', async () => {
    // ⚠️ [#17560] This case used to carry a second half: a `min` over the same
    // `lookup` column, asserting the corrected MEASURE column reused the
    // dimension's word. That pair is refused now, and the half that survives is
    // the load-bearing one for this card — a `lookup` / `select` / `text` field
    // used as a DIMENSION (grouping, labelling, filtering) is not aggregation
    // and nothing about it moved.
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      sourceFieldMeta,
      executeAggregate: async () => [{ by_owner: 'usr_01H8XK', task_count: 3 }],
    });
    const result = await svc.queryDataset(
      dataset,
      { dimensions: ['by_owner'], measures: ['task_count'] },
      CTX,
    );
    expect(typeOf(result.fields, 'by_owner')).toBe('string');
    expect(typeOf(result.fields, 'task_count')).toBe('number');
  });

  it('a host that cannot answer for the field leaves the column exactly as produced', async () => {
    const blind = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      // No `sourceFieldMeta` at all — the "no data engine wired" tier.
      executeAggregate: async () => GRID.map((r) => ({ ...r })),
    });
    const result = await blind.queryDataset(
      dataset,
      { dimensions: ['status'], measures: ['newest_last_update_at', 'max_estimate'] },
      CTX,
    );
    expect(typeOf(result.fields, 'newest_last_update_at')).toBe('number');
    expect(typeOf(result.fields, 'max_estimate')).toBe('number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E) [#17560] the population this file used to type — now REFUSED at the door
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The seven measures that left the shared fixture, each pinned as a REFUSAL
 * through the same `queryDataset` door that used to answer them. ⛔ The pairs
 * are not restated as a verdict — every case asks the shipped table first, so a
 * row changed upstream moves this file with it instead of leaving a second
 * account of the contract.
 */
const RETIRED_PAIRS: ReadonlyArray<{ measure: string; aggregate: 'min' | 'max'; field: string; declared: string; used_to_type: string }> = [
  { measure: 'first_subject', aggregate: 'min', field: 'subject', declared: 'text', used_to_type: 'string' },
  { measure: 'last_subject', aggregate: 'max', field: 'subject', declared: 'text', used_to_type: 'string' },
  { measure: 'first_status_code', aggregate: 'min', field: 'status', declared: 'select', used_to_type: 'string' },
  { measure: 'first_owner_id', aggregate: 'min', field: 'owner_id', declared: 'lookup', used_to_type: 'string' },
  { measure: 'min_payload', aggregate: 'min', field: 'payload', declared: 'json', used_to_type: 'number (no correction)' },
  { measure: 'min_margin', aggregate: 'min', field: 'margin', declared: 'formula', used_to_type: 'number (no correction)' },
];

/** One measure per case, so a refusal cannot be masked by a sibling's. */
const refusedDataset = (name: string, aggregate: string, field: string) => DatasetSchema.parse({
  name: 'task_metrics_refused',
  label: 'Task Metrics',
  object: 'duly_task',
  dimensions: [{ name: 'status', field: 'status', type: 'string', label: 'Status' }],
  measures: [{ name, aggregate, field, label: name }],
});

async function refusalOf(fn: () => Promise<unknown>): Promise<Error & { code?: string; status?: number }> {
  try {
    await fn();
  } catch (e) {
    return e as Error & { code?: string; status?: number };
  }
  throw new Error('expected a refusal, none was thrown');
}

describe('E) the min/max pairs this file used to describe are refused before a type is minted', () => {
  for (const { measure, aggregate, field, declared, used_to_type } of RETIRED_PAIRS) {
    it(`${aggregate} × \`${declared}\` → DATASET_INVALID / 400 (used to answer ${used_to_type})`, async () => {
      // Guard against a vacuous case: if the table ever ACCEPTED the pair this
      // expectation would be asserting the wrong contract.
      expect(isAggregateCompatibleWithFieldType(aggregate, declared)).toBe(false);
      const sqls: string[] = [];
      const svc = new AnalyticsService({
        queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
        sourceFieldMeta,
        executeRawSql: async (_o: string, sql: string) => { sqls.push(sql); return GRID.map((r) => ({ ...r })); },
      });
      const err = await refusalOf(() => svc.queryDataset(
        refusedDataset(measure, aggregate, field),
        { dimensions: ['status'], measures: [measure] },
        CTX,
      ));
      expect(err.code).toBe('DATASET_INVALID');
      expect(err.status).toBe(400);
      // The message locates the fault for the author who wrote the pair…
      expect(err.message).toContain(measure);
      expect(err.message).toContain(field);
      expect(err.message).toContain(declared);
      // …and refused as a DECLARATION: nothing reached the driver, which is
      // what makes this a rejected document rather than an empty answer.
      expect(sqls.length).toBe(0);
    });
  }

  it('`autonumber` is refused too — the member whose string-ness this file MEASURED', async () => {
    // ⚠️ The measurement stands and was never the question: `renderAutonumber`
    // returns a zero-padded string, the DDL is `table.string`, and SQLite really
    // answers padded TEXT for `min` over such a column. What batch #127 settled
    // is that a value existing on one backend is not a value every backend
    // agrees on — `'0010'` sorts before `'9'` — so the pair is refused and the
    // `'string'` this file used to pin has nothing left to describe.
    expect(isAggregateCompatibleWithFieldType('min', 'autonumber')).toBe(false);
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      sourceFieldMeta: (_o: string, f: string) => (f === 'case_no' ? { type: 'autonumber' } : sourceFieldMeta(_o, f)),
      executeAggregate: async () => [{ status: 'open', first_case_no: '0003' }],
    });
    const err = await refusalOf(() => svc.queryDataset(
      refusedDataset('first_case_no', 'min', 'case_no'),
      { dimensions: ['status'], measures: ['first_case_no'] },
      CTX,
    ));
    expect(err.code).toBe('DATASET_INVALID');
  });

  it('⭐ the NEGATIVE CONTROL that keeps this section honest: accepted pairs still compile', async () => {
    // `min` × `number` is accepted by the table and must be untouched by all of
    // the above — the case that fails if the door started refusing everything.
    expect(isAggregateCompatibleWithFieldType('min', 'number')).toBe(true);
    const result = await objectqlService().queryDataset(
      dataset,
      { dimensions: ['status'], measures: ['min_estimate', 'oldest_last_update_at'] },
      CTX,
    );
    expect(result.rows[0]?.min_estimate).toBe(2);
    expect(typeOf(result.fields, 'min_estimate')).toBe('number');
    expect(typeOf(result.fields, 'oldest_last_update_at')).toBe('time');
  });

  it('the ACCEPTED members this rule still declines for keep the number they had', async () => {
    const result = await objectqlService().queryDataset(
      dataset,
      { dimensions: ['status'], measures: ['min_flag', 'min_child_total'] },
      CTX,
    );
    // `boolean` — ACCEPTED by the table (#11152 / #16750: booleans aggregate as
    // numbers on every backend) and yet three readings disagree about what
    // `min` over one returns. `DimensionType` HAS a `boolean` spelling, which is
    // precisely why this assertion is load-bearing: the correction is spellable
    // and is deliberately not made.
    expect(isAggregateCompatibleWithFieldType('min', 'boolean')).toBe(true);
    expect(typeOf(result.fields, 'min_flag')).toBe('number');
    // `summary` — genuinely numeric on both shipped statements, so `number` is
    // CORRECT here rather than merely unexamined.
    expect(typeOf(result.fields, 'min_child_total')).toBe('number');
  });
});
