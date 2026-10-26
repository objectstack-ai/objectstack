/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11141 — a read, a drag and a write leave a stored date-only end the
 * day it was.
 *
 * `ObjectGantt` reads a date-only end INCLUSIVELY (`toDisplayEndDate`,
 * `@object-ui/core`): a stored `2024-01-15` is handed to the view as the 16th's
 * local midnight, the exclusive end the bar is drawn to. The write is the
 * exact inverse (`toInclusiveEndDay`): an end the view hands back on a day's
 * midnight names the day BEFORE it. These drive the real `GanttView` with
 * pointer events, as a user would, and read the patch the data source got:
 *
 *  - a left-edge drag moves only the start, and the untouched end is written
 *    back as the stored day (⛔ never the day after);
 *  - a move shifts both stored days by the days the bar moved;
 *  - a right-edge drag moves the stored end by the days it was dragged;
 *  - control: a `datetime` end keeps its instant through the same drags.
 *
 * The suite runs in UTC (`vitest.config.mts` pins `TZ`); the zone pins beside
 * this file hand the same reads and writes through other zones and a chart's
 * business `timeZone`.
 */

import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from '@object-ui/types';
import { ObjectGantt } from '../ObjectGantt';

const OBJECT_SCHEMA = {
  fields: {
    name: { type: 'text' },
    start_date: { type: 'date' },
    end_date: { type: 'date' },
    begins_at: { type: 'datetime' },
    ends_at: { type: 'datetime' },
  },
};

/** January 10th to 15th, 2024, as stored. */
const DATE_ROW = { id: 't1', name: 'Build', start_date: '2024-01-10', end_date: '2024-01-15' };
/** The same bar in instants, ending mid-afternoon. */
const DATETIME_ROW = { id: 't1', name: 'Build', begins_at: '2024-01-10T00:00:00.000Z', ends_at: '2024-01-15T15:00:00.000Z' };
/**
 * The RULER: a second task starting ten days after the first. The distance
 * between the two bars' left edges measures a day's width on the axis without
 * reading any END, so the width case below can fail.
 */
const DATE_RULER = { id: 'r1', name: 'Ruler', start_date: '2024-01-20', end_date: '2024-01-22' };
const DATETIME_RULER = { id: 'r1', name: 'Ruler', begins_at: '2024-01-20T00:00:00.000Z', ends_at: '2024-01-22T00:00:00.000Z' };

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

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

interface Mounted {
  update: ReturnType<typeof vi.fn>;
  container: HTMLElement;
  /** One day's width on the axis. */
  pxPerDay: number;
}

async function mount(kind: 'date' | 'datetime'): Promise<Mounted> {
  const ds = {
    find: vi.fn().mockResolvedValue({ data: kind === 'date' ? [DATE_ROW, DATE_RULER] : [DATETIME_ROW, DATETIME_RULER] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
  };
  const gantt =
    kind === 'date'
      ? { titleField: 'name', startDateField: 'start_date', endDateField: 'end_date', viewMode: 'day' }
      : { titleField: 'name', startDateField: 'begins_at', endDateField: 'ends_at', viewMode: 'day' };
  const schema = {
    type: 'gantt',
    gantt,
    data: { provider: 'object', object: 'task' },
  } as unknown as React.ComponentProps<typeof ObjectGantt>['schema'];
  const { container } = render(
    <div style={{ width: 1280, height: 600 }}>
      <ObjectGantt schema={schema} dataSource={ds as unknown as DataSource} />
    </div>,
  );
  await waitFor(() => {
    expect(container.querySelector('[data-testid="gantt-task-bar-t1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="gantt-task-bar-r1"]')).not.toBeNull();
  });
  // The object-schema fetch re-arms the loader once; wait for the call volume
  // to go quiet, as the zone pins do, so the write handler has read the types.
  let calls = ds.find.mock.calls.length;
  await waitFor(() => {
    const now = ds.find.mock.calls.length;
    if (now !== calls) {
      calls = now;
      throw new Error('still loading');
    }
  });
  const leftOf = (id: string) =>
    parseFloat((container.querySelector(`[data-testid="gantt-task-bar-${id}"]`) as HTMLElement).style.left);
  // The ruler starts ten days after the task, on a linear axis (no folded days).
  return { update: ds.update, container, pxPerDay: (leftOf('r1') - leftOf('t1')) / 10 };
}

/** Drag `testId` by `days` days and hand back the patch the data source was sent. */
async function drag(m: Mounted, testId: string, days: number): Promise<Record<string, unknown>> {
  const el = m.container.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
  expect(el, testId).not.toBeNull();
  const to = 600 + days * m.pxPerDay;
  act(() => { el.dispatchEvent(pointer('pointerdown', 600)); });
  act(() => { window.dispatchEvent(pointer('pointermove', to)); });
  act(() => { window.dispatchEvent(pointer('pointerup', to)); });
  await waitFor(() => expect(m.update).toHaveBeenCalledTimes(1));
  return m.update.mock.calls[0][2] as Record<string, unknown>;
}

describe('a date-only end survives a read, a drag and a write (objectui#11141)', () => {
  it('the bar is drawn through the 15th: six days wide, where the start-of-day read drew five', async () => {
    const m = await mount('date');
    const bar = m.container.querySelector('[data-testid="gantt-task-bar-t1"]') as HTMLElement;
    expect(m.pxPerDay).toBeGreaterThan(0);
    expect(parseFloat(bar.style.width) / m.pxPerDay).toBeCloseTo(6, 6);
  });

  it('a left-edge drag two days back writes the stored end back unchanged', async () => {
    const m = await mount('date');
    expect(await drag(m, 'gantt-task-resize-left-t1', -2)).toEqual({
      start_date: '2024-01-08',
      end_date: '2024-01-15',
    });
  });

  it('a move three days on moves both stored days by three', async () => {
    const m = await mount('date');
    expect(await drag(m, 'gantt-task-bar-t1', 3)).toEqual({
      start_date: '2024-01-13',
      end_date: '2024-01-18',
    });
  });

  it('a right-edge drag one day on writes the next day as the end', async () => {
    const m = await mount('date');
    expect(await drag(m, 'gantt-task-resize-right-t1', 1)).toEqual({
      start_date: '2024-01-10',
      end_date: '2024-01-16',
    });
  });

  it('a right-edge drag back to the start day writes a one-day task, start and end on one day', async () => {
    const m = await mount('date');
    expect(await drag(m, 'gantt-task-resize-right-t1', -5)).toEqual({
      start_date: '2024-01-10',
      end_date: '2024-01-10',
    });
  });
});

describe('control: a `datetime` end keeps its instant (objectui#11141)', () => {
  it('a left-edge drag writes the end instant back unchanged', async () => {
    const m = await mount('datetime');
    expect(await drag(m, 'gantt-task-resize-left-t1', -2)).toEqual({
      begins_at: '2024-01-08T00:00:00.000Z',
      ends_at: '2024-01-15T15:00:00.000Z',
    });
  });

  it('a move three days on moves the end instant by three days', async () => {
    const m = await mount('datetime');
    expect(await drag(m, 'gantt-task-bar-t1', 3)).toEqual({
      begins_at: '2024-01-13T00:00:00.000Z',
      ends_at: '2024-01-18T15:00:00.000Z',
    });
  });
});
