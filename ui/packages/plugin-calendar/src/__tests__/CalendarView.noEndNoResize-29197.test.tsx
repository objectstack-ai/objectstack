/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29197 — an event with no stored end is a point in time, so no
 * view draws a resize handle on it.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * `CalendarView`'s `endEditable={false}` says the events have no stored end.
 * The week and day views then draw neither the bottom "Resize end" handle nor
 * the top "Resize start" one: against an unstored end, dragging the top edge
 * only rewrote the start and redrew the event an hour long, so it read as a
 * move. Moving the event stays a drag of its body. `ObjectCalendar` passes
 * `false` when the view declares no `endDateField`.
 *
 * The `calendar-view` renderer forwards a host's boolean `endEditable` the way
 * it forwards `slotMinutes`. It does not derive one from `endDateField`: that
 * key defaults to `end`, so every node names an end field.
 *
 * A view whose events have a stored end keeps both handles.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { SchemaRenderer } from '@object-ui/react';
import { ObjectCalendar } from '../ObjectCalendar';
import { CalendarView, type CalendarViewEvent } from '../CalendarView';
// Module scope: the `calendar-view` registration the renderer cases render
// through (ui/AGENTS.md, test discipline: never inside a hook).
import '../index';

const TITLE = 'Build homepage';

const MONTH_HANDLE = 'Resize event end';
const GRID_HANDLE = { top: 'Resize start', bottom: 'Resize end' } as const;

/**
 * Thursday January 15th, 2026: the day the day view opens on, inside the week
 * of the 11th to the 17th. The `ObjectCalendar` records sit on it.
 */
const CLOCK = '2026-01-15T12:00:00.000Z';

const OBJECT_SCHEMA = {
  name: 'task',
  fields: {
    name: { type: 'text' },
    starts_at: { type: 'datetime' },
    ends_at: { type: 'datetime' },
    all_day: { type: 'boolean' },
  },
};

/**
 * With no end field a record is all-day, drawn in the all-day lane with no
 * handle, unless the view declares `allDayField`: then a record flagged not
 * all-day is drawn timed, an hour long, in the time grid.
 */
const TIMED_NO_END = { startDateField: 'starts_at', allDayField: 'all_day' };

const timed: CalendarViewEvent = {
  id: 'e1',
  title: TITLE,
  start: new Date(2026, 0, 12, 9),
  end: new Date(2026, 0, 12, 11),
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function handlesOn(piece: HTMLElement) {
  return {
    top: within(piece).queryByLabelText(GRID_HANDLE.top),
    bottom: within(piece).queryByLabelText(GRID_HANDLE.bottom),
  };
}

function mountObjectCalendar(
  calendar: Record<string, unknown>,
  row: Record<string, unknown>,
  defaultView: 'week' | 'day',
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

describe('CalendarView endEditable={false}: no resize handle in the time grid (objectstack#29197)', () => {
  for (const view of ['week', 'day'] as const) {
    it(`${view} view: neither the top nor the bottom handle is drawn`, () => {
      render(
        <CalendarView
          events={[timed]}
          view={view}
          currentDate={new Date(2026, 0, 12)}
          onEventDrop={vi.fn()}
          endEditable={false}
        />,
      );
      const { top, bottom } = handlesOn(screen.getByTitle(TITLE));
      expect(top).toBeNull();
      expect(bottom).toBeNull();
    });

    it(`control: ${view} view, endEditable left at its default, draws both handles`, () => {
      render(
        <CalendarView events={[timed]} view={view} currentDate={new Date(2026, 0, 12)} onEventDrop={vi.fn()} />,
      );
      const { top, bottom } = handlesOn(screen.getByTitle(TITLE));
      expect(top).not.toBeNull();
      expect(bottom).not.toBeNull();
    });
  }
});

describe('ObjectCalendar with no endDateField: no resize handle in the time grid (objectstack#29197)', () => {
  for (const view of ['week', 'day'] as const) {
    it(`${view} view: a view with no end field draws no top handle`, async () => {
      mountObjectCalendar(TIMED_NO_END, { starts_at: '2026-01-15T09:00:00.000Z', all_day: false }, view);
      const { top, bottom } = handlesOn(await screen.findByTitle(TITLE));
      expect(top).toBeNull();
      expect(bottom).toBeNull();
    });

    it(`control: ${view} view, a view with an end field draws both handles`, async () => {
      mountObjectCalendar(
        { startDateField: 'starts_at', endDateField: 'ends_at' },
        { starts_at: '2026-01-15T09:00:00.000Z', ends_at: '2026-01-15T11:00:00.000Z' },
        view,
      );
      const { top, bottom } = handlesOn(await screen.findByTitle(TITLE));
      expect(top).not.toBeNull();
      expect(bottom).not.toBeNull();
    });
  }
});

describe('calendar-view renderer forwards a host endEditable (objectstack#29197)', () => {
  /** A timed record with an end, on Monday January 12th, 2026. */
  const data = [
    {
      id: 'r1',
      title: TITLE,
      start: new Date(2026, 0, 12, 9).toISOString(),
      end: new Date(2026, 0, 12, 11).toISOString(),
      allDay: false,
    },
  ];

  function mountNode(view: 'month' | 'week', host: Record<string, unknown>) {
    render(
      <SchemaRenderer
        schema={{ type: 'plugin-calendar:calendar-view', id: 'n', view, currentDate: '2026-01-12', data } as never}
        // A React host's own props: `SchemaRenderer` hands them to the widget.
        {...host}
      />,
    );
  }

  it('week view: a host endEditable false draws neither time-grid handle', async () => {
    mountNode('week', { onEventDrop: vi.fn(), endEditable: false });
    const { top, bottom } = handlesOn(await screen.findByTitle(TITLE));
    expect(top).toBeNull();
    expect(bottom).toBeNull();
  });

  it('month view: a host endEditable false draws no resize-end handle', async () => {
    mountNode('month', { onEventDrop: vi.fn(), endEditable: false });
    await screen.findAllByTitle(TITLE);
    expect(screen.queryAllByLabelText(MONTH_HANDLE)).toHaveLength(0);
  });

  it('control: with no endEditable from the host, the week view draws both handles', async () => {
    mountNode('week', { onEventDrop: vi.fn() });
    const { top, bottom } = handlesOn(await screen.findByTitle(TITLE));
    expect(top).not.toBeNull();
    expect(bottom).not.toBeNull();
  });

  it('control: a non-boolean endEditable gets the absent-key answer, both handles drawn', async () => {
    mountNode('week', { onEventDrop: vi.fn(), endEditable: 'false' });
    const { top, bottom } = handlesOn(await screen.findByTitle(TITLE));
    expect(top).not.toBeNull();
    expect(bottom).not.toBeNull();
  });
});
