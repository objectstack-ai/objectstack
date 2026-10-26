/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11060 — a resize in the week and day views moves one edge of the
 * EVENT and keeps the other where the event truly has it, not where the
 * grabbed piece is clipped.
 *
 * ── What was measured before this change ────────────────────────────────────
 * The time grid draws an event that crosses midnight as one piece per day,
 * clipped at midnight, and a short event as a piece at least 15 minutes tall.
 * The top handle sits only on the event's first piece, the bottom handle only
 * on its last. A resize rebuilt BOTH edges on the grabbed piece's day, the
 * untouched one from that piece's clipped bound. So a 22:00 to 02:00 event:
 *  - resized by its top handle to 21:00 was written 21:00 to 00:00, the two
 *    hours past midnight gone (a press and release without moving did the
 *    same);
 *  - resized by its bottom handle to 03:00 was written 00:00 to 03:00, its
 *    start moved to midnight.
 * A 5-minute event resized by its top handle came back ending 15 minutes after
 * its start, the drawn piece's height.
 *
 * ── The rule now ────────────────────────────────────────────────────────────
 * The top handle changes only the start and the bottom handle only the end.
 * The other edge is the event's own instant, handed back unchanged. The
 * dragged edge is placed as before, at the pointer's row on the grabbed
 * piece's day, snapped, and held one slot away from the kept edge, wherever
 * that edge falls.
 *
 * No zone cases: the kept edge is the event's own instant, not rebuilt on any
 * clock, and the dragged edge's arithmetic is unchanged.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CalendarView, type CalendarViewEvent } from '../CalendarView';

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
function layOutColumns(): void {
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
}

const yOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return ((h * 60 + m) / 60) * PX_PER_HOUR;
};

const HANDLE = { top: 'Resize start', bottom: 'Resize end' } as const;

interface Resize {
  view: 'week' | 'day';
  /** An instant inside the week (or the day) the grid opens on. */
  open: string;
  start: string;
  /** Omitted for an event with no end. */
  end?: string;
  handle: 'top' | 'bottom';
  /** The day whose piece carries the handle, and the row the handle is grabbed at. */
  grab: [day: string, at: string];
  /** The row the pointer is released at; omitted for a press and release without moving. */
  to?: string;
}

interface Written {
  start: string;
  end: string | undefined;
}

function renderGrid(r: Pick<Resize, 'view' | 'open' | 'start' | 'end'>, onEventDrop = vi.fn()) {
  const event: CalendarViewEvent = {
    id: 'e1',
    title: TITLE,
    start: new Date(r.start),
    ...(r.end ? { end: new Date(r.end) } : {}),
  };
  render(
    <CalendarView
      events={[event]}
      view={r.view}
      locale="en-US"
      currentDate={new Date(r.open)}
      onEventDrop={onEventDrop}
    />,
  );
  layOutColumns();
  return onEventDrop;
}

/** Grab `r.handle` on the piece in `r.grab`'s column and move the pointer to `r.to`. */
function grabHandle(r: Resize): HTMLElement {
  const column = columnFor(r.grab[0]);
  const piece = within(column).getByTitle(TITLE);
  const x = column.getBoundingClientRect().left + COLUMN_WIDTH / 2;
  fireEvent.pointerDown(within(piece).getByLabelText(HANDLE[r.handle]), {
    clientX: x,
    clientY: yOf(r.grab[1]),
    button: 0,
  });
  const at = yOf(r.to ?? r.grab[1]);
  if (r.to) fireEvent.pointerMove(window, { clientX: x, clientY: at });
  return column;
}

/** Run one time-grid resize and hand back the instants `onEventDrop` got. */
function resized(r: Resize): Written {
  const onEventDrop = renderGrid(r);
  const column = grabHandle(r);
  const x = column.getBoundingClientRect().left + COLUMN_WIDTH / 2;
  fireEvent.pointerUp(window, { clientX: x, clientY: yOf(r.to ?? r.grab[1]) });

  expect(onEventDrop).toHaveBeenCalledTimes(1);
  const [, newStart, newEnd] = onEventDrop.mock.calls[0] as [unknown, Date, Date | undefined];
  cleanup();
  return { start: newStart.toISOString(), end: newEnd?.toISOString() };
}

/** The week of Sunday January 11th to Saturday January 17th, 2026. */
const JANUARY_WEEK = '2026-01-15T12:00:00.000Z';

/** 22:00 on Monday January 12th to 02:00 on Tuesday the 13th, in the suite zone (UTC). */
const OVERNIGHT = { start: '2026-01-12T22:00:00.000Z', end: '2026-01-13T02:00:00.000Z' };

const FIRST_DAY = 'January 12, 2026';
const SECOND_DAY = 'January 13, 2026';

describe('CalendarView time-grid resize keeps the event\'s other edge, in the suite zone (objectui#11060)', () => {
  it('an overnight event carries the top handle on its first piece and the bottom handle on its last', () => {
    renderGrid({ view: 'week', open: JANUARY_WEEK, ...OVERNIGHT });
    const first = within(columnFor(FIRST_DAY)).getByTitle(TITLE);
    const second = within(columnFor(SECOND_DAY)).getByTitle(TITLE);
    expect(within(first).queryByLabelText(HANDLE.top)).not.toBeNull();
    expect(within(first).queryByLabelText(HANDLE.bottom)).toBeNull();
    expect(within(second).queryByLabelText(HANDLE.top)).toBeNull();
    expect(within(second).queryByLabelText(HANDLE.bottom)).not.toBeNull();
  });

  it.each(['week', 'day'] as const)(
    '%s view: the top handle of its first piece dragged to 21:00 moves the start and keeps the end at 02:00',
    (view) => {
      const got = resized({
        view,
        open: view === 'week' ? JANUARY_WEEK : '2026-01-12T12:00:00.000Z',
        ...OVERNIGHT,
        handle: 'top',
        grab: [FIRST_DAY, '22:00'],
        to: '21:00',
      });
      expect(got).toEqual({ start: '2026-01-12T21:00:00.000Z', end: OVERNIGHT.end });
    },
  );

  it.each(['week', 'day'] as const)(
    '%s view: the bottom handle of its second piece dragged to 03:00 moves the end and keeps the start at 22:00',
    (view) => {
      const got = resized({
        view,
        open: view === 'week' ? JANUARY_WEEK : '2026-01-13T12:00:00.000Z',
        ...OVERNIGHT,
        handle: 'bottom',
        grab: [SECOND_DAY, '02:00'],
        to: '03:00',
      });
      expect(got).toEqual({ start: OVERNIGHT.start, end: '2026-01-13T03:00:00.000Z' });
    },
  );

  it('the top handle pressed and released without moving writes the event as it was', () => {
    const got = resized({ view: 'week', open: JANUARY_WEEK, ...OVERNIGHT, handle: 'top', grab: [FIRST_DAY, '22:00'] });
    expect(got).toEqual(OVERNIGHT);
  });

  it('the bottom handle pressed and released without moving writes the event as it was', () => {
    const got = resized({ view: 'week', open: JANUARY_WEEK, ...OVERNIGHT, handle: 'bottom', grab: [SECOND_DAY, '02:00'] });
    expect(got).toEqual(OVERNIGHT);
  });

  it('the top handle dragged to the foot of the first day stops one slot before the end past midnight', () => {
    // 23:00 to 00:10: the end is ten minutes into the second day, so the
    // start is held at 23:40, one 30-minute slot before it.
    const got = resized({
      view: 'week',
      open: JANUARY_WEEK,
      start: '2026-01-12T23:00:00.000Z',
      end: '2026-01-13T00:10:00.000Z',
      handle: 'top',
      grab: [FIRST_DAY, '23:00'],
      to: '24:00',
    });
    expect(got).toEqual({ start: '2026-01-12T23:40:00.000Z', end: '2026-01-13T00:10:00.000Z' });
  });

  it('the bottom handle dragged to the head of the second day stops one slot after the start before midnight', () => {
    // 23:50 to 01:00: the start is ten minutes before midnight, so the end is
    // held at 00:20, one 30-minute slot after it.
    const got = resized({
      view: 'week',
      open: JANUARY_WEEK,
      start: '2026-01-12T23:50:00.000Z',
      end: '2026-01-13T01:00:00.000Z',
      handle: 'bottom',
      grab: [SECOND_DAY, '01:00'],
      to: '00:00',
    });
    expect(got).toEqual({ start: '2026-01-12T23:50:00.000Z', end: '2026-01-13T00:20:00.000Z' });
  });

  it('a 5-minute event resized by its top handle keeps its own end, not the end of the 15 minutes its piece is drawn', () => {
    const got = resized({
      view: 'week',
      open: JANUARY_WEEK,
      start: '2026-01-12T10:00:00.000Z',
      end: '2026-01-12T10:05:00.000Z',
      handle: 'top',
      grab: [FIRST_DAY, '10:00'],
      to: '09:00',
    });
    expect(got).toEqual({ start: '2026-01-12T09:00:00.000Z', end: '2026-01-12T10:05:00.000Z' });
  });

  it.each([
    ['top', FIRST_DAY, '22:00', '21:00', /^9:00\sPM – 2:00\sAM$/, { top: yOf('21:00'), height: yOf('03:00') }],
    ['bottom', SECOND_DAY, '02:00', '03:00', /^10:00\sPM – 3:00\sAM$/, { top: 0, height: yOf('03:00') }],
  ] as const)(
    'while the %s handle is dragged, the preview is labelled with the whole event\'s times and stays inside the day',
    (handle, day, grabAt, to, label, box) => {
      const onEventDrop = renderGrid({ view: 'week', open: JANUARY_WEEK, ...OVERNIGHT });
      const column = grabHandle({ view: 'week', open: JANUARY_WEEK, ...OVERNIGHT, handle, grab: [day, grabAt], to });
      const preview = column.querySelector<HTMLElement>('.border-dashed.border-primary');
      expect(preview, 'no resize preview in the grabbed column').not.toBeNull();
      expect(preview!.textContent).toMatch(label);
      expect({ top: parseFloat(preview!.style.top), height: parseFloat(preview!.style.height) }).toEqual(box);
      fireEvent.pointerUp(window, { clientX: 0, clientY: yOf(to) });
      expect(onEventDrop).toHaveBeenCalledTimes(1);
    },
  );
});

describe('CalendarView time-grid resize of a same-day event is unchanged (objectui#11060 control)', () => {
  const SAME_DAY = { start: '2026-01-12T10:00:00.000Z', end: '2026-01-12T12:00:00.000Z' };

  it('the top handle dragged to 09:00 writes 09:00 to 12:00', () => {
    const got = resized({ view: 'week', open: JANUARY_WEEK, ...SAME_DAY, handle: 'top', grab: [FIRST_DAY, '10:00'], to: '09:00' });
    expect(got).toEqual({ start: '2026-01-12T09:00:00.000Z', end: SAME_DAY.end });
  });

  it('the bottom handle dragged to 13:00 writes 10:00 to 13:00', () => {
    const got = resized({ view: 'day', open: '2026-01-12T12:00:00.000Z', ...SAME_DAY, handle: 'bottom', grab: [FIRST_DAY, '12:00'], to: '13:00' });
    expect(got).toEqual({ start: SAME_DAY.start, end: '2026-01-12T13:00:00.000Z' });
  });

  it('the top handle dragged past the end is held one slot before it', () => {
    const got = resized({ view: 'week', open: JANUARY_WEEK, ...SAME_DAY, handle: 'top', grab: [FIRST_DAY, '10:00'], to: '13:00' });
    expect(got).toEqual({ start: '2026-01-12T11:30:00.000Z', end: SAME_DAY.end });
  });

  it('the bottom handle dragged past the start is held one slot after it', () => {
    const got = resized({ view: 'week', open: JANUARY_WEEK, ...SAME_DAY, handle: 'bottom', grab: [FIRST_DAY, '12:00'], to: '08:00' });
    expect(got).toEqual({ start: SAME_DAY.start, end: '2026-01-12T10:30:00.000Z' });
  });

  it('an event with no end is handed the grid\'s one-hour end by the top handle', () => {
    const got = resized({ view: 'week', open: JANUARY_WEEK, start: '2026-01-12T09:00:00.000Z', handle: 'top', grab: [FIRST_DAY, '09:00'], to: '08:00' });
    expect(got).toEqual({ start: '2026-01-12T08:00:00.000Z', end: '2026-01-12T10:00:00.000Z' });
  });
});
