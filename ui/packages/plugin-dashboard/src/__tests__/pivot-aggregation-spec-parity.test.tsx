/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Pivot aggregation ↔ spec vocabulary parity + behavior (#2941).
 *
 * `ChartAggregateFunctionSchema` (`ui/chart.zod.ts`) is the UI-side
 * aggregation vocabulary — the five names the spec deliberately carved out of
 * the engine's 8-name `AggregationFunction` because client renderers
 * implement exactly these. The pivot's `default:` branch used to return a
 * SUM for anything else, so `aggregation: 'count_distinct'` (an engine name
 * that validates on engine surfaces) produced a plausible wrong total with
 * no signal anywhere.
 *
 * Contract under test:
 * - parity: the pivot's implemented set equals the spec enum, both ways;
 * - an out-of-vocabulary aggregation renders a visible notice, never numbers.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ChartAggregateFunctionSchema } from '@objectstack/spec/ui';
import { enumOptions } from '@object-ui/test-support';
import { PivotTable, PIVOT_AGGREGATIONS } from '../PivotTable';

const baseSchema = {
  type: 'pivot' as const,
  rowField: 'region',
  columnField: 'quarter',
  valueField: 'amount',
  data: [
    { region: 'East', quarter: 'Q1', amount: 10 },
    { region: 'East', quarter: 'Q1', amount: 10 },
    { region: 'West', quarter: 'Q1', amount: 5 },
  ],
};

describe('PivotTable covers the spec UI aggregation vocabulary', () => {
  const specNames: string[] = enumOptions(ChartAggregateFunctionSchema);

  it('reads a non-empty enum from the spec', () => {
    expect(specNames, 'could not read ChartAggregateFunctionSchema.options from the spec').not.toEqual([]);
  });

  it('implements every aggregation the spec accepts', () => {
    const unimplemented = specNames.filter((name) => !PIVOT_AGGREGATIONS.has(name));
    expect(
      unimplemented,
      'these pass schema validation but refuse to render — implement them in PivotTable.aggregate',
    ).toEqual([]);
  });

  it('does not accept aggregations the spec rejects', () => {
    const extra = [...PIVOT_AGGREGATIONS].filter((name) => !specNames.includes(name));
    expect(
      extra,
      'these are renderer-local dialect — promote them into @objectstack/spec instead',
    ).toEqual([]);
  });
});

describe('PivotTable refuses out-of-vocabulary aggregations', () => {
  it("renders a visible notice for 'count_distinct' instead of silently summing", () => {
    render(<PivotTable schema={{ ...baseSchema, aggregation: 'count_distinct' as any }} />);

    expect(screen.getByTestId('pivot-unsupported-aggregation')).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toContain('count_distinct');
    // The wrong-total failure mode: 2×10 rows would sum to "20".
    expect(screen.queryByText('20')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('still renders every supported aggregation as a table', () => {
    for (const aggregation of PIVOT_AGGREGATIONS) {
      const { unmount, container } = render(
        <PivotTable schema={{ ...baseSchema, aggregation: aggregation as any }} />,
      );
      expect(container.querySelector('table'), `aggregation '${aggregation}' should render a table`).toBeTruthy();
      unmount();
    }
  });

  it('defaults to sum when no aggregation is authored', () => {
    render(<PivotTable schema={{ ...baseSchema }} />);
    expect(screen.getByText('20')).toBeInTheDocument();
  });
});
