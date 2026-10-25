/**
 * Group 4 tests: read-only experience (只读体验) and mobile read-only thumbnail
 * (移动端只读缩略).
 *
 * Covers: the read-only badge, stripped write affordances (resize/progress
 * handles, undo/redo, context-menu mutations), empty-menu suppression, and the
 * `mobileReadOnly` viewport gate. innerWidth drives `isNarrow` because
 * useResizeObserver reports 0 in jsdom and the component falls back to it.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GanttView, type GanttTask } from './GanttView';

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});

function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true });
}

function makeTask(id: string, start: string, end: string, extra: Partial<GanttTask> = {}): GanttTask {
  return { id, title: `Task ${id}`, start: new Date(start), end: new Date(end), progress: 0, ...extra };
}

const TASKS = () => [
  makeTask('a', '2024-06-03T00:00:00.000Z', '2024-06-13T00:00:00.000Z', { progress: 50 }),
  makeTask('b', '2024-06-17T00:00:00.000Z', '2024-06-21T00:00:00.000Z'),
];

function renderView(props: Partial<React.ComponentProps<typeof GanttView>> = {}, width = 1280) {
  return render(
    <div style={{ width, height: 600 }}>
      <GanttView
        tasks={TASKS()}
        startDate={new Date('2024-06-01T00:00:00.000Z')}
        endDate={new Date('2024-12-30T00:00:00.000Z')}
        {...props}
      />
    </div>
  );
}

describe('GanttView read-only experience (只读体验)', () => {
  it('shows the read-only badge when readOnly', () => {
    const { getByTestId } = renderView({ readOnly: true });
    expect(getByTestId('gantt-readonly-badge')).toBeTruthy();
  });

  it('hides the badge by default (editable)', () => {
    const { queryByTestId } = renderView({ onTaskUpdate: vi.fn() });
    expect(queryByTestId('gantt-readonly-badge')).toBeNull();
  });

  it('strips resize + progress handles even when onTaskUpdate is passed', () => {
    const { queryByTestId } = renderView({ readOnly: true, onTaskUpdate: vi.fn() });
    expect(queryByTestId('gantt-task-resize-left-a')).toBeNull();
    expect(queryByTestId('gantt-task-resize-right-a')).toBeNull();
    expect(queryByTestId('gantt-progress-handle-a')).toBeNull();
  });

  it('keeps handles when editable (control)', () => {
    const { getByTestId } = renderView({ onTaskUpdate: vi.fn() });
    expect(getByTestId('gantt-task-resize-left-a')).toBeTruthy();
    expect(getByTestId('gantt-task-resize-right-a')).toBeTruthy();
  });

  it('hides the undo/redo toolbar buttons in read-only', () => {
    const { queryByTestId } = renderView({ readOnly: true, onTaskUpdate: vi.fn() });
    expect(queryByTestId('gantt-undo')).toBeNull();
    expect(queryByTestId('gantt-redo')).toBeNull();
  });

  it('marks the root with data-readonly', () => {
    const { container } = renderView({ readOnly: true });
    expect(container.querySelector('[data-readonly="true"]')).toBeTruthy();
    expect(container.querySelector('[data-mobile-readonly]')).toBeNull();
  });

  it('does not bleed write callbacks: onTaskDelete via Delete key is a no-op', () => {
    const onTaskDelete = vi.fn();
    const { getByTestId } = renderView({ readOnly: true, onTaskDelete });
    const body = getByTestId('gantt-body');
    act(() => { fireEvent.keyDown(body, { key: 'Delete' }); });
    expect(onTaskDelete).not.toHaveBeenCalled();
  });
});

describe('GanttView read-only context menu', () => {
  it('suppresses the empty menu when nothing is actionable', () => {
    // readOnly + no onTaskClick → every menu item is gated off → no popover.
    const { getByTestId, queryByTestId } = renderView({ readOnly: true });
    act(() => { fireEvent.contextMenu(getByTestId('gantt-task-bar-a')); });
    expect(queryByTestId('gantt-context-menu')).toBeNull();
  });

  it('still opens a view-only menu when onTaskClick is available', () => {
    const { getByTestId, queryByTestId } = renderView({ readOnly: true, onTaskClick: vi.fn() });
    act(() => { fireEvent.contextMenu(getByTestId('gantt-task-bar-a')); });
    expect(getByTestId('gantt-context-menu')).toBeTruthy();
    expect(getByTestId('gantt-context-menu-view')).toBeTruthy();
    // Mutation items stay gated off.
    expect(queryByTestId('gantt-context-menu-delete')).toBeNull();
    expect(queryByTestId('gantt-context-menu-add-successor')).toBeNull();
  });
});

describe('GanttView mobile read-only thumbnail (移动端只读缩略)', () => {
  it('does NOT enter read-only on a wide viewport', () => {
    const { queryByTestId, getByTestId } = renderView({ mobileReadOnly: true, onTaskUpdate: vi.fn() }, 1280);
    expect(queryByTestId('gantt-readonly-badge')).toBeNull();
    expect(getByTestId('gantt-task-resize-left-a')).toBeTruthy();
  });

  it('enters read-only on a narrow viewport', () => {
    setWidth(420);
    const { getByTestId, queryByTestId, container } = renderView(
      { mobileReadOnly: true, onTaskUpdate: vi.fn() },
      420,
    );
    expect(getByTestId('gantt-readonly-badge')).toBeTruthy();
    expect(queryByTestId('gantt-task-resize-left-a')).toBeNull();
    expect(container.querySelector('[data-mobile-readonly="true"]')).toBeTruthy();
  });

  it('leaves narrow viewports editable when mobileReadOnly is off', () => {
    setWidth(420);
    const { queryByTestId } = renderView({ mobileReadOnly: false, onTaskUpdate: vi.fn() }, 420);
    expect(queryByTestId('gantt-readonly-badge')).toBeNull();
  });
});
