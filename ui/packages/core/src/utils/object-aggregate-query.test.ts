/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `objectAggregateSpecQuery` / `isStructuredGroupBy` — the shared answer to
 * "which call does an object-bound `aggregate` make when its `groupBy` is the
 * structured node?" (objectui#8613).
 *
 * The payload itself had NO pin before this file: it was spelled inline in
 * `ObjectChart.runAggregate`, and the chart's structured-`groupBy` tests
 * (objectui#7946) all observe the RESULT columns — the drill key, the reverse
 * label map — never the request. So a change to what is posted was invisible to
 * the suite, which is part of why the metric path could disagree with it for as
 * long as it did.
 */

import { describe, it, expect } from 'vitest';
import { isStructuredGroupBy, objectAggregateSpecQuery } from './object-aggregate-query.js';

describe('isStructuredGroupBy', () => {
  it('says yes to the date-bucketing node', () => {
    expect(isStructuredGroupBy({ field: 'closed_at', dateGranularity: 'month' })).toBe(true);
    // `dateGranularity` is optional on the node; the node is still the node.
    expect(isStructuredGroupBy({ field: 'closed_at' })).toBe(true);
  });

  it('says no to the union`s STRING arm, and to absence', () => {
    expect(isStructuredGroupBy('stage')).toBe(false);
    expect(isStructuredGroupBy('')).toBe(false);
    expect(isStructuredGroupBy(undefined)).toBe(false);
    expect(isStructuredGroupBy(null)).toBe(false);
  });

  it('says no to an ARRAY, which is an object but not this arm', () => {
    // The adapter's own `looksLikeSpecShape` already treats an array `groupBy`
    // as the spec shape and refuses the analytics keys beside it
    // (objectui#6864). Answering `true` here would wrap it a second time.
    expect(isStructuredGroupBy(['stage'])).toBe(false);
    expect(isStructuredGroupBy([])).toBe(false);
  });
});

describe('objectAggregateSpecQuery', () => {
  const MONTHLY = { field: 'closed_at', dateGranularity: 'month' } as const;

  it('projects the measure under the contract`s own value column', () => {
    expect(objectAggregateSpecQuery({ field: 'amount', function: 'sum' }, MONTHLY, undefined))
      .toEqual({
        groupBy: [MONTHLY],
        aggregations: [{ function: 'sum', alias: 'amount', field: 'amount' }],
        where: undefined,
      });
  });

  it('omits `field` for a count, and aliases a FIELDLESS count `count`', () => {
    expect(objectAggregateSpecQuery({ function: 'count' }, MONTHLY, undefined))
      .toEqual({
        groupBy: [MONTHLY],
        aggregations: [{ function: 'count', alias: 'count' }],
        where: undefined,
      });
  });

  it('omits `field` for a count that NAMES one, keeping the field as the alias', () => {
    // `count(*)` either way — the relays default `field: 'value'` for a widget
    // with no measure column, and `count(value)` is a driver error. The alias
    // still follows the field, because that is the column the caller's readback
    // and any series binding name.
    const q = objectAggregateSpecQuery({ field: 'id', function: 'count' }, MONTHLY, undefined);
    expect(q.aggregations).toEqual([{ function: 'count', alias: 'id' }]);
  });

  it('forwards the node VERBATIM, `alias` and all', () => {
    // The projected group column is the node's `alias` when it declares one.
    // Rebuilding the node instead of forwarding it would drop the member and
    // key every result row wrong.
    const aliased = { field: 'closed_at', dateGranularity: 'quarter', alias: 'q' } as const;
    expect(objectAggregateSpecQuery({ field: 'amount', function: 'avg' }, aliased, undefined).groupBy)
      .toEqual([aliased]);
  });

  it('puts the filter in `where`, the spec Query DSL`s position — never `filter`', () => {
    // `filter` is the ANALYTICS branch's key. A spec-shape query carrying it is
    // refused by the adapter rather than silently dropped (objectui#6864), so
    // the position is load-bearing and not a rename.
    const where = { stage: { $ne: 'closed' } };
    const q = objectAggregateSpecQuery({ field: 'amount', function: 'sum' }, MONTHLY, where);
    expect(q.where).toBe(where);
    expect(Object.keys(q).sort()).toEqual(['aggregations', 'groupBy', 'where']);
  });
});
