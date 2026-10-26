/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10866, slice 6 — a gantt drag moves a task by calendar days and
 * keeps each value's wall-clock time, across the viewer's DST change.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * On every day-and-coarser scale a drag snaps to whole days. The start already
 * moved by calendar days (`setDate` on a copy, which keeps the wall-clock
 * time), but a move then carried the END by the elapsed milliseconds of the
 * start's move, and a summary's group move carried every descendant by that
 * same span. Across a DST change of the viewer's zone that span is a whole
 * number of days plus or minus an hour, so any value that crossed the change
 * when the start did not (or the reverse) landed an hour off. In
 * `America/Los_Angeles` a `date` task from October 29th to October 31st moved
 * three days ended at 23:00 on November 2nd, so `ObjectGantt` wrote
 * `end_date: '2026-11-02'` where the drop reads the 3rd; a `datetime` end
 * shifted its wall-clock time by an hour; a descendant of a moved summary
 * started the day before its drop. The one-day floor of an edge drag was
 * the same arithmetic: `start ± 24 h` across a change is 23:00 of the day
 * before, or 01:00.
 *
 * objectui#11005's ruling B, inherited by this card: a move shifts a value by
 * calendar days and keeps its wall-clock time, for every value, `move` and
 * `resize-end` alike ("the user moved an event to a day, not by a number of
 * milliseconds"). The drag now counts the calendar days its snapped start
 * moved and moves every value by that count with `setDate`, and the one-day
 * floor is one calendar day. `Asia/Shanghai` keeps no DST: its rows are the
 * control and passed before the repair, as did every start and the plain end
 * drag (`resize-right`, already `setDate`).
 *
 * ⚠️ The shift-band scale (`shiftSegments` in day view) is NOT covered here: a
 * drag there moves by bands on an elapsed-time axis, which the ruling's reason
 * does not decide, so it is left as it was.
 *
 * ── ⚠️ The zone cases run ONLY when driven, in a FORKS child ────────────────
 * `process.env.TZ` written inside a test of the normal run does not move the
 * zone (the root config runs `pool: 'threads'`), so the zone cases are
 * skipped there and `scripts/__tests__/date-only-zone-pins-10183.test.ts`
 * runs them on the forks pool and fails unless every one ran and passed. Each
 * zone opens with a rig case, so a child whose zone did not move reds instead
 * of going quietly green. The suite-zone cases run in the normal run too; they
 * cannot tell the repair from its absence, because UTC keeps no DST.
 */

import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from '@object-ui/types';
import { GanttView, type GanttTask, type GanttViewMode } from '../GanttView';
import { ObjectGantt } from '../ObjectGantt';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** Falls back at 09:00Z on November 1st and springs forward at 10:00Z on March 8th, 2026. */
const WEST = 'America/Los_Angeles';
/** No DST — the control. */
const EAST = 'Asia/Shanghai';

/** A fixed instant: 21:00 on the 5th in the west, 12:00 on the 6th in the east. */
const INSTANT = '2026-10-06T04:00:00.000Z';

/** `GanttView`'s base column width at a 1280px container; the windows below are pinned, so it is not stretched. */
const COLUMN_W = 110;
const PX_PER_DAY: Record<'day' | 'week', number> = { day: COLUMN_W, week: COLUMN_W / 7 };

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

/** A local wall-clock time: month is 1-based. */
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);

/** Local wall-clock parts of a `Date`: year, month (1-based), day, hour, minute. */
const parts = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];

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

/** Press on `el`, move `dx` px, release. */
function drag(el: Element, dx: number): void {
  act(() => {
    el.dispatchEvent(pointer('pointerdown', 500));
  });
  act(() => {
    window.dispatchEvent(pointer('pointermove', 500 + dx));
  });
  act(() => {
    window.dispatchEvent(pointer('pointerup', 500 + dx));
  });
}

type Emitted = Record<string, [number[], number[]]>;

/**
 * Render the tasks, drag the element `testId` names by `days` days on the
 * `viewMode` axis, and hand back every emitted change as wall-clock parts,
 * keyed by task id.
 */
function dragged(
  tasks: GanttTask[],
  testId: string,
  days: number,
  window_: [Date, Date],
  viewMode: 'day' | 'week' = 'day',
): Emitted {
  const onTaskUpdate = vi.fn();
  const { container } = render(
    <div style={{ width: 1280, height: 600 }}>
      <GanttView
        tasks={tasks}
        startDate={window_[0]}
        endDate={window_[1]}
        viewMode={viewMode as GanttViewMode}
        onTaskUpdate={onTaskUpdate}
      />
    </div>,
  );
  const el = container.querySelector(`[data-testid="${testId}"]`);
  expect(el, `no ${testId}`).not.toBeNull();
  drag(el!, days * PX_PER_DAY[viewMode]);
  const out: Emitted = {};
  for (const [task, changes] of onTaskUpdate.mock.calls as Array<[GanttTask, { start?: Date; end?: Date }]>) {
    out[String(task.id)] = [parts(changes.start ?? task.start), parts(changes.end ?? task.end)];
  }
  cleanup();
  return out;
}

const task = (id: string, start: Date, end: Date, extra: Partial<GanttTask> = {}): GanttTask => ({
  id,
  title: `Task ${id}`,
  start,
  end,
  progress: 0,
  ...extra,
});

/** The chart windows, built per case: a `Date` built at load time would carry the load zone's midnight. */
const autumn = (): [Date, Date] => [at(2026, 10, 15), at(2026, 11, 20)];
const spring = (): [Date, Date] => [at(2026, 2, 20), at(2026, 3, 25)];

/**
 * The drags, each with the wall-clock parts every value should land on. The
 * same in every zone: the point is that a zone's DST change moves none of them.
 */
function dragCases() {
  it('move: a day task from Oct 29 to Oct 31 moved three days runs Nov 1 to Nov 3, midnight to midnight', () => {
    expect(dragged([task('a', at(2026, 10, 29), at(2026, 10, 31))], 'gantt-task-bar-a', 3, autumn())).toEqual({
      a: [[2026, 11, 1, 0, 0], [2026, 11, 3, 0, 0]],
    });
  });

  it('move back: a day task from Nov 3 to Nov 5 moved two days back runs Nov 1 to Nov 3', () => {
    expect(dragged([task('a', at(2026, 11, 3), at(2026, 11, 5))], 'gantt-task-bar-a', -2, autumn())).toEqual({
      a: [[2026, 11, 1, 0, 0], [2026, 11, 3, 0, 0]],
    });
  });

  it('move on the week scale: the same task moves by the same three calendar days', () => {
    expect(dragged([task('a', at(2026, 10, 29), at(2026, 10, 31))], 'gantt-task-bar-a', 3, autumn(), 'week')).toEqual({
      a: [[2026, 11, 1, 0, 0], [2026, 11, 3, 0, 0]],
    });
  });

  it('move: a datetime task keeps both wall-clock times (10:00 to 16:30, across the autumn change)', () => {
    expect(
      dragged([task('a', at(2026, 10, 30, 10), at(2026, 11, 2, 16, 30))], 'gantt-task-bar-a', 3, autumn()),
    ).toEqual({
      a: [[2026, 11, 2, 10, 0], [2026, 11, 5, 16, 30]],
    });
  });

  it('move: a datetime task keeps both wall-clock times (09:15 to 18:45, across the spring change)', () => {
    expect(
      dragged([task('a', at(2026, 3, 6, 9, 15), at(2026, 3, 8, 18, 45))], 'gantt-task-bar-a', 2, spring()),
    ).toEqual({
      a: [[2026, 3, 8, 9, 15], [2026, 3, 10, 18, 45]],
    });
  });

  it('resize-end: the end handle moves the end three calendar days, the start stays', () => {
    expect(
      dragged([task('a', at(2026, 10, 27), at(2026, 10, 30))], 'gantt-task-resize-right-a', 3, autumn()),
    ).toEqual({
      a: [[2026, 10, 27, 0, 0], [2026, 11, 2, 0, 0]],
    });
  });

  it('resize-end past the start stops one calendar day after it (Nov 1 to Nov 2)', () => {
    expect(
      dragged([task('a', at(2026, 11, 1), at(2026, 11, 3))], 'gantt-task-resize-right-a', -5, autumn()),
    ).toEqual({
      a: [[2026, 11, 1, 0, 0], [2026, 11, 2, 0, 0]],
    });
  });

  it('resize-start past the end stops one calendar day before it (Mar 8 to Mar 9)', () => {
    expect(dragged([task('a', at(2026, 3, 7), at(2026, 3, 9))], 'gantt-task-resize-left-a', 5, spring())).toEqual({
      a: [[2026, 3, 8, 0, 0], [2026, 3, 9, 0, 0]],
    });
  });

  it('group move: a summary moved three days moves itself and every descendant three calendar days', () => {
    const tasks = [
      task('p', at(2026, 10, 28), at(2026, 11, 2)),
      task('c1', at(2026, 10, 28), at(2026, 10, 29), { parent: 'p' }),
      task('c2', at(2026, 10, 31), at(2026, 11, 2), { parent: 'p' }),
    ];
    expect(dragged(tasks, 'gantt-summary-bar-p', 3, autumn())).toEqual({
      p: [[2026, 10, 31, 0, 0], [2026, 11, 5, 0, 0]],
      c1: [[2026, 10, 31, 0, 0], [2026, 11, 1, 0, 0]],
      c2: [[2026, 11, 3, 0, 0], [2026, 11, 5, 0, 0]],
    });
  });
}

// ── The stored value, through `ObjectGantt` and the real view ────────────────

const OBJECT_SCHEMA = {
  fields: {
    name: { type: 'text' },
    start_date: { type: 'date' },
    end_date: { type: 'date' },
  },
};

/** Mount `ObjectGantt` over one `date` row, drag its bar `days` days, and hand back the patch it wrote. */
async function writtenAfterDrag(row: Record<string, unknown>, days: number): Promise<Record<string, unknown>> {
  const ds = {
    find: vi.fn().mockResolvedValue({ data: [{ id: 't1', name: 'Build', ...row }] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
  };
  const schema = {
    type: 'gantt',
    gantt: { titleField: 'name', startDateField: 'start_date', endDateField: 'end_date' },
    data: { provider: 'object', object: 'task' },
  } as unknown as React.ComponentProps<typeof ObjectGantt>['schema'];
  const { container } = render(<ObjectGantt schema={schema} dataSource={ds as unknown as DataSource} />);
  await waitFor(() => expect(container.querySelector('[data-testid="gantt-task-bar-t1"]')).not.toBeNull());
  // Wait for the object-schema fetch to re-arm the loader and go quiet, so the
  // write handler is the one that has read the field types.
  let calls = ds.find.mock.calls.length;
  await waitFor(() => {
    const now = ds.find.mock.calls.length;
    if (now !== calls) {
      calls = now;
      throw new Error('still loading');
    }
  });
  // The chart's range is not pinned here, so its day width is read off the
  // header: the first column is a plain day, a week before the task.
  const firstColumn = container.querySelector('[data-testid="gantt-header-units"] > div') as HTMLElement | null;
  const pxPerDay = parseFloat(firstColumn?.style.width ?? '');
  expect(pxPerDay, 'a day column width').toBeGreaterThan(0);
  drag(container.querySelector('[data-testid="gantt-task-bar-t1"]')!, days * pxPerDay);
  await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
  return ds.update.mock.calls[0][2] as Record<string, unknown>;
}

describe('GanttView drag by calendar days, in the suite zone (objectui#10866)', () => {
  dragCases();

  it('ObjectGantt writes the dropped days of a `date` task moved three days', async () => {
    expect(await writtenAfterDrag({ start_date: '2026-10-29', end_date: '2026-10-31' }, 3)).toEqual({
      start_date: '2026-11-01',
      end_date: '2026-11-03',
    });
  });
});

function zoneCases(zone: string, instantHour: number) {
  it('rig: the zone really moved', () => {
    enter(zone);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
    expect(new Date(INSTANT).getHours()).toBe(instantHour);
  });

  describe('drags', () => {
    beforeEach(() => enter(zone));
    dragCases();
  });

  it('ObjectGantt writes the dropped days of a `date` task moved three days: end_date is Nov 3rd', async () => {
    enter(zone);
    expect(await writtenAfterDrag({ start_date: '2026-10-29', end_date: '2026-10-31' }, 3)).toEqual({
      start_date: '2026-11-01',
      end_date: '2026-11-03',
    });
  });
}

describe.runIf(DRIVEN)(`GanttView drag by calendar days in ${WEST} (objectui#10866)`, () => {
  zoneCases(WEST, 21);

  it('fixture validity: three days of elapsed time from Oct 31st\'s midnight end at 23:00 on Nov 2nd here', () => {
    enter(WEST);
    expect(parts(new Date(at(2026, 10, 31).getTime() + 3 * 86_400_000))).toEqual([2026, 11, 2, 23, 0]);
  });
});

describe.runIf(DRIVEN)(`GanttView drag by calendar days in ${EAST}, the control (objectui#10866)`, () => {
  zoneCases(EAST, 12);
});
