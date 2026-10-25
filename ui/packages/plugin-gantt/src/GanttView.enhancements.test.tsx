/**
 * Tests for the #2460 interaction batch: row click model (单击=Focus 定位,
 * 双击/「→」=详情), day-snap dragging in coarse granularities (周/月拖拽按日吸附),
 * collapse-state persistence in 保存布局, and the locked-row tooltip hint
 * (无编辑权限).
 *
 * Conventions match the other suites: innerWidth=1280 → columnWidth 110,
 * rowHeight 40; window pointer events dispatched inside act().
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GanttView, type GanttTask, type GanttLayout } from './GanttView';

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  window.localStorage.clear();
});

function makeTask(id: string, start: string, end: string, extra: Partial<GanttTask> = {}): GanttTask {
  return { id, title: `Task ${id}`, start: new Date(start), end: new Date(end), progress: 0, ...extra };
}

const A = () => makeTask('a', '2024-06-10T00:00:00.000Z', '2024-06-15T00:00:00.000Z');

function renderView(tasks: GanttTask[], props: Partial<React.ComponentProps<typeof GanttView>> = {}) {
  return render(
    <div style={{ width: 1280, height: 600 }}>
      <GanttView
        tasks={tasks}
        startDate={new Date('2024-06-01T00:00:00.000Z')}
        endDate={new Date('2024-06-30T00:00:00.000Z')}
        {...props}
      />
    </div>
  );
}

function pointer(type: string, clientX: number, clientY = 100) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    pointerType: 'mouse',
    button: 0,
    isPrimary: true,
  } as PointerEventInit);
}

describe('GanttView row click model (单击=Focus, 双击/「→」=详情)', () => {
  it('a single row click selects the row WITHOUT opening detail', () => {
    const onTaskClick = vi.fn();
    const { getByTestId } = renderView([A()], { onTaskClick });
    const row = getByTestId('gantt-task-row-a');
    act(() => { fireEvent.click(row); });
    expect(onTaskClick).not.toHaveBeenCalled();
    expect(row.getAttribute('aria-selected')).toBe('true');
  });

  it('double-click opens detail when inline edit is unavailable', () => {
    const onTaskClick = vi.fn();
    const { getByTestId } = renderView([A()], { onTaskClick });
    act(() => { fireEvent.doubleClick(getByTestId('gantt-task-row-a')); });
    expect(onTaskClick).toHaveBeenCalledTimes(1);
    expect(onTaskClick.mock.calls[0][0].id).toBe('a');
  });

  it('double-click prefers inline edit over detail when editable', () => {
    const onTaskClick = vi.fn();
    const { getByTestId, container } = renderView([A()], {
      onTaskClick,
      onTaskUpdate: vi.fn(),
      inlineEdit: true,
    });
    act(() => { fireEvent.doubleClick(getByTestId('gantt-task-row-a')); });
    expect(onTaskClick).not.toHaveBeenCalled();
    // The title input replaces the label while editing.
    expect(container.querySelector('input[value="Task a"]')).toBeTruthy();
  });

  it('the row 「→」 button opens detail and only renders with onTaskClick', () => {
    const onTaskClick = vi.fn();
    const { getByTestId, queryByTestId: q1 } = renderView([A()], { onTaskClick });
    const openBtn = getByTestId('gantt-row-open-a');
    act(() => { fireEvent.click(openBtn); });
    expect(onTaskClick).toHaveBeenCalledTimes(1);
    expect(onTaskClick.mock.calls[0][0].id).toBe('a');
    // In-flow slot, not an absolute overlay — it must never cover the
    // end-date column (#2482).
    expect(openBtn.className).not.toContain('absolute');
    // The hover locate icon is gone: a plain row click already locates.
    expect(q1('gantt-row-locate-a')).toBeNull();

    const { queryByTestId } = renderView([makeTask('z', '2024-06-10T00:00:00.000Z', '2024-06-15T00:00:00.000Z')]);
    expect(queryByTestId('gantt-row-open-z')).toBeNull();
  });
});

describe('GanttView coarse-granularity drag snaps by DAY (周/月拖拽按日吸附)', () => {
  it('week view: +47px ≈ 3 day-steps, not a whole-week snap', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderView([A()], { onTaskUpdate, viewMode: 'week' });
    const bar = container.querySelector('[data-testid="gantt-task-bar-a"]') as HTMLElement;
    expect(bar).toBeTruthy();

    // pxPerDay = 110 / 7 ≈ 15.71; +47px → round(2.99) = +3 days. A per-column
    // snap would have produced 0 (round(47/110)) or a jump of ±7 days.
    act(() => { bar.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 547)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 547)); });

    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    const [task, changes] = onTaskUpdate.mock.calls[0];
    expect(task.id).toBe('a');
    expect(changes.start.toISOString()).toBe('2024-06-13T00:00:00.000Z');
    expect(changes.end.toISOString()).toBe('2024-06-18T00:00:00.000Z');
  });

  it('month view: +11px ≈ 3 day-steps', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderView([A()], { onTaskUpdate, viewMode: 'month' });
    const bar = container.querySelector('[data-testid="gantt-task-bar-a"]') as HTMLElement;

    // pxPerDay = 110 / 30.44 ≈ 3.61; +11px → round(3.04) = +3 days.
    act(() => { bar.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 511)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 511)); });

    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    const [, changes] = onTaskUpdate.mock.calls[0];
    expect(changes.start.toISOString()).toBe('2024-06-13T00:00:00.000Z');
    expect(changes.end.toISOString()).toBe('2024-06-18T00:00:00.000Z');
  });
});

describe('GanttView 保存布局 covers collapse state (收纳/展开)', () => {
  const TREE = () => [
    makeTask('p', '2024-06-03T00:00:00.000Z', '2024-06-20T00:00:00.000Z'),
    makeTask('c', '2024-06-05T00:00:00.000Z', '2024-06-10T00:00:00.000Z', { parent: 'p' }),
  ];

  it('persists the collapsed set on save', () => {
    const { getByTestId, queryByTestId } = renderView(TREE(), { persistLayoutKey: 'proj1' });
    expect(queryByTestId('gantt-task-row-c')).toBeTruthy();
    act(() => { fireEvent.click(getByTestId('gantt-row-toggle-p')); });
    expect(queryByTestId('gantt-task-row-c')).toBeNull();
    act(() => { fireEvent.click(getByTestId('gantt-save-layout')); });
    const saved = JSON.parse(window.localStorage.getItem('gantt-layout:proj1')!) as GanttLayout;
    expect(saved.collapsedIds).toEqual(['p']);
  });

  it('restores a persisted collapsed set on mount', () => {
    window.localStorage.setItem(
      'gantt-layout:proj2',
      JSON.stringify({ viewMode: 'day', columnWidth: null, taskListCollapsed: false, collapsedIds: ['p'] } satisfies GanttLayout),
    );
    const { getByTestId, queryByTestId } = renderView(TREE(), { persistLayoutKey: 'proj2' });
    expect(queryByTestId('gantt-task-row-c')).toBeNull();
    // Expanding again brings the child back — the restored state is live.
    act(() => { fireEvent.click(getByTestId('gantt-row-toggle-p')); });
    expect(queryByTestId('gantt-task-row-c')).toBeTruthy();
  });

  it('a saved EMPTY collapse state beats defaultCollapsedDepth', () => {
    // Control: without a snapshot, depth-0 default collapse hides the child.
    const first = renderView(TREE(), { persistLayoutKey: 'proj3', defaultCollapsedDepth: 0 });
    expect(first.queryByTestId('gantt-task-row-c')).toBeNull();
    first.unmount();

    window.localStorage.setItem(
      'gantt-layout:proj3',
      JSON.stringify({ viewMode: 'day', columnWidth: null, taskListCollapsed: false, collapsedIds: [] } satisfies GanttLayout),
    );
    const second = renderView(TREE(), { persistLayoutKey: 'proj3', defaultCollapsedDepth: 0 });
    expect(second.queryByTestId('gantt-task-row-c')).toBeTruthy();
  });
});

describe('GanttView locked-row tooltip hint (无编辑权限)', () => {
  it('shows the locked hint in the hover tooltip for locked tasks only', () => {
    const tasks = [
      makeTask('a', '2024-06-03T00:00:00.000Z', '2024-06-08T00:00:00.000Z', { locked: true }),
      makeTask('b', '2024-06-10T00:00:00.000Z', '2024-06-15T00:00:00.000Z'),
    ];
    const { container } = renderView(tasks);

    fireEvent.mouseEnter(container.querySelector('[data-testid="gantt-task-bar-a"]')!);
    const hint = container.querySelector('[data-testid="gantt-tooltip-locked-a"]') as HTMLElement;
    expect(hint).toBeTruthy();
    expect(hint.textContent).toContain('No edit permission');
    fireEvent.mouseLeave(container.querySelector('[data-testid="gantt-task-bar-a"]')!);

    fireEvent.mouseEnter(container.querySelector('[data-testid="gantt-task-bar-b"]')!);
    expect(container.querySelector('[data-testid="gantt-tooltip-locked-b"]')).toBeNull();
  });
});
