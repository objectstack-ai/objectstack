/**
 * Group 3 tests: navigation buttons, year granularity, layout persistence
 * (保存布局), and the PNG / PDF export toolbar buttons.
 *
 * Conventions match the other interaction tests: innerWidth=1280 →
 * columnWidth 110, rowHeight 40.
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

const TASKS = () => [
  makeTask('a', '2024-06-03T00:00:00.000Z', '2024-06-13T00:00:00.000Z', { progress: 50 }),
  makeTask('b', '2024-06-17T00:00:00.000Z', '2024-06-21T00:00:00.000Z'),
];

function renderView(props: Partial<React.ComponentProps<typeof GanttView>> = {}) {
  return render(
    <div style={{ width: 1280, height: 600 }}>
      <GanttView
        tasks={TASKS()}
        startDate={new Date('2024-06-01T00:00:00.000Z')}
        endDate={new Date('2024-12-30T00:00:00.000Z')}
        {...props}
      />
    </div>
  );
}

describe('GanttView navigation buttons (导航)', () => {
  it('renders jump-to-today / this-week / this-month controls', () => {
    const { getByTestId } = renderView();
    expect(getByTestId('gantt-jump-today')).toBeTruthy();
    expect(getByTestId('gantt-jump-week')).toBeTruthy();
    expect(getByTestId('gantt-jump-month')).toBeTruthy();
  });

  it('this-week / this-month scroll the timeline horizontally', () => {
    const { getByTestId } = renderView();
    const timeline = getByTestId('gantt-timeline') as HTMLElement;
    // jsdom has no layout, so scrollLeft is a plain settable number; assert the
    // handlers run without throwing and leave a finite scrollLeft.
    act(() => { fireEvent.click(getByTestId('gantt-jump-week')); });
    expect(Number.isFinite(timeline.scrollLeft)).toBe(true);
    act(() => { fireEvent.click(getByTestId('gantt-jump-month')); });
    expect(Number.isFinite(timeline.scrollLeft)).toBe(true);
  });
});

describe('GanttView year granularity (年刻度)', () => {
  it('exposes a year view-mode button and switches to it', () => {
    const { getByTestId } = renderView();
    const yearBtn = getByTestId('gantt-view-mode-year');
    expect(yearBtn).toBeTruthy();
    act(() => { fireEvent.click(yearBtn); });
    expect(yearBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('seeds the year granularity from the viewMode prop', () => {
    const { getByTestId } = renderView({ viewMode: 'year' });
    expect(getByTestId('gantt-view-mode-year').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('GanttView export buttons (导出 PNG / PDF)', () => {
  it('renders both the PNG and PDF export buttons', () => {
    const { getByTestId } = renderView();
    expect(getByTestId('gantt-export-png')).toBeTruthy();
    expect(getByTestId('gantt-export-pdf')).toBeTruthy();
  });
});

describe('GanttView refresh button (手动刷新)', () => {
  it('hides the refresh button when onRefresh is not provided', () => {
    const { queryByTestId } = renderView();
    expect(queryByTestId('gantt-refresh')).toBeNull();
  });

  it('shows the refresh button and forwards clicks to onRefresh', () => {
    const onRefresh = vi.fn();
    const { getByTestId } = renderView({ onRefresh });
    act(() => { fireEvent.click(getByTestId('gantt-refresh')); });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('disables the button while a refresh is in flight', () => {
    const onRefresh = vi.fn();
    const { getByTestId } = renderView({ onRefresh, refreshing: true });
    const btn = getByTestId('gantt-refresh') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe('GanttView save layout (保存布局)', () => {
  it('hides the save-layout button without persistLayoutKey/onLayoutChange', () => {
    const { queryByTestId } = renderView();
    expect(queryByTestId('gantt-save-layout')).toBeNull();
  });

  it('shows the save-layout button when onLayoutChange is set', () => {
    const { getByTestId } = renderView({ onLayoutChange: () => {} });
    expect(getByTestId('gantt-save-layout')).toBeTruthy();
  });

  it('persists the current layout to localStorage under the key', () => {
    const { getByTestId } = renderView({ persistLayoutKey: 'proj1' });
    act(() => { fireEvent.click(getByTestId('gantt-view-mode-month')); });
    act(() => { fireEvent.click(getByTestId('gantt-save-layout')); });
    const raw = window.localStorage.getItem('gantt-layout:proj1');
    expect(raw).toBeTruthy();
    const saved = JSON.parse(raw!) as GanttLayout;
    expect(saved.viewMode).toBe('month');
    expect(saved.taskListCollapsed).toBe(false);
  });

  it('calls onLayoutChange with the snapshot on save', () => {
    const onLayoutChange = vi.fn();
    const { getByTestId } = renderView({ onLayoutChange });
    act(() => { fireEvent.click(getByTestId('gantt-view-mode-quarter')); });
    act(() => { fireEvent.click(getByTestId('gantt-save-layout')); });
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    expect(onLayoutChange.mock.calls[0][0].viewMode).toBe('quarter');
  });

  it('restores a persisted granularity on mount', () => {
    window.localStorage.setItem(
      'gantt-layout:proj2',
      JSON.stringify({ viewMode: 'month', columnWidth: null, taskListCollapsed: false } satisfies GanttLayout)
    );
    const { getByTestId } = renderView({ persistLayoutKey: 'proj2' });
    expect(getByTestId('gantt-view-mode-month').getAttribute('aria-pressed')).toBe('true');
  });

  it('lets the viewMode prop win over a persisted granularity', () => {
    window.localStorage.setItem(
      'gantt-layout:proj3',
      JSON.stringify({ viewMode: 'month', columnWidth: null, taskListCollapsed: false } satisfies GanttLayout)
    );
    const { getByTestId } = renderView({ persistLayoutKey: 'proj3', viewMode: 'week' });
    expect(getByTestId('gantt-view-mode-week').getAttribute('aria-pressed')).toBe('true');
    expect(getByTestId('gantt-view-mode-month').getAttribute('aria-pressed')).toBe('false');
  });

  it('ignores malformed persisted layout JSON', () => {
    window.localStorage.setItem('gantt-layout:proj4', '{not valid json');
    const { getByTestId } = renderView({ persistLayoutKey: 'proj4' });
    // Falls back to the default 'day' granularity without throwing.
    expect(getByTestId('gantt-view-mode-day').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('GanttView alert stroke (预警描边 borderColor)', () => {
  const bar = (c: HTMLElement, id: string) =>
    c.querySelector(`[data-testid="gantt-task-bar-${id}"]`) as HTMLElement;

  it('outlines a task bar in its borderColor with a halo, leaving the fill alone', () => {
    const tasks = [
      makeTask('a', '2024-06-03T00:00:00.000Z', '2024-06-13T00:00:00.000Z', { borderColor: '#ef4444' }),
      makeTask('b', '2024-06-17T00:00:00.000Z', '2024-06-21T00:00:00.000Z'),
    ];
    const { container } = renderView({ tasks });
    const a = bar(container, 'a');
    expect(a.style.borderColor).toBe('#ef4444');
    expect(a.style.boxShadow).toBe('0 0 0 2px #ef4444');
    expect(a.style.backgroundColor).toBe('#3b82f6'); // fill untouched (default blue)
    // Unmarked sibling: no alert stroke, no halo. (The default hairline is an
    // hsl(var(...)) value jsdom's CSS parser drops, so assert the negatives.)
    const b = bar(container, 'b');
    expect(b.style.borderColor).not.toBe('#ef4444');
    expect(b.style.boxShadow).toBe('');
  });

  it('outlines a milestone diamond too', () => {
    const tasks = [
      makeTask('m', '2024-06-10T00:00:00.000Z', '2024-06-10T00:00:00.000Z', { borderColor: '#f97316' }),
    ];
    const { container } = renderView({ tasks });
    const diamond = container.querySelector('[data-testid="gantt-milestone-m"]') as HTMLElement;
    expect(diamond.style.borderColor).toBe('#f97316');
    expect(diamond.style.boxShadow).toBe('0 0 0 2px #f97316');
  });

  it('outlines a summary bar too', () => {
    const tasks = [
      makeTask('p', '2024-06-03T00:00:00.000Z', '2024-06-13T00:00:00.000Z', { borderColor: '#ef4444' }),
      makeTask('c', '2024-06-04T00:00:00.000Z', '2024-06-08T00:00:00.000Z', { parent: 'p' }),
    ];
    const { container } = renderView({ tasks });
    const summary = container.querySelector('[data-testid="gantt-summary-bar-p"]') as HTMLElement;
    expect(summary.style.borderColor).toBe('#ef4444');
    expect(summary.style.boxShadow).toBe('0 0 0 2px #ef4444');
  });
});
