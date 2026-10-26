/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10866 — `GanttView`'s own date-only reads: a marker authored as a
 * day, and the day typed into the inline editor.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * - A marker's `date` string was parsed with `new Date(m.date)`, which reads
 *   a date-only `2026-10-05` as UTC midnight: west of UTC the line stood at
 *   17:00 on October 4th, east of it at 08:00 on the 5th, never on the day's
 *   own column edge. With a business `timeZone` the string was then re-based
 *   like an instant, which moved it again.
 * - The inline editor seeds its date inputs with each bar's LOCAL day and
 *   committed them with `new Date(value)`, a UTC midnight: pressing Enter on
 *   an untouched row moved a bar to 17:00 the day before west of UTC.
 * Both reads now go through `toDisplayDate` (`@object-ui/core`, the
 * objectui#10183 convention), and a date-only marker is placed on the day in
 * the chart's calendar rather than re-based. A marker authored as an instant
 * keeps its instant: the control rows below.
 *
 * ── ⚠️ The zone cases run ONLY when driven, in a FORKS child ────────────────
 * `process.env.TZ` written inside a test of the normal run does not move the
 * zone (the root config runs `pool: 'threads'`), so the zone cases are
 * skipped there and `scripts/__tests__/date-only-zone-pins-10183.test.ts`
 * runs them on the forks pool and fails unless every one ran and passed. Each
 * zone opens with a rig case, so a child whose zone did not move reds instead
 * of going quietly green. The suite-zone cases run in the normal run too; they
 * cannot tell the repair from its absence, because UTC is the one offset where
 * the two parses agree.
 */

import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GanttView, makeTzShift, type GanttTask } from '../GanttView';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** UTC-7 in October — the card's direction. */
const WEST = 'America/Los_Angeles';
/** UTC+8 — the control. */
const EAST = 'Asia/Shanghai';

/** A fixed instant: 21:00 on the 5th in the west, 12:00 on the 6th in the east. */
const INSTANT = '2026-10-06T04:00:00.000Z';

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

function enter(zone: string): void {
  process.env.TZ = zone;
}

/** Local calendar parts of a `Date`: year, month (1-based), day, hour. */
const parts = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()];

function task(id: string, start: Date, end: Date): GanttTask {
  return { id, title: `Task ${id}`, start, end, progress: 0 };
}

function renderView(tasks: GanttTask[], props: Partial<React.ComponentProps<typeof GanttView>> = {}) {
  return render(
    <div style={{ width: 1280, height: 600 }}>
      <GanttView
        tasks={tasks}
        startDate={new Date(2026, 8, 28)}
        endDate={new Date(2026, 9, 20)}
        viewMode="day"
        {...props}
      />
    </div>,
  );
}

function leftOf(container: HTMLElement, testId: string): number {
  const el = container.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  expect(el, `no ${testId}`).not.toBeNull();
  return parseFloat(el!.style.left);
}

/**
 * The gap in px between marker 0 (`2026-10-05`) and the bar of a task starting
 * at that day's local midnight, and between marker 1 (an instant) and the bar
 * of a task starting at that instant. Both are 0 when each line stands where
 * its value says.
 */
function markerGaps(timeZone?: string): { day: number; instant: number } {
  // A chart in a business zone is handed the instant that re-bases onto the
  // day's midnight, as `ObjectGantt` does since objectui#10866.
  const dayStart = makeTzShift(timeZone).from(new Date(2026, 9, 5));
  const { container } = renderView(
    [
      task('a', dayStart, new Date(dayStart.getTime() + 2 * 86_400_000)),
      task('b', new Date(INSTANT), new Date(Date.parse(INSTANT) + 2 * 86_400_000)),
    ],
    {
      timeZone,
      markers: [
        { date: '2026-10-05', label: 'Freeze' },
        { date: INSTANT, label: 'Cutover' },
      ],
    },
  );
  // Rounded: a marker's `left` is rounded to the pixel and a bar's is not. An
  // hour is over 4px at this zoom, so any real misplacement survives it.
  const gaps = {
    day: Math.round(Math.abs(leftOf(container, 'gantt-marker-0') - leftOf(container, 'gantt-task-bar-a'))),
    instant: Math.round(Math.abs(leftOf(container, 'gantt-marker-1') - leftOf(container, 'gantt-task-bar-b'))),
  };
  cleanup();
  return gaps;
}

/** Open the inline editor on a bar, type `2026-10-07` as its start, press Enter. */
function committedStart(): Date {
  const onTaskUpdate = vi.fn();
  const { getByTestId, container } = renderView(
    [task('a', new Date(2026, 9, 5), new Date(2026, 9, 9))],
    { inlineEdit: true, onTaskUpdate },
  );
  act(() => {
    fireEvent.doubleClick(getByTestId('gantt-task-row-a'));
  });
  const startInput = container.querySelector('[data-testid="gantt-row-start-a"] input') as HTMLInputElement;
  expect(startInput, 'the start date input').not.toBeNull();
  expect(startInput.value).toBe('2026-10-05');
  act(() => {
    fireEvent.change(startInput, { target: { value: '2026-10-07' } });
  });
  const titleInput = container.querySelector('input[value="Task a"]') as HTMLInputElement;
  act(() => {
    fireEvent.keyDown(titleInput, { key: 'Enter' });
  });
  expect(onTaskUpdate).toHaveBeenCalledTimes(1);
  const start = onTaskUpdate.mock.calls[0][1].start as Date;
  cleanup();
  return start;
}

describe('GanttView date-only reads, in the suite zone (objectui#10866)', () => {
  it('a date-only marker stands on its day, an instant marker on its instant', () => {
    expect(markerGaps()).toEqual({ day: 0, instant: 0 });
  });

  it('the inline editor commits the typed day at local midnight', () => {
    expect(parts(committedStart())).toEqual([2026, 10, 7, 0]);
  });
});

function zoneCases(zone: string, chartZone: string, instantHour: number) {
  it('rig: the zone really moved', () => {
    enter(zone);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
    expect(new Date(INSTANT).getHours()).toBe(instantHour);
  });

  it('a `2026-10-05` marker stands on the day its bar starts; an instant marker on its instant', () => {
    enter(zone);
    expect(markerGaps()).toEqual({ day: 0, instant: 0 });
  });

  it(`in a chart zoned ${chartZone}, the day marker still stands on the day, not re-based`, () => {
    enter(zone);
    expect(markerGaps(chartZone)).toEqual({ day: 0, instant: 0 });
  });

  it('typing `2026-10-07` inline commits the 7th at local midnight', () => {
    enter(zone);
    expect(parts(committedStart())).toEqual([2026, 10, 7, 0]);
  });
}

describe.runIf(DRIVEN)('GanttView date-only reads west of UTC (objectui#10866)', () => {
  zoneCases(WEST, EAST, 21);

  it('fixture validity: the engine parse of the string lands on the day before here', () => {
    enter(WEST);
    expect(new Date('2026-10-05').getDate()).toBe(4);
  });
});

describe.runIf(DRIVEN)('GanttView date-only reads east of UTC, the control (objectui#10866)', () => {
  zoneCases(EAST, WEST, 12);
});
