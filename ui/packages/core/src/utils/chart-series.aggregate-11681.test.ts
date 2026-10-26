/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11681 — `buildChartSeries` carries each measure column's
 * `aggregate` onto the series that plots it, so a value axis over counts can
 * draw whole-number ticks.
 *
 * The dataset answer states the aggregate on every measure column, labelled or
 * not (`AnalyticsResult.fields[].aggregate`, objectstack#21995). The fixtures
 * below are the measured shape: an author-labelled count (`task_count`,
 * label `Tasks`), which carries `aggregate` but no `builtinAggregate`.
 */

import { describe, it, expect } from 'vitest';
import { buildChartSeries, isIntegerAggregate, type ChartMeasureField } from './chart-series';

const FIELDS: ChartMeasureField[] = [
  { name: 'status', label: 'Status' },
  { name: 'task_count', label: 'Tasks', aggregate: 'count' },
  { name: 'budget', label: 'Budget', aggregate: 'sum' },
  { name: 'margin', label: 'Margin' },
];

describe('objectui#11681 — isIntegerAggregate', () => {
  it.each(['count', 'count_distinct'])('%s is an integer aggregate', (value) => {
    expect(isIntegerAggregate(value)).toBe(true);
  });

  it.each(['sum', 'avg', 'min', 'max', 'Count', '', undefined, null, 1])('%s is not', (value) => {
    expect(isIntegerAggregate(value)).toBe(false);
  });
});

describe('objectui#11681 — buildChartSeries carries the measure\'s aggregate', () => {
  it('one series per measure: each carries its own column\'s aggregate, and a column without one carries none', () => {
    const { series } = buildChartSeries(
      [{ status: 'open', task_count: 2, budget: 10.5, margin: 0.2 }],
      ['status'],
      ['task_count', 'budget', 'margin'],
      FIELDS,
    );
    expect(series).toEqual([
      { dataKey: 'task_count', label: 'Tasks', aggregate: 'count' },
      { dataKey: 'budget', label: 'Budget', aggregate: 'sum' },
      { dataKey: 'margin', label: 'Margin' },
    ]);
    // Absent means absent, not `undefined` under the key.
    expect('aggregate' in series[2]).toBe(false);
  });

  it('a pivoted second dimension: every group plots the one measure, so every group carries its aggregate', () => {
    const { series } = buildChartSeries(
      [
        { status: 'open', owner: 'Ann', task_count: 1 },
        { status: 'done', owner: 'Bob', task_count: 3 },
      ],
      ['status', 'owner'],
      ['task_count'],
      FIELDS,
    );
    expect(series.map((s) => s.aggregate)).toEqual(['count', 'count']);
  });

  it('no result fields at all: no aggregate, exactly as before', () => {
    const { series } = buildChartSeries([{ status: 'open', task_count: 1 }], ['status'], ['task_count']);
    expect(series).toEqual([{ dataKey: 'task_count', label: 'task_count' }]);
  });
});
