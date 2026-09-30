// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20544] `compensatedSum` — the one compensated fold every platform face that
 * adds a group's values in JavaScript calls (objectql's rows path,
 * driver-memory's data and analytics faces, service-analytics' draft preview).
 *
 * The expected values are SQLite's own `sum` answers, measured by #20489 with
 * better-sqlite3 (SQLite 3.53.4), sql.js (3.49.1) and @libsql/client (3.45.1);
 * the naive fold each face used before is asserted beside them, so a fixture
 * that cannot tell the two folds apart fails here instead of passing vacuously.
 * Each face pins the same fixtures through its own door, in its own package.
 */

import { describe, it, expect } from 'vitest';
import { compensatedSum } from './compensated-sum';

/** The fold the faces used before: in order, one addition at a time. */
const naiveSum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe('[#20544] compensatedSum — the one compensated fold', () => {
  it("the card's fixture: 0.1 + 0.2 + 0.3 is SQLite's 0.6, not the naive 0.6000000000000001", () => {
    expect(naiveSum([0.1, 0.2, 0.3])).toBe(0.6000000000000001);
    expect(compensatedSum([0.1, 0.2, 0.3])).toBe(0.6);
    // The mean every avg arm divides out of it: SQLite's 0.19999999999999998.
    expect(compensatedSum([0.1, 0.2, 0.3]) / 3).toBe(0.19999999999999998);
  });

  it('a large cancellation keeps the small addend: 1e16 + 1 - 1e16 is 1, not 0', () => {
    expect(naiveSum([1e16, 1, -1e16])).toBe(0);
    expect(compensatedSum([1e16, 1, -1e16])).toBe(1);
    expect(compensatedSum([1e16, 0.5, -1e16])).toBe(0.5);
  });

  it('two addends are unchanged: the compensated a + b is the naive one', () => {
    for (const pair of [[0.1, 0.2], [0.7, 0.1], [1e16, 1], [-0.3, 0.1]]) {
      expect(compensatedSum(pair), `${pair}`).toBe(naiveSum(pair));
    }
    expect(compensatedSum([0.1, 0.2])).toBe(0.30000000000000004);
  });

  it('integers whose partial sums stay within 2^53 are unchanged', () => {
    for (const ints of [[1, 2, 3, 40, 500], [-7, 3, 12, 0, 9_000_000_000]]) {
      const s = compensatedSum(ints);
      expect(s, `${ints}`).toBe(naiveSum(ints));
      expect(Number.isInteger(s)).toBe(true);
    }
    expect(compensatedSum([1, 2, 3, 40, 500])).toBe(546);
  });

  it('an empty list is 0, and one addend is itself', () => {
    expect(compensatedSum([])).toBe(0);
    expect(compensatedSum([0.1])).toBe(0.1);
    expect(compensatedSum([-2.5])).toBe(-2.5);
  });

  it('a non-finite total is the naive one, as SQLite returns its running sum when the error term overflows', () => {
    for (const values of [
      [Infinity, 1, 2],
      [1, -Infinity, 0.3],
      [1e308, 1e308, -1e308],
      [Infinity, -Infinity, 1],
      [NaN, 0.1, 0.2],
    ]) {
      expect(Object.is(compensatedSum(values), naiveSum(values)), `${values}`).toBe(true);
    }
  });
});
