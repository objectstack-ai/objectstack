/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11005 (ruled B) — the month grid moves a value by calendar days and
 * keeps its wall-clock time, for every value, for a move and for a drag of the
 * span's end alike.
 *
 * ── What was measured before this change ────────────────────────────────────
 * `MonthView.handleDrop` moved an event by the milliseconds between the grabbed
 * cell's local midnight and the drop cell's. Across a DST change that span is
 * 23 or 25 hours, so under `America/Los_Angeles` (clocks fall back on November
 * 1st, 2026 and spring forward on March 8th, 2026):
 *  - a 10:00 event on November 1st moved two days landed at 11:00, one moved
 *    back onto November 1st at 09:00, and one on March 8th moved two days at
 *    09:00;
 *  - a span grabbed on its start and moved two days, whose end crosses
 *    November 1st, kept its start's clock and lost an hour at its end;
 *  - a span starting at local midnight on November 1st, grabbed on the 2nd and
 *    moved one day, started at 23:00 on November 1st, the cell before the one
 *    it was dropped on.
 * The drag of a span's end already set the drop day's clock from the old end
 * (`setHours`), so it kept hours, minutes and seconds across a DST change; it
 * dropped the milliseconds. It now moves a copy of the end by calendar days,
 * the same rule as a move, so the whole time of day is kept.
 *
 * `Asia/Shanghai` keeps no DST: every day there is 24 hours, so a move by
 * calendar days lands exactly where the elapsed-time arithmetic did. Its cases
 * are the "a zone without DST behaves as before" control.
 *
 * The week and day views are not here: their time grid places a moved event
 * at its snapped minutes on the drop day's own clock, not by a day delta.
 *
 * ── ⚠️ The zone cases run ONLY when driven, in a FORKS child ────────────────
 * `process.env.TZ` written inside a test of the normal run does not move the
 * zone (the root config runs `pool: 'threads'`), so the zone cases are
 * skipped there and `scripts/__tests__/date-only-zone-pins-10183.test.ts`
 * runs them on the forks pool and fails unless every one ran and passed. Each
 * zone opens with a rig case, so a child whose zone did not move reds instead
 * of going quietly green. The suite-zone cases run in the normal run too.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CalendarView, type CalendarViewEvent } from '../CalendarView';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** Falls back on November 1st, 2026 and springs forward on March 8th, 2026. */
const WEST = 'America/Los_Angeles';
/** No DST — the control. */
const EAST = 'Asia/Shanghai';

const TITLE = 'Standup';

afterEach(() => {
  cleanup();
});

/** `November 2, 2026` out of a month cell's accessible name. */
function dayOf(cell: Element): string {
  const m = (cell.getAttribute('aria-label') ?? '').match(/[A-Z][a-z]+ \d{1,2}, \d{4}/);
  return m ? m[0] : '';
}

function cellFor(day: string): HTMLElement {
  const cell = screen.getAllByRole('gridcell').find((c) => dayOf(c) === day);
  expect(cell, `no month cell for ${day}`).toBeDefined();
  return cell as HTMLElement;
}

/** jsdom has no DataTransfer round-trip; carry the payload in a synthetic one. */
function performDnd(source: Element, target: Element) {
  const store: Record<string, string> = {};
  const dataTransfer = {
    effectAllowed: '',
    dropEffect: '',
    setData: (k: string, v: string) => {
      store[k] = v;
    },
    getData: (k: string) => store[k] ?? '',
    setDragImage: () => {},
    types: ['text/plain'],
  };
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
  fireEvent.dragEnd(source, { dataTransfer });
}

interface Drag {
  /** The month the grid opens on, as `[year, monthIndex]` in the zone. */
  month: [number, number];
  start: string;
  end: string;
  /** The cell the gesture starts in: a later cell of the span grabs there. */
  grab: string;
  drop: string;
}

interface Written {
  start: string;
  end: string | undefined;
}

/**
 * Run one month-grid gesture and hand back the instants `onEventDrop` got.
 * `resize` grabs the right-edge handle in `grab` instead of the pill body.
 */
function dragged(d: Drag, gesture: 'move' | 'resize', zone?: string): Written {
  if (zone) process.env.TZ = zone;
  const onEventDrop = vi.fn();
  const event: CalendarViewEvent = {
    id: 'e1',
    title: TITLE,
    start: new Date(d.start),
    end: new Date(d.end),
  };
  render(
    <CalendarView
      events={[event]}
      view="month"
      locale="en-US"
      currentDate={new Date(d.month[0], d.month[1], 15)}
      onEventDrop={onEventDrop}
    />,
  );
  const source =
    gesture === 'move'
      ? within(cellFor(d.grab)).getAllByLabelText(TITLE)[0]
      : within(cellFor(d.grab)).getByRole('separator');
  performDnd(source, cellFor(d.drop));
  expect(onEventDrop).toHaveBeenCalledTimes(1);
  const [, newStart, newEnd] = onEventDrop.mock.calls[0] as [unknown, Date, Date | undefined];
  cleanup();
  return { start: newStart.toISOString(), end: newEnd?.toISOString() };
}

const OCTOBER: [number, number] = [2026, 9];
const NOVEMBER: [number, number] = [2026, 10];
const MARCH: [number, number] = [2026, 2];

/** Moves under `America/Los_Angeles`: each keeps its wall-clock time on the day it was dropped on. */
const WEST_MOVES: Array<[string, Drag, Written]> = [
  [
    'a 10:00 event on November 1st, the 25-hour day, moved two days stays at 10:00',
    // 10:00-11:00 PST on November 1st.
    { month: NOVEMBER, start: '2026-11-01T18:00:00.000Z', end: '2026-11-01T19:00:00.000Z', grab: 'November 1, 2026', drop: 'November 3, 2026' },
    // 10:00-11:00 PST on November 3rd.
    { start: '2026-11-03T18:00:00.000Z', end: '2026-11-03T19:00:00.000Z' },
  ],
  [
    'a 10:00 event moved back onto November 1st stays at 10:00',
    { month: NOVEMBER, start: '2026-11-03T18:00:00.000Z', end: '2026-11-03T19:00:00.000Z', grab: 'November 3, 2026', drop: 'November 1, 2026' },
    { start: '2026-11-01T18:00:00.000Z', end: '2026-11-01T19:00:00.000Z' },
  ],
  [
    'a 10:00 event on March 8th, the 23-hour day, moved two days stays at 10:00',
    // 10:00-11:00 PDT on March 8th.
    { month: MARCH, start: '2026-03-08T17:00:00.000Z', end: '2026-03-08T18:00:00.000Z', grab: 'March 8, 2026', drop: 'March 10, 2026' },
    { start: '2026-03-10T17:00:00.000Z', end: '2026-03-10T18:00:00.000Z' },
  ],
  [
    'a span whose end crosses November 1st, grabbed on its start and moved two days, keeps both clocks',
    // October 29th 10:00 PDT to October 31st 10:00 PDT.
    { month: OCTOBER, start: '2026-10-29T17:00:00.000Z', end: '2026-10-31T17:00:00.000Z', grab: 'October 29, 2026', drop: 'October 31, 2026' },
    // October 31st 10:00 PDT to November 2nd 10:00 PST.
    { start: '2026-10-31T17:00:00.000Z', end: '2026-11-02T18:00:00.000Z' },
  ],
  [
    'a span starting at local midnight on November 1st, grabbed on the 2nd and moved one day, starts at midnight on the 2nd',
    // November 1st 00:00 PDT to November 3rd 00:00 PST.
    { month: NOVEMBER, start: '2026-11-01T07:00:00.000Z', end: '2026-11-03T08:00:00.000Z', grab: 'November 2, 2026', drop: 'November 3, 2026' },
    // November 2nd 00:00 PST to November 4th 00:00 PST.
    { start: '2026-11-02T08:00:00.000Z', end: '2026-11-04T08:00:00.000Z' },
  ],
  [
    'a span ending at local midnight on March 9th, grabbed there and moved back one day, starts at midnight',
    // March 7th 00:00 PST to March 9th 00:00 PDT.
    { month: MARCH, start: '2026-03-07T08:00:00.000Z', end: '2026-03-09T07:00:00.000Z', grab: 'March 9, 2026', drop: 'March 8, 2026' },
    // March 6th 00:00 PST to March 8th 00:00 PST.
    { start: '2026-03-06T08:00:00.000Z', end: '2026-03-08T08:00:00.000Z' },
  ],
];

/** Drags of a span's end under `America/Los_Angeles`: the end keeps its whole time of day. */
const WEST_RESIZES: Array<[string, Drag, Written]> = [
  [
    'the end of a span dragged across November 1st keeps its time of day, seconds and milliseconds too',
    // October 30th 10:00 PDT to October 31st 11:30:15.250 PDT.
    { month: OCTOBER, start: '2026-10-30T17:00:00.000Z', end: '2026-10-31T18:30:15.250Z', grab: 'October 31, 2026', drop: 'November 2, 2026' },
    // The start is untouched; the end is November 2nd 11:30:15.250 PST.
    { start: '2026-10-30T17:00:00.000Z', end: '2026-11-02T19:30:15.250Z' },
  ],
  [
    'the end of a span dragged onto March 8th keeps its time of day',
    // March 5th 10:00 PST to March 6th 10:00 PST.
    { month: MARCH, start: '2026-03-05T18:00:00.000Z', end: '2026-03-06T18:00:00.000Z', grab: 'March 6, 2026', drop: 'March 8, 2026' },
    // March 8th 10:00 PDT.
    { start: '2026-03-05T18:00:00.000Z', end: '2026-03-08T17:00:00.000Z' },
  ],
];

/**
 * The control under `Asia/Shanghai`, where every day is 24 hours: each lands
 * exactly N x 24 hours from where it was, which is what the elapsed-time
 * arithmetic wrote before this change.
 */
const EAST_DRAGS: Array<[string, 'move' | 'resize', Drag, Written]> = [
  [
    'a 10:00 event on November 1st moved two days lands 48 hours later',
    'move',
    // 10:00-11:00 CST on November 1st.
    { month: NOVEMBER, start: '2026-11-01T02:00:00.000Z', end: '2026-11-01T03:00:00.000Z', grab: 'November 1, 2026', drop: 'November 3, 2026' },
    { start: '2026-11-03T02:00:00.000Z', end: '2026-11-03T03:00:00.000Z' },
  ],
  [
    'a 10:00 event on March 8th moved two days lands 48 hours later',
    'move',
    { month: MARCH, start: '2026-03-08T02:00:00.000Z', end: '2026-03-08T03:00:00.000Z', grab: 'March 8, 2026', drop: 'March 10, 2026' },
    { start: '2026-03-10T02:00:00.000Z', end: '2026-03-10T03:00:00.000Z' },
  ],
  [
    'a span starting at local midnight on November 1st, grabbed on the 2nd and moved one day, lands 24 hours later',
    'move',
    // November 1st 00:00 CST to November 3rd 00:00 CST.
    { month: NOVEMBER, start: '2026-10-31T16:00:00.000Z', end: '2026-11-02T16:00:00.000Z', grab: 'November 2, 2026', drop: 'November 3, 2026' },
    { start: '2026-11-01T16:00:00.000Z', end: '2026-11-03T16:00:00.000Z' },
  ],
  [
    'the end of a span dragged two days lands 48 hours later, its start untouched',
    'resize',
    { month: OCTOBER, start: '2026-10-30T02:00:00.000Z', end: '2026-10-31T03:30:15.000Z', grab: 'October 31, 2026', drop: 'November 2, 2026' },
    { start: '2026-10-30T02:00:00.000Z', end: '2026-11-02T03:30:15.000Z' },
  ],
];

describe('CalendarView month-grid drags, in the suite zone (objectui#11005)', () => {
  it('a move of two days lands on the dropped day at the same clock', () => {
    expect(
      dragged(
        { month: NOVEMBER, start: '2026-11-01T10:00:00.000Z', end: '2026-11-01T11:00:00.000Z', grab: 'November 1, 2026', drop: 'November 3, 2026' },
        'move',
      ),
    ).toEqual({ start: '2026-11-03T10:00:00.000Z', end: '2026-11-03T11:00:00.000Z' });
  });

  it('a drag of the end keeps the end\'s whole time of day', () => {
    expect(
      dragged(
        { month: OCTOBER, start: '2026-10-30T10:00:00.000Z', end: '2026-10-31T11:30:15.250Z', grab: 'October 31, 2026', drop: 'November 2, 2026' },
        'resize',
      ),
    ).toEqual({ start: '2026-10-30T10:00:00.000Z', end: '2026-11-02T11:30:15.250Z' });
  });
});

describe.runIf(DRIVEN)('CalendarView month-grid drags across a DST change, west of UTC (objectui#11005)', () => {
  it('rig: the zone really moved', () => {
    process.env.TZ = WEST;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date('2026-10-06T04:00:00.000Z').getHours()).toBe(21);
  });

  it('fixture validity: November 1st is 25 hours long here and March 8th is 23', () => {
    process.env.TZ = WEST;
    const hours = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;
    expect(hours(new Date(2026, 10, 1), new Date(2026, 10, 2))).toBe(25);
    expect(hours(new Date(2026, 2, 8), new Date(2026, 2, 9))).toBe(23);
  });

  it.each(WEST_MOVES)('%s', (_name, drag, want) => {
    expect(dragged(drag, 'move', WEST)).toEqual(want);
  });

  it.each(WEST_RESIZES)('%s', (_name, drag, want) => {
    expect(dragged(drag, 'resize', WEST)).toEqual(want);
  });
});

describe.runIf(DRIVEN)('CalendarView month-grid drags east of UTC, the zone without DST (objectui#11005)', () => {
  it('rig: the zone really moved', () => {
    process.env.TZ = EAST;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date('2026-10-06T04:00:00.000Z').getHours()).toBe(12);
  });

  it.each(EAST_DRAGS)('%s', (_name, gesture, drag, want) => {
    expect(dragged(drag, gesture, EAST)).toEqual(want);
  });
});
