// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0037 P3 — draft data preview: the evaluator computes a dataset
// selection over pending seed-draft rows in memory, and queryDataset routes
// through it (bypassing the engine entirely) when previewDrafts is set and a
// pending seed exists.

import { describe, it, expect, vi } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';
import { evaluateAnalyticsQueryOverRows, bucketDate, matchesWhere } from '../preview-evaluator.js';
import type { Cube } from '@objectstack/spec/data';

const SEED_ROWS = [
  { title: 'Flight', amount: 1200, category: 'travel', spent_on: '2026-05-03' },
  { title: 'Hotel', amount: 800, category: 'travel', spent_on: '2026-05-12' },
  { title: 'Lunch', amount: 60, category: 'meals', spent_on: '2026-06-01' },
  { title: 'Dinner', amount: 140, category: 'meals', spent_on: '2026-06-02' },
];

const DATASET = DatasetSchema.parse({
  name: 'expense_ds',
  label: 'Expense',
  object: 'expense',
  dimensions: [
    { name: 'category', field: 'category', type: 'string' },
    { name: 'spent_on', field: 'spent_on', type: 'date', dateGranularity: 'month' },
  ],
  measures: [
    { name: 'count', aggregate: 'count' },
    { name: 'total_amount', aggregate: 'sum', field: 'amount' },
  ],
});

function previewService(rows: Record<string, unknown>[] | null) {
  // No strategies, no fallback: if the engine path is ever reached the call
  // throws — which is exactly how we prove preview bypasses it.
  return new AnalyticsService({
    draftRowsResolver: vi.fn(async () => rows),
  });
}

describe('queryDataset({ previewDrafts }) — seed-overlay preview', () => {
  it('charts the drafted seed rows without touching the engine', async () => {
    const result = await previewService(SEED_ROWS).queryDataset(
      DATASET,
      { dimensions: ['category'], measures: ['count', 'total_amount'] },
      undefined,
      { previewDrafts: true },
    );
    const byCat = Object.fromEntries(result.rows.map((r) => [r.category, r]));
    expect(byCat.travel).toMatchObject({ count: 2, total_amount: 2000 });
    expect(byCat.meals).toMatchObject({ count: 2, total_amount: 200 });
  });

  it('buckets date dimensions by the dataset granularity (month)', async () => {
    const result = await previewService(SEED_ROWS).queryDataset(
      DATASET,
      { dimensions: ['spent_on'], measures: ['total_amount'] },
      undefined,
      { previewDrafts: true },
    );
    const byMonth = Object.fromEntries(result.rows.map((r) => [r.spent_on, r.total_amount]));
    expect(byMonth['2026-05']).toBe(2000);
    expect(byMonth['2026-06']).toBe(200);
  });

  it('falls through to the real engine when the object has NO pending seed', async () => {
    // resolver → null ⇒ live-data path ⇒ the bare service (no strategies,
    // no fallback) rejects — proof the preview branch stepped aside.
    await expect(
      previewService(null).queryDataset(
        DATASET,
        { dimensions: ['category'], measures: ['count'] },
        undefined,
        { previewDrafts: true },
      ),
    ).rejects.toThrow();
  });

  it('ignores the flag entirely when no resolver is configured', async () => {
    const svc = new AnalyticsService({});
    await expect(
      svc.queryDataset(DATASET, { dimensions: [], measures: ['count'] }, undefined, { previewDrafts: true }),
    ).rejects.toThrow(); // straight to the (absent) engine — no preview detour
  });
});

describe('evaluateAnalyticsQueryOverRows', () => {
  const CUBE: Cube = {
    name: 'expense_ds',
    sql: 'expense',
    dimensions: {
      category: { name: 'category', type: 'string', sql: 'category' },
      spent_on: { name: 'spent_on', type: 'time', sql: 'spent_on', granularities: ['month'] },
    },
    measures: {
      count: { name: 'count', type: 'count', sql: '*' },
      total_amount: { name: 'total_amount', type: 'sum', sql: 'amount' },
    },
  } as unknown as Cube;

  it('applies Mongo-style where filters', () => {
    const r = evaluateAnalyticsQueryOverRows(
      { measures: ['count'], dimensions: [], where: { category: 'travel' } },
      CUBE,
      SEED_ROWS,
    );
    expect(r.rows[0].count).toBe(2);
    expect(
      evaluateAnalyticsQueryOverRows(
        { measures: ['count'], dimensions: [], where: { amount: { $gte: 800 } } },
        CUBE,
        SEED_ROWS,
      ).rows[0].count,
    ).toBe(2);
  });

  it('filters by timeDimension dateRange and buckets by granularity', () => {
    const r = evaluateAnalyticsQueryOverRows(
      {
        measures: ['total_amount'],
        dimensions: ['spent_on'],
        timeDimensions: [{ dimension: 'spent_on', granularity: 'month', dateRange: ['2026-05-01', '2026-05-31'] }],
      },
      CUBE,
      SEED_ROWS,
    );
    expect(r.rows).toEqual([{ spent_on: '2026-05', total_amount: 2000 }]);
  });

  it('orders and limits', () => {
    const r = evaluateAnalyticsQueryOverRows(
      { measures: ['total_amount'], dimensions: ['category'], order: { total_amount: 'desc' }, limit: 1 },
      CUBE,
      SEED_ROWS,
    );
    expect(r.rows).toEqual([{ category: 'travel', total_amount: 2000 }]);
  });

  it('a zero-dimension query over zero rows still yields one row (count 0)', () => {
    const r = evaluateAnalyticsQueryOverRows({ measures: ['count'], dimensions: [] }, CUBE, []);
    expect(r.rows).toEqual([{ count: 0 }]);
  });

  it('helpers: bucketDate + matchesWhere edge ops', () => {
    expect(bucketDate('2026-06-11', 'quarter')).toBe('2026-Q2');
    expect(bucketDate('not-a-date', 'month')).toBeNull();
    expect(matchesWhere({ a: 'x' }, { $or: [{ a: 'y' }, { a: 'x' }] })).toBe(true);
    expect(matchesWhere({ a: 5 }, { a: { $in: [1, 5] } })).toBe(true);
    expect(matchesWhere({ a: 'Hello World' }, { a: { $contains: 'world' } })).toBe(true);
  });

  it('helpers: bucketDate resolves the calendar day in a reference timezone', () => {
    // 2024-03-01T03:00Z is still 2024-02-29 in America/New_York.
    const near = '2024-03-01T03:00:00.000Z';
    expect(bucketDate(near, 'day', 'America/New_York')).toBe('2024-02-29');
    expect(bucketDate(near, 'month', 'America/New_York')).toBe('2024-02');
    // Unset / UTC keep the historical UTC bucketing.
    expect(bucketDate(near, 'day')).toBe('2024-03-01');
    expect(bucketDate(near, 'day', 'UTC')).toBe('2024-03-01');
  });
});
