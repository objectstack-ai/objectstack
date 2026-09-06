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
 * branch for the column. The STRING half is the same defect over a different
 * population: a `min` over a `text` / `select` / `lookup` / `autonumber` column
 * returns a string and was described as `number` too.
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
 * `'time'` or `'string'` — sections B, C and E — and leave section A (the rule
 * in isolation) and section D (the columns the rule deliberately does not
 * touch) GREEN. Ordinary direction: the change CORRECTS a value on existing
 * entries, mints no column and removes no limb, so nothing downstream can gain
 * or lose a finding. Measured: recorded in the PR body.
 */

import { describe, it, expect } from 'vitest';
import { AggregationFunction, FieldType } from '@objectstack/spec/data';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import {
  measureResultType,
  MEASURE_RESULT_TYPE_STRING,
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
 * The bucket each `FieldType` member lands in. The three that matter are the
 * card's own split, made honest by measuring rather than guessing:
 *
 *  - `string` / `temporal` — the stored value's kind is established by BOTH
 *    shipped statements of it (the spec value contract and driver-sql's DDL),
 *    so the wire word follows from a measurement.
 *  - `numeric-correct` — the producer's `number` is right; there is nothing to
 *    correct. Not the same thing as "unexamined".
 *  - `backend-dependent` — measured, and the readings do not converge on one
 *    value (or on whether a value exists at all). Left uncorrected on purpose;
 *    the missing refusal is owned by the `needs-user-decision` card for "no
 *    layer refuses an incoherent aggregate / field-type pair".
 *  - `not-on-this-input` — an answer exists in the metadata but not on this
 *    rule's input (`formula.returnType`, which `sourceFieldMeta` does not
 *    carry). Filed rather than guessed.
 */
type FieldTypeBucket =
  | 'string'
  | 'temporal'
  | 'numeric-correct'
  | 'backend-dependent'
  | 'not-on-this-input';

const EXPECTED_BY_BUCKET: Record<FieldTypeBucket, string | undefined> = {
  string: MEASURE_RESULT_TYPE_STRING,
  temporal: MEASURE_RESULT_TYPE_TEMPORAL,
  'numeric-correct': undefined,
  'backend-dependent': undefined,
  'not-on-this-input': undefined,
};

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
  { type: 'text', bucket: 'string', why: 'valueSchemaFor answers z.string(); TEXT column' },
  { type: 'textarea', bucket: 'string', why: 'valueSchemaFor answers z.string(); TEXT column' },
  { type: 'email', bucket: 'string', why: 'valueSchemaFor answers z.string(); TEXT column' },
  { type: 'url', bucket: 'string', why: 'valueSchemaFor answers z.string(); TEXT column' },
  { type: 'phone', bucket: 'string', why: 'valueSchemaFor answers z.string(); TEXT column' },
  { type: 'password', bucket: 'string', why: 'stored plaintext-or-hashed, masked on read — a string either way' },
  { type: 'secret', bucket: 'string', why: 'stores an opaque sys_secret ref, masked on read — a string either way' },
  { type: 'markdown', bucket: 'string', why: 'a multi-line body in a TEXT column' },
  { type: 'html', bucket: 'string', why: 'a multi-line body in a TEXT column' },
  { type: 'richtext', bucket: 'string', why: 'a multi-line body in a TEXT column' },
  { type: 'code', bucket: 'string', why: 'stores the editor contents verbatim (measured in field-zoo)' },
  { type: 'color', bucket: 'string', why: 'a color code string' },
  { type: 'signature', bucket: 'string', why: 'a data-URI string; the write seam enforces its declared bound' },
  { type: 'qrcode', bucket: 'string', why: 'a data-URI string; the write seam enforces its declared bound' },
  // ── one declared option code: spec `SINGLE_OPTION_TYPES` ──
  { type: 'select', bucket: 'string', why: 'one option code; optionCodes stringifies a numerically-spelled code' },
  { type: 'radio', bucket: 'string', why: 'one option code, same branch as select' },
  // ── the referenced row id: spec `REFERENCE_VALUE_TYPES` ──
  { type: 'lookup', bucket: 'string', why: 'ReferenceIdValueSchema is z.string() — the id, never the expanded record' },
  { type: 'master_detail', bucket: 'string', why: 'same ReferenceIdValueSchema as lookup' },
  { type: 'tree', bucket: 'string', why: 'same ReferenceIdValueSchema as lookup' },
  { type: 'user', bucket: 'string', why: 'a lookup fixed to sys_user; identical storage' },
  // ── measured, not assumed ──
  { type: 'autonumber', bucket: 'string', why: 'renderAutonumber returns a zero-padded string; DDL is table.string; SQLite min/max over padded numbers returns text' },
  // ── the temporal family, landed earlier ──
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
  { type: 'summary', bucket: 'numeric-correct', why: 'spec NUMERIC_VALUE_TYPES and DDL table.float — both shipped statements say numeric' },
  // ── measured, and the readings do not converge ──
  { type: 'boolean', bucket: 'backend-dependent', why: 'Postgres has no min(boolean) at all; SQLite answers 0/1 as numbers; the driver seam has been recorded answering false/true' },
  { type: 'toggle', bucket: 'backend-dependent', why: 'a boolean rendered as a switch — same column, same three readings' },
  { type: 'multiselect', bucket: 'backend-dependent', why: 'an array in a JSON column: no min over jsonb on Postgres, serialized TEXT on SQLite' },
  { type: 'checkboxes', bucket: 'backend-dependent', why: 'an array in a JSON column, same as multiselect' },
  { type: 'tags', bucket: 'backend-dependent', why: 'a free-form array in a JSON column, same as multiselect' },
  { type: 'image', bucket: 'backend-dependent', why: 'stored form mid-migration (ADR-0104 D3): contract says opaque id, DDL still a JSON column' },
  { type: 'file', bucket: 'backend-dependent', why: 'stored form mid-migration, same as image' },
  { type: 'avatar', bucket: 'backend-dependent', why: 'stored form mid-migration, same as image' },
  { type: 'video', bucket: 'backend-dependent', why: 'stored form mid-migration, same as image' },
  { type: 'audio', bucket: 'backend-dependent', why: 'stored form mid-migration, same as image' },
  { type: 'composite', bucket: 'backend-dependent', why: 'an object in a JSON column' },
  { type: 'repeater', bucket: 'backend-dependent', why: 'an array of objects in a JSON column' },
  { type: 'record', bucket: 'backend-dependent', why: 'a name-keyed map in a JSON column' },
  { type: 'location', bucket: 'backend-dependent', why: 'a {lat,lng} object in a JSON column' },
  { type: 'address', bucket: 'backend-dependent', why: 'a structured object in a JSON column' },
  { type: 'vector', bucket: 'backend-dependent', why: 'a number array in a JSON column' },
  { type: 'json', bucket: 'backend-dependent', why: 'the untyped escape hatch — the value contract is explicitly open (z.unknown())' },
  // ── answerable, but not from this rule's input ──
  { type: 'formula', bucket: 'not-on-this-input', why: 'FieldSchema.returnType declares it, but sourceFieldMeta returns only { type, defaultCurrency, max } — and returnType is itself optional' },
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

  it('every bucket is populated — the split is real, not three names for one branch', () => {
    const buckets = new Set(FIELD_TYPE_VERDICTS.map((v) => v.bucket));
    expect([...buckets].sort()).toEqual([
      'backend-dependent', 'not-on-this-input', 'numeric-correct', 'string', 'temporal',
    ]);
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

  it('the two minted words are the DimensionType spellings, not FieldType ones', () => {
    // The wire vocabulary here is `string` / `number` / `boolean` / `time` /
    // `geo`. A sixth word would leave every existing consumer branch unreached.
    expect(MEASURE_RESULT_TYPE_STRING).toBe('string');
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
    // The STRING population this card lands — one member per value class.
    { name: 'first_subject', aggregate: 'min', field: 'subject', label: 'First subject' },
    // …with a measure-scoped filter, so the string family covers the
    // supplementary-sub-query producer too, not only the primary one.
    { name: 'last_subject', aggregate: 'max', field: 'subject', label: 'Last subject', filter: { status: 'open' } },
    { name: 'first_status_code', aggregate: 'min', field: 'status', label: 'First status' },
    { name: 'first_owner_id', aggregate: 'min', field: 'owner_id', label: 'First owner' },
    { name: 'first_case_no', aggregate: 'min', field: 'case_no', label: 'First case number' },
    // The controls that must NOT move.
    { name: 'task_count', aggregate: 'count', label: 'Tasks' },
    { name: 'counted_touches', aggregate: 'count', field: 'last_update_at', label: 'Touched' },
    { name: 'counted_subjects', aggregate: 'count', field: 'subject', label: 'Subjects' },
    { name: 'summed_touches', aggregate: 'sum', field: 'last_update_at', label: 'Summed touches' },
    { name: 'avg_touch', aggregate: 'avg', field: 'last_update_at', label: 'Average touch' },
    { name: 'min_estimate', aggregate: 'min', field: 'estimate_hours', label: 'Smallest estimate' },
    { name: 'min_flag', aggregate: 'min', field: 'is_urgent', label: 'Min urgency flag' },
    { name: 'min_payload', aggregate: 'min', field: 'payload', label: 'Min payload' },
    { name: 'min_margin', aggregate: 'min', field: 'margin', label: 'Min margin' },
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
  last_update_at: 'datetime',   // temporal
  subject: 'text',              // string — plain
  status: 'select',             // string — one option code
  owner_id: 'lookup',           // string — a referenced row id
  case_no: 'autonumber',        // string — the rendered record number
  estimate_hours: 'number',     // numeric-correct
  is_urgent: 'boolean',         // backend-dependent
  payload: 'json',              // backend-dependent
  margin: 'formula',            // not-on-this-input
  child_total: 'summary',       // numeric-correct
};

const sourceFieldMeta = (_object: string, field: string) =>
  FIELD_TYPES[field] ? { type: FIELD_TYPES[field] } : undefined;

const OLDEST = '2026-07-04T07:00:00.000Z';
const NEWEST = '2026-08-30T09:15:00.000Z';

/**
 * The grid every fake producer below answers with. The string columns carry the
 * values SQLite really answers for `min`/`max` over TEXT — measured directly:
 * lexicographic, and a zero-padded record number stays padded text.
 */
const GRID = [{
  status: 'open',
  oldest_last_update_at: OLDEST,
  newest_last_update_at: NEWEST,
  first_subject: 'Archive the backlog',
  last_subject: 'Zip the release notes',
  first_status_code: 'closed',
  first_owner_id: 'usr_01H8XK',
  first_case_no: '0003',
  task_count: 3,
  counted_touches: 3,
  counted_subjects: 3,
  summed_touches: 12,
  avg_touch: 4,
  min_estimate: 2,
  min_flag: 0,
  min_payload: '{"a":1}',
  min_margin: 0.25,
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
      measures: ['newest_last_update_at', 'first_subject', 'task_count'],
    };
    const viaObjectql = await objectqlService().queryDataset(dataset, selection, CTX);
    const viaNativeSql = await nativeSqlService().queryDataset(dataset, selection, CTX);

    const shape = (r: Awaited<ReturnType<AnalyticsService['queryDataset']>>) =>
      r.fields.map((f) => ({ name: f.name, type: f.type }));

    expect(shape(viaObjectql)).toEqual(shape(viaNativeSql));
    expect(typeOf(viaObjectql.fields, 'newest_last_update_at')).toBe('time');
    expect(typeOf(viaNativeSql.fields, 'newest_last_update_at')).toBe('time');
    expect(typeOf(viaObjectql.fields, 'first_subject')).toBe('string');
    expect(typeOf(viaNativeSql.fields, 'first_subject')).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D) what the rule deliberately leaves alone
// ─────────────────────────────────────────────────────────────────────────────

describe('D) the columns that are genuinely numeric keep saying number', () => {
  it('count / count_distinct / sum / avg over the SAME datetime column, and a derived measure', async () => {
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
    // `sum`/`avg` over a temporal column: nothing refuses the pair and the value
    // is backend-decided, so no type is invented for it.
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

  it('a lookup DIMENSION column already said `string` — the measure now uses the SAME word', async () => {
    // The `time` argument's other half, and the reason a textual measure is not
    // spelled `text`: `dataset-compiler.dimensionType` maps a lookup dimension
    // to `string`, so the corrected measure column reuses a word this position
    // already speaks rather than adding a sixth to `DimensionType`.
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      sourceFieldMeta,
      executeAggregate: async () => [{ by_owner: 'usr_01H8XK', first_owner_id: 'usr_01H8XK' }],
    });
    const result = await svc.queryDataset(
      dataset,
      { dimensions: ['by_owner'], measures: ['first_owner_id'] },
      CTX,
    );
    expect(typeOf(result.fields, 'by_owner')).toBe('string');
    expect(typeOf(result.fields, 'first_owner_id')).toBe('string');
  });

  it('a host that cannot answer for the field leaves the column exactly as produced', async () => {
    const blind = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      // No `sourceFieldMeta` at all — the "no data engine wired" tier.
      executeAggregate: async () => GRID.map((r) => ({ ...r })),
    });
    const result = await blind.queryDataset(
      dataset,
      { dimensions: ['status'], measures: ['newest_last_update_at', 'first_subject'] },
      CTX,
    );
    expect(typeOf(result.fields, 'newest_last_update_at')).toBe('number');
    expect(typeOf(result.fields, 'first_subject')).toBe('number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E) the string population this card lands, and the members it leaves alone
// ─────────────────────────────────────────────────────────────────────────────

describe('E) a min/max over a string-valued column is described as string, not number', () => {
  it('the card shape: a text column whose value and metadata no longer contradict', async () => {
    const result = await objectqlService().queryDataset(
      dataset,
      { dimensions: ['status'], measures: ['first_subject'] },
      CTX,
    );
    // The value beside the metadata is a string, exactly as SQLite answers.
    expect(result.rows[0]?.first_subject).toBe('Archive the backlog');
    expect(result.fields.find((f) => f.name === 'first_subject')).toMatchObject({
      name: 'first_subject',
      type: 'string',
      label: 'First subject',
    });
  });

  it('the SUPPLEMENTARY-sub-query producer is covered for the string family too', async () => {
    // `last_subject` is the only measure and carries a filter, so
    // `runMeasurePass` appends the descriptor itself instead of issuing a
    // primary query — the producer the card's own measured response came from.
    const result = await objectqlService().queryDataset(
      dataset,
      { dimensions: [], measures: ['last_subject'] },
      CTX,
    );
    expect(typeOf(result.fields, 'last_subject')).toBe('string');
  });

  it('one member of every string value class moves: option code, reference id, record number', async () => {
    const result = await objectqlService().queryDataset(
      dataset,
      {
        dimensions: ['status'],
        measures: ['first_status_code', 'first_owner_id', 'first_case_no'],
      },
      CTX,
    );
    // `select` — the stored option code.
    expect(result.rows[0]?.first_status_code).toBe('closed');
    expect(typeOf(result.fields, 'first_status_code')).toBe('string');
    // `lookup` — the referenced row's id, never the expanded record.
    expect(result.rows[0]?.first_owner_id).toBe('usr_01H8XK');
    expect(typeOf(result.fields, 'first_owner_id')).toBe('string');
    // `autonumber` — the rendered, zero-padded record number. Measured on
    // SQLite: min over padded record numbers answers padded TEXT, not an int.
    expect(result.rows[0]?.first_case_no).toBe('0003');
    expect(typeOf(result.fields, 'first_case_no')).toBe('string');
  });

  it('the __compare producer carries the corrected string type too', async () => {
    const result = await objectqlService().queryDataset(
      dataset,
      {
        dimensions: ['status'],
        measures: ['first_subject'],
        timeDimensions: [{ dimension: 'touched_on', dateRange: ['2026-08-01', '2026-08-31'] }],
        compareTo: { kind: 'previousPeriod' as const, dimension: 'touched_on' },
      },
      CTX,
    );
    expect(typeOf(result.fields, 'first_subject__compare')).toBe('string');
    expect(typeOf(result.fields, 'first_subject')).toBe('string');
  });

  it('the UNCORRECTED members keep the number they had, and each for its own recorded reason', async () => {
    const result = await objectqlService().queryDataset(
      dataset,
      {
        dimensions: ['status'],
        measures: ['min_flag', 'min_payload', 'min_margin', 'min_child_total'],
      },
      CTX,
    );
    // `boolean` — Postgres has no min(boolean); SQLite answers 0/1 as numbers;
    // the driver seam has been recorded answering false/true. Three readings,
    // no single answer, so no word is invented. `DimensionType` HAS a `boolean`
    // spelling, which is precisely why this assertion is load-bearing: the
    // correction is spellable and is deliberately not made.
    expect(typeOf(result.fields, 'min_flag')).toBe('number');
    // `json` — an object in a JSON column; the value contract is explicitly open.
    expect(typeOf(result.fields, 'min_payload')).toBe('number');
    // `formula` — the answer is declared on `FieldSchema.returnType`, which is
    // not on `sourceFieldMeta`'s return shape (and is itself optional).
    expect(typeOf(result.fields, 'min_margin')).toBe('number');
    // `summary` — genuinely numeric on both shipped statements (spec
    // NUMERIC_VALUE_TYPES, DDL `table.float`), so `number` is CORRECT here
    // rather than merely unexamined.
    expect(typeOf(result.fields, 'min_child_total')).toBe('number');
  });
});
