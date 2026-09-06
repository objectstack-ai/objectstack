// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15768 — a dataset measure's `fields[].type` must describe the value sitting
 * beside it in the same response.
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
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Reverting ONLY the two-line call site in `analytics-service.ts` (leaving
 * `measure-result-type.ts` in place) must turn RED every assertion that expects
 * `'time'` — sections B and C — and leave section A (the rule in isolation) and
 * section D (the columns the rule deliberately does not touch) GREEN. Ordinary
 * direction: the change CORRECTS a value on existing entries, mints no column
 * and removes no limb, so nothing downstream can gain or lose a finding.
 * Predicted red: the four `'time'` cases. Measured: recorded in the PR body.
 */

import { describe, it, expect } from 'vitest';
import { AggregationFunction } from '@objectstack/spec/data';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import { measureResultType, MEASURE_RESULT_TYPE_TEMPORAL } from '../measure-result-type.js';

const CTX = { tenantId: 'org_A' } as ExecutionContext;

// ─────────────────────────────────────────────────────────────────────────────
// A) the CLOSED aggregate vocabulary, enumerated rather than sampled
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One row per member of `AggregationFunction`, with what the member answers and
 * why. `overTemporal` is the verdict for a `date`/`datetime`/`time` source
 * field; `undefined` means "this rule says nothing — the producer's `'number'`
 * stands", which for four of the six members is the CORRECT answer rather than
 * an omission.
 */
const VOCABULARY: ReadonlyArray<{
  fn: (typeof AggregationFunction.options)[number];
  overTemporal: string | undefined;
  why: string;
}> = [
  { fn: 'count', overTemporal: undefined, why: 'a row count is a number however temporal the counted column is' },
  { fn: 'count_distinct', overTemporal: undefined, why: 'a cardinality is a number, same reason as count' },
  { fn: 'sum', overTemporal: undefined, why: 'unrefused and backend-decided over a temporal column — no single value to type' },
  { fn: 'avg', overTemporal: undefined, why: 'same as sum: an epoch mean on SQLite, a refusal on Postgres' },
  { fn: 'min', overTemporal: MEASURE_RESULT_TYPE_TEMPORAL, why: 'returns a value of the aggregated field own type' },
  { fn: 'max', overTemporal: MEASURE_RESULT_TYPE_TEMPORAL, why: 'returns a value of the aggregated field own type' },
];

describe('A) measureResultType covers the whole closed AggregationFunction vocabulary', () => {
  it('the table enumerates every declared member, and only declared members', () => {
    // The exhaustiveness guard. A member ADDED to the spec enum lands here as a
    // failure rather than silently falling through `measureResultType` as
    // "nothing to say" — which is exactly how a new aggregate would inherit the
    // flat `number` this card is about.
    expect([...VOCABULARY.map((v) => v.fn)].sort()).toEqual([...AggregationFunction.options].sort());
  });

  for (const { fn, overTemporal, why } of VOCABULARY) {
    it(`${fn} over a temporal field → ${overTemporal ?? 'no correction'} (${why})`, () => {
      expect(measureResultType(fn, 'datetime')).toBe(overTemporal);
      expect(measureResultType(fn, 'date')).toBe(overTemporal);
      expect(measureResultType(fn, 'time')).toBe(overTemporal);
    });

    it(`${fn} over a NUMBER field is never corrected`, () => {
      expect(measureResultType(fn, 'number')).toBeUndefined();
      expect(measureResultType(fn, 'currency')).toBeUndefined();
    });
  }

  it('a derived measure (no aggregate) is never corrected — computeDerived coerces with Number()', () => {
    expect(measureResultType(undefined, 'datetime')).toBeUndefined();
  });

  it('an unanswerable source field is left alone ("cannot answer, do not block")', () => {
    // No data engine wired, an object/field the host does not know, or a
    // relationship-path measure `sourceFieldMeta` cannot resolve.
    expect(measureResultType('min', undefined)).toBeUndefined();
    expect(measureResultType('max', undefined)).toBeUndefined();
  });

  it('min/max over a NON-temporal field is deliberately out of this rule population', () => {
    // Still described as `number`, and still wrong for a text column — reported
    // as its own finding rather than absorbed here.
    expect(measureResultType('min', 'text')).toBeUndefined();
    expect(measureResultType('max', 'select')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// the fixture — the card shape: a `min` over a `Field.datetime`
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
  ],
  measures: [
    // The card's measure, verbatim in shape: `min` over a datetime, carrying a
    // measure-scoped filter (which is what routes it down the supplementary
    // sub-query producer).
    { name: 'oldest_last_update_at', aggregate: 'min', field: 'last_update_at', label: 'Oldest touch', format: 'relative', filter: { status: 'open' } },
    // `max` over the same column, unfiltered → the primary `buildFieldMeta` producer.
    { name: 'newest_last_update_at', aggregate: 'max', field: 'last_update_at', label: 'Newest touch' },
    // The controls that must NOT move.
    { name: 'task_count', aggregate: 'count', label: 'Tasks' },
    { name: 'counted_touches', aggregate: 'count', field: 'last_update_at', label: 'Touched' },
    { name: 'summed_touches', aggregate: 'sum', field: 'last_update_at', label: 'Summed touches' },
    { name: 'avg_touch', aggregate: 'avg', field: 'last_update_at', label: 'Average touch' },
    { name: 'min_estimate', aggregate: 'min', field: 'estimate_hours', label: 'Smallest estimate' },
    { name: 'touch_ratio', derived: { op: 'ratio', of: ['counted_touches', 'task_count'] }, label: 'Touch ratio' },
  ],
});

/** `duly_task.last_update_at` is `Field.datetime`; `estimate_hours` is a number. */
const sourceFieldMeta = (_object: string, field: string) =>
  field === 'last_update_at'
    ? { type: 'datetime' }
    : field === 'estimate_hours'
      ? { type: 'number' }
      : undefined;

const OLDEST = '2026-07-04T07:00:00.000Z';
const NEWEST = '2026-08-30T09:15:00.000Z';

/** The grid every fake producer below answers with. */
const GRID = [{ status: 'open', oldest_last_update_at: OLDEST, newest_last_update_at: NEWEST, task_count: 3, counted_touches: 3, summed_touches: 12, avg_touch: 4, min_estimate: 2 }];

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
// B) the card's own shape, end to end through queryDataset
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
    const selection = { dimensions: ['status'], measures: ['newest_last_update_at', 'task_count'] };
    const viaObjectql = await objectqlService().queryDataset(dataset, selection, CTX);
    const viaNativeSql = await nativeSqlService().queryDataset(dataset, selection, CTX);

    const shape = (r: Awaited<ReturnType<AnalyticsService['queryDataset']>>) =>
      r.fields.map((f) => ({ name: f.name, type: f.type }));

    expect(shape(viaObjectql)).toEqual(shape(viaNativeSql));
    expect(typeOf(viaObjectql.fields, 'newest_last_update_at')).toBe('time');
    expect(typeOf(viaNativeSql.fields, 'newest_last_update_at')).toBe('time');
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

  it('a host that cannot answer for the field leaves the column exactly as produced', async () => {
    const blind = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      // No `sourceFieldMeta` at all — the "no data engine wired" tier.
      executeAggregate: async () => GRID.map((r) => ({ ...r })),
    });
    const result = await blind.queryDataset(
      dataset,
      { dimensions: ['status'], measures: ['newest_last_update_at'] },
      CTX,
    );
    expect(typeOf(result.fields, 'newest_last_update_at')).toBe('number');
  });
});
