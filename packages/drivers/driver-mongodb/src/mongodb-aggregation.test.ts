// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { buildAggregationPipeline, postProcessAggregation } from './mongodb-aggregation.js';

/**
 * [#11151/#11152] The aggregand all four arithmetic/order accumulators now
 * consume: the field path, with a BOOLEAN rendered as the number it is worth.
 * Spelled once here because the pins below are about ALIAS ROUTING and stage
 * shape — which accumulator lands under which key — and the accumulator's own
 * internals are pinned, with the reasons, in
 * `mongodb-11151-boolean-aggregand-answers.test.ts`.
 *
 * `sum`/`avg` have worn the wrapper since #11151; `min`/`max` wear it since
 * the #11152 ruling (maintainer 2026-08-28, superseding #11249's
 * `false`/`true`): booleans aggregate as NUMBERS on every face, no
 * per-aggregate exception. The wrapper is applied at BUILD time to every
 * `min`/`max` because the column's type is unknown statically; at RUN time the
 * `$cond` coerces only actual booleans — every other value takes the
 * pass-through branch and is ranked exactly as the bare path would rank it.
 */
const coerced = (path: string) => ({
  $cond: [{ $eq: [{ $type: path }, 'bool'] }, { $cond: [path, 1, 0] }, path],
});

describe('MongoDB Aggregation Pipeline Builder', () => {
  it('builds empty pipeline for no options', () => {
    expect(buildAggregationPipeline({})).toEqual([]);
  });

  it('adds $match stage from where clause', () => {
    const pipeline = buildAggregationPipeline({
      where: { status: 'active' },
    });
    expect(pipeline).toEqual([{ $match: { status: 'active' } }]);
  });

  it('builds $group stage with count', () => {
    const pipeline = buildAggregationPipeline({
      aggregations: [{ function: 'count', alias: 'total' }],
    });
    expect(pipeline).toEqual([
      { $group: { _id: null, total: { $sum: 1 } } },
    ]);
  });

  it('builds $group with groupBy fields', () => {
    const pipeline = buildAggregationPipeline({
      aggregations: [
        { function: 'sum', field: 'amount', alias: 'total_amount' },
      ],
      groupBy: ['region'],
    });
    expect(pipeline).toEqual([
      { $group: { _id: { region: '$region' }, total_amount: { $sum: coerced('$amount') } } },
      { $project: { _id: 0, region: '$_id.region', total_amount: 1 } },
    ]);
  });

  it('builds multiple aggregations', () => {
    const pipeline = buildAggregationPipeline({
      aggregations: [
        { function: 'count', alias: 'order_count' },
        { function: 'sum', field: 'amount', alias: 'total' },
        { function: 'avg', field: 'amount', alias: 'average' },
      ],
      groupBy: ['customer_id'],
    });

    const groupStage = pipeline[0];
    expect(groupStage.$group._id).toEqual({ customer_id: '$customer_id' });
    expect(groupStage.$group.order_count).toEqual({ $sum: 1 });
    expect(groupStage.$group.total).toEqual({ $sum: coerced('$amount') });
    expect(groupStage.$group.average).toEqual({ $avg: coerced('$amount') });
  });

  it('adds $sort stage', () => {
    const pipeline = buildAggregationPipeline({
      aggregations: [{ function: 'count', alias: 'total' }],
      orderBy: [{ field: 'total', order: 'desc' }],
    });
    expect(pipeline[1]).toEqual({ $sort: { total: -1 } });
  });

  it('adds $skip and $limit', () => {
    const pipeline = buildAggregationPipeline({
      aggregations: [{ function: 'count', alias: 'total' }],
      offset: 10,
      limit: 5,
    });
    expect(pipeline).toContainEqual({ $skip: 10 });
    expect(pipeline).toContainEqual({ $limit: 5 });
  });

  it('builds min/max aggregations', () => {
    const pipeline = buildAggregationPipeline({
      aggregations: [
        { function: 'min', field: 'price', alias: 'min_price' },
        { function: 'max', field: 'price', alias: 'max_price' },
      ],
    });
    // [#11152] The same wrapper `$sum`/`$avg` wear — build-time on every
    // min/max, runtime pass-through for anything that is not a boolean.
    expect(pipeline[0].$group.min_price).toEqual({ $min: coerced('$price') });
    expect(pipeline[0].$group.max_price).toEqual({ $max: coerced('$price') });
  });

  describe('postProcessAggregation', () => {
    it('converts count_distinct arrays to counts', () => {
      const results = [
        { region: 'US', unique_customers: ['a', 'b', 'c'] },
        { region: 'EU', unique_customers: ['d', 'e'] },
      ];
      const processed = postProcessAggregation(results, [
        { function: 'count_distinct', field: 'customer_id', alias: 'unique_customers' },
      ]);
      expect(processed[0].unique_customers).toBe(3);
      expect(processed[1].unique_customers).toBe(2);
    });

    it('converts string_agg arrays to joined strings', () => {
      const results = [{ names: ['Alice', 'Bob', 'Charlie'] }];
      const processed = postProcessAggregation(results, [
        { function: 'string_agg', field: 'name', alias: 'names' },
      ]);
      expect(processed[0].names).toBe('Alice, Bob, Charlie');
    });

    it('passes through results with no special processing needed', () => {
      const results = [{ total: 42 }];
      const processed = postProcessAggregation(results, [
        { function: 'count', alias: 'total' },
      ]);
      expect(processed).toEqual(results);
    });
  });
});
