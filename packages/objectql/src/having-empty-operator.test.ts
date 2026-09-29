// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20444] The staged `$empty` operator on objectql's `having` — the face that
 * filters AGGREGATED rows, and the one no shared conformance table drives
 * (`FILTER_LOGIC_CASES` does not reach the HAVING path), so its conclusion is
 * stated here, explicitly.
 *
 * ## The conclusion
 *
 * An aggregated row carries no field declaration of its own, so ruling A on
 * #20399 (record 5865693155) gives this face the BY-VALUE reading, through the
 * spec's `isEmptyFilterValue`: null, a column the row does not carry, `''` and
 * `[]` are empty; `$empty: false` is the exact complement. Concretely:
 *
 * - a numeric aggregate holding `0` (a `count` over no matching rows, a `sum`
 *   that nets to zero) is NOT empty — zero is a value, and HAVING on a count
 *   asks about it with `$eq: 0`, never with `$empty`;
 * - a `groupBy` text column holding `''` IS empty — the row a declared text
 *   field takes on every other face too;
 * - a `min` / `max` over no values (null) and a column the row lacks are empty.
 *
 * It parts from a declared-type face only on `''` in a non-text column, the
 * write-door class #20308 closed. The per-aggregation `filter` shares this
 * walker and so the same reading (`matchesAggregationFilter`).
 */

import { describe, expect, it } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';
import {
  applyHaving,
  matchesAggregationFilter,
  assertHavingIsEvaluable,
} from './having-filter.js';

/** Aggregated rows: a groupBy text column, a count, a max over a text field, a list. */
const ROWS: Array<Record<string, unknown>> = [
  { id: 'g1', region: 'north', n: 3, top: 'z', codes: ['a'] },
  { id: 'g2', region: '', n: 0, top: null, codes: [] },
  { id: 'g3', region: null, n: 7, top: '', codes: null },
  { id: 'g4', region: 'south', n: 1, top: 'b' },
];

const ids = (having: FilterCondition) => applyHaving(ROWS, having).map((r) => String(r.id));

function refusal(run: () => unknown): { code?: string; status?: number } | 'answered' {
  try {
    run();
  } catch (err) {
    return { code: (err as { code?: string }).code, status: (err as { status?: number }).status };
  }
  return 'answered';
}

describe('[#20444] having — $empty, judged by value over the aggregated row', () => {
  it('a numeric aggregate holding 0 is NOT empty; only a missing value would be', () => {
    expect(ids({ n: { $empty: true } })).toEqual([]);
    expect(ids({ n: { $empty: false } })).toEqual(['g1', 'g2', 'g3', 'g4']);
  });

  it("a groupBy text column holding '' IS empty, as null is", () => {
    expect(ids({ region: { $empty: true } })).toEqual(['g2', 'g3']);
    expect(ids({ region: { $empty: false } })).toEqual(['g1', 'g4']);
  });

  it("a max over no values (null) and one landing on '' are empty", () => {
    expect(ids({ top: { $empty: true } })).toEqual(['g2', 'g3']);
  });

  it('a list value: [] and null are empty, and a column the row does not carry is empty too', () => {
    expect(ids({ codes: { $empty: true } })).toEqual(['g2', 'g3', 'g4']);
    expect(ids({ codes: { $empty: false } })).toEqual(['g1']);
  });

  it('nests under $and / $or / $not, and ANDs with a sibling operator on the same column', () => {
    expect(ids({ $not: { region: { $empty: true } } })).toEqual(['g1', 'g4']);
    expect(ids({ $or: [{ n: { $gt: 5 } }, { codes: { $empty: false } }] })).toEqual(['g1', 'g3']);
    expect(ids({ $and: [{ region: { $empty: false } }, { n: { $gte: 1 } }] })).toEqual(['g1', 'g4']);
    expect(ids({ region: { $empty: false, $ne: 'north' } })).toEqual(['g4']);
  });

  it('the per-aggregation filter shares the walker and the reading', () => {
    const source = [{ stage: '' }, { stage: 'won' }, { stage: null }, {}];
    const kept = source.filter((row) => matchesAggregationFilter(row, { stage: { $empty: true } }, 0));
    expect(kept).toEqual([{ stage: '' }, { stage: null }, {}]);
  });

  it('a non-boolean flag is REFUSED — judged once, before any row, and per row as the floor', () => {
    expect(refusal(() => assertHavingIsEvaluable({ n: { $empty: 'yes' } }, ['id', 'region', 'n', 'top', 'codes'])))
      .toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(refusal(() => applyHaving(ROWS, { n: { $empty: 1 as never } })))
      .toEqual({ code: 'INVALID_FILTER', status: 400 });
    // An empty grouped set still refuses: the verdict is the filter's, not the data's.
    expect(refusal(() => assertHavingIsEvaluable({ $or: [{ n: 1 }, { n: { $empty: null } }] }, ['n'])))
      .toEqual({ code: 'INVALID_FILTER', status: 400 });
  });

  it('a well-formed $empty passes the whole-clause judgement', () => {
    expect(refusal(() => assertHavingIsEvaluable({ $not: { region: { $empty: false } } }, ['region']))).toBe('answered');
  });
});
