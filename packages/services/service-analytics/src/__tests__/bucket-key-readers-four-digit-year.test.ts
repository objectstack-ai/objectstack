// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20867] This package's two readers of a date-bucket key agree with
 * `@objectstack/core`'s one writer, `bucketDateKey`, for a year in 0001..0999.
 *
 * - `formatDateBucket` (`dimension-labels.ts`) relabels a date dimension's
 *   grouped key on the published `queryDataset` path. Its year check admitted
 *   only 1000..9999, so the key `0050` was read as epoch seconds and labelled
 *   `1970`; a month or day key was re-spelled with its year unpadded (`50-06`,
 *   `50-06-15`). It now labels every key the writer writes as written, and
 *   what it relabels is spelled by the writer.
 * - `bucketDate` (`preview-evaluator.ts`) keys a drafted seed row on the draft
 *   preview path. It spelled every key itself: the year unpadded (`50`,
 *   `50-Q2`, `50-06`, `50-06-15`), and the week as the Monday's
 *   `YYYY-MM-DD` where the runtime writes the ISO week label (`0050-W24`,
 *   `2026-W25`). It now delegates to `bucketDateKey`, so the preview adopts the
 *   runtime's ISO week label and a drafted chart keys a row the way the same
 *   dataset does once published.
 *
 * Pins: 0050 (with 0050-01-01, whose ISO week is `0049-W52`) and 0999, with a
 * 2026 control. Every expected key is spelled literally.
 */

import { describe, it, expect, vi } from 'vitest';
import { bucketDateKey } from '@objectstack/core';
import { applyInMemoryAggregation } from '@objectstack/objectql';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import { formatDateBucket } from '../dimension-labels.js';
import { bucketDate } from '../preview-evaluator.js';

const GRANULARITIES = ['year', 'quarter', 'month', 'week', 'day'] as const;
type Granularity = (typeof GRANULARITIES)[number];

/** The key the writer gives each instant, spelled literally (the reference). */
const WRITTEN: ReadonlyArray<readonly [string, Record<Granularity, string>]> = [
  ['0050-06-15T10:00:00.000Z', { year: '0050', quarter: '0050-Q2', month: '0050-06', week: '0050-W24', day: '0050-06-15' }],
  ['0050-01-01T10:00:00.000Z', { year: '0050', quarter: '0050-Q1', month: '0050-01', week: '0049-W52', day: '0050-01-01' }],
  ['0999-06-15T10:00:00.000Z', { year: '0999', quarter: '0999-Q2', month: '0999-06', week: '0999-W24', day: '0999-06-15' }],
  // The control.
  ['2026-06-15T10:00:00.000Z', { year: '2026', quarter: '2026-Q2', month: '2026-06', week: '2026-W25', day: '2026-06-15' }],
];

describe('[#20867] the reference: core writes these keys', () => {
  it.each(WRITTEN)('%s', (instant, keys) => {
    for (const g of GRANULARITIES) expect(bucketDateKey(instant, g), g).toBe(keys[g]);
  });
});

describe('[#20867] formatDateBucket labels every key the writer writes as written', () => {
  it.each([
    ['0050', 'year'],
    ['0050-06', 'month'],
    ['0050-06-15', 'day'],
  ] as const)('%s (%s) is labelled as written', (key, g) => {
    expect(formatDateBucket(key, g)).toBe(key);
  });

  it.each(WRITTEN)('every granularity of %s', (_instant, keys) => {
    for (const g of GRANULARITIES) expect(formatDateBucket(keys[g], g), g).toBe(keys[g]);
  });

  it.each([
    // A raw value a date dimension groups by when no bucket was applied; the
    // label is the key the writer gives the same instant in UTC.
    ['0050-06-15T10:00:00.000Z', { year: '0050', quarter: '0050-Q2', month: '0050-06', day: '0050-06-15' }],
    ['0050-06-15', { year: '0050', quarter: '0050-Q2', month: '0050-06', day: '0050-06-15' }],
    // The control.
    ['2026-06-15T10:00:00.000Z', { year: '2026', quarter: '2026-Q2', month: '2026-06', day: '2026-06-15' }],
  ] as const)('relabels the raw value %s with the year in four digits', (raw, keys) => {
    for (const g of ['year', 'quarter', 'month', 'day'] as const) expect(formatDateBucket(raw, g), g).toBe(keys[g]);
    expect(formatDateBucket(raw, undefined)).toBe(keys.day);
  });
});

describe('[#20867] bucketDate delegates to the writer', () => {
  it.each(WRITTEN)('%s', (instant, keys) => {
    const ms = Date.parse(instant);
    for (const g of GRANULARITIES) {
      expect(bucketDate(instant, g), g).toBe(keys[g]);
      // The other two forms the writer reads, and the published path buckets.
      expect(bucketDate(ms, g), `${g} (epoch ms)`).toBe(keys[g]);
      expect(bucketDate(new Date(ms), g), `${g} (Date)`).toBe(keys[g]);
    }
  });

  it('resolves the calendar day in the reference zone, as the writer does', () => {
    // Sunday 0050-01-02 in UTC is Monday 0050-01-03 in Asia/Shanghai.
    expect(bucketDate('0050-01-02T20:00:00.000Z', 'week', 'UTC')).toBe('0049-W52');
    expect(bucketDate('0050-01-02T20:00:00.000Z', 'week', 'Asia/Shanghai')).toBe('0050-W01');
    expect(bucketDate('0050-01-02T20:00:00.000Z', 'day', 'Asia/Shanghai')).toBe('0050-01-03');
    // The control.
    expect(bucketDate('2026-06-14T20:00:00.000Z', 'week', 'Asia/Shanghai')).toBe('2026-W25');
  });
});

describe('[#20867] a draft preview keys 0050-06-15 as the published path does', () => {
  const CTX = { tenantId: 'org_A' } as ExecutionContext;
  const DATASET = DatasetSchema.parse({
    name: 'expense_ds', label: 'Expense', object: 'expense', include: [],
    dimensions: [{ name: 'spent_on', field: 'spent_on', type: 'date', dateGranularity: 'month' }],
    measures: [{ name: 'expense_count', aggregate: 'count' }],
  });
  // A `date` value and a `datetime` value on the same calendar day, and the control.
  const ROWS = [
    { spent_on: '0050-06-15', amount: 10 },
    { spent_on: '0050-06-15T10:00:00.000Z', amount: 20 },
    { spent_on: '2026-06-15', amount: 30 },
  ];

  /** The draft preview: the seed rows, evaluated in memory. */
  const preview = new AnalyticsService({ draftRowsResolver: vi.fn(async () => ROWS) });

  /**
   * The published path over the same rows: the ObjectQL strategy, the engine's
   * in-memory grouping (`@objectstack/objectql`) as `executeAggregate`, and the
   * dimension labels `queryDataset` resolves after grouping.
   */
  const published = new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (_object, options) =>
      applyInMemoryAggregation(
        ROWS,
        {
          groupBy: options.groupBy,
          aggregations: (options.aggregations ?? []).map((a) => ({ function: a.method, field: a.field, alias: a.alias })),
        },
        options.timezone,
      ),
    sourceFieldMeta: (_o, f) => (f === 'spent_on' ? { type: 'date' } : undefined),
    labelResolver: {
      getObjectFields: (o) => (o === 'expense' ? { spent_on: { type: 'date' } } : undefined),
      fetchRecordLabels: async () => new Map(),
    },
  });

  const keysOf = (rows: Record<string, unknown>[]) =>
    rows.map((r) => [r.spent_on, r.expense_count]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  it.each([
    ['year', '0050', '2026'],
    ['quarter', '0050-Q2', '2026-Q2'],
    ['month', '0050-06', '2026-06'],
    ['week', '0050-W24', '2026-W25'],
    ['day', '0050-06-15', '2026-06-15'],
  ] as const)('%s: %s, and %s for the control', async (g, key, control) => {
    const selection = { dimensions: ['spent_on'], measures: ['expense_count'], dateGranularity: g };
    const drafted = await preview.queryDataset(DATASET, selection, CTX, { previewDrafts: true });
    const live = await published.queryDataset(DATASET, selection, CTX);
    const expected = [[key, 2], [control, 1]];
    expect(keysOf(live.rows), 'published').toEqual(expected);
    expect(keysOf(drafted.rows), 'preview').toEqual(expected);
  });
});
