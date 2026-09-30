// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20760] The memory cube face labels a time bucket in 0001..0999 with a
// four-digit year — `0050`, `0050-Q2`, `0050-06`, `0050-06-15`, `0050-W24` —
// the key a SQL driver's bucket expression answers for the same instant. It
// folds the key through `@objectstack/core`'s `bucketDateKey`; this pins the
// face. Before the card it answered `50`, `50-Q2`, `50-06`, `50-06-15` and
// `50-W24`, and a drill-down from such a key found no range.

import { describe, it, expect } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';
import { AnalyticsQuerySchema } from '@objectstack/spec/data';
import type { AnalyticsQuery, Cube } from '@objectstack/spec/data';

const cubes: Cube[] = [
  {
    name: 'events',
    title: 'Events',
    sql: 'events',
    measures: { count: { label: 'Event Count', type: 'count', sql: 'id' } },
    dimensions: {
      createdAt: {
        label: 'Created At',
        type: 'time',
        sql: 'created_at',
        granularities: ['day', 'week', 'month', 'quarter', 'year'],
      },
    },
  },
];

const ROWS = [
  { id: 1, created_at: '0050-06-15T10:00:00.000Z' },
  { id: 2, created_at: '0999-06-15T10:00:00.000Z' },
  // The control.
  { id: 3, created_at: '2026-06-15T10:00:00.000Z' },
];

async function labels(granularity: 'day' | 'week' | 'month' | 'quarter' | 'year'): Promise<unknown[]> {
  const driver = new InMemoryDriver({ initialData: { events: ROWS } });
  await driver.connect();
  const service = new MemoryAnalyticsService({ driver, cubes });
  const result = await service.query(
    AnalyticsQuerySchema.parse({
      cube: 'events',
      measures: ['events.count'],
      dimensions: ['events.createdAt'],
      timeDimensions: [{ dimension: 'events.createdAt', granularity }],
    } satisfies AnalyticsQuery),
  );
  return result.rows.map((r) => r['events.createdAt']).sort();
}

describe('[#20760] the memory cube face labels a year below 1000 with four digits', () => {
  it.each([
    ['year', ['0050', '0999', '2026']],
    ['quarter', ['0050-Q2', '0999-Q2', '2026-Q2']],
    ['month', ['0050-06', '0999-06', '2026-06']],
    ['day', ['0050-06-15', '0999-06-15', '2026-06-15']],
    ['week', ['0050-W24', '0999-W24', '2026-W25']],
  ] as const)('at %s', async (granularity, expected) => {
    expect(await labels(granularity)).toEqual(expected);
  });
});
