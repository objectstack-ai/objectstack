/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Report column aggregation coverage (#2942).
 *
 * `ReportAggregationType` (`@object-ui/types/reports.ts`) is the contract for
 * a report column's `aggregation`; `distinct` used to fall into
 * `default: return ''` and render a blank summary cell while the type
 * accepted it. The sample table below is `Record<ReportAggregationType, …>`,
 * so a NEW union member fails type-check here until someone teaches
 * `computeReportAggregation` to compute it — the #2897 guard shape, keyed to
 * the local vocabulary because this legacy viewer's contract is the types
 * package, not a spec enum.
 */
import { describe, it, expect } from 'vitest';
import type { ReportAggregationType } from '@object-ui/types';
import { computeReportAggregation } from '../ReportViewer';

const rows = [
  { amount: 10, stage: 'won' },
  { amount: 10, stage: 'lost' },
  { amount: 30, stage: 'won' },
];

describe('computeReportAggregation covers ReportAggregationType', () => {
  const expected: Record<ReportAggregationType, string | number> = {
    count: 3,
    sum: 50,
    avg: '16.67',
    min: 10,
    max: 30,
    distinct: 2, // distinct raw values of `stage` — was a blank cell before #2942
  };

  for (const [aggregation, value] of Object.entries(expected)) {
    it(`computes '${aggregation}' (never a blank cell)`, () => {
      const field = aggregation === 'distinct' ? 'stage' : 'amount';
      const result = computeReportAggregation(rows, field, aggregation);
      expect(result).toBe(value);
      expect(result, `'${aggregation}' must never render blank`).not.toBe('');
    });
  }

  it('an out-of-vocabulary aggregation still yields the empty sentinel', () => {
    expect(computeReportAggregation(rows, 'amount', 'median')).toBe('');
  });
});
