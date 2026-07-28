// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
import { describe, it, expect } from 'vitest';
import { ChartAggregateSchema } from './chart.zod';
import {
  CHART_AGGREGATE_COMPARISON_SUFFIX,
  chartAggregateCategoryKey,
  chartAggregateValueKey,
  chartAggregateResultKeys,
} from './chart-aggregate';

describe('ChartAggregateSchema', () => {
  it('accepts a field aggregation grouped by a bare field name', () => {
    expect(() =>
      ChartAggregateSchema.parse({ field: 'total', function: 'sum', groupBy: 'status' }),
    ).not.toThrow();
  });

  it('accepts a structured, date-bucketed groupBy', () => {
    expect(() =>
      ChartAggregateSchema.parse({
        field: 'total',
        function: 'sum',
        groupBy: { field: 'closed_at', dateGranularity: 'quarter' },
      }),
    ).not.toThrow();
  });

  it('accepts a fieldless count (it counts rows, not a column)', () => {
    expect(() => ChartAggregateSchema.parse({ function: 'count', groupBy: 'status' })).not.toThrow();
  });

  it('rejects a non-count function with no field', () => {
    // Left to the renderer this produced `sum(undefined)` — an empty chart with
    // no diagnostic. The contract rejects it instead.
    expect(() => ChartAggregateSchema.parse({ function: 'sum', groupBy: 'status' })).toThrow();
  });

  it('rejects an aggregation function no chart renderer implements', () => {
    expect(() =>
      ChartAggregateSchema.parse({ field: 'id', function: 'count_distinct', groupBy: 'status' }),
    ).toThrow();
  });
});

describe('result-column naming convention (#3701)', () => {
  // The whole point of the convention: rows are keyed by the RAW FIELD NAMES,
  // NOT by a derived measure name. A dataset keys its rows `sum_amount`; an
  // object-bound aggregate keys the same numbers `amount`.
  const agg = { field: 'total', function: 'sum', groupBy: 'status' };

  it('keys the category column by groupBy', () => {
    expect(chartAggregateCategoryKey(agg)).toBe('status');
  });

  it('keys the value column by the raw field — never "sum_total"', () => {
    expect(chartAggregateValueKey(agg)).toBe('total');
  });

  it('honours a structured groupBy alias over its field', () => {
    expect(chartAggregateCategoryKey({ ...agg, groupBy: { field: 'closed_at', alias: 'quarter' } })).toBe('quarter');
    expect(chartAggregateCategoryKey({ ...agg, groupBy: { field: 'closed_at' } })).toBe('closed_at');
  });

  it('names a fieldless count column "count"', () => {
    expect(chartAggregateValueKey({ function: 'count', groupBy: 'status' })).toBe('count');
  });

  it('prefers an explicit field even for count', () => {
    expect(chartAggregateValueKey({ field: 'total', function: 'count', groupBy: 'status' })).toBe('total');
  });

  it('has no value column for a non-count aggregate with no field', () => {
    expect(chartAggregateValueKey({ function: 'sum', groupBy: 'status' })).toBeUndefined();
  });

  it('has no category column for an ungrouped aggregate', () => {
    expect(chartAggregateCategoryKey({ field: 'total', function: 'sum' })).toBeUndefined();
    expect(chartAggregateCategoryKey(undefined)).toBeUndefined();
  });

  it('derives the comparison-overlay column from the value column', () => {
    expect(chartAggregateResultKeys(agg)).toEqual({
      category: 'status',
      value: 'total',
      comparison: `total${CHART_AGGREGATE_COMPARISON_SUFFIX}`,
    });
  });

  it('emits no comparison column when there is no value column', () => {
    expect(chartAggregateResultKeys({ function: 'sum', groupBy: 'status' })).toEqual({
      category: 'status',
      value: undefined,
      comparison: undefined,
    });
  });
});
