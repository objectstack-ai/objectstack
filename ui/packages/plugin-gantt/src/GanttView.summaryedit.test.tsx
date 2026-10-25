/**
 * Summary-bar editability (手动排程汇总条) unit tests.
 *
 * The MS-Project rule: a summary whose OWN dates are authoritative
 * (`summaryExtent: 'self'` + `hasOwnDates !== false`) edits like a task bar —
 * edge grips resize its own start/end, connector dots draw dependencies —
 * while its middle still group-moves the whole subtree. Rollup summaries
 * (children define the span) stay move-only: derived dates have no field to
 * persist to.
 */
import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GanttView, type GanttTask } from './GanttView';

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});

function pointer(type: string, clientX: number) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY: 100,
    pointerType: 'mouse',
    button: 0,
    isPrimary: true,
  } as PointerEventInit);
}

function makeTasks(overrides?: { lockedParent?: boolean }): GanttTask[] {
  return [
    {
      id: 'p1',
      title: 'Plan',
      start: new Date('2024-06-10T00:00:00.000Z'),
      end: new Date('2024-06-15T00:00:00.000Z'),
      progress: 0,
      dependencies: [],
      hasOwnDates: true,
      locked: overrides?.lockedParent ?? false,
    },
    {
      id: 'c1',
      title: 'Child order',
      start: new Date('2024-06-11T00:00:00.000Z'),
      end: new Date('2024-06-12T00:00:00.000Z'),
      progress: 0,
      dependencies: [],
      parent: 'p1',
    },
  ];
}

/**
 * `GanttView`'s `onTaskUpdate` as this file's helpers pass it.
 *
 * Naming it is what lets the spies below be `vi.fn< GanttTaskUpdate >()` rather
 * than a bare `vi.fn()`. A bare one types `mock.calls` as `any[][]` — an array
 * of arrays of unknown LENGTH — while the assertions further down destructure
 * `[task]` and read `call[1]`, the changes payload. So the spy was declaring
 * that there is no second argument at all, next to assertions that read it
 * (objectui#4040).
 */
type GanttTaskUpdate = (task: GanttTask, changes: any) => void;

function renderView(opts: {
  tasks?: GanttTask[];
  summaryExtent?: 'children' | 'self';
  onTaskUpdate?: GanttTaskUpdate;
  onDependencyCreate?: (s: GanttTask, t: GanttTask, ty: any) => void;
}) {
  return render(
    <div style={{ width: 1280, height: 600 }}>
      <GanttView
        tasks={opts.tasks ?? makeTasks()}
        startDate={new Date('2024-06-01T00:00:00.000Z')}
        endDate={new Date('2024-06-30T00:00:00.000Z')}
        summaryExtent={opts.summaryExtent}
        onTaskUpdate={opts.onTaskUpdate}
        onDependencyCreate={opts.onDependencyCreate}
      />
    </div>
  );
}

describe('self-extent summary bar editability', () => {
  it('renders resize grips on a self-dated summary bar', () => {
    const { container } = renderView({ summaryExtent: 'self', onTaskUpdate: vi.fn() });
    expect(container.querySelector('[data-testid="gantt-summary-bar-p1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="gantt-task-resize-left-p1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="gantt-task-resize-right-p1"]')).toBeTruthy();
  });

  it('rollup summary (summaryExtent children) gets NO resize grips', () => {
    const { container } = renderView({ onTaskUpdate: vi.fn() });
    expect(container.querySelector('[data-testid="gantt-summary-bar-p1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="gantt-task-resize-left-p1"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="gantt-task-resize-right-p1"]')).toBeFalsy();
  });

  it('locked summary gets NO resize grips even in self mode', () => {
    const { container } = renderView({
      summaryExtent: 'self',
      tasks: makeTasks({ lockedParent: true }),
      onTaskUpdate: vi.fn(),
    });
    expect(container.querySelector('[data-testid="gantt-task-resize-left-p1"]')).toBeFalsy();
  });

  it('read-only view gets NO resize grips even in self mode', () => {
    const { container } = render(
      <div style={{ width: 1280, height: 600 }}>
        <GanttView
          tasks={makeTasks()}
          startDate={new Date('2024-06-01T00:00:00.000Z')}
          endDate={new Date('2024-06-30T00:00:00.000Z')}
          summaryExtent="self"
          onTaskUpdate={vi.fn()}
          readOnly
        />
      </div>
    );
    expect(container.querySelector('[data-testid="gantt-task-resize-left-p1"]')).toBeFalsy();
  });

  it('resize-right on a summary commits ONLY the summary own end (no children)', () => {
    const onTaskUpdate = vi.fn<GanttTaskUpdate>();
    const { container } = renderView({ summaryExtent: 'self', onTaskUpdate });
    const handle = container.querySelector('[data-testid="gantt-task-resize-right-p1"]') as HTMLElement;
    expect(handle).toBeTruthy();

    // columnWidth at width>=1024 = 110 → +220px = +2 days.
    act(() => { handle.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 720)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 720)); });

    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    const [task, changes] = onTaskUpdate.mock.calls[0];
    expect(task.id).toBe('p1');
    expect(changes.start.toISOString()).toBe('2024-06-10T00:00:00.000Z');
    expect(changes.end.toISOString()).toBe('2024-06-17T00:00:00.000Z');
  });

  it('dragging the summary body still group-moves the whole subtree', () => {
    const onTaskUpdate = vi.fn<GanttTaskUpdate>();
    const { container } = renderView({ summaryExtent: 'self', onTaskUpdate });
    const bar = container.querySelector('[data-testid="gantt-summary-bar-p1"]') as HTMLElement;

    // jsdom rects are zero-width → the edge-zone resolver returns 'move',
    // exercising the middle-of-bar path. +330px → +3 days.
    act(() => { bar.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 830)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 830)); });

    expect(onTaskUpdate).toHaveBeenCalledTimes(2);
    const ids = onTaskUpdate.mock.calls.map(([t]) => t.id).sort();
    expect(ids).toEqual(['c1', 'p1']);
    const parentCall = onTaskUpdate.mock.calls.find(([t]) => t.id === 'p1')!;
    expect(parentCall[1].start.toISOString()).toBe('2024-06-13T00:00:00.000Z');
    expect(parentCall[1].end.toISOString()).toBe('2024-06-18T00:00:00.000Z');
  });

  it('summary bars grow connector dots for drag-to-link', () => {
    const { container } = renderView({
      summaryExtent: 'self',
      onTaskUpdate: vi.fn(),
      onDependencyCreate: vi.fn(),
    });
    expect(container.querySelector('[data-testid="gantt-link-dot-start-p1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="gantt-link-dot-end-p1"]')).toBeTruthy();
  });

  it('no connector dots without onDependencyCreate', () => {
    const { container } = renderView({ summaryExtent: 'self', onTaskUpdate: vi.fn() });
    expect(container.querySelector('[data-testid="gantt-link-dot-end-p1"]')).toBeFalsy();
  });
});
