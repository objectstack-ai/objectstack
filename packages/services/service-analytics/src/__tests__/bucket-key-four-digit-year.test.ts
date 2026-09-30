// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20760] This package's bucket-key sites read and write the key a grouped row
 * carries, with its year in four digits, for a day in 0001..0999.
 *
 * - `bucketKeyAtOrdinal` (the `compareTo` alignment) mints its key through
 *   `@objectstack/core`'s `bucketDateKey`. It spelled every granularity itself
 *   and carried a private copy of the ISO week rule, so it minted `50-06` and
 *   `49-W52` while the grouped rows it is merged with carry `0050-06` and
 *   `0049-W52` (a SQL driver's bucket expression, and since this card the
 *   in-memory faces too). A comparison row then never merged onto its bucket.
 * - The drill-down (`drillRanges`) turns a grouped row's key back into a
 *   calendar range through core's `bucketKeyToCalendarRange`, whose week arm
 *   checked a padded key against the unpadded label: `0050-W01` found no range.
 *
 * Pins: 0001, 0050 and 0999 with a 2026 control. Every expected key and bound
 * is spelled literally.
 */

import { describe, it, expect } from 'vitest';
import { bucketDateKey } from '@objectstack/core';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import { alignedCompareBucketKey, bucketKeyAtOrdinal, bucketOrdinalOfDay } from '../dataset-executor.js';

const GRANULARITIES = ['year', 'quarter', 'month', 'day', 'week'] as const;

describe('[#20760] bucketKeyAtOrdinal mints the key a grouped row carries', () => {
  it.each([
    ['0001-06-15', { year: '0001', quarter: '0001-Q2', month: '0001-06', day: '0001-06-15', week: '0001-W24' }],
    ['0050-06-15', { year: '0050', quarter: '0050-Q2', month: '0050-06', day: '0050-06-15', week: '0050-W24' }],
    ['0050-01-01', { year: '0050', quarter: '0050-Q1', month: '0050-01', day: '0050-01-01', week: '0049-W52' }],
    ['0999-06-15', { year: '0999', quarter: '0999-Q2', month: '0999-06', day: '0999-06-15', week: '0999-W24' }],
    ['2026-06-15', { year: '2026', quarter: '2026-Q2', month: '2026-06', day: '2026-06-15', week: '2026-W25' }],
  ] as const)('%s', (day, expected) => {
    for (const g of GRANULARITIES) {
      const minted = bucketKeyAtOrdinal(bucketOrdinalOfDay(day, g), g);
      expect(minted, g).toBe(expected[g]);
      // The grouped row's key for the same day, from the labeller the
      // in-memory faces delegate to.
      expect(minted, g).toBe(bucketDateKey(day, g));
    }
  });

  it.each([
    ['0049-06', 'month', '0050-06'],
    ['0049-Q2', 'quarter', '0050-Q2'],
    ['0049', 'year', '0050'],
    ['0049-06-15', 'day', '0050-06-15'],
    ['0049-W24', 'week', '0050-W24'],
    // The control.
    ['2025-06', 'month', '2026-06'],
  ] as const)('restates the previous-year key %s (%s) as %s', (key, g, current) => {
    const year = Number(current.slice(0, 4));
    const pad = (y: number) => String(y).padStart(4, '0');
    expect(
      alignedCompareBucketKey(
        key,
        g,
        'previousYear',
        [`${pad(year)}-01-01`, `${pad(year)}-12-31`],
        [`${pad(year - 1)}-01-01`, `${pad(year - 1)}-12-31`],
      ),
    ).toBe(current);
  });
});

describe('[#20760] a drill-down from a week key in 0001..0999 finds its range', () => {
  const CTX = { tenantId: 'org_A' } as ExecutionContext;
  const weekly = DatasetSchema.parse({
    name: 'task_metrics', label: 'Tasks', object: 'showcase_task', include: [],
    dimensions: [{ name: 'created_at', field: 'created_at', type: 'date', dateGranularity: 'week' }],
    measures: [{ name: 'task_count', aggregate: 'count' }],
  });

  /** A service whose grouped row carries the week key of `day`, as the in-memory face writes it. */
  async function drill(day: string) {
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async () => [{ created_at: bucketDateKey(day, 'week'), task_count: 1 }],
      // A tz-naive calendar `date` → the range is the calendar bounds themselves.
      sourceFieldMeta: (_o, f) => (f === 'created_at' ? { type: 'date' } : undefined),
    });
    return (await svc.queryDataset(weekly, { dimensions: ['created_at'], measures: ['task_count'] }, CTX)) as any;
  }

  it.each([
    ['0050-01-05', '0050-W01', '0050-01-03', '0050-01-10'],
    ['0050-01-01', '0049-W52', '0049-12-27', '0050-01-03'],
    ['0999-06-15', '0999-W24', '0999-06-10', '0999-06-17'],
    // The control.
    ['2026-01-01', '2026-W01', '2025-12-29', '2026-01-05'],
  ])('%s keys %s and drills to %s up to %s', async (day, key, gte, lt) => {
    const r = await drill(day);
    expect(r.rows[0].created_at).toBe(key);
    expect(r.drillRanges).toEqual([{ created_at: { field: 'created_at', gte, lt } }]);
  });
});
