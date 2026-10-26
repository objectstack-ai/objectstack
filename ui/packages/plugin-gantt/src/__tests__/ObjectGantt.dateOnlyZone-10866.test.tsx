/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10866 — `ObjectGantt` places a stored date-only day on that day,
 * and writes a `date` field back as a calendar day.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * The task mapping read `start` / `end` and the baselines with the engine's
 * own `Date` parse, which reads a date-only `2026-10-05` as UTC midnight, so
 * every viewer west of UTC saw the bar start on October 4th at 17:00. The drag
 * handler then wrote `toISOString()` into the field: a UTC instant stored in a
 * `Field.date`. The reads now go through `toDisplayDate` (`@object-ui/core`,
 * the objectui#10183 convention), and a write to a field declared `date` sends
 * the calendar day as `yyyy-MM-dd`. A `datetime` field keeps its instant: the
 * control rows below.
 *
 * ── An END runs through its day (objectui#11141) ────────────────────────────
 * A date-only end is INCLUSIVE, the rule `plugin-timeline`'s gantt reads too:
 * a stored `2026-10-09` end is handed to the view as the 10th's local midnight,
 * the exclusive end of the span, and a bar the view hands back ending on a
 * day's midnight is written as the day BEFORE it, the day it runs through. So
 * the end cases below read the 10th and drop onto the 12th to write the 11th,
 * and a read handed straight back writes the stored days unchanged.
 *
 * ── A chart with a business `timeZone` ──────────────────────────────────────
 * `GanttView` re-bases every `Date` it is handed into the configured zone
 * (`makeTzShift`) and hands every emitted change back through the inverse. A
 * date-only value names a calendar day and carries no instant, so re-basing
 * it would move the bar off its day for any viewer whose zone is not the
 * chart's. `ObjectGantt` therefore hands the view the instant that re-bases
 * onto the named day's midnight, and reads a dropped day back through the same
 * shim. These cases put the viewer in one zone and the chart in the other, and
 * read the task where the view will draw it: `makeTzShift(zone).to(start)`.
 *
 * ── ⚠️ The zone cases run ONLY when driven, in a FORKS child ────────────────
 * `process.env.TZ` written inside a test of the normal run does not move the
 * zone (the root config runs `pool: 'threads'`), so the zone cases are
 * skipped there and `scripts/__tests__/date-only-zone-pins-10183.test.ts`
 * runs them on the forks pool and fails unless every one ran and passed. Each
 * zone opens with a rig case, so a child whose zone did not move reds instead
 * of going quietly green. The suite-zone cases run in the normal run too: the
 * read cannot tell the repair from its absence there (UTC is the one offset
 * where the two parses agree), but the written SHAPE can.
 *
 * `GanttView` is mocked to a probe that hands back the props `ObjectGantt`
 * gives it, the pattern of `ObjectGantt.readback.test.tsx`.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { DataSource } from '@object-ui/types';
import type { GanttTask, GanttViewProps } from '../GanttView';
import { makeTzShift } from '../tzShift';

const probe = vi.hoisted(() => ({ view: null as GanttViewProps | null }));

vi.mock('../GanttView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../GanttView')>();
  return {
    ...actual,
    GanttView: (props: GanttViewProps) => {
      probe.view = props;
      return <div data-testid="gantt-view">{props.tasks.length}</div>;
    },
  };
});

// Imported after the mock is declared (vitest hoists `vi.mock` anyway).
import { ObjectGantt } from '../ObjectGantt';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** UTC-7 in October — the card's direction. */
const WEST = 'America/Los_Angeles';
/** UTC+8 — the control. */
const EAST = 'Asia/Shanghai';

/** A fixed instant: 21:00 on the 5th in the west, 12:00 on the 6th in the east. */
const INSTANT = '2026-10-06T04:00:00.000Z';
const INSTANT_END = '2026-10-09T04:00:00.000Z';
const INSTANT_PLUS_2 = '2026-10-08T04:00:00.000Z';

const DATE_ROW = {
  id: 't1',
  name: 'Build',
  start_date: '2026-10-05',
  end_date: '2026-10-09',
  plan_start: '2026-10-02',
  plan_end: '2026-10-08',
};
const DATETIME_ROW = { id: 't1', name: 'Build', begins_at: INSTANT, ends_at: INSTANT_END };

const OBJECT_SCHEMA = {
  fields: {
    name: { type: 'text' },
    start_date: { type: 'date' },
    end_date: { type: 'date' },
    plan_start: { type: 'date' },
    plan_end: { type: 'date' },
    begins_at: { type: 'datetime' },
    ends_at: { type: 'datetime' },
  },
};

afterEach(() => {
  cleanup();
  probe.view = null;
});

function enter(zone: string): void {
  process.env.TZ = zone;
}

/** Local calendar parts of a `Date`: year, month (1-based), day, hour. */
const parts = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()];

/** The data-source methods these cases read the calls of. */
interface Calls {
  find: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  getObjectSchema: ReturnType<typeof vi.fn>;
}

interface Mounted {
  ds: Calls;
  /** The task the view was last handed. */
  task: GanttTask;
}

async function mount(kind: 'date' | 'datetime', timeZone?: string): Promise<Mounted> {
  const row = kind === 'date' ? DATE_ROW : DATETIME_ROW;
  const ds = {
    find: vi.fn().mockResolvedValue({ data: [row] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
  };
  const gantt =
    kind === 'date'
      ? {
          titleField: 'name',
          startDateField: 'start_date',
          endDateField: 'end_date',
          baselineStartField: 'plan_start',
          baselineEndField: 'plan_end',
        }
      : { titleField: 'name', startDateField: 'begins_at', endDateField: 'ends_at' };
  const schema = {
    type: 'gantt',
    gantt: timeZone ? { ...gantt, timeZone } : gantt,
    data: { provider: 'object', object: 'task' },
  } as unknown as React.ComponentProps<typeof ObjectGantt>['schema'];
  render(<ObjectGantt schema={schema} dataSource={ds as unknown as DataSource} />);
  await waitFor(() => expect(probe.view?.tasks?.length).toBe(1));
  // The object-schema fetch re-arms the loader once; wait for the call volume
  // to go quiet, as `ObjectGantt.readback.test.tsx` does, so the write
  // handler below is the one that has read the field types.
  let calls = ds.find.mock.calls.length;
  await waitFor(() => {
    const now = ds.find.mock.calls.length;
    if (now !== calls) {
      calls = now;
      throw new Error('still loading');
    }
  });
  return { ds, task: probe.view!.tasks[0] };
}

/** Drive the view's LATEST write callback and hand back the patch it produced. */
async function written(m: Mounted, changes: Partial<Pick<GanttTask, 'start' | 'end'>>): Promise<Record<string, unknown>> {
  probe.view!.onTaskUpdate!(probe.view!.tasks[0], changes);
  await waitFor(() => expect(m.ds.update).toHaveBeenCalledTimes(1));
  return m.ds.update.mock.calls[0][2] as Record<string, unknown>;
}

describe('ObjectGantt date-only days, in the suite zone (objectui#10866)', () => {
  it('a date-only row reads its start at local midnight and runs its end through its day, baselines too', async () => {
    const m = await mount('date');
    expect(parts(m.task.start)).toEqual([2026, 10, 5, 0]);
    expect(parts(m.task.end)).toEqual([2026, 10, 10, 0]);
    expect(parts(m.task.baselineStart!)).toEqual([2026, 10, 2, 0]);
    expect(parts(m.task.baselineEnd!)).toEqual([2026, 10, 9, 0]);
  });

  it('a drag writes `date` fields as calendar days, never instants', async () => {
    const m = await mount('date');
    expect(await written(m, { start: new Date(2026, 9, 7), end: new Date(2026, 9, 12) })).toEqual({
      start_date: '2026-10-07',
      end_date: '2026-10-11',
    });
  });

  it('the dates the view was handed, handed straight back, write the stored days (objectui#11141)', async () => {
    const m = await mount('date');
    expect(await written(m, { start: m.task.start, end: m.task.end })).toEqual({
      start_date: '2026-10-05',
      end_date: '2026-10-09',
    });
  });

  it('control: a drag of a `datetime` row keeps the instant', async () => {
    const m = await mount('datetime');
    expect(m.task.start.getTime()).toBe(Date.parse(INSTANT));
    expect(await written(m, { start: new Date(INSTANT_PLUS_2) })).toEqual({ begins_at: INSTANT_PLUS_2 });
  });
});

/**
 * The zone cases for one viewer zone. `chartZone` is the OTHER zone, so a
 * business-zone chart is read by a viewer who is not in it.
 */
function zoneCases(zone: string, chartZone: string, instantHour: number, instantDayHere: number[]) {
  it('rig: the zone really moved', () => {
    enter(zone);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
    expect(new Date(INSTANT).getHours()).toBe(instantHour);
  });

  it('`2026-10-05` → `2026-10-09` reads from the 5th\'s midnight through the 9th, baselines too', async () => {
    enter(zone);
    const m = await mount('date');
    expect(parts(m.task.start)).toEqual([2026, 10, 5, 0]);
    expect(parts(m.task.end)).toEqual([2026, 10, 10, 0]);
    expect(parts(m.task.baselineStart!)).toEqual([2026, 10, 2, 0]);
    expect(parts(m.task.baselineEnd!)).toEqual([2026, 10, 9, 0]);
  });

  it('a drag onto the 7th writes `2026-10-07`, and its end the day it runs through', async () => {
    enter(zone);
    const m = await mount('date');
    expect(await written(m, { start: new Date(2026, 9, 7), end: new Date(2026, 9, 12) })).toEqual({
      start_date: '2026-10-07',
      end_date: '2026-10-11',
    });
  });

  it('the dates the view was handed, handed straight back, write the stored days (objectui#11141)', async () => {
    enter(zone);
    const m = await mount('date');
    expect(await written(m, { start: m.task.start, end: m.task.end })).toEqual({
      start_date: '2026-10-05',
      end_date: '2026-10-09',
    });
  });

  it(`a chart in ${chartZone} draws the day on its own midnight, and writes the dropped day back`, async () => {
    enter(zone);
    const shift = makeTzShift(chartZone);
    const m = await mount('date', chartZone);
    // Where `GanttView` draws the bar: the task re-based into the chart zone.
    expect(parts(shift.to(m.task.start))).toEqual([2026, 10, 5, 0]);
    expect(parts(shift.to(m.task.end))).toEqual([2026, 10, 10, 0]);
    // What `GanttView` hands back for a drop onto the 7th: the inverse re-base.
    expect(
      await written(m, { start: shift.from(new Date(2026, 9, 7)), end: shift.from(new Date(2026, 9, 12)) }),
    ).toEqual({ start_date: '2026-10-07', end_date: '2026-10-11' });
  });

  it(`a chart in ${chartZone} writes back the stored days for the bar it drew, untouched (objectui#11141)`, async () => {
    enter(zone);
    const shift = makeTzShift(chartZone);
    const m = await mount('date', chartZone);
    const back = (d: Date) => shift.from(shift.to(d));
    expect(await written(m, { start: back(m.task.start), end: back(m.task.end) })).toEqual({
      start_date: '2026-10-05',
      end_date: '2026-10-09',
    });
  });

  it('control: a `datetime` row keeps its instant, in the chart zone too', async () => {
    enter(zone);
    const m = await mount('datetime');
    expect(m.task.start.getTime()).toBe(Date.parse(INSTANT));
    expect(parts(m.task.start)).toEqual(instantDayHere);
    expect(await written(m, { start: new Date(INSTANT_PLUS_2) })).toEqual({ begins_at: INSTANT_PLUS_2 });
    cleanup();
    const z = await mount('datetime', chartZone);
    expect(z.task.start.getTime()).toBe(Date.parse(INSTANT));
  });
}

describe.runIf(DRIVEN)('ObjectGantt date-only days west of UTC (objectui#10866)', () => {
  zoneCases(WEST, EAST, 21, [2026, 10, 5, 21]);

  it('fixture validity: the engine parse of the string lands on the day before here', () => {
    enter(WEST);
    expect(new Date('2026-10-05').getDate()).toBe(4);
  });
});

describe.runIf(DRIVEN)('ObjectGantt date-only days east of UTC, the control (objectui#10866)', () => {
  zoneCases(EAST, WEST, 12, [2026, 10, 6, 12]);
});
