/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Resource / Workload view (资源/工作负载视图) render tests.
 *
 * The aggregation math lives in workload.ts (covered by workload.test.ts);
 * these tests assert the renderer wires that model into DOM correctly — one
 * row per resource, an unassigned bucket, overload flags surfaced on cells and
 * the peak caption, and the empty state.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ResourceWorkload } from './ResourceWorkload';
import type { GanttTask } from './GanttView';

function makeTask(id: string, start: string, end: string, extra: Partial<GanttTask> = {}): GanttTask {
  return { id, title: `Task ${id}`, start: new Date(start), end: new Date(end), progress: 0, ...extra };
}

// Priya is double-booked 06-03..06-05 (a overlaps c); Sam has one task; one
// task has no owner → unassigned bucket.
const TASKS: GanttTask[] = [
  makeTask('a', '2024-06-02T00:00:00.000Z', '2024-06-06T00:00:00.000Z', { data: { owner: 'Priya' } }),
  makeTask('c', '2024-06-03T00:00:00.000Z', '2024-06-05T00:00:00.000Z', { data: { owner: 'Priya' } }),
  makeTask('b', '2024-06-10T00:00:00.000Z', '2024-06-14T00:00:00.000Z', { data: { owner: 'Sam' } }),
  makeTask('d', '2024-06-08T00:00:00.000Z', '2024-06-09T00:00:00.000Z', { data: {} }),
];

const byOwner = (t: GanttTask) => {
  const owner = (t.data ?? {}).owner;
  return owner ? { key: String(owner), label: String(owner) } : null;
};

function renderWorkload(extra: Partial<React.ComponentProps<typeof ResourceWorkload>> = {}) {
  return render(
    <div style={{ width: 1280, height: 600 }}>
      <ResourceWorkload tasks={TASKS} assignee={byOwner} viewMode="day" unassignedLabel="未分配" {...extra} />
    </div>
  );
}

describe('ResourceWorkload', () => {
  it('renders the empty state when there are no tasks', () => {
    const { getByTestId } = render(<ResourceWorkload tasks={[]} assignee={byOwner} />);
    const root = getByTestId('resource-workload');
    expect(root.textContent).toContain('No tasks to allocate.');
  });

  it('renders one row per resource plus the unassigned bucket', () => {
    const { getByTestId } = renderWorkload();
    expect(getByTestId('resource-row-Priya')).toBeTruthy();
    expect(getByTestId('resource-row-Sam')).toBeTruthy();
    // null assignee → unassigned bucket keyed by '__unassigned__'.
    expect(getByTestId('resource-row-__unassigned__')).toBeTruthy();
    // The custom unassigned label is shown.
    expect(getByTestId('resource-row-__unassigned__').textContent).toContain('未分配');
  });

  it('flags Priya overloaded (concurrent tasks) on the peak caption', () => {
    const { getByTestId } = renderWorkload();
    const priyaPeak = getByTestId('resource-peak-Priya');
    expect(priyaPeak.getAttribute('data-overloaded')).toBe('true');
    // peak load reaches 2 (two concurrent tasks at default effort 1).
    expect(priyaPeak.textContent).toContain('2');
    // Sam is never double-booked → not overloaded.
    expect(getByTestId('resource-peak-Sam').getAttribute('data-overloaded')).toBeNull();
  });

  it('marks at least one Priya cell overloaded and none for Sam', () => {
    const { getByTestId } = renderWorkload();
    const row = getByTestId('resource-row-Priya');
    expect(row).toBeTruthy();
    // Scan Priya's cells for an overloaded one (load 2 on the overlap days).
    let overloaded = 0;
    for (let i = 0; i < 40; i++) {
      const cell = document.querySelector(`[data-testid="resource-cell-Priya-${i}"]`);
      if (cell && cell.getAttribute('data-overloaded') === 'true') overloaded++;
    }
    expect(overloaded).toBeGreaterThan(0);

    let samOverloaded = 0;
    for (let i = 0; i < 40; i++) {
      const cell = document.querySelector(`[data-testid="resource-cell-Sam-${i}"]`);
      if (cell && cell.getAttribute('data-overloaded') === 'true') samOverloaded++;
    }
    expect(samOverloaded).toBe(0);
  });

  it('honours a custom capacity so concurrency below it is not overload', () => {
    const { getByTestId } = renderWorkload({ capacity: 2 });
    // With capacity 2, Priya's peak of 2 is no longer over the ceiling.
    expect(getByTestId('resource-peak-Priya').getAttribute('data-overloaded')).toBeNull();
  });
});
