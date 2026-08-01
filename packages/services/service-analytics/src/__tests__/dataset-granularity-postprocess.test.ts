// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3588 follow-up — the EFFECTIVE granularity must reach the post-processing,
 * not just the GROUP BY.
 *
 * `selection.dateGranularity` correctly overrode the dataset dimension's default
 * when compiling the query, but two post-processing steps kept reading the
 * DATASET default: the bucket-label formatter and the drill-range inverter. The
 * result was a query grouped one way and described another. Caught by driving a
 * real dashboard query in a browser against a dataset whose dimension declares
 * `dateGranularity: 'month'`:
 *
 *   selection 'year'    → row labelled "1970-01"  (a year key re-parsed as epoch ms)
 *   selection 'day'     → day buckets re-labelled as months, so rows collapsed
 *                         to duplicate keys
 *   selection 'quarter' → correct label, but `drillRanges` empty — the chart
 *                         silently lost drill-through
 *
 * These pin the three sites (query, labels, ranges) to one resolution.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import { resolveDimensionGranularity } from '../dataset-executor.js';

const CTX = { tenantId: 'org_A' } as ExecutionContext;

/** Mirrors the showcase dataset: the dimension declares a MONTH default. */
const monthly = DatasetSchema.parse({
  name: 'task_metrics', label: 'Tasks', object: 'showcase_task', include: [],
  dimensions: [{ name: 'created_at', field: 'created_at', type: 'date', dateGranularity: 'month' }],
  measures: [{ name: 'task_count', aggregate: 'count' }],
});

/** A dataset that declares NO granularity — the widget supplies it (the hotcrm case). */
const bare = DatasetSchema.parse({
  name: 'account_metrics', label: 'Accounts', object: 'crm_account', include: [],
  dimensions: [{ name: 'created_at', field: 'created_at', type: 'date' }],
  measures: [{ name: 'account_count', aggregate: 'count' }],
});

/**
 * Service whose aggregate returns the bucket key the DRIVER would produce for
 * the granularity actually requested — so a mismatch between the query's
 * granularity and the post-processing's shows up exactly as it did in the browser.
 */
function service(bucketByGranularity: Record<string, string>) {
  const seen: { granularity?: string } = {};
  const svc = new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (_o, options) => {
      const gb = (options.groupBy ?? []) as Array<string | { field: string; dateGranularity?: string }>;
      const g = gb.map((x) => (typeof x === 'string' ? undefined : x.dateGranularity)).find(Boolean);
      seen.granularity = g;
      return [{ created_at: bucketByGranularity[g ?? 'none'], task_count: 10, account_count: 10 }];
    },
    // `created_at` is a tz-naive calendar date → ranges are exact under any tz.
    sourceFieldMeta: (_o, f) => (f === 'created_at' ? { type: 'date' } : undefined),
  });
  return { svc, seen };
}

const BUCKETS = { day: '2026-07-15', week: '2026-W29', month: '2026-07', quarter: '2026-Q3', year: '2026' };

describe('#3588 — effective granularity reaches labels and drill ranges', () => {
  it('labels a YEAR bucket as the year, not as epoch month "1970-01"', async () => {
    const { svc, seen } = service(BUCKETS);
    const r = await svc.queryDataset(
      monthly,
      { dimensions: ['created_at'], measures: ['task_count'], dateGranularity: 'year' },
      CTX,
    ) as any;
    expect(seen.granularity).toBe('year');
    expect(r.rows[0].created_at).toBe('2026');
    expect(r.rows[0].created_at).not.toBe('1970-01');
  });

  it('drills a YEAR bucket into the whole year', async () => {
    const { svc } = service(BUCKETS);
    const r = await svc.queryDataset(
      monthly,
      { dimensions: ['created_at'], measures: ['task_count'], dateGranularity: 'year' },
      CTX,
    ) as any;
    expect(r.drillRanges).toEqual([
      { created_at: { field: 'created_at', gte: '2026-01-01', lt: '2027-01-01' } },
    ]);
  });

  it('drills a QUARTER bucket into that quarter — previously the range was dropped', async () => {
    const { svc } = service(BUCKETS);
    const r = await svc.queryDataset(
      monthly,
      { dimensions: ['created_at'], measures: ['task_count'], dateGranularity: 'quarter' },
      CTX,
    ) as any;
    expect(r.drillRanges).toEqual([
      { created_at: { field: 'created_at', gte: '2026-07-01', lt: '2026-10-01' } },
    ]);
  });

  it('keeps a DAY bucket at day resolution instead of collapsing it to a month', async () => {
    const { svc } = service(BUCKETS);
    const r = await svc.queryDataset(
      monthly,
      { dimensions: ['created_at'], measures: ['task_count'], dateGranularity: 'day' },
      CTX,
    ) as any;
    expect(r.rows[0].created_at).toBe('2026-07-15');
    expect(r.drillRanges).toEqual([
      { created_at: { field: 'created_at', gte: '2026-07-15', lt: '2026-07-16' } },
    ]);
  });

  it('still honours the dataset default when the selection asks for nothing', async () => {
    const { svc, seen } = service(BUCKETS);
    const r = await svc.queryDataset(monthly, { dimensions: ['created_at'], measures: ['task_count'] }, CTX) as any;
    expect(seen.granularity).toBe('month');
    expect(r.rows[0].created_at).toBe('2026-07');
    expect(r.drillRanges).toEqual([
      { created_at: { field: 'created_at', gte: '2026-07-01', lt: '2026-08-01' } },
    ]);
  });

  it('gives a dataset that declares NO granularity both labels and ranges (#3588 case 1)', async () => {
    const { svc, seen } = service(BUCKETS);
    const r = await svc.queryDataset(
      bare,
      { dimensions: ['created_at'], measures: ['account_count'], dateGranularity: 'month' },
      CTX,
    ) as any;
    expect(seen.granularity).toBe('month');
    expect(r.rows[0].created_at).toBe('2026-07');
    // Before, a bare dataset dimension had no `dateGranularity` at all, so the
    // range sidecar was skipped and a bucketed chart could not drill.
    expect(r.drillRanges).toEqual([
      { created_at: { field: 'created_at', gte: '2026-07-01', lt: '2026-08-01' } },
    ]);
  });
});

describe('resolveDimensionGranularity — the single source of precedence', () => {
  it('a stated timeDimensions granularity wins over everything', () => {
    expect(resolveDimensionGranularity(
      { timeDimensions: [{ dimension: 'd', granularity: 'week' }], dateGranularity: 'year' }, 'd', 'month',
    )).toBe('week');
  });

  it('the selection beats the dataset default', () => {
    expect(resolveDimensionGranularity({ dateGranularity: 'year' }, 'd', 'month')).toBe('year');
  });

  it('the dataset default applies when the selection is silent', () => {
    expect(resolveDimensionGranularity({}, 'd', 'month')).toBe('month');
  });

  it('a dateRange-only entry states a WINDOW, not a bucket — it must not suppress bucketing', () => {
    expect(resolveDimensionGranularity(
      { timeDimensions: [{ dimension: 'd', dateRange: ['2026-01-01', '2026-12-31'] }], dateGranularity: 'month' },
      'd', undefined,
    )).toBe('month');
  });

  it('returns undefined when nothing declares one', () => {
    expect(resolveDimensionGranularity({}, 'd', undefined)).toBeUndefined();
  });
});

describe('formatDateBucket — a year key must survive its own re-labeling', () => {
  it('keeps a bare year key as the year, not epoch 1970', async () => {
    const { formatDateBucket } = await import('../dimension-labels.js');
    // Both forms drivers return for a `date_trunc('year', …)` bucket.
    expect(formatDateBucket('2026', 'year')).toBe('2026');
    expect(formatDateBucket(2026, 'year')).toBe('2026');
    // Idempotent: re-labeling an already-labelled key is a no-op.
    expect(formatDateBucket(formatDateBucket('2026', 'year'), 'year')).toBe('2026');
  });

  it('still reads a real epoch value under year granularity', async () => {
    const { formatDateBucket } = await import('../dimension-labels.js');
    expect(formatDateBucket(Date.UTC(2026, 5, 15), 'year')).toBe('2026');
    expect(formatDateBucket('2026-06-15T00:00:00Z', 'year')).toBe('2026');
  });

  it('leaves the other granularity keys alone (they never collided)', async () => {
    const { formatDateBucket } = await import('../dimension-labels.js');
    expect(formatDateBucket('2026-Q2', 'quarter')).toBe('2026-Q2');
    expect(formatDateBucket('2026-07', 'month')).toBe('2026-07');
    expect(formatDateBucket('2026-07-15', 'day')).toBe('2026-07-15');
  });
});
