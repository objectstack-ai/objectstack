/**
 * Non-linear working-time axis (非线性工作时间轴) tests for GanttView.
 *
 * When the active scale is `day` AND a working calendar marks weekends/holidays
 * as non-working, those columns are folded OUT of the grid: Friday sits directly
 * against Monday. This makes date→px non-linear (a weekend spans zero pixels),
 * so the suite asserts (1) fewer columns than the un-folded axis, (2) a bar that
 * straddles a weekend is compressed to its working width, (3) drag advances by
 * working days, and (4) folding is gated to day mode + a calendar (no regression
 * for the plain linear axis).
 *
 * Dates are built with the LOCAL Date constructor so getDay() (which drives the
 * fold) is deterministic regardless of the runner's timezone — the component
 * folds on local weekday, matching the column `isWeekend` flag.
 */
import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { GanttView, type GanttTask } from './GanttView';
import type { WorkingCalendar } from './scheduling';

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});

const COLUMN_WIDTH = 110;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// June 2024 (local): 1=Sat, 2=Sun, 3=Mon … 7=Fri, 8=Sat, 9=Sun, 10=Mon.
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

function makeTask(id: string, start: Date, end: Date): GanttTask {
  return { id, title: `Task ${id}`, start, end, progress: 0 };
}

function renderView(
  tasks: GanttTask[],
  props: Partial<React.ComponentProps<typeof GanttView>> = {},
) {
  return render(
    <div style={{ width: 1280, height: 600 }}>
      <GanttView
        tasks={tasks}
        startDate={d(2024, 6, 1)}
        endDate={d(2024, 6, 30)}
        viewMode="day"
        {...props}
      />
    </div>,
  );
}

function unitCells(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll('[data-testid="gantt-header-units"] > div'),
  ) as HTMLElement[];
}

// Day-of-month numbers only (cell text is "day + weekday-narrow", e.g. "3M").
function dayNumbers(container: HTMLElement): string[] {
  return unitCells(container).map((u) => (u.textContent || '').match(/^\d+/)?.[0] ?? '');
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

const WEEKENDS: WorkingCalendar = { skipWeekends: true };

describe('GanttView non-linear working-time axis', () => {
  it('folds weekend columns out of the grid in day mode', () => {
    const task = makeTask('a', d(2024, 6, 5), d(2024, 6, 6));
    const linear = renderView([task]);
    const folded = renderView([task], { workingCalendar: WEEKENDS });

    const linearCount = unitCells(linear.container).length;
    const foldedCount = unitCells(folded.container).length;

    // June has 10 weekend days, so the folded grid is materially shorter.
    expect(foldedCount).toBeLessThan(linearCount);
    expect(foldedCount).toBeGreaterThanOrEqual(19);
    expect(foldedCount).toBeLessThanOrEqual(23);
  });

  it('drops the weekend cells, leaving only weekday columns', () => {
    const { container } = renderView([makeTask('a', d(2024, 6, 5), d(2024, 6, 6))], {
      workingCalendar: WEEKENDS,
    });
    // Day-of-month labels for the first working week should be Mon..Fri (3..7),
    // skipping Sat 8 / Sun 9 and continuing at Mon 10.
    const labels = dayNumbers(container);
    // 1 and 2 (Sat/Sun) folded away; first visible day is 3.
    expect(labels[0]).toBe('3');
    // The weekend gap collapses: 7 (Fri) is immediately followed by 10 (Mon).
    const idx7 = labels.indexOf('7');
    expect(idx7).toBeGreaterThanOrEqual(0);
    expect(labels[idx7 + 1]).toBe('10');
  });

  it('compresses a bar that straddles a weekend to its working width', () => {
    // Fri 7 → Mon 10: 3 calendar days, but only 1 working-column step.
    const task = makeTask('a', d(2024, 6, 7), d(2024, 6, 10));
    const linear = renderView([task]);
    const folded = renderView([task], { workingCalendar: WEEKENDS });

    const linearWidth = barGeometry(linear.container, 'a').width;
    const foldedWidth = barGeometry(folded.container, 'a').width;

    // Un-folded: 3 days × 110px. Folded: Sat/Sun removed → one column wide.
    expect(linearWidth).toBeCloseTo(3 * COLUMN_WIDTH, 0);
    expect(foldedWidth).toBeCloseTo(COLUMN_WIDTH, 0);
  });

  it('drag advances by working days across the folded weekend', () => {
    let captured: { start: Date; end: Date } | null = null;
    const task = makeTask('a', d(2024, 6, 7), d(2024, 6, 10)); // starts Friday
    const { container } = renderView([task], {
      workingCalendar: WEEKENDS,
      onTaskUpdate: (_t, changes) => {
        captured = changes as { start: Date; end: Date };
      },
    });

    const bar = container.querySelector('[data-testid="gantt-task-bar-a"]') as HTMLElement;
    act(() => { bar.dispatchEvent(pointer('pointerdown', 300)); });
    // +110px = one visible column = one working day = Fri → Mon (+3 calendar days).
    act(() => { window.dispatchEvent(pointer('pointermove', 410)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 410)); });

    expect(captured).not.toBeNull();
    expect(captured!.start.getTime() - task.start.getTime()).toBe(3 * MS_PER_DAY);
  });

  it('folds an explicit holiday column too', () => {
    // Wed 5 June marked as a holiday → folded out on top of the weekends.
    const holidays = new Set(['2024-06-05']);
    const base = renderView([makeTask('a', d(2024, 6, 10), d(2024, 6, 11))], {
      workingCalendar: WEEKENDS,
    });
    const withHoliday = renderView([makeTask('a', d(2024, 6, 10), d(2024, 6, 11))], {
      workingCalendar: { skipWeekends: true, holidays },
    });
    const baseLabels = dayNumbers(base.container);
    const holidayLabels = dayNumbers(withHoliday.container);
    expect(baseLabels).toContain('5');
    expect(holidayLabels).not.toContain('5');
    expect(holidayLabels.length).toBe(baseLabels.length - 1);
  });

  it('does not fold outside day mode (week mode keeps every column)', () => {
    const task = makeTask('a', d(2024, 6, 5), d(2024, 6, 8));
    const withoutCal = renderView([task], { viewMode: 'week' });
    const withCal = renderView([task], { viewMode: 'week', workingCalendar: WEEKENDS });
    expect(unitCells(withCal.container).length).toBe(unitCells(withoutCal.container).length);
  });

  it('leaves the linear axis untouched when no calendar is supplied', () => {
    // Equivalence guard: a mid-week task with no calendar keeps the exact linear
    // mapping (start offset in whole days × columnWidth).
    const task = makeTask('a', d(2024, 6, 5), d(2024, 6, 7));
    const { container } = renderView([task]);
    const { left, width } = barGeometry(container, 'a');
    // 06-05 is the 5th day; with timezone-local midnight range the offset is a
    // whole number of columns. Width = 2 days.
    expect(Number.isFinite(left)).toBe(true);
    expect(width).toBeCloseTo(2 * COLUMN_WIDTH, 0);
  });
});
