// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3916 — a selected time dimension comes back CHRONOLOGICAL by default.
 *
 * The reported symptom was a matrix report whose date COLUMNS rendered in
 * arbitrary order (`2026-07-01, 2026-07-05, …, 2026-07-02`). Nothing in the
 * stack ordered them: `resolveOrdering` returned `undefined` unless the
 * selection carried an explicit `order`, the ObjectQL aggregate path has no
 * ordering grammar (its buckets come back in Map-insertion order), and the
 * pivot builds its column headers in row-ARRIVAL order. Declaring
 * `dateGranularity` made the keys sortable without making anything sort them.
 *
 * These tests pin the default and its boundaries: it applies to time dimensions
 * only, it never overrides an explicit `order`, and it survives on both strategy
 * paths — as a real `ORDER BY` where native SQL serves the query, and as the
 * executor's post-pass where a bucketed query is handed to the ObjectQL path.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import { resolveOrdering } from '../dataset-executor.js';

const CTX = { tenantId: 'org_A' } as ExecutionContext;

/** The HotCRM shape: a date dimension across, a string dimension down. */
const tasks = DatasetSchema.parse({
  name: 'task_metrics',
  label: 'Tasks',
  object: 'crm_task',
  include: [],
  dimensions: [
    { name: 'due_date', field: 'due_date', type: 'date' },
    { name: 'closed_month', field: 'closed_at', type: 'date', dateGranularity: 'month' },
    { name: 'owner', field: 'owner', type: 'string' },
  ],
  measures: [
    { name: 'task_count', aggregate: 'count' },
    { name: 'est_hours', aggregate: 'sum', field: 'est_hours' },
  ],
});

/**
 * ObjectQL-aggregate service — the path every date-BUCKETED query is handed to.
 * Stub rows are keyed by the underlying FIELD name (`closed_at`), which is what
 * the engine returns; the strategy remaps them onto the dimension names.
 */
function aggService(rows: Record<string, unknown>[]) {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async () => rows,
  });
}

/** Native-SQL service; captures every statement it is asked to run. */
function sqlService(rows: Record<string, unknown>[], captured: string[] = []) {
  const svc = new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async (_o, sql) => { captured.push(sql); return rows; },
  });
  return { svc, captured };
}

describe('#3916 — resolveOrdering defaults the time axis to ascending', () => {
  const selection = { measures: ['task_count'] };

  it('orders a selected time dimension ascending when nothing else asked', () => {
    expect(resolveOrdering(selection, ['closed_month'], ['closed_month'])).toEqual({ closed_month: 'asc' });
  });

  it('leaves a selection with no time dimension unordered, exactly as before', () => {
    expect(resolveOrdering(selection, ['owner'], [])).toBeUndefined();
  });

  it('orders ONLY the time dimensions — a non-time dimension keeps the grouping order', () => {
    // Deliberately narrow: sorting every dimension by default would reorder
    // grids that have nothing wrong with them. The row axis stays as-is.
    expect(resolveOrdering(selection, ['owner', 'closed_month'], ['closed_month']))
      .toEqual({ closed_month: 'asc' });
  });

  it('keeps multiple time dimensions in selection order (first is the primary sort)', () => {
    expect(resolveOrdering(selection, ['due_date', 'owner', 'closed_month'], ['due_date', 'closed_month']))
      .toEqual({ due_date: 'asc', closed_month: 'asc' });
  });

  it('never overrides an explicit order — the default is a default, not a policy', () => {
    expect(
      resolveOrdering({ ...selection, order: { closed_month: 'desc' } }, ['closed_month'], ['closed_month']),
    ).toEqual({ closed_month: 'desc' });
  });

  it('yields to the bare-limit fallback, which orders EVERY dimension for a reproducible window', () => {
    expect(resolveOrdering({ ...selection, limit: 10 }, ['owner', 'closed_month'], ['closed_month']))
      .toEqual({ owner: 'asc', closed_month: 'asc' });
  });

  it('ignores a time dimension the selection does not actually group by', () => {
    expect(resolveOrdering(selection, ['owner'], ['closed_month'])).toBeUndefined();
  });
});

describe('#3916 — matrix date columns arrive chronological end-to-end', () => {
  it('sorts month buckets the aggregate path emitted in insertion order', async () => {
    // Exactly the reported grid: the driver's bucket Map hands back July before
    // June before August, and nothing downstream fixed it.
    const svc = aggService([
      { owner: 'ann', closed_at: '2026-07', task_count: 3 },
      { owner: 'ann', closed_at: '2026-06', task_count: 5 },
      { owner: 'bob', closed_at: '2026-08', task_count: 2 },
      { owner: 'bob', closed_at: '2026-06', task_count: 1 },
    ]);
    const result = await svc.queryDataset(
      tasks,
      { dimensions: ['owner', 'closed_month'], measures: ['task_count'] },
      CTX,
    );
    // The pivot builds its column headers in row-ARRIVAL order, so the distinct
    // months must arrive ascending for the across-axis to read left-to-right.
    const months = [...new Set(result.rows.map((r) => r.closed_month))];
    expect(months).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('sorts quarter and year keys chronologically too (bucket keys are minted sort-stable)', async () => {
    const quarterly = DatasetSchema.parse({
      name: 'quarterly_tasks', label: 'Quarterly', object: 'crm_task', include: [],
      dimensions: [{ name: 'closed_quarter', field: 'closed_at', type: 'date', dateGranularity: 'quarter' }],
      measures: [{ name: 'task_count', aggregate: 'count' }],
    });
    const svc = aggService([
      { closed_at: '2026-Q3', task_count: 1 },
      { closed_at: '2025-Q4', task_count: 2 },
      { closed_at: '2026-Q1', task_count: 3 },
    ]);
    const result = await svc.queryDataset(
      quarterly,
      { dimensions: ['closed_quarter'], measures: ['task_count'] },
      CTX,
    );
    expect(result.rows.map((r) => r.closed_quarter)).toEqual(['2025-Q4', '2026-Q1', '2026-Q3']);
  });

  it('emits a real ORDER BY when native SQL serves the query', async () => {
    // An UNbucketed date dimension stays on the native path (native SQL declines
    // granularity), so the ordering becomes server-side SQL rather than a
    // post-pass — the "no ORDER BY in the aggregate SQL" half of the report.
    const { svc, captured } = sqlService([{ due_date: '2026-07-01', task_count: 1 }]);
    await svc.queryDataset(tasks, { dimensions: ['due_date'], measures: ['task_count'] }, CTX);
    expect(captured[0]).toContain('ORDER BY "due_date" ASC');
  });

  it('adds no ORDER BY for a selection with no time dimension', async () => {
    const { svc, captured } = sqlService([{ owner: 'ann', task_count: 1 }]);
    await svc.queryDataset(tasks, { dimensions: ['owner'], measures: ['task_count'] }, CTX);
    expect(captured[0]).not.toContain('ORDER BY');
  });

  it('an explicit desc order still wins end-to-end (newest month first)', async () => {
    const svc = aggService([
      { closed_at: '2026-06', task_count: 5 },
      { closed_at: '2026-08', task_count: 2 },
      { closed_at: '2026-07', task_count: 3 },
    ]);
    const result = await svc.queryDataset(
      tasks,
      { dimensions: ['closed_month'], measures: ['task_count'], order: { closed_month: 'desc' } },
      CTX,
    );
    expect(result.rows.map((r) => r.closed_month)).toEqual(['2026-08', '2026-07', '2026-06']);
  });

  it('keeps the empty (null) bucket last, as every other ordering does', async () => {
    // #3839 made the empty bucket a real `null`; `compareValues` sorts nulls
    // last in BOTH directions, so an undated row cannot lead the time axis.
    const svc = aggService([
      { closed_at: null, task_count: 9 },
      { closed_at: '2026-07', task_count: 3 },
      { closed_at: '2026-06', task_count: 5 },
    ]);
    const result = await svc.queryDataset(
      tasks,
      { dimensions: ['closed_month'], measures: ['task_count'] },
      CTX,
    );
    expect(result.rows.map((r) => r.closed_month)).toEqual(['2026-06', '2026-07', null]);
  });
});
