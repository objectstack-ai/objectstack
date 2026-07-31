// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * HAVING evaluator (#4286 step 3) — semantics over AGGREGATED rows.
 *
 * The namespace is the aggregated row's own columns (aggregation aliases +
 * groupBy projections); operator semantics mirror the Filter Protocol's
 * memory evaluation, EXCEPT that an unknown operator throws — ignoring one
 * would silently return unfiltered aggregates, the exact silently-inert
 * failure (#4286, ADR-0078) enforcement exists to end.
 */

import { describe, it, expect } from 'vitest';
import { applyHaving, matchesHaving } from './having-filter.js';

const ROWS = [
  { customer_id: 'c1', order_count: 2, total: 500 },
  { customer_id: 'c2', order_count: 6, total: 1200 },
  { customer_id: 'c3', order_count: 9, total: 800, region: null },
];

describe('applyHaving', () => {
  it('returns rows unchanged for an absent or empty condition', () => {
    expect(applyHaving(ROWS, undefined)).toBe(ROWS);
    expect(applyHaving(ROWS, null)).toBe(ROWS);
    expect(applyHaving(ROWS, {})).toBe(ROWS);
  });

  it('filters on an aggregation alias with a comparison operator', () => {
    expect(applyHaving(ROWS, { order_count: { $gt: 5 } }).map((r) => r.customer_id))
      .toEqual(['c2', 'c3']);
    expect(applyHaving(ROWS, { total: { $lte: 800 } }).map((r) => r.customer_id))
      .toEqual(['c1', 'c3']);
  });

  it('filters on a groupBy projection with implicit equality', () => {
    expect(applyHaving(ROWS, { customer_id: 'c2' })).toHaveLength(1);
  });

  it('composes with $and / $or / $not', () => {
    expect(applyHaving(ROWS, {
      $and: [{ order_count: { $gt: 1 } }, { total: { $gt: 1000 } }],
    }).map((r) => r.customer_id)).toEqual(['c2']);

    expect(applyHaving(ROWS, {
      $or: [{ total: { $gt: 1000 } }, { order_count: { $gte: 9 } }],
    }).map((r) => r.customer_id)).toEqual(['c2', 'c3']);

    expect(applyHaving(ROWS, { $not: { customer_id: 'c1' } })).toHaveLength(2);
  });

  it('supports set, range, and null operators', () => {
    expect(applyHaving(ROWS, { customer_id: { $in: ['c1', 'c3'] } })).toHaveLength(2);
    expect(applyHaving(ROWS, { total: { $between: [600, 1300] } }).map((r) => r.customer_id))
      .toEqual(['c2', 'c3']);
    expect(applyHaving(ROWS, { region: { $null: true } }).map((r) => r.customer_id))
      .toEqual(['c1', 'c2', 'c3']); // absent folds into null, like the memory matcher
  });

  it('multiple keys on one condition AND together, like `where`', () => {
    expect(applyHaving(ROWS, { order_count: { $gte: 2 }, total: { $lt: 900 } })
      .map((r) => r.customer_id)).toEqual(['c1', 'c3']);
  });
});

describe('matchesHaving — the unknown-operator refusal', () => {
  it('THROWS on an unknown condition operator instead of ignoring it', () => {
    expect(() => matchesHaving(ROWS[0], { order_count: { $median: 3 } }))
      .toThrow(/Unsupported operator '\$median' in `having`.*\$gte.*unfiltered aggregates/s);
  });

  it('THROWS on an unknown logical operator', () => {
    expect(() => matchesHaving(ROWS[0], { $nand: [{ order_count: 2 }] }))
      .toThrow(/Unsupported operator '\$nand'/);
  });

  it('accepts $regex with $options as its sibling, not an operator', () => {
    expect(matchesHaving({ k: 'Alpha' }, { k: { $regex: '^alp', $options: 'i' } })).toBe(true);
  });
});
