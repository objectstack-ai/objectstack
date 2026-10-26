/**
 * Resource / workload aggregation tests (资源/工作负载视图 core).
 */
import { describe, it, expect } from 'vitest';
import { computeWorkload, type WorkloadColumn } from './workload';

interface T { id: string; start: Date; end: Date; owner?: string; units?: number }
const t = (id: string, start: string, end: string, owner?: string, units?: number): T => ({
  id, start: new Date(start), end: new Date(end), owner, units,
});

// Three day columns: 06-01, 06-02, 06-03.
const COLS: WorkloadColumn[] = [
  { start: new Date('2024-06-01T00:00:00Z'), end: new Date('2024-06-02T00:00:00Z') },
  { start: new Date('2024-06-02T00:00:00Z'), end: new Date('2024-06-03T00:00:00Z') },
  { start: new Date('2024-06-03T00:00:00Z'), end: new Date('2024-06-04T00:00:00Z') },
];

const byOwner = (task: T) => (task.owner ? { key: task.owner, label: task.owner } : null);

describe('computeWorkload', () => {
  it('buckets tasks by resource, preserving first-seen order', () => {
    const rows = computeWorkload(
      [t('1', '2024-06-01Z', '2024-06-02Z', 'B'), t('2', '2024-06-01Z', '2024-06-02Z', 'A')],
      COLS,
      { assignee: byOwner },
    );
    expect(rows.map((r) => r.key)).toEqual(['B', 'A']);
  });

  it('sums concurrent tasks into a column load and flags overload past capacity', () => {
    // Two A-tasks both span 06-01..06-03 → load 2 on cols 0 and 1 (overload at cap 1).
    const rows = computeWorkload(
      [t('1', '2024-06-01T00:00:00Z', '2024-06-03T00:00:00Z', 'A'),
       t('2', '2024-06-01T00:00:00Z', '2024-06-03T00:00:00Z', 'A')],
      COLS,
      { assignee: byOwner, capacity: 1 },
    );
    const a = rows[0];
    expect(a.cells.map((c) => c.load)).toEqual([2, 2, 0]);
    expect(a.cells.map((c) => c.overloaded)).toEqual([true, true, false]);
    expect(a.peak).toBe(2);
    expect(a.overloadedCount).toBe(2);
  });

  it('respects a custom effort accessor (fractional allocation)', () => {
    const rows = computeWorkload(
      [t('1', '2024-06-01T00:00:00Z', '2024-06-02T00:00:00Z', 'A', 0.5),
       t('2', '2024-06-01T00:00:00Z', '2024-06-02T00:00:00Z', 'A', 0.5)],
      COLS,
      { assignee: byOwner, effort: (x) => x.units ?? 1, capacity: 1 },
    );
    // 0.5 + 0.5 = 1.0 — exactly at capacity, not overloaded.
    expect(rows[0].cells[0].load).toBeCloseTo(1);
    expect(rows[0].cells[0].overloaded).toBe(false);
  });

  it('supports per-resource capacity via a function', () => {
    const rows = computeWorkload(
      [t('1', '2024-06-01T00:00:00Z', '2024-06-02T00:00:00Z', 'A'),
       t('2', '2024-06-01T00:00:00Z', '2024-06-02T00:00:00Z', 'A')],
      COLS,
      { assignee: byOwner, capacity: (k) => (k === 'A' ? 2 : 1) },
    );
    // Load 2 against capacity 2 → at ceiling, not overloaded.
    expect(rows[0].cells[0].load).toBe(2);
    expect(rows[0].cells[0].overloaded).toBe(false);
  });

  it('routes null-assignee tasks into the unassigned bucket', () => {
    const rows = computeWorkload(
      [t('1', '2024-06-01T00:00:00Z', '2024-06-02T00:00:00Z')],
      COLS,
      { assignee: byOwner, unassignedLabel: '未分配' },
    );
    expect(rows[0].key).toBe('__unassigned__');
    expect(rows[0].label).toBe('未分配');
    expect(rows[0].cells[0].load).toBe(1);
  });

  it('counts a zero-width milestone in the column containing its instant', () => {
    const rows = computeWorkload(
      [t('m', '2024-06-02T00:00:00Z', '2024-06-02T00:00:00Z', 'A')],
      COLS,
      { assignee: byOwner },
    );
    expect(rows[0].cells.map((c) => c.load)).toEqual([0, 1, 0]);
  });

  it('ignores non-positive effort values', () => {
    const rows = computeWorkload(
      [t('1', '2024-06-01T00:00:00Z', '2024-06-02T00:00:00Z', 'A', 0)],
      COLS,
      { assignee: byOwner, effort: (x) => x.units ?? 1 },
    );
    expect(rows[0].cells[0].load).toBe(0);
  });
});
