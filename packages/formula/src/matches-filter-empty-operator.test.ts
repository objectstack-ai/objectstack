// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20444] The `$empty` operator on `matchesFilterCondition` — the RLS
 * write-side `check` evaluator.
 *
 * This face judges a RECORD, not a declaration, so ruling A on #20399 (record
 * 5865693155) gives it the BY-VALUE reading: null, a missing key, `''` and `[]`
 * are empty (the spec's `isEmptyFilterValue`), and `$empty: false` is the exact
 * complement. It differs from the declared-type faces only on a stored state
 * the declaration does not predict — `''` in a non-text column, the write-door
 * class #20308 closed.
 *
 * Before its arm, a DECLARED `$empty` got this face's silent `false` for every
 * record and both flags — the defect the module header says a declared
 * operator must never get. The first test pins the arm by requiring both
 * answers from both flags.
 */

import { describe, expect, it } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';
import { matchesFilterCondition } from './matches-filter';

const RECORDS: Array<Record<string, unknown>> = [
  { id: 'r1', title: 'x', tags: ['a'], score: 5 },
  { id: 'r2', title: '', tags: [], score: 0 },
  { id: 'r3', title: null, tags: null, score: null },
  { id: 'r4', title: '  ', tags: ['a', 'b'], score: -1 },
  { id: 'r5' },
];

const ids = (filter: FilterCondition) =>
  RECORDS.filter((r) => matchesFilterCondition(r, filter)).map((r) => String(r.id));

describe('[#20444] matchesFilterCondition — $empty, judged by value', () => {
  it('is ANSWERED, not given the silent false: each flag admits some record and refuses another', () => {
    for (const flag of [true, false]) {
      const admitted = ids({ title: { $empty: flag } });
      expect(admitted.length, `$empty: ${flag}`).toBeGreaterThan(0);
      expect(admitted.length, `$empty: ${flag}`).toBeLessThan(RECORDS.length);
    }
  });

  it("text: null, a missing key and '' are empty — '  ' is a value", () => {
    expect(ids({ title: { $empty: true } })).toEqual(['r2', 'r3', 'r5']);
    expect(ids({ title: { $empty: false } })).toEqual(['r1', 'r4']);
  });

  it('a list: null, a missing key and [] are empty', () => {
    expect(ids({ tags: { $empty: true } })).toEqual(['r2', 'r3', 'r5']);
    expect(ids({ tags: { $empty: false } })).toEqual(['r1', 'r4']);
  });

  it('a number: 0 is a value; only null and a missing key are empty', () => {
    expect(ids({ score: { $empty: true } })).toEqual(['r3', 'r5']);
    expect(ids({ score: { $empty: false } })).toEqual(['r1', 'r2', 'r4']);
  });

  it("the one reading a declared-type face does not share: '' in a number column counts as empty here", () => {
    expect(matchesFilterCondition({ score: '' }, { score: { $empty: true } })).toBe(true);
  });

  it('nests under $and / $or / $not, and ANDs with a sibling operator on the same field', () => {
    expect(ids({ $not: { title: { $empty: true } } })).toEqual(['r1', 'r4']);
    expect(ids({ $not: { tags: { $empty: false } } })).toEqual(['r2', 'r3', 'r5']);
    expect(ids({ $or: [{ score: 5 }, { tags: { $empty: true } }] })).toEqual(['r1', 'r2', 'r3', 'r5']);
    expect(ids({ $and: [{ title: { $empty: false } }, { tags: { $empty: false } }] })).toEqual(['r1', 'r4']);
    expect(ids({ title: { $empty: false, $ne: 'x' } })).toEqual(['r4']);
  });

  it('a non-boolean flag denies the write — this face\'s answer to an unevaluable condition', () => {
    for (const bad of ['true', 1, null, { $field: 'title' }]) {
      expect(ids({ title: { $empty: bad as never } }), JSON.stringify(bad)).toEqual([]);
    }
  });
});
