// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11151] Boolean aggregands answer the RULED values on this face too — all
 * four cells, ungrouped and grouped.
 *
 * ## The ruling this suite pins
 *
 * - **`sum` / `avg` answer arithmetic** — `3` / `0.5` over a 3-true/3-false
 *   fixture. The #11065 family shape, landed on `driver-memory` and on every
 *   SQL dialect (#11635).
 * - **`min` / `max` answer `0` / `1`** — #11152 (maintainer 2026-08-28,
 *   applied on that card's comment 5448627494, ruling verbatim and
 *   untranslated: 「12745 A回，其他同意。」), SUPERSEDING #11249's
 *   `false` / `true`: booleans aggregate as NUMBERS on every face, with no
 *   per-aggregate exception, so one boolean column's aggregates answer in one
 *   numeric domain rather than three-numbers-two-booleans.
 *
 * Measured on `origin/main` @ `23843d3f4` before the #11151 fix, through the
 * harness below: `sum` = `0`, `avg` = `null`, `min` = `null`, `max` = `null` —
 * all four wrong, whole-table and per group, while `count` = 6 and
 * `count_distinct` = 2 already agreed. Between #11151 and #11152 the order
 * statistics answered #11249's `false` / `true`; measured red against the
 * ruled `0` / `1` (the #11152 conformance cases) before this file flipped.
 *
 * ## The two independent defects behind the original four cells
 *
 * They were NOT one fix applied twice:
 *
 * 1. **The lowering** (`mongodb-aggregation.ts`) emitted a bare
 *    `{$sum: '$flag'}` / `{$avg: '$flag'}`. MongoDB's arithmetic accumulators
 *    ignore non-numeric values, so with no numeric value `$sum` folds to its
 *    identity `0` and `$avg` answers `null`. Fixed by the boolean-only `$cond`
 *    coercion.
 * 2. **The instrument** (`mongodb-pipeline-evaluator.testkit.ts`) applied that
 *    same "ignore non-numeric" rule to `$min` / `$max`, which are order
 *    statistics over BSON canonical order and rank booleans perfectly well.
 *    The bare `{$min: '$flag'}` lowering was faithful mongod semantics — and
 *    the #11152 ruling is exactly why faithfulness is not enough: bare, this
 *    face answers a member of the input domain (`false`/`true`) where the
 *    platform contract says `0`/`1`, so the lowering now wraps `min`/`max` in
 *    the SAME `$cond` coercion `sum`/`avg` use, and the numbers get ranked.
 *
 * The {@link describe} block "the emitted lowering carries the coercion on all
 * four arms" pins the stages by reading them rather than trusting the values —
 * the values alone cannot tell a `$min` over a coerced `1`/`0` from a
 * post-processing conversion, and the stage is the contract surface a real
 * mongod would execute.
 *
 * ## ⚠️ What this suite deliberately does NOT answer
 *
 * Whether a real mongod agrees. `runPipeline` is the in-process evaluator
 * `mongodb-aggregation-translation.test.ts` uses: it holds the LOWERING to the
 * shared table by MongoDB's documented semantics, and this fleet cannot fetch a
 * mongod binary at all (#5517). Every operator it models is read from the
 * manual, not observed — `$type` and the BSON-order `$min`/`$max` this card
 * added included. No test name here claims otherwise.
 *
 * ## The fixture
 *
 * `AGGREGATION_ROWS` — the shared aggregate-vocabulary fixture, whose `flag`
 * boolean column (added by #11152) carries the distribution this file
 * previously held as a private `FLAG_BY_ID` map: 3 true / 3 false, `west`
 * `[T,F,F,F]`, `east` `[T,T]`. The private map is deleted in favour of the
 * fixture column so the faces can never silently disagree on grouped values.
 */

import { describe, it, expect } from 'vitest';
import { AGGREGATION_ROWS } from '@objectstack/spec/data';
import {
  buildAggregationPipeline,
  postProcessAggregation,
  type AggregationInput,
} from './mongodb-aggregation.js';
import {
  runPipeline,
  UnsupportedShape,
  type Doc,
} from './mongodb-pipeline-evaluator.testkit.js';

/** The alias every measure is projected under — never a fixture column. */
const MEASURE = 'measure';

/**
 * The six shared rows — `flag` included, straight from the fixture — plus a
 * column that exists only to drive the empty-input branch of an order
 * statistic: `voidcol` is an explicit `null` on every row, and no row carries
 * `absent` at all.
 */
const ROWS: Doc[] = (AGGREGATION_ROWS as unknown as Doc[]).map((row) => ({
  ...row,
  voidcol: null,
}));

/** Run one aggregation end to end and answer the whole-table measure. */
function measure(func: string, field: string): unknown {
  const aggregations = [{ function: func, field, alias: MEASURE }] as AggregationInput[];
  const pipeline = buildAggregationPipeline({ aggregations });
  return postProcessAggregation(runPipeline(ROWS, pipeline), aggregations)[0]?.[MEASURE];
}

/** Run one aggregation grouped by `region`, keyed by group value. */
function byRegion(func: string, field: string): Record<string, unknown> {
  const aggregations = [{ function: func, field, alias: MEASURE }] as AggregationInput[];
  const pipeline = buildAggregationPipeline({ aggregations, groupBy: ['region'] });
  const rows = postProcessAggregation(runPipeline(ROWS, pipeline), aggregations);
  return Object.fromEntries(rows.map((row) => [String(row.region), row[MEASURE]]));
}

describe('[#11151] driver-mongodb — the fixture this suite measures', () => {
  // The fixture read back rather than trusted: a seed that dropped a row or
  // folded the flags would turn every value below into a test of another table.
  it('is six rows, 3 true / 3 false, with east all-true', () => {
    expect(ROWS).toHaveLength(6);
    expect(ROWS.filter((r) => r.flag === true), 'true rows').toHaveLength(3);
    expect(ROWS.filter((r) => r.region === 'east').map((r) => r.flag)).toEqual([true, true]);
    expect(ROWS.filter((r) => r.region === 'west').map((r) => r.flag)).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });
});

describe('[#11151] the ruled arithmetic half — sum / avg count a boolean as 1 or 0', () => {
  it('sum(flag) answers 3, not $sum’s identity 0', () => {
    expect(measure('sum', 'flag')).toBe(3);
  });

  it('avg(flag) answers 0.5, not null', () => {
    expect(measure('avg', 'flag')).toBe(0.5);
  });

  it('grouped sum/avg answer per group: west [T,F,F,F], east [T,T]', () => {
    expect(byRegion('sum', 'flag')).toEqual({ west: 1, east: 2 });
    expect(byRegion('avg', 'flag')).toEqual({ west: 0.25, east: 1 });
  });
});

describe('[#11152] the ruled order-statistic half — min / max answer JSON numbers', () => {
  // Asserted STRICTLY. `false` / `true` — the #11249-era answer this face gave
  // until #11152 superseded it — satisfies a loose reading, so a coerced
  // comparison here would pass on the one wrong spelling this half exists to
  // exclude.
  it('min(flag) answers 0 — the number, not false and not null', () => {
    expect(measure('min', 'flag')).toBe(0);
  });

  it('max(flag) answers 1 — the number, not true and not null', () => {
    expect(measure('max', 'flag')).toBe(1);
  });

  it('grouped min/max answer per-group numbers, and east’s min is 1', () => {
    // `east` is the load-bearing cell: all-true, so its `min` is `1`. A
    // whole-table computation or a sticky `0` fails here and only here.
    expect(byRegion('min', 'flag')).toEqual({ west: 0, east: 1 });
    expect(byRegion('max', 'flag')).toEqual({ west: 1, east: 1 });
  });

  it('min/max over a column that is null or absent everywhere answer null', () => {
    // The manual's rule: null and missing are IGNORED, and a group left with
    // nothing answers `null`. Not folded to `0`, which is what a boolean face
    // that manufactured a default would do — the `$cond` coercion's else
    // branch passes null/missing through untouched, so the accumulator's own
    // rule still applies.
    expect(measure('min', 'voidcol'), 'explicit null on every row').toBeNull();
    expect(measure('max', 'voidcol'), 'explicit null on every row').toBeNull();
    expect(measure('min', 'absent'), 'a column no row carries').toBeNull();
    expect(measure('max', 'absent'), 'a column no row carries').toBeNull();
  });
});

describe('[#11152] the emitted lowering carries the coercion on all four arms', () => {
  const emit = (func: string): unknown =>
    buildAggregationPipeline({
      aggregations: [{ function: func, field: 'flag', alias: MEASURE }] as AggregationInput[],
    })[0];

  const COERCED = {
    $cond: [{ $eq: [{ $type: '$flag' }, 'bool'] }, { $cond: ['$flag', 1, 0] }, '$flag'],
  };

  it('sum and avg wrap the aggregand in the boolean-only coercion', () => {
    expect(emit('sum')).toEqual({ $group: { _id: null, [MEASURE]: { $sum: COERCED } } });
    expect(emit('avg')).toEqual({ $group: { _id: null, [MEASURE]: { $avg: COERCED } } });
  });

  it('min and max wrap the SAME coercion — the #11152 ruling, in the stage', () => {
    // The load-bearing pin of this file, direction FLIPPED by the #11152
    // ruling (2026-08-28, superseding #11249): a bare `$min`/`$max` would
    // answer `false`/`true` — a member of the input domain, where the ruled
    // contract says `0`/`1` on every face — and the VALUES cannot catch a
    // conversion smuggled in anywhere else (post-processing, the evaluator),
    // because both spellings then produce the ruled number. The emitted stage
    // is what a real mongod would execute, so the coercion is pinned THERE.
    expect(emit('min')).toEqual({ $group: { _id: null, [MEASURE]: { $min: COERCED } } });
    expect(emit('max')).toEqual({ $group: { _id: null, [MEASURE]: { $max: COERCED } } });
  });

  it('a fieldless sum/avg is unchanged — the coercion needs a path to coerce', () => {
    const fieldless = buildAggregationPipeline({
      aggregations: [{ function: 'sum', alias: MEASURE }] as AggregationInput[],
    })[0];
    expect(fieldless).toEqual({ $group: { _id: null, [MEASURE]: { $sum: 0 } } });
  });
});

describe('[#11151] CONTROLS — what neither half was allowed to move', () => {
  // These two already agreed with every other face before this card. A suite
  // holding only the broken cells cannot show that the fix was targeted.
  it('count(flag) / count_distinct(flag) are unchanged', () => {
    expect(measure('count', 'flag'), 'count over the boolean column').toBe(6);
    expect(measure('count_distinct', 'flag'), 'count_distinct over the boolean column').toBe(2);
    expect(byRegion('count', 'flag')).toEqual({ west: 4, east: 2 });
    expect(byRegion('count_distinct', 'flag')).toEqual({ west: 2, east: 1 });
  });

  it('all four functions over the NUMERIC column are untouched', () => {
    expect(measure('sum', 'score'), 'sum(score)').toBe(210);
    expect(measure('avg', 'score'), 'avg(score)').toBe(35);
    expect(measure('min', 'score'), 'min(score)').toBe(10);
    expect(measure('max', 'score'), 'max(score)').toBe(60);
  });

  it('sum/avg still IGNORE a non-numeric string — the coercion is boolean-only', () => {
    // `stage` is a string column with two explicit nulls. Coercing wider would
    // mean adopting `Number('won') === NaN` or a `toNumber` that maps it to 0;
    // both are separate questions from this card, and neither is adopted.
    expect(measure('sum', 'stage'), 'sum over a string column').toBe(0);
    expect(measure('avg', 'stage'), 'avg over a string column').toBeNull();
  });
});

describe('[#11151] the evaluator REFUSES a type it does not rank, rather than answering null', () => {
  // The head note of `mongodb-pipeline-evaluator.testkit.ts` promises this
  // instrument "refuses every shape it does not model". The `$min`/`$max` arms
  // were the exception: they filtered to numbers and answered `null` for
  // everything else, silently. A wrong answer from a strict evaluator is worse
  // than a refusal, because the red it produces reads as a defect in the driver
  // under test — which is how this card's own `min`/`max` half was first
  // misattributed to the lowering.
  const withDate: Doc[] = ROWS.map((row) => ({ ...row, when: new Date('2026-01-01T00:00:00Z') }));

  for (const func of ['min', 'max'] as const) {
    it(`${func} over an unmodelled BSON type raises UnsupportedShape`, () => {
      const aggregations = [
        { function: func, field: 'when', alias: MEASURE },
      ] as AggregationInput[];
      const pipeline = buildAggregationPipeline({ aggregations });
      expect(() => runPipeline(withDate, pipeline)).toThrow(UnsupportedShape);
      expect(() => runPipeline(withDate, pipeline)).toThrow(/unmodelled type/);
    });
  }

  // The refusal is a property of the evaluator's coverage, NOT a statement
  // about MongoDB: a real mongod ranks dates fine. Extending `bsonRank` is the
  // way to model one, and until someone does the instrument says so out loud
  // instead of answering `null`.
  it('the types it DOES rank all answer, so the refusal above is not blanket', () => {
    expect(measure('min', 'score'), 'number').toBe(10);
    expect(measure('min', 'stage'), 'string').toBe('lost');
    // A boolean aggregand reaches the ranker AS the coerced number since
    // #11152 — the answer proves the coercion path ranks, not bare booleans.
    expect(measure('min', 'flag'), 'boolean, coerced to its number').toBe(0);
  });
});
