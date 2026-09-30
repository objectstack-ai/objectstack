// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20760] The engine's in-memory `groupBy` face keys a date bucket in
// 0001..0999 with a four-digit year, the key the SQL drivers' bucket
// expressions answer for the same rows (`strftime('%Y-%m')` → `0050-06`). It
// delegates to `@objectstack/core`'s `bucketDateKey`; this pins the face, so a
// local spelling here cannot drift from the pushed-down path.
//
// Before the card this face answered `50`, `50-Q2`, `50-06`, `50-06-15` and
// `50-W24` for 0050-06-15 while SQLite answered `0050`, `0050-Q2`, … so the
// same `groupBy` keyed the same rows differently on the two paths.

import { describe, it, expect } from 'vitest';
import { applyInMemoryAggregation } from './in-memory-aggregation.js';

/** A `date` value, a stored `datetime` instant on the same day, a 0999 day and the 2026 control. */
const ROWS = [
  { id: 1, closed_at: '0050-06-15' },
  { id: 2, closed_at: '0050-06-15T10:00:00.000Z' },
  { id: 3, closed_at: '0999-06-15' },
  { id: 4, closed_at: '2026-06-15' },
];

const EXPECTED: Record<'year' | 'quarter' | 'month' | 'day' | 'week', Record<string, number>> = {
  year: { '0050': 2, '0999': 1, '2026': 1 },
  quarter: { '0050-Q2': 2, '0999-Q2': 1, '2026-Q2': 1 },
  month: { '0050-06': 2, '0999-06': 1, '2026-06': 1 },
  day: { '0050-06-15': 2, '0999-06-15': 1, '2026-06-15': 1 },
  week: { '0050-W24': 2, '0999-W24': 1, '2026-W25': 1 },
};

describe('[#20760] in-memory groupBy keys a year below 1000 with four digits', () => {
  it.each(Object.entries(EXPECTED))('at %s', (granularity, expected) => {
    const out = applyInMemoryAggregation(ROWS, {
      groupBy: [{ field: 'closed_at', dateGranularity: granularity as 'year' }],
      aggregations: [{ function: 'count', alias: 'n' }],
    });
    expect(Object.fromEntries(out.map((r) => [r.closed_at, r.n]))).toEqual(expected);
  });

  it('keys early January 0050 in its ISO week-year, 0049', () => {
    const out = applyInMemoryAggregation([{ id: 1, closed_at: '0050-01-01' }], {
      groupBy: [{ field: 'closed_at', dateGranularity: 'week' }],
      aggregations: [{ function: 'count', alias: 'n' }],
    });
    expect(out).toEqual([{ closed_at: '0049-W52', n: 1 }]);
  });
});
