/**
 * Dynamic Group by (动态 Group by) tests for GanttView.
 *
 * `groupBy` is a presentational transform: leaf tasks are bucketed by the
 * accessor's key and rendered under one synthesized summary row per group,
 * replacing the original parent hierarchy. These tests assert the synthesized
 * rows exist, leaves reparent, the rollup spans the bucket, ungrouped tasks
 * land in the fallback bucket, and the synthetic rows are not draggable.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { GanttView, type GanttTask } from './GanttView';

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});

function makeTask(id: string, start: string, end: string, extra: Partial<GanttTask> = {}): GanttTask {
  return { id, title: `Task ${id}`, start: new Date(start), end: new Date(end), progress: 0, ...extra };
}

// Original hierarchy: phase P with three children of two owners, plus a solo.
const TASKS: GanttTask[] = [
  makeTask('p', '2024-06-01T00:00:00.000Z', '2024-06-02T00:00:00.000Z'),
  makeTask('a', '2024-06-03T00:00:00.000Z', '2024-06-06T00:00:00.000Z', { parent: 'p', data: { owner: 'Priya' }, progress: 100 }),
  makeTask('b', '2024-06-10T00:00:00.000Z', '2024-06-14T00:00:00.000Z', { parent: 'p', data: { owner: 'Sam' } }),
  makeTask('c', '2024-06-16T00:00:00.000Z', '2024-06-20T00:00:00.000Z', { parent: 'p', data: { owner: 'Priya' } }),
  makeTask('d', '2024-06-22T00:00:00.000Z', '2024-06-24T00:00:00.000Z', { data: {} }), // no owner → ungrouped
];

const byOwner = (t: GanttTask) => {
  const owner = (t.data ?? {}).owner;
  return owner ? { key: String(owner), label: String(owner) } : null;
};

function renderGrouped(extra: Partial<React.ComponentProps<typeof GanttView>> = {}) {
  return render(
    <div style={{ width: 1280, height: 600 }}>
      <GanttView
        tasks={TASKS}
        startDate={new Date('2024-06-01T00:00:00.000Z')}
        endDate={new Date('2024-06-30T00:00:00.000Z')}
        groupBy={byOwner}
        ungroupedLabel="未分组"
        {...extra}
      />
    </div>
  );
}

function geom(el: HTMLElement) {
  return { left: parseFloat(el.style.left), width: parseFloat(el.style.width) };
}

describe('GanttView dynamic Group by', () => {
  it('synthesizes one summary row per distinct group value', () => {
    const { container } = renderGrouped();
    // Buckets: Priya, Sam, 未分组 (first-seen order from task list).
    expect(container.querySelector('[data-testid="gantt-summary-bar-__group__Priya"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="gantt-summary-bar-__group__Sam"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="gantt-summary-bar-__group____ungrouped__"]')).toBeTruthy();
  });

  it('drops the original parent (p) — grouping replaces the hierarchy', () => {
    const { container } = renderGrouped();
    expect(container.querySelector('[data-testid="gantt-summary-bar-p"]')).toBeNull();
    expect(container.querySelector('[data-testid="gantt-task-bar-p"]')).toBeNull();
  });

  it('renders every leaf task once under its group', () => {
    const { container } = renderGrouped();
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(container.querySelectorAll(`[data-testid="gantt-task-bar-${id}"]`).length).toBe(1);
    }
  });

  it('rolls the group summary up to span its members', () => {
    const { container } = renderGrouped();
    // Priya owns a (06-03→06-06) and c (06-16→06-20): summary must span both.
    const summary = geom(container.querySelector('[data-testid="gantt-summary-bar-__group__Priya"]') as HTMLElement);
    const a = geom(container.querySelector('[data-testid="gantt-task-bar-a"]') as HTMLElement);
    const c = geom(container.querySelector('[data-testid="gantt-task-bar-c"]') as HTMLElement);
    expect(summary.left).toBeCloseTo(a.left, 0);
    expect(summary.left + summary.width).toBeCloseTo(c.left + c.width, 0);
  });

  it('shows the ungrouped label for tasks whose accessor returns null', () => {
    const { getAllByText } = renderGrouped();
    // Rendered in both the task-list row and the summary bar label.
    expect(getAllByText('未分组').length).toBeGreaterThan(0);
  });

  it('collapsing a group hides its members', () => {
    const { container } = renderGrouped();
    expect(container.querySelector('[data-testid="gantt-task-bar-a"]')).toBeTruthy();
    const toggle = container.querySelector('[data-testid="gantt-row-toggle-__group__Priya"]') as HTMLElement;
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);
    expect(container.querySelector('[data-testid="gantt-task-bar-a"]')).toBeNull();
    expect(container.querySelector('[data-testid="gantt-task-bar-c"]')).toBeNull();
    // The other group's members stay visible.
    expect(container.querySelector('[data-testid="gantt-task-bar-b"]')).toBeTruthy();
  });

  it('does not start a group drag on synthetic group rows', () => {
    const { container } = renderGrouped({ onTaskUpdate: () => {} });
    // Real leaf bars expose resize handles; the guard leaves them intact.
    expect(container.querySelector('[data-testid="gantt-task-resize-left-a"]')).toBeTruthy();
    // Pressing + dragging a synthetic group summary must NOT begin a drag:
    // the live drag chip (only rendered while dragState is set) never appears.
    const summary = container.querySelector('[data-testid="gantt-summary-bar-__group__Priya"]') as HTMLElement;
    fireEvent.pointerDown(summary, { button: 0, clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 320 });
    expect(container.querySelector('[data-testid="gantt-summary-drag-chip-__group__Priya"]')).toBeNull();
  });

  it('renders the plain hierarchy when no groupBy is provided', () => {
    const { container } = render(
      <div style={{ width: 1280, height: 600 }}>
        <GanttView
          tasks={TASKS}
          startDate={new Date('2024-06-01T00:00:00.000Z')}
          endDate={new Date('2024-06-30T00:00:00.000Z')}
        />
      </div>
    );
    // Original summary p present, no synthetic group rows.
    expect(container.querySelector('[data-testid="gantt-summary-bar-p"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="gantt-summary-bar-__group__Priya"]')).toBeNull();
  });
});
