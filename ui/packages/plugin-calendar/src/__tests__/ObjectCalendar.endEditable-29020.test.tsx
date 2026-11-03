/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29020 — a calendar whose view declares no `endDateField` draws
 * no handle that moves an event's end on its own, and no drop writes a date
 * the record already has.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * With no end field the end is not stored, so an end-only edit has nothing to
 * write: the month view's "Resize event end" handle and the week and day
 * views' resize handles are not drawn (`CalendarView`'s `endEditable`, which
 * `ObjectCalendar` sets from `endDateField`). The time grid's top "Resize
 * start" handle goes too (objectstack#29197): against an unstored end it only
 * moved the event. A view that declares an end field keeps every handle and
 * keeps writing the end.
 *
 * `ObjectCalendar`'s default drop handler writes nothing when every date it
 * would write is where the record already has it: a write of unchanged values
 * still moves `updated_at` and runs every after-update trigger and flow. A
 * press and release on a week-view event, without moving it, is such a drop.
 *
 * The week-view cases with no end field declare `allDayField`: without it a
 * record with no end is all-day and is drawn in the all-day lane, which has
 * no handles and no pointer drag.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { ObjectCalendar } from '../ObjectCalendar';
import { CalendarView, type CalendarViewEvent } from '../CalendarView';

const TITLE = 'Build homepage';

/** The grid draws 48 px per hour. */
const PX_PER_HOUR = 48;
const COLUMN_WIDTH = 100;

const MONTH_HANDLE = 'Resize event end';
const GRID_HANDLE = { top: 'Resize start', bottom: 'Resize end' } as const;

/** Thursday January 15th, 2026: the month and the week of the 11th to the 17th. */
const CLOCK = '2026-01-15T12:00:00.000Z';

const OBJECT_SCHEMA = {
  name: 'task',
  fields: {
    name: { type: 'text' },
    due_date: { type: 'date' },
    end_date: { type: 'date' },
    starts_at: { type: 'datetime' },
    ends_at: { type: 'datetime' },
    all_day: { type: 'boolean' },
  },
};

/**
 * A record with no end is drawn in the all-day lane, which carries no handle,
 * unless the view declares `allDayField`: then a record flagged not all-day is
 * drawn timed, an hour long, with both resize handles before this change.
 */
const TIMED_NO_END = { startDateField: 'starts_at', allDayField: 'all_day' };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount(
  calendar: Record<string, unknown>,
  row: Record<string, unknown>,
  defaultView: 'month' | 'week' = 'month',
) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(CLOCK));
  const ds = {
    getObjectSchema: vi.fn(async () => OBJECT_SCHEMA),
    find: vi.fn(async () => ({ value: [{ id: 't1', name: TITLE, ...row }] })),
    update: vi.fn(async () => ({})),
    create: vi.fn(async () => ({ id: 't2' })),
  };
  const schema = {
    type: 'object-calendar',
    objectName: 'task',
    defaultView,
    calendar: { titleField: 'name', ...calendar },
  } as never;
  render(
    <LocalizationProvider value={{ locale: 'en-US' }}>
      <ObjectCalendar schema={schema} dataSource={ds as never} />
    </LocalizationProvider>,
  );
  return ds;
}

/** `January 12, 2026` out of a month cell's accessible name. */
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

/** The time-grid column whose accessible name carries `day`. */
function columnFor(day: string): HTMLElement {
  const column = screen
    .getAllByLabelText(new RegExp(day))
    .find((el) => el.classList.contains('select-none'));
  expect(column, `no time-grid column for ${day}`).toBeDefined();
  return column as HTMLElement;
}

/** jsdom measures nothing: lay the columns out side by side, each a full 24-hour column. */
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

/** Press and release on the event's body at `at`, without moving the pointer. */
function pressAndRelease(day: string, at: string): void {
  layOutColumns();
  const column = columnFor(day);
  const piece = within(column).getByTitle(TITLE);
  const x = column.getBoundingClientRect().left + COLUMN_WIDTH / 2;
  fireEvent.pointerDown(piece, { clientX: x, clientY: yOf(at), button: 0 });
  fireEvent.pointerUp(window, { clientX: x, clientY: yOf(at) });
}

describe('ObjectCalendar month view: the resize-end handle follows endDateField (objectstack#29020)', () => {
  it('a view with no end field draws no resize-end handle on any card', async () => {
    mount({ startDateField: 'due_date' }, { due_date: '2026-01-12' });
    await screen.findAllByLabelText(TITLE);
    expect(screen.queryAllByLabelText(MONTH_HANDLE)).toHaveLength(0);
  });

  it('a view with no end field still moves the card, writing the start alone', async () => {
    const ds = mount({ startDateField: 'due_date' }, { due_date: '2026-01-12' });
    await screen.findAllByLabelText(TITLE);
    const [pill] = within(cellFor('January 12, 2026')).getAllByLabelText(TITLE);
    performDnd(pill, cellFor('January 13, 2026'));
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledWith('task', 't1', { due_date: '2026-01-13' });
  });

  it('control: a view with an end field draws the handle, and dragging it writes the new end', async () => {
    const ds = mount(
      { startDateField: 'due_date', endDateField: 'end_date' },
      { due_date: '2026-01-12', end_date: '2026-01-13' },
    );
    await screen.findAllByLabelText(TITLE);
    const handles = within(cellFor('January 13, 2026')).getAllByLabelText(MONTH_HANDLE);
    expect(handles).toHaveLength(1);
    performDnd(handles[0], cellFor('January 15, 2026'));
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledWith('task', 't1', { due_date: '2026-01-12', end_date: '2026-01-15' });
  });

  it('control: a view with an end field keeps the handle on a record whose end is empty, and writes the end', async () => {
    const ds = mount({ startDateField: 'due_date', endDateField: 'end_date' }, { due_date: '2026-01-12' });
    await screen.findAllByLabelText(TITLE);
    const handles = within(cellFor('January 12, 2026')).getAllByLabelText(MONTH_HANDLE);
    performDnd(handles[0], cellFor('January 14, 2026'));
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledWith('task', 't1', { due_date: '2026-01-12', end_date: '2026-01-14' });
  });
});

describe('ObjectCalendar week view: the resize handles follow endDateField (objectstack#29020, objectstack#29197)', () => {
  it('a view with no end field draws neither the top nor the bottom handle', async () => {
    mount(TIMED_NO_END, { starts_at: '2026-01-12T09:00:00.000Z', all_day: false }, 'week');
    const piece = await screen.findByTitle(TITLE);
    expect(within(piece).queryByLabelText(GRID_HANDLE.top)).toBeNull();
    expect(within(piece).queryByLabelText(GRID_HANDLE.bottom)).toBeNull();
  });

  it('control: a view with an end field draws both handles', async () => {
    mount(
      { startDateField: 'starts_at', endDateField: 'ends_at' },
      { starts_at: '2026-01-12T09:00:00.000Z', ends_at: '2026-01-12T11:00:00.000Z' },
      'week',
    );
    const piece = await screen.findByTitle(TITLE);
    expect(within(piece).queryByLabelText(GRID_HANDLE.top)).not.toBeNull();
    expect(within(piece).queryByLabelText(GRID_HANDLE.bottom)).not.toBeNull();
  });
});

describe('ObjectCalendar writes nothing for a drop that changes no date (objectstack#29020)', () => {
  it('a press and release on a week-view event with no end field writes nothing', async () => {
    const ds = mount(TIMED_NO_END, { starts_at: '2026-01-12T09:00:00.000Z', all_day: false }, 'week');
    await screen.findByTitle(TITLE);
    pressAndRelease('January 12, 2026', '09:00');
    // Flush the handler's microtasks before reading the absence.
    await Promise.resolve();
    expect(ds.update).not.toHaveBeenCalled();
  });

  it('a press and release on a week-view event with an end field writes nothing', async () => {
    const ds = mount(
      { startDateField: 'starts_at', endDateField: 'ends_at' },
      { starts_at: '2026-01-12T09:00:00.000Z', ends_at: '2026-01-12T11:00:00.000Z' },
      'week',
    );
    await screen.findByTitle(TITLE);
    pressAndRelease('January 12, 2026', '09:00');
    await Promise.resolve();
    expect(ds.update).not.toHaveBeenCalled();
  });

  it('control: a week-view event moved two hours writes its new start', async () => {
    const ds = mount(TIMED_NO_END, { starts_at: '2026-01-12T09:00:00.000Z', all_day: false }, 'week');
    await screen.findByTitle(TITLE);
    layOutColumns();
    const column = columnFor('January 12, 2026');
    const piece = within(column).getByTitle(TITLE);
    const x = column.getBoundingClientRect().left + COLUMN_WIDTH / 2;
    fireEvent.pointerDown(piece, { clientX: x, clientY: yOf('09:00'), button: 0 });
    fireEvent.pointerMove(window, { clientX: x, clientY: yOf('11:00') });
    fireEvent.pointerUp(window, { clientX: x, clientY: yOf('11:00') });
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledWith('task', 't1', { starts_at: '2026-01-12T11:00:00.000Z' });
  });
});

describe('CalendarView endEditable (objectstack#29020)', () => {
  const event: CalendarViewEvent = {
    id: 'e1',
    title: TITLE,
    start: new Date(2026, 0, 12),
    end: new Date(2026, 0, 13),
    allDay: true,
  };

  it('defaults to true: the month view draws the resize-end handle', () => {
    render(<CalendarView events={[event]} view="month" currentDate={new Date(2026, 0, 15)} onEventDrop={vi.fn()} />);
    expect(screen.queryAllByLabelText(MONTH_HANDLE).length).toBeGreaterThan(0);
  });

  it('false: the month view draws no resize-end handle, and the card still moves', () => {
    const onEventDrop = vi.fn();
    render(
      <CalendarView
        events={[event]}
        view="month"
        currentDate={new Date(2026, 0, 15)}
        onEventDrop={onEventDrop}
        endEditable={false}
      />,
    );
    expect(screen.queryAllByLabelText(MONTH_HANDLE)).toHaveLength(0);
    const [pill] = within(screen.getByLabelText(/Monday, January 12, 2026/i)).getAllByTitle(TITLE);
    performDnd(pill, screen.getByLabelText(/Wednesday, January 14, 2026/i));
    expect(onEventDrop).toHaveBeenCalledTimes(1);
  });

  it('false: a resize-end payload dropped anyway hands nothing back', () => {
    const onEventDrop = vi.fn();
    render(
      <CalendarView
        events={[event]}
        view="month"
        currentDate={new Date(2026, 0, 15)}
        onEventDrop={onEventDrop}
        endEditable={false}
      />,
    );
    const payload = JSON.stringify({ id: 'e1', mode: 'resize-end' });
    const dataTransfer = { getData: () => payload, setData: () => {}, dropEffect: '', effectAllowed: '' };
    fireEvent.drop(screen.getByLabelText(/Thursday, January 15, 2026/i), { dataTransfer });
    expect(onEventDrop).not.toHaveBeenCalled();
  });

  it('false: the week view draws neither the top nor the bottom handle (objectstack#29197)', () => {
    const timed: CalendarViewEvent = {
      id: 'e2',
      title: TITLE,
      start: new Date(2026, 0, 12, 9),
      end: new Date(2026, 0, 12, 11),
    };
    render(
      <CalendarView
        events={[timed]}
        view="week"
        currentDate={new Date(2026, 0, 15)}
        onEventDrop={vi.fn()}
        endEditable={false}
      />,
    );
    const piece = screen.getByTitle(TITLE);
    expect(within(piece).queryByLabelText(GRID_HANDLE.top)).toBeNull();
    expect(within(piece).queryByLabelText(GRID_HANDLE.bottom)).toBeNull();
  });
});
