/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6460 — the comparison under `ObjectView`'s non-grid fetch dependency.
 *
 * Two properties are pinned here, and the FIRST is the load-bearing one:
 *
 *  1. **Nothing that differs is ever reported equal.** A false "equal" is a
 *     re-fetch that never happens — silent, and worse than the churn this
 *     mechanism exists to remove. Every case below that `JSON.stringify` would
 *     collapse is asserted NOT equal, with the stringify collapse asserted
 *     alongside it so the test states what it is protecting against rather than
 *     merely asserting a boolean.
 *  2. Values that are the same are reported equal even when a naive key would
 *     say otherwise (key order), which is what actually removes the churn.
 */

import { describe, it, expect } from 'vitest';
import { isStructurallyEqual } from './stableIdentity';

describe('isStructurallyEqual — values a stringified key gets WRONG', () => {
  it('keeps `{ a: undefined }` distinct from `{}` — stringify collapses them', () => {
    expect(JSON.stringify({ a: undefined })).toBe(JSON.stringify({}));
    expect(isStructurallyEqual({ a: undefined }, {})).toBe(false);
  });

  it('keeps a function-valued key distinct from an absent one', () => {
    const withFn = { where: () => true };
    expect(JSON.stringify(withFn)).toBe('{}');
    expect(isStructurallyEqual(withFn, {})).toBe(false);
    // Two DIFFERENT functions are never equal (identity only) — the
    // conservative direction: an extra query, never a missed one.
    expect(isStructurallyEqual({ where: () => true }, { where: () => true })).toBe(false);
    // The same function reference is unchanged.
    const same = () => true;
    expect(isStructurallyEqual({ where: same }, { where: same })).toBe(true);
  });

  it('keeps a `Map` distinct from a plain empty object', () => {
    expect(JSON.stringify({ m: new Map([['a', 1]]) })).toBe(JSON.stringify({ m: {} }));
    expect(isStructurallyEqual({ m: new Map([['a', 1]]) }, { m: {} })).toBe(false);
  });

  it('keeps `NaN` distinct from `null`, and treats `NaN` as unchanged from itself', () => {
    expect(JSON.stringify({ n: NaN })).toBe(JSON.stringify({ n: null }));
    expect(isStructurallyEqual({ n: NaN }, { n: null })).toBe(false);
    expect(isStructurallyEqual({ n: NaN }, { n: NaN })).toBe(true);
  });

  it('ignores KEY ORDER, which stringify treats as a difference', () => {
    const a = { field: 'status', value: 'open' };
    const b: Record<string, string> = {};
    b.value = 'open';
    b.field = 'status';
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(isStructurallyEqual(a, b)).toBe(true);
  });

  it('compares a `Date` by its instant, and reports a different instant as changed', () => {
    expect(isStructurallyEqual(new Date('2026-01-01'), new Date('2026-01-01'))).toBe(true);
    expect(isStructurallyEqual(new Date('2026-01-01'), new Date('2026-01-02'))).toBe(false);
    // A Date is not interchangeable with the string it would serialize to.
    expect(isStructurallyEqual(new Date('2026-01-01'), '2026-01-01T00:00:00.000Z')).toBe(false);
  });

  it('survives a cyclic value instead of throwing, and calls it changed', () => {
    const a: Record<string, unknown> = {}; a.self = a;
    const b: Record<string, unknown> = {}; b.self = b;
    expect(() => JSON.stringify(a)).toThrow();
    // Bounded, and bounded in the re-fetch direction.
    expect(isStructurallyEqual(a, b)).toBe(false);
  });
});

describe('isStructurallyEqual — the ordinary filter/sort shapes', () => {
  it('reports a fresh-but-identical view filter as unchanged', () => {
    expect(isStructurallyEqual([['status', '=', 'open']], [['status', '=', 'open']])).toBe(true);
  });

  it('reports a changed operand, operator and arity as changed', () => {
    expect(isStructurallyEqual([['status', '=', 'open']], [['status', '=', 'closed']])).toBe(false);
    expect(isStructurallyEqual([['status', '=', 'open']], [['status', '!=', 'open']])).toBe(false);
    expect(isStructurallyEqual([['status', '=', 'open']], [['status', '=', 'open'], ['a', '=', 1]])).toBe(false);
  });

  it('is order-SENSITIVE for arrays — a sort’s order is semantic', () => {
    const asc = [{ field: 'a', order: 'asc' }, { field: 'b', order: 'asc' }];
    const swapped = [{ field: 'b', order: 'asc' }, { field: 'a', order: 'asc' }];
    expect(isStructurallyEqual(asc, swapped)).toBe(false);
  });

  it('handles the `undefined` both-sides case a view without a filter produces', () => {
    expect(isStructurallyEqual(undefined, undefined)).toBe(true);
    expect(isStructurallyEqual(undefined, null)).toBe(false);
    expect(isStructurallyEqual(undefined, [])).toBe(false);
  });
});
