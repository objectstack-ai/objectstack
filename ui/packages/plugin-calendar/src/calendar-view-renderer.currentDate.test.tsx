/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `plugin-calendar:calendar-view` — the declared `currentDate` input never
 * converted (objectui#4452).
 *
 * The registry declares the input as
 * `{ name: 'currentDate', type: 'string', description: 'ISO date string for
 * initial calendar date' }`, while `CalendarViewProps.currentDate` is a `Date`.
 * The renderer converted nothing: the authored string rode the trailing
 * `{...props}` spread into `CalendarView`, became `useState`'s initial
 * `selectedDate`, and the header called `selectedDate.toLocaleDateString(…)` on
 * a string — `selectedDate.toLocaleDateString is not a function`, the error
 * boundary instead of the calendar.
 *
 * This is the mirror of objectui#4433's collision, which the sibling file pins.
 * There an UNDOCUMENTED authored key overwrote a computed prop; here the
 * component documents the key, its type AND its format, and writing the one
 * spelling an author is told to write is what breaks it. There was no correct
 * authored value at all: `type: 'string'` cannot express a `Date`.
 *
 * The fix converts at the renderer boundary and destructures the key out of the
 * spread (the objectui#4433 consumed-key pattern), so `CalendarView` only ever
 * receives the `Date` its prop type declares.
 *
 * ## Two dates, deliberately
 *
 * The first case authors the card's verbatim repro string,
 * `2026-08-12T08:00:00.000Z`. It pins the crash — and ONLY the crash: that
 * instant is in the month this card was filed in, so a fix that quietly dropped
 * the authored date to "today" would still satisfy it. The honouring assertions
 * therefore use {@link farFutureDate}, 14 months out, where "the authored date
 * reached the calendar" and "the calendar fell back to today" are visibly
 * different renders.
 *
 * ## Why the assertions read year DIGITS, not a month name
 *
 * `CalendarView` formats its header with `toLocaleDateString(locale, …)` under
 * the ambient i18n language, so pinning "October 2027" would pin the test to a
 * locale rather than to the date. 14 months is more than a year, so the
 * authored month is always in a DIFFERENT calendar year than today: the year
 * digits alone separate honoured from dropped, in any Gregorian locale. The
 * event-visibility assertion is the locale-free half of the same fact — a month
 * grid only renders the events of the month it is showing.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
// Module scope: the registration side effect this file renders through
// (AGENTS.md 测试纪律 — never inside a hook).
import './index';

/** The text `SchemaErrorBoundary` renders when a widget throws. */
const ERROR_BOUNDARY_MARKER = 'failed to render';

/** The card's verbatim repro value. */
const ISSUE_REPRO_ISO = '2026-08-12T08:00:00.000Z';

/** What a `Date`-typed header renders when it is handed an unparseable value. */
const INVALID_DATE_MARKER = 'Invalid Date';

/**
 * A date 14 months from today at local noon on the 15th.
 *
 * 14 > 12, so this is always in a different calendar YEAR than today — the
 * property the header assertions rest on. The 15th keeps it in the middle of
 * the month grid, well away from the leading/trailing spill days a month view
 * borrows from its neighbours.
 */
function farFutureDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 14, 15, 12, 0, 0, 0);
}

function calendarRegion(): Element | null {
  return document.body.querySelector('[role="region"][aria-label="Calendar"]');
}

/**
 * The header's date label. `CalendarView` renders it into the popover
 * trigger's accessible name (`Current date: <label>`) and into its own span.
 */
function headerDateLabel(): string {
  const trigger = document.body.querySelector('[aria-label^="Current date:"]');
  return trigger?.getAttribute('aria-label') ?? '';
}

/** A record the month grid will show, on `date`'s own day. */
function recordOn(date: Date, title: string) {
  return { id: 'r-far', title, start: new Date(date).toISOString() };
}

async function expectCalendarRendered() {
  await waitFor(() => expect(calendarRegion()).not.toBeNull());
  expect(document.body.textContent ?? '').not.toContain(ERROR_BOUNDARY_MARKER);
}

describe('calendar-view: the declared `currentDate` ISO input reaches CalendarView as a Date (objectui#4452)', () => {
  it('renders the calendar for the card\'s verbatim repro node, not the error boundary', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: [{ id: 'r1', title: 'Repro Event', start: ISSUE_REPRO_ISO }],
              currentDate: ISSUE_REPRO_ISO,
            } as never
          }
        />,
      );

      // Before the fix this rendered `SchemaErrorBoundary` with
      // `selectedDate.toLocaleDateString is not a function`.
      await expectCalendarRendered();
      expect(document.body.textContent ?? '').not.toContain(
        'toLocaleDateString is not a function',
      );
    } finally {
      errors.mockRestore();
    }
  });

  it('honours the authored ISO date instead of falling back to today', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const authored = farFutureDate();
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: [recordOn(authored, 'Far Month Event')],
              currentDate: authored.toISOString(),
            } as never
          }
        />,
      );

      await expectCalendarRendered();

      // Not merely "did not crash": the authored month is the one on screen.
      // A fix that parsed the string and then dropped it would still render a
      // calendar, and would fail both of these.
      expect(headerDateLabel()).toContain(String(authored.getFullYear()));
      expect(headerDateLabel()).not.toContain(String(new Date().getFullYear()));
      expect(await screen.findByRole('button', { name: 'Far Month Event' })).toBeTruthy();
    } finally {
      errors.mockRestore();
    }
  });

  it('honours an authored ISO date written in the `props` container', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const authored = farFutureDate();
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: [recordOn(authored, 'Far Month Event')],
              // The second channel: `SchemaRenderer` spreads the `props`
              // container's contents as props too, so a fix that only handled
              // the node's own key would leave this half live.
              props: { currentDate: authored.toISOString() },
            } as never
          }
        />,
      );

      await expectCalendarRendered();
      expect(headerDateLabel()).toContain(String(authored.getFullYear()));
      expect(await screen.findByRole('button', { name: 'Far Month Event' })).toBeTruthy();
    } finally {
      errors.mockRestore();
    }
  });

  it('keeps user navigation from the authored date (the parsed Date must be stable across renders)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const authored = farFutureDate();
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: [recordOn(authored, 'Far Month Event')],
              currentDate: authored.toISOString(),
            } as never
          }
        />,
      );

      await expectCalendarRendered();
      const next = new Date(authored.getFullYear(), authored.getMonth() + 1, 15);

      fireEvent.click(screen.getByRole('button', { name: 'Next period' }));

      // `CalendarView` re-seeds `selectedDate` from `currentDate` in an effect
      // keyed on that prop's IDENTITY. A renderer that re-parsed the string
      // into a fresh `Date` on every render would hand it a new identity each
      // time — re-seeding on every render (so this click snaps straight back)
      // and looping the effect against its own `setState`. The move has to
      // stick.
      await waitFor(() => {
        expect(headerDateLabel()).toContain(String(next.getFullYear()));
        expect(screen.queryByRole('button', { name: 'Far Month Event' })).toBeNull();
      });
      expect(document.body.textContent ?? '').not.toContain(ERROR_BOUNDARY_MARKER);
    } finally {
      errors.mockRestore();
    }
  });

  it('treats an unparseable authored string as ABSENT — default date, no crash, no Invalid Date', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              currentDate: 'garbage',
            } as never
          }
        />,
      );

      // One resolver, one answer: off-spec input gets the same answer as an
      // absent key — the component's own default — and never an `Invalid Date`
      // object passed through to be rendered as text.
      await expectCalendarRendered();
      expect(headerDateLabel()).toContain(String(new Date().getFullYear()));
      expect(headerDateLabel()).not.toContain(INVALID_DATE_MARKER);
      expect(document.body.textContent ?? '').not.toContain(INVALID_DATE_MARKER);
    } finally {
      errors.mockRestore();
    }
  });

  /* ── must-not-change pins: green before AND after the fix ─────────────── */

  it('MUST-NOT-CHANGE: a node with no `currentDate` still opens on the default date', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const now = new Date();
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: [
                {
                  id: 'r1',
                  title: 'This Month Event',
                  start: new Date(now.getFullYear(), now.getMonth(), 15, 12, 0, 0, 0).toISOString(),
                },
              ],
            } as never
          }
        />,
      );

      await expectCalendarRendered();
      expect(headerDateLabel()).toContain(String(now.getFullYear()));
      expect(headerDateLabel()).not.toContain(INVALID_DATE_MARKER);
      expect(await screen.findByRole('button', { name: 'This Month Event' })).toBeTruthy();
    } finally {
      errors.mockRestore();
    }
  });

  it('MUST-NOT-CHANGE: a `Date` instance from a React host is passed through unchanged', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const hostDate = farFutureDate();
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: [recordOn(hostDate, 'Far Month Event')],
            } as never
          }
          // The host path: `SchemaRenderer` spreads its own extra props onto the
          // component last. This is the real `CalendarViewProps.currentDate`
          // type, and it must keep working exactly as before.
          currentDate={hostDate}
        />,
      );

      await expectCalendarRendered();
      expect(headerDateLabel()).toContain(String(hostDate.getFullYear()));
      expect(await screen.findByRole('button', { name: 'Far Month Event' })).toBeTruthy();
    } finally {
      errors.mockRestore();
    }
  });

  it('MUST-NOT-CHANGE: a `Date` instance authored on the node keeps working', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const authored = farFutureDate();
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: [recordOn(authored, 'Far Month Event')],
              // Not JSON-authorable, but reachable from a programmatic host
              // that builds the node in TS. Unchanged behaviour either way.
              currentDate: authored,
            } as never
          }
        />,
      );

      await expectCalendarRendered();
      expect(headerDateLabel()).toContain(String(authored.getFullYear()));
      expect(await screen.findByRole('button', { name: 'Far Month Event' })).toBeTruthy();
    } finally {
      errors.mockRestore();
    }
  });
});
