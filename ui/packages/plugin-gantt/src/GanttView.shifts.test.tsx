/**
 * Shift segmentation (班次/排班分段) rendering + drag tests for GanttView.
 *
 * When a normalized shift config is supplied AND the scale is `day`, each day
 * column is replaced by one column per band (白班 | 夜班), the upper header tier
 * shows the 排班日 (shift-day starting at `dayStart`, e.g. 08:00), and a
 * cross-midnight 夜班 sits wholly inside its shift-day's columns. Drag snaps to
 * band boundaries (half-day steps) instead of whole days. The suite also guards
 * that segmenting is gated to day mode and is a no-op without a config.
 *
 * Dates use the LOCAL Date constructor so shiftDayStart (local time-of-day math)
 * is deterministic regardless of the runner's timezone.
 */
import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { GanttView, type GanttTask } from './GanttView';
import { normalizeShiftSegments } from './shifts';

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});

const COLUMN_WIDTH = 110; // one shift-day (24h) at 1280px container
const HOUR = 60 * 60 * 1000;

const d = (y: number, m: number, day: number, h = 0, min = 0) =>
  new Date(y, m - 1, day, h, min);

const SHIFTS = normalizeShiftSegments({
  dayStart: '08:00',
  bands: [
    { key: 'day', label: '白班', start: '08:00', end: '20:00' },
    { key: 'night', label: '夜班', start: '20:00', end: '08:00' },
  ],
})!;

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
        endDate={d(2024, 6, 10)}
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

function groupCells(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll('[data-testid="gantt-header-groups"] > div'),
  ) as HTMLElement[];
}

function unitLabels(container: HTMLElement): string[] {
  return unitCells(container).map((u) => (u.textContent || '').trim());
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

describe('GanttView shift segmentation', () => {
  it('splits each day into 白班 | 夜班 band columns', () => {
    const task = makeTask('a', d(2024, 6, 4, 8), d(2024, 6, 4, 20));
    const plain = renderView([task]);
    const shifted = renderView([task], { shiftSegments: SHIFTS });

    // Two band columns per shift-day → materially more cells than the plain axis.
    expect(unitCells(shifted.container).length).toBeGreaterThan(unitCells(plain.container).length);

    const labels = unitLabels(shifted.container);
    expect(labels[0]).toBe('白班');
    expect(labels[1]).toBe('夜班');
    expect(labels[2]).toBe('白班');
    expect(labels[3]).toBe('夜班');
    // Each band is half a shift-day wide.
    expect(parseFloat(unitCells(shifted.container)[0].style.width)).toBeCloseTo(COLUMN_WIDTH / 2, 0);
  });

  it('groups the two bands under one 排班日 header cell', () => {
    const { container } = renderView([makeTask('a', d(2024, 6, 4, 8), d(2024, 6, 4, 20))], {
      shiftSegments: SHIFTS,
    });
    const groups = groupCells(container);
    // One day-tier cell per shift-day, each spanning its two bands (full day wide).
    expect(groups.length).toBeGreaterThan(1);
    expect(parseFloat(groups[0].style.width)).toBeCloseTo(COLUMN_WIDTH, 0);
  });

  it('sizes a 白班 (12h) bar to one band and a full day to two', () => {
    const dayBar = renderView([makeTask('a', d(2024, 6, 4, 8), d(2024, 6, 4, 20))], {
      shiftSegments: SHIFTS,
    });
    const fullBar = renderView([makeTask('a', d(2024, 6, 4, 8), d(2024, 6, 5, 8))], {
      shiftSegments: SHIFTS,
    });
    expect(barGeometry(dayBar.container, 'a').width).toBeCloseTo(COLUMN_WIDTH / 2, 0);
    expect(barGeometry(fullBar.container, 'a').width).toBeCloseTo(COLUMN_WIDTH, 0);
  });

  it('places a cross-midnight 夜班 in the second band of its shift-day', () => {
    // 夜班 6/4 20:00 → 6/5 08:00 belongs to the 6/4 shift-day (by start).
    const dayBar = barGeometry(
      renderView([makeTask('a', d(2024, 6, 4, 8), d(2024, 6, 4, 20))], { shiftSegments: SHIFTS })
        .container,
      'a',
    );
    const nightBar = barGeometry(
      renderView([makeTask('a', d(2024, 6, 4, 20), d(2024, 6, 5, 8))], { shiftSegments: SHIFTS })
        .container,
      'a',
    );
    // Night sits directly after the day band, same width.
    expect(nightBar.width).toBeCloseTo(COLUMN_WIDTH / 2, 0);
    expect(nightBar.left - dayBar.left).toBeCloseTo(COLUMN_WIDTH / 2, 0);
  });

  it('drag snaps by one band (12h), not a whole day', () => {
    let captured: { start: Date; end: Date } | null = null;
    const task = makeTask('a', d(2024, 6, 4, 8), d(2024, 6, 4, 20)); // 白班
    const { container } = renderView([task], {
      shiftSegments: SHIFTS,
      onTaskUpdate: (_t, changes) => {
        captured = changes as { start: Date; end: Date };
      },
    });

    const bar = container.querySelector('[data-testid="gantt-task-bar-a"]') as HTMLElement;
    act(() => { bar.dispatchEvent(pointer('pointerdown', 300)); });
    // +55px = one band = +12h: 白班 6/4 08:00 → 夜班 6/4 20:00.
    act(() => { window.dispatchEvent(pointer('pointermove', 355)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 355)); });

    expect(captured).not.toBeNull();
    expect(captured!.start.getTime() - task.start.getTime()).toBe(12 * HOUR);
  });

  it('draws a dashed calendar-midnight marker inside the cross-midnight 夜班', () => {
    const { container } = renderView([makeTask('a', d(2024, 6, 4, 20), d(2024, 6, 5, 8))], {
      shiftSegments: SHIFTS,
    });
    const marks = Array.from(
      container.querySelectorAll('[data-testid^="gantt-midnight-"]'),
    ) as HTMLElement[];
    expect(marks.length).toBeGreaterThan(0);
    // 0:00 falls 4h into the 12h 夜班 band → 1/3 of the way across a half-day
    // column, which itself begins half a shift-day in.
    const first = Math.min(...marks.map((m) => parseFloat(m.style.left)));
    expect(first).toBeCloseTo(COLUMN_WIDTH / 2 + (COLUMN_WIDTH / 2) * (4 / 12), 0);
  });

  it('hides the midnight marker when showMidnight is false', () => {
    const noMid = normalizeShiftSegments({
      dayStart: '08:00',
      showMidnight: false,
      bands: [
        { key: 'day', label: '白班', start: '08:00', end: '20:00' },
        { key: 'night', label: '夜班', start: '20:00', end: '08:00' },
      ],
    })!;
    const { container } = renderView([makeTask('a', d(2024, 6, 4, 20), d(2024, 6, 5, 8))], {
      shiftSegments: noMid,
    });
    expect(container.querySelectorAll('[data-testid^="gantt-midnight-"]').length).toBe(0);
  });

  it('renders no midnight markers without a shift config', () => {
    const { container } = renderView([makeTask('a', d(2024, 6, 4, 0), d(2024, 6, 6, 0))]);
    expect(container.querySelectorAll('[data-testid^="gantt-midnight-"]').length).toBe(0);
  });

  it('does not segment outside day mode', () => {
    const task = makeTask('a', d(2024, 6, 4, 8), d(2024, 6, 6, 8));
    const plain = renderView([task], { viewMode: 'week' });
    const withShifts = renderView([task], { viewMode: 'week', shiftSegments: SHIFTS });
    expect(unitCells(withShifts.container).length).toBe(unitCells(plain.container).length);
    expect(unitLabels(withShifts.container)).not.toContain('白班');
  });

  it('is a no-op when no shift config is supplied (regression guard)', () => {
    const task = makeTask('a', d(2024, 6, 4, 0), d(2024, 6, 6, 0));
    const a = renderView([task]);
    const b = renderView([task], { shiftSegments: null });
    expect(unitCells(a.container).length).toBe(unitCells(b.container).length);
    expect(barGeometry(a.container, 'a').width).toBeCloseTo(barGeometry(b.container, 'a').width, 0);
  });
});
