/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11037 — a move in the week and day views keeps the event's own
 * length and the grabbed point's place in it, not the length of the piece
 * that was grabbed.
 *
 * ── What was measured before this change ────────────────────────────────────
 * The time grid draws an event that crosses midnight as one piece per day,
 * clipped at midnight, and a short event as a piece at least 15 minutes tall.
 * A move read its length and its grab offset from the grabbed PIECE, and kept
 * the moved piece inside the drop day. So a 22:00 to 02:00 event:
 *  - grabbed by its first piece and dropped at 10:00 was written 10:00 to
 *    12:00, two of its four hours gone;
 *  - grabbed at the top of its second piece (its own 00:00) and dropped at
 *    10:00 was written 10:00 to 12:00 as well, its start put where its
 *    midnight had been grabbed;
 *  - could not be moved and stay overnight: its first piece was held to end
 *    by midnight of the drop day.
 * A 5-minute event came back 15 minutes long, the drawn piece's height.
 *
 * ── The rule now ────────────────────────────────────────────────────────────
 * The event's length is `end - start` of its instants, and the grab offset is
 * the grabbed point's distance from the event's own start, both in elapsed
 * time. The event's start goes to the drop row minus that offset, snapped as
 * before, and its end to that start plus the length. An event drawn wholly
 * inside one day is still held inside the drop day, as before; one that
 * crosses midnight is placed where it is dropped.
 *
 * An elapsed length keeps a `datetime` event's real duration (objectui#10866's
 * reading: a `datetime` keeps its instant). On the night a DST change falls
 * in, the wall clock shows that length an hour longer or shorter: the
 * `America/Los_Angeles` case below moves a 4-hour 22:00 to 02:00 event onto
 * the night of November 1st, 2026, when the clocks fall back, and it reads
 * 22:00 to 01:00, still four hours.
 *
 * ── ⚠️ The zone cases run ONLY when driven, in a FORKS child ────────────────
 * `process.env.TZ` written inside a test of the normal run does not move the
 * zone (the root config runs `pool: 'threads'` and pins `UTC`), so the zone
 * cases are skipped there and `scripts/__tests__/date-only-zone-pins-10183.test.ts`
 * runs them on the forks pool and fails unless every one ran and passed. Each
 * zone opens with a rig case, so a child whose zone did not move reds instead
 * of going quietly green. The suite-zone cases run in the normal run too.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CalendarView, type CalendarViewEvent } from '../CalendarView';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** Falls back on November 1st, 2026. */
const WEST = 'America/Los_Angeles';
/** No DST — the control. */
const EAST = 'Asia/Shanghai';

const TITLE = 'Night shift';

/** The grid draws 48 px per hour. */
const PX_PER_HOUR = 48;
const COLUMN_WIDTH = 100;

afterEach(() => {
  cleanup();
});

/** The time-grid column whose accessible name carries `day`, e.g. `January 13, 2026`. */
function columnFor(day: string): HTMLElement {
  const column = screen
    .getAllByLabelText(new RegExp(day))
    .find((el) => el.classList.contains('select-none'));
  expect(column, `no time-grid column for ${day}`).toBeDefined();
  return column as HTMLElement;
}

/**
 * jsdom measures nothing: lay the columns out side by side, each a full
 * 24-hour column from the top of the viewport.
 */
function layOutColumns(): HTMLElement[] {
  const columns = Array.from(document.querySelectorAll<HTMLElement>('.select-none[aria-label]'));
  columns.forEach((column, i) => {
    const left = COLUMN_WIDTH * (i + 1);
    column.getBoundingClientRect = () =>
      ({
        top: 0,
        left,
        right: left + COLUMN_WIDTH,
        bottom: 24 * PX_PER_HOUR,
        width: COLUMN_WIDTH,
        height: 24 * PX_PER_HOUR,
        x: left,
        y: 0,
        toJSON() {},
      }) as DOMRect;
  });
  return columns;
}

const yOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return ((h * 60 + m) / 60) * PX_PER_HOUR;
};

interface Move {
  view: 'week' | 'day';
  /** An instant inside the week (or the day) the grid opens on. */
  open: string;
  start: string;
  /** Omitted for an event with no end. */
  end?: string;
  /** The day whose piece is grabbed, and the row it is grabbed at. */
  grab: [day: string, at: string];
  /** The day it is dropped on, and the row the pointer is released at. */
  drop: [day: string, at: string];
}

interface Written {
  start: string;
  end: string | undefined;
}

/** Run one time-grid move and hand back the instants `onEventDrop` got. */
function moved(m: Move, zone?: string): Written {
  if (zone) process.env.TZ = zone;
  const onEventDrop = vi.fn();
  const event: CalendarViewEvent = {
    id: 'e1',
    title: TITLE,
    start: new Date(m.start),
    ...(m.end ? { end: new Date(m.end) } : {}),
  };
  render(
    <CalendarView
      events={[event]}
      view={m.view}
      locale="en-US"
      currentDate={new Date(m.open)}
      onEventDrop={onEventDrop}
    />,
  );
  layOutColumns();
  const grabColumn = columnFor(m.grab[0]);
  const dropColumn = columnFor(m.drop[0]);
  const piece = within(grabColumn).getByTitle(TITLE);
  const xIn = (column: HTMLElement) => column.getBoundingClientRect().left + COLUMN_WIDTH / 2;

  fireEvent.pointerDown(piece, { clientX: xIn(grabColumn), clientY: yOf(m.grab[1]), button: 0 });
  fireEvent.pointerMove(window, { clientX: xIn(dropColumn), clientY: yOf(m.drop[1]) });
  fireEvent.pointerUp(window, { clientX: xIn(dropColumn), clientY: yOf(m.drop[1]) });

  expect(onEventDrop).toHaveBeenCalledTimes(1);
  const [, newStart, newEnd] = onEventDrop.mock.calls[0] as [unknown, Date, Date | undefined];
  cleanup();
  return { start: newStart.toISOString(), end: newEnd?.toISOString() };
}

const HOUR = 3_600_000;
const hoursBetween = (w: Written) => (new Date(w.end!).getTime() - new Date(w.start).getTime()) / HOUR;

/** The week of Sunday January 11th to Saturday January 17th, 2026. */
const JANUARY_WEEK = '2026-01-15T12:00:00.000Z';

/** 22:00 on Monday January 12th to 02:00 on Tuesday the 13th, in the suite zone (UTC). */
const OVERNIGHT = { start: '2026-01-12T22:00:00.000Z', end: '2026-01-13T02:00:00.000Z' };

describe('CalendarView time-grid move keeps the event, not the grabbed piece, in the suite zone (objectui#11037)', () => {
  it('dragged by its first piece to 10:00, an overnight event keeps its four hours', () => {
    const got = moved({
      view: 'week',
      open: JANUARY_WEEK,
      ...OVERNIGHT,
      grab: ['January 12, 2026', '22:00'],
      drop: ['January 14, 2026', '10:00'],
    });
    expect(got).toEqual({ start: '2026-01-14T10:00:00.000Z', end: '2026-01-14T14:00:00.000Z' });
    expect(hoursBetween(got)).toBe(4);
  });

  it('dragged by the top of its second piece, the event\'s own midnight lands under the pointer at 10:00', () => {
    // The grabbed point is two hours into the event, so its start lands two
    // hours before the drop row: 08:00 to 12:00 on the drop day.
    const got = moved({
      view: 'week',
      open: JANUARY_WEEK,
      ...OVERNIGHT,
      grab: ['January 13, 2026', '00:00'],
      drop: ['January 14, 2026', '10:00'],
    });
    expect(got).toEqual({ start: '2026-01-14T08:00:00.000Z', end: '2026-01-14T12:00:00.000Z' });
    expect(hoursBetween(got)).toBe(4);
  });

  it('dragged by its second piece at 01:00 and dropped at 01:00 two days on, it is the same night two days later', () => {
    const got = moved({
      view: 'week',
      open: JANUARY_WEEK,
      ...OVERNIGHT,
      grab: ['January 13, 2026', '01:00'],
      drop: ['January 15, 2026', '01:00'],
    });
    expect(got).toEqual({ start: '2026-01-14T22:00:00.000Z', end: '2026-01-15T02:00:00.000Z' });
  });

  it('dragged by its first piece to 23:00, it stays overnight instead of being held inside the drop day', () => {
    const got = moved({
      view: 'week',
      open: JANUARY_WEEK,
      ...OVERNIGHT,
      grab: ['January 12, 2026', '22:00'],
      drop: ['January 15, 2026', '23:00'],
    });
    expect(got).toEqual({ start: '2026-01-15T23:00:00.000Z', end: '2026-01-16T03:00:00.000Z' });
  });

  it('in the day view, where only its second piece is on screen, it keeps its four hours and the grabbed point', () => {
    // January 13th shows 00:00 to 02:00 of the event. Grabbed at its own
    // 00:00 and dropped at 03:00, its start goes to 01:00.
    const got = moved({
      view: 'day',
      open: '2026-01-13T12:00:00.000Z',
      ...OVERNIGHT,
      grab: ['January 13, 2026', '00:00'],
      drop: ['January 13, 2026', '03:00'],
    });
    expect(got).toEqual({ start: '2026-01-13T01:00:00.000Z', end: '2026-01-13T05:00:00.000Z' });
  });

  it('a 5-minute event keeps its five minutes, not the 15 minutes its piece is drawn', () => {
    const got = moved({
      view: 'week',
      open: JANUARY_WEEK,
      start: '2026-01-12T10:00:00.000Z',
      end: '2026-01-12T10:05:00.000Z',
      grab: ['January 12, 2026', '10:00'],
      drop: ['January 14, 2026', '13:00'],
    });
    expect(got).toEqual({ start: '2026-01-14T13:00:00.000Z', end: '2026-01-14T13:05:00.000Z' });
  });

  it('while it is dragged, the preview is labelled with the whole event\'s times', () => {
    const onEventDrop = vi.fn();
    render(
      <CalendarView
        events={[{ id: 'e1', title: TITLE, start: new Date(OVERNIGHT.start), end: new Date(OVERNIGHT.end) }]}
        view="week"
        locale="en-US"
        currentDate={new Date(JANUARY_WEEK)}
        onEventDrop={onEventDrop}
      />,
    );
    layOutColumns();
    const grabColumn = columnFor('January 12, 2026');
    const dropColumn = columnFor('January 14, 2026');
    const xIn = (column: HTMLElement) => column.getBoundingClientRect().left + COLUMN_WIDTH / 2;
    fireEvent.pointerDown(within(grabColumn).getByTitle(TITLE), { clientX: xIn(grabColumn), clientY: yOf('22:00'), button: 0 });
    fireEvent.pointerMove(window, { clientX: xIn(dropColumn), clientY: yOf('10:00') });
    const preview = dropColumn.querySelector('.border-dashed.border-primary');
    expect(preview, 'no move preview in the drop column').not.toBeNull();
    expect(preview!.textContent).toMatch(/^10:00\sAM – 2:00\sPM$/);
    fireEvent.pointerUp(window, { clientX: xIn(dropColumn), clientY: yOf('10:00') });
    expect(onEventDrop).toHaveBeenCalledTimes(1);
  });

  it('control: a same-day event moves as before, one hour kept', () => {
    const got = moved({
      view: 'week',
      open: JANUARY_WEEK,
      start: '2026-01-12T09:00:00.000Z',
      end: '2026-01-12T10:00:00.000Z',
      grab: ['January 12, 2026', '09:00'],
      drop: ['January 16, 2026', '11:00'],
    });
    expect(got).toEqual({ start: '2026-01-16T11:00:00.000Z', end: '2026-01-16T12:00:00.000Z' });
  });

  it('control: a same-day event dropped near midnight is still held inside the drop day', () => {
    const got = moved({
      view: 'week',
      open: JANUARY_WEEK,
      start: '2026-01-12T10:00:00.000Z',
      end: '2026-01-12T12:00:00.000Z',
      grab: ['January 12, 2026', '10:00'],
      drop: ['January 14, 2026', '23:30'],
    });
    expect(got).toEqual({ start: '2026-01-14T22:00:00.000Z', end: '2026-01-15T00:00:00.000Z' });
  });

  it('control: an event with no end is still handed the grid\'s one-hour end', () => {
    const got = moved({
      view: 'week',
      open: JANUARY_WEEK,
      start: '2026-01-12T09:00:00.000Z',
      grab: ['January 12, 2026', '09:00'],
      drop: ['January 16, 2026', '11:00'],
    });
    expect(got).toEqual({ start: '2026-01-16T11:00:00.000Z', end: '2026-01-16T12:00:00.000Z' });
  });
});

/** The week of Sunday October 25th to Saturday October 31st, 2026, the night the clocks fall back in the west. */
const OCTOBER_WEEK = '2026-10-28T19:00:00.000Z';

describe.runIf(DRIVEN)('CalendarView time-grid move across a DST change, west of UTC (objectui#11037)', () => {
  it('rig: the zone really moved', () => {
    process.env.TZ = WEST;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date('2026-10-06T04:00:00.000Z').getHours()).toBe(21);
  });

  it('fixture validity: 22:00 on October 31st to 02:00 on November 1st is five hours here', () => {
    process.env.TZ = WEST;
    expect((new Date(2026, 10, 1, 2).getTime() - new Date(2026, 9, 31, 22).getTime()) / HOUR).toBe(5);
  });

  it('a 22:00 to 02:00 event moved onto the fall-back night keeps four elapsed hours, and the clock reads 22:00 to 01:00', () => {
    // 22:00 PDT on October 27th to 02:00 PDT on the 28th, four hours.
    const got = moved(
      {
        view: 'week',
        open: OCTOBER_WEEK,
        start: '2026-10-28T05:00:00.000Z',
        end: '2026-10-28T09:00:00.000Z',
        grab: ['October 27, 2026', '22:00'],
        drop: ['October 31, 2026', '22:00'],
      },
      WEST,
    );
    // 22:00 PDT on October 31st to 01:00 PST on November 1st.
    expect(got).toEqual({ start: '2026-11-01T05:00:00.000Z', end: '2026-11-01T09:00:00.000Z' });
    expect(hoursBetween(got)).toBe(4);
    expect(new Date(got.start).getHours()).toBe(22);
    expect(new Date(got.end!).getHours()).toBe(1);
  });

  it('control: moved onto an ordinary night, it reads 22:00 to 02:00', () => {
    const got = moved(
      {
        view: 'week',
        open: OCTOBER_WEEK,
        start: '2026-10-28T05:00:00.000Z',
        end: '2026-10-28T09:00:00.000Z',
        grab: ['October 27, 2026', '22:00'],
        drop: ['October 29, 2026', '22:00'],
      },
      WEST,
    );
    // 22:00 PDT on October 29th to 02:00 PDT on the 30th.
    expect(got).toEqual({ start: '2026-10-30T05:00:00.000Z', end: '2026-10-30T09:00:00.000Z' });
    expect(new Date(got.end!).getHours()).toBe(2);
  });
});

describe.runIf(DRIVEN)('CalendarView time-grid move east of UTC, the zone without DST (objectui#11037)', () => {
  it('rig: the zone really moved', () => {
    process.env.TZ = EAST;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date('2026-10-06T04:00:00.000Z').getHours()).toBe(12);
  });

  it('the same move onto October 31st keeps four hours and reads 22:00 to 02:00', () => {
    // 22:00 CST on October 27th to 02:00 CST on the 28th.
    const got = moved(
      {
        view: 'week',
        open: OCTOBER_WEEK,
        start: '2026-10-27T14:00:00.000Z',
        end: '2026-10-27T18:00:00.000Z',
        grab: ['October 27, 2026', '22:00'],
        drop: ['October 31, 2026', '22:00'],
      },
      EAST,
    );
    expect(got).toEqual({ start: '2026-10-31T14:00:00.000Z', end: '2026-10-31T18:00:00.000Z' });
    expect(new Date(got.end!).getHours()).toBe(2);
  });
});
