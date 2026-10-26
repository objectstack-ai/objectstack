/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10866, slice 4 — a zone pin for the path slice 1 repaired and no
 * zone pin covered: an `ObjectGantt` whose adapter gives no object schema.
 *
 * With no declared type to ask, the stored value's own shape answers, on the
 * read (`readTaskDate`, and `readTaskEnd` for an end) and on the write
 * (`toStoredDateValue`): a stored `YYYY-MM-DD` is a day, read at local
 * midnight of that day and written back as the day it was dropped on; a stored
 * instant keeps its instant both ways. An END day is inclusive
 * (objectui#11141, re-derived from that card's rule): a stored `2026-10-05` to
 * `2026-10-09` is drawn through the end of the 9th, to the 10th's midnight,
 * and a bar handed back ending on a day's midnight is written as the day
 * before it, the day it runs through. Two
 * adapters have no types to give: one with no `getObjectSchema`, and one whose
 * schema carries no fields (a code-built `ApiDataSource` answers
 * `{ fields: {} }`). A chart with a business `timeZone` takes the same split
 * through the shim, as the schema-declared pin beside this one measures.
 *
 * Every case here passed on the base of this slice: this pin covers a path, it
 * does not repair it.
 *
 * ── ⚠️ The zone cases run ONLY when driven, in a FORKS child ────────────────
 * `process.env.TZ` written inside a test of the normal run does not move the
 * zone (the root config runs `pool: 'threads'`), so the zone cases are
 * skipped there and `scripts/__tests__/date-only-zone-pins-10183.test.ts`
 * runs them on the forks pool and fails unless every one ran and passed. Each
 * zone opens with a rig case, so a child whose zone did not move reds instead
 * of going quietly green. The suite-zone cases run in the normal run too.
 *
 * `GanttView` is mocked to a probe that hands back the props `ObjectGantt`
 * gives it, the pattern of `ObjectGantt.dateOnlyZone-10866.test.tsx`.
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

const DATE_ROW = { id: 't1', name: 'Build', starts: '2026-10-05', ends: '2026-10-09' };
const INSTANT_ROW = { id: 't1', name: 'Build', starts: INSTANT, ends: INSTANT_END };

/** How the adapter answers for types: not at all, or with a schema that has no fields. */
type NoTypes = 'no getObjectSchema' | 'a schema with no fields';

afterEach(() => {
  cleanup();
  probe.view = null;
});

function enter(zone: string): void {
  process.env.TZ = zone;
}

/** Local calendar parts of a `Date`: year, month (1-based), day, hour. */
const parts = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()];

interface Mounted {
  update: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
  /** The task the view was last handed. */
  task: GanttTask;
}

async function mount(row: Record<string, unknown>, noTypes: NoTypes, timeZone?: string): Promise<Mounted> {
  const ds: Record<string, unknown> = {
    find: vi.fn().mockResolvedValue({ data: [row] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn(),
  };
  if (noTypes === 'a schema with no fields') ds.getObjectSchema = vi.fn().mockResolvedValue({ fields: {} });
  const gantt = { titleField: 'name', startDateField: 'starts', endDateField: 'ends' };
  const schema = {
    type: 'gantt',
    gantt: timeZone ? { ...gantt, timeZone } : gantt,
    data: { provider: 'object', object: 'task' },
  } as unknown as React.ComponentProps<typeof ObjectGantt>['schema'];
  render(<ObjectGantt schema={schema} dataSource={ds as unknown as DataSource} />);
  await waitFor(() => expect(probe.view?.tasks?.length).toBe(1));
  // Let the call volume go quiet, as the schema-declared pin does, so the write
  // handler below is the settled one.
  const find = ds.find as ReturnType<typeof vi.fn>;
  let calls = find.mock.calls.length;
  await waitFor(() => {
    const now = find.mock.calls.length;
    if (now !== calls) {
      calls = now;
      throw new Error('still loading');
    }
  });
  return { update: ds.update as ReturnType<typeof vi.fn>, find, task: probe.view!.tasks[0] };
}

/** Drive the view's LATEST write callback and hand back the patch it produced. */
async function written(m: Mounted, changes: Partial<Pick<GanttTask, 'start' | 'end'>>): Promise<Record<string, unknown>> {
  probe.view!.onTaskUpdate!(probe.view!.tasks[0], changes);
  await waitFor(() => expect(m.update).toHaveBeenCalledTimes(1));
  return m.update.mock.calls[0][2] as Record<string, unknown>;
}

const NO_TYPES: NoTypes[] = ['no getObjectSchema', 'a schema with no fields'];

/**
 * The cases for one zone. `chartZone` is the OTHER zone, so a business-zone
 * chart is read by a viewer who is not in it; `instantDayHere` is where the
 * instant falls locally.
 */
function zoneCases(zone: string | undefined, chartZone: string, instantDayHere: number[]) {
  const at = () => {
    if (zone) enter(zone);
  };

  it.each(NO_TYPES)('%s: a stored `2026-10-05` → `2026-10-09` reads from the 5th\'s midnight through the end of the 9th', async (noTypes) => {
    at();
    const m = await mount(DATE_ROW, noTypes);
    expect(parts(m.task.start)).toEqual([2026, 10, 5, 0]);
    expect(parts(m.task.end)).toEqual([2026, 10, 10, 0]);
  });

  it.each(NO_TYPES)('%s: a drag onto the 7th writes the stored days back as days', async (noTypes) => {
    at();
    const m = await mount(DATE_ROW, noTypes);
    expect(await written(m, { start: new Date(2026, 9, 7), end: new Date(2026, 9, 12) })).toEqual({
      starts: '2026-10-07',
      ends: '2026-10-11',
    });
  });

  it.each(NO_TYPES)('%s: the dates the view was handed, handed straight back, write the stored days (objectui#11141)', async (noTypes) => {
    at();
    const m = await mount(DATE_ROW, noTypes);
    expect(await written(m, { start: m.task.start, end: m.task.end })).toEqual({
      starts: '2026-10-05',
      ends: '2026-10-09',
    });
  });

  it.each(NO_TYPES)('control, %s: a stored instant reads and writes as the instant', async (noTypes) => {
    at();
    const m = await mount(INSTANT_ROW, noTypes);
    expect(m.task.start.getTime()).toBe(Date.parse(INSTANT));
    expect(parts(m.task.start)).toEqual(instantDayHere);
    expect(await written(m, { start: new Date(INSTANT_PLUS_2) })).toEqual({ starts: INSTANT_PLUS_2 });
  });

  it(`no getObjectSchema, a chart in ${chartZone}: the day stands on its own midnight there, the end runs through its day, and a drop writes the days back`, async () => {
    at();
    const shift = makeTzShift(chartZone);
    const m = await mount(DATE_ROW, 'no getObjectSchema', chartZone);
    // Where `GanttView` draws the bar: the task re-based into the chart zone.
    expect(parts(shift.to(m.task.start))).toEqual([2026, 10, 5, 0]);
    expect(parts(shift.to(m.task.end))).toEqual([2026, 10, 10, 0]);
    // What `GanttView` hands back for a drop onto the 7th: the inverse re-base.
    expect(
      await written(m, { start: shift.from(new Date(2026, 9, 7)), end: shift.from(new Date(2026, 9, 12)) }),
    ).toEqual({ starts: '2026-10-07', ends: '2026-10-11' });
  });
}

describe('ObjectGantt with no object schema, in the suite zone (objectui#10866)', () => {
  zoneCases(undefined, EAST, [2026, 10, 6, 4]);
});

describe.runIf(DRIVEN)('ObjectGantt with no object schema, west of UTC (objectui#10866)', () => {
  it('rig: the zone really moved', () => {
    enter(WEST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date(INSTANT).getHours()).toBe(21);
  });

  it('fixture validity: the engine parse of the stored day lands on the day before here', () => {
    enter(WEST);
    expect(new Date(DATE_ROW.starts).getDate()).toBe(4);
  });

  zoneCases(WEST, EAST, [2026, 10, 5, 21]);
});

describe.runIf(DRIVEN)('ObjectGantt with no object schema, east of UTC, the control (objectui#10866)', () => {
  it('rig: the zone really moved', () => {
    enter(EAST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date(INSTANT).getHours()).toBe(12);
  });

  zoneCases(EAST, WEST, [2026, 10, 6, 12]);
});
