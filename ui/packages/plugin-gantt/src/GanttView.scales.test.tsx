/**
 * Time-scale (viewMode) tests for GanttView.
 *
 * Geometry strategy mirrors GanttView.links.test.tsx: pixel positions depend
 * on the local timezone (timelineRange normalizes to local midnight), so we
 * recompute expectations with the same linear ms→px mapping the component
 * uses (pxPerDay = columnWidth / nominal days per unit) instead of asserting
 * hardcoded offsets.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
// `MS_PER_DAY` and `NOMINAL_DAYS` are IMPORTED, not re-declared. This file used
// to carry hand-written copies of both, under a header claiming it recomputes
// expectations with "the same linear ms→px mapping the component uses" — and
// the copy had already drifted: `NOMINAL_DAYS` gained a `year` entry in
// `GanttView.tsx` that the fork never grew. Nothing noticed, because nothing
// compiled this file. Importing makes the header's "same" true by construction
// instead of by hand (objectui#4040, the fork shape of objectui#3009).
import {
  GanttView,
  MS_PER_DAY,
  NOMINAL_DAYS,
  type GanttTask,
} from './GanttView';

// Force the container width to >=1024 so columnWidth=110 (deterministic).
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});

const COLUMN_WIDTH = 110;

function makeTask(id: string, start: string, end: string): GanttTask {
  return { id, title: `Task ${id}`, start: new Date(start), end: new Date(end), progress: 0 };
}

function renderView(
  tasks: GanttTask[],
  props: Partial<React.ComponentProps<typeof GanttView>> = {},
) {
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

function unitCells(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll('[data-testid="gantt-header-units"] > div'),
  ) as HTMLElement[];
}

function groupCells(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll('[data-testid="gantt-header-groups"] > div'),
  ) as HTMLElement[];
}

function barGeometry(container: HTMLElement, id: string) {
  const bar = container.querySelector(`[data-testid="gantt-task-bar-${id}"]`) as HTMLElement;
  expect(bar).toBeTruthy();
  return { left: parseFloat(bar.style.left), width: parseFloat(bar.style.width) };
}

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

describe('GanttView time scales', () => {
  it('defaults to day mode: one column per day with a month group header', () => {
    const { container } = renderView([
      makeTask('a', '2024-06-05T00:00:00.000Z', '2024-06-08T00:00:00.000Z'),
    ]);
    const units = unitCells(container);
    // 2024-06-01..06-30 spans 30 columns (±1 for timezone shift of the range edges).
    expect(units.length).toBeGreaterThanOrEqual(29);
    expect(units.length).toBeLessThanOrEqual(31);
    expect(parseFloat(units[0].style.width)).toBeCloseTo(COLUMN_WIDTH, 5);
    // Day numbers are sequential.
    const labels = units.slice(0, 3).map((u) => u.textContent || '');
    expect(labels[0]).toMatch(/\d+/);
    // Group row shows month + year.
    const groups = groupCells(container);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups[0].textContent).toMatch(/2024/);
  });

  it('week mode: one column per week, snapped to Monday, columnWidth wide', () => {
    const { container } = renderView(
      [makeTask('a', '2024-06-05T00:00:00.000Z', '2024-06-08T00:00:00.000Z')],
      { viewMode: 'week' },
    );
    const units = unitCells(container);
    // ~30 days ≈ 5 weeks (+1 for boundary snap).
    expect(units.length).toBeGreaterThanOrEqual(5);
    expect(units.length).toBeLessThanOrEqual(6);
    for (const u of units) {
      expect(parseFloat(u.style.width)).toBeCloseTo(COLUMN_WIDTH, 5);
    }
  });

  it('month mode: month-name columns grouped by year, calendar-proportional widths', () => {
    const { container } = renderView(
      [makeTask('a', '2024-06-05T00:00:00.000Z', '2024-08-20T00:00:00.000Z')],
      {
        viewMode: 'month',
        startDate: new Date('2024-06-01T00:00:00.000Z'),
        endDate: new Date('2024-08-31T00:00:00.000Z'),
      },
    );
    const units = unitCells(container);
    expect(units.length).toBeGreaterThanOrEqual(3);
    expect(units.length).toBeLessThanOrEqual(4);
    // June (30 days) column width = 30 * 110/30.44.
    const pxPerDay = COLUMN_WIDTH / NOMINAL_DAYS.month;
    const first = units[0];
    const days = Math.round(parseFloat(first.style.width) / pxPerDay);
    expect([30, 31]).toContain(days);
    const groups = groupCells(container);
    expect(groups.length).toBe(1);
    expect(groups[0].textContent).toContain('2024');
  });

  it('quarter mode: Q-labels grouped by year', () => {
    const { container } = renderView(
      [makeTask('a', '2024-06-05T00:00:00.000Z', '2024-11-20T00:00:00.000Z')],
      {
        viewMode: 'quarter',
        startDate: new Date('2024-04-10T00:00:00.000Z'),
        endDate: new Date('2024-11-30T00:00:00.000Z'),
      },
    );
    const units = unitCells(container);
    const labels = units.map((u) => u.textContent || '');
    expect(labels.some((l) => /^Q[1-4]$/.test(l))).toBe(true);
    expect(groupCells(container)[0].textContent).toContain('2024');
  });

  it('bar geometry uses the granularity pxPerDay (month mode)', () => {
    const start = '2024-06-05T00:00:00.000Z';
    const end = '2024-06-25T00:00:00.000Z';
    const { container } = renderView([makeTask('a', start, end)], {
      viewMode: 'month',
      startDate: new Date('2024-06-01T00:00:00.000Z'),
      endDate: new Date('2024-08-31T00:00:00.000Z'),
    });
    const pxPerDay = COLUMN_WIDTH / NOMINAL_DAYS.month;
    const { width } = barGeometry(container, 'a');
    const durationDays = (new Date(end).getTime() - new Date(start).getTime()) / MS_PER_DAY;
    expect(width).toBeCloseTo(durationDays * pxPerDay, 1);
  });

  it('toolbar segmented control switches the scale and fires onViewChange', () => {
    const onViewChange = vi.fn();
    const { container } = renderView(
      [makeTask('a', '2024-06-05T00:00:00.000Z', '2024-06-08T00:00:00.000Z')],
      { onViewChange },
    );
    const dayCount = unitCells(container).length;
    fireEvent.click(container.querySelector('[data-testid="gantt-view-mode-week"]')!);
    expect(onViewChange).toHaveBeenCalledWith('week');
    const weekCount = unitCells(container).length;
    expect(weekCount).toBeLessThan(dayCount);
    expect(
      container
        .querySelector('[data-testid="gantt-view-mode-week"]')!
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('week mode drag snaps to whole weeks', () => {
    const onTaskUpdate = vi.fn();
    const task = makeTask('a', '2024-06-05T00:00:00.000Z', '2024-06-08T00:00:00.000Z');
    const { container } = renderView([task], { viewMode: 'week', onTaskUpdate });

    const bar = container.querySelector('[data-testid="gantt-task-bar-a"]') as HTMLElement;
    act(() => { bar.dispatchEvent(pointer('pointerdown', 300)); });
    // +110px = one column = one week.
    act(() => { window.dispatchEvent(pointer('pointermove', 410)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 410)); });

    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    const [, changes] = onTaskUpdate.mock.calls[0];
    expect(changes.start.getTime() - task.start.getTime()).toBe(7 * MS_PER_DAY);
    expect(changes.end.getTime() - task.end.getTime()).toBe(7 * MS_PER_DAY);
  });

  it('month mode drag moves by one calendar month preserving duration', () => {
    const onTaskUpdate = vi.fn();
    const task = makeTask('a', '2024-06-05T00:00:00.000Z', '2024-06-15T00:00:00.000Z');
    const { container } = renderView([task], {
      viewMode: 'month',
      startDate: new Date('2024-06-01T00:00:00.000Z'),
      endDate: new Date('2024-09-30T00:00:00.000Z'),
      onTaskUpdate,
    });

    const bar = container.querySelector('[data-testid="gantt-task-bar-a"]') as HTMLElement;
    act(() => { bar.dispatchEvent(pointer('pointerdown', 300)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 410)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 410)); });

    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    const [, changes] = onTaskUpdate.mock.calls[0];
    // Start shifted by one calendar month (same day-of-month)…
    expect(changes.start.getMonth()).toBe((task.start.getMonth() + 1) % 12);
    expect(changes.start.getDate()).toBe(task.start.getDate());
    // …and duration is preserved exactly.
    expect(changes.end.getTime() - changes.start.getTime()).toBe(
      task.end.getTime() - task.start.getTime(),
    );
  });
});
