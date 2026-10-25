/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `plugin-calendar:calendar-view` — the renderer forwards only what it consumes
 * or declares (objectui#4453; the objectui#4425 phase-2 whitelist contract
 * applied to this widget).
 *
 * The renderer used to end in `<CalendarView … {...props} />`, where `props` was
 * everything `SchemaRenderer` hands a registered widget. Two collisions on that
 * spread were already user-reachable crashes with their own cards and their own
 * pin files next to this one — objectui#4433 (`events`) and objectui#4452
 * (`currentDate`). This file pins the third, which is the worst of the three:
 *
 *   an authored `onEventClick: 'NOT-A-FUNCTION'` renders a perfectly normal
 *   calendar and then throws `onEventClick is not a function` on the first
 *   click.
 *
 * ## Why this one is worse than an error boundary
 *
 * React does not route event-handler errors to `SchemaErrorBoundary`: a render
 * error becomes the boundary's tidy alert, but a handler error escapes to the
 * window as an UNCAUGHT error. So the calendar keeps looking fine while its
 * click handling is dead — nothing on screen says anything is wrong. The
 * assertions below therefore cannot use the boundary marker the sibling files
 * use; they capture the window `error` event, a synchronous throw out of
 * `fireEvent`, and `console.error` (see {@link clickErrors}), because which of
 * the three carries the report is the DOM implementation's business and not
 * this contract's.
 *
 * ## The two authoring channels
 *
 * Both are pinned for every authored case, per objectui#4452's lesson: the
 * node's own key, and the `props: { … }` container whose contents
 * `SchemaRenderer` spreads separately. A fix that only handled one would leave
 * the other half live.
 *
 * ## What must NOT change
 *
 * A host-passed FUNCTION is the component's genuine escape hatch — the working
 * path the card forbids breaking. It survives as a DECLARED, function-typed
 * hatch, and it keeps its old precedence: a host handler REPLACES the `onAction`
 * dispatch rather than running alongside it (that is what the trailing-props
 * spread did, so that is what is pinned).
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
// Module scope: the registration side effect this file renders through
// (AGENTS.md 测试纪律 — never inside a hook).
import './index';

/** The text `SchemaErrorBoundary` renders when a widget throws during RENDER. */
const ERROR_BOUNDARY_MARKER = 'failed to render';

/** The card's verbatim repro value, for both channels. */
const NOT_A_FUNCTION = 'NOT-A-FUNCTION';

/** Two records in the CURRENT month, so the default month view shows them. */
function currentMonthRecords() {
  const now = new Date();
  const day = (n: number) =>
    new Date(now.getFullYear(), now.getMonth(), n, 10, 0, 0, 0).toISOString();
  return [
    { id: 'r1', title: 'Computed Standup', start: day(10) },
    { id: 'r2', title: 'Computed Review', start: day(12) },
  ];
}

function calendarRegion(): Element | null {
  return document.body.querySelector('[role="region"][aria-label="Calendar"]');
}

/** Present only in the MONTH view — `TimeGridView` (week/day) has no such grid. */
function monthGrid(): Element | null {
  return document.body.querySelector('[role="grid"][aria-label="Calendar grid"]');
}

/** The header's date label, which `CalendarView` mirrors into the popover trigger. */
function headerDateLabel(): string {
  const trigger = document.body.querySelector('[aria-label^="Current date:"]');
  return trigger?.getAttribute('aria-label') ?? '';
}

async function expectCalendarRendered() {
  await waitFor(() => expect(calendarRegion()).not.toBeNull());
  expect(document.body.textContent ?? '').not.toContain(ERROR_BOUNDARY_MARKER);
}

/**
 * Run `act` and return every error report it produced, from all three channels
 * an uncaught handler error can take.
 *
 * A handler error is NOT a render error, so `SchemaErrorBoundary` never sees it
 * and the DOM stays intact — the only evidence is the report. Which channel
 * carries it depends on the DOM implementation (a real browser and happy-dom
 * both "report the exception" per the DOM spec, but a synchronous rethrow out of
 * `dispatchEvent` is also a legal shape), so all three are collected and the
 * assertion is on the UNION. That way this pin cannot go quietly green because
 * an environment changed which channel it reports on.
 */
function clickErrors(act: () => void): string[] {
  const seen: string[] = [];
  const onWindowError = (event: Event) => {
    const e = event as ErrorEvent;
    seen.push(`window.error: ${e.message || String(e.error)}`);
  };
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation((...args: unknown[]) => {
      const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
      // React logs plenty of its own noise here; only genuine TypeErrors of the
      // shape this card is about are evidence.
      if (text.includes('is not a function')) seen.push(`console.error: ${text}`);
    });
  window.addEventListener('error', onWindowError);
  try {
    act();
  } catch (err) {
    seen.push(`thrown: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    window.removeEventListener('error', onWindowError);
    consoleError.mockRestore();
  }
  return seen;
}

describe('calendar-view: an authored handler key can no longer crash a click (objectui#4453)', () => {
  it('drops an authored `onEventClick` string written on the NODE — the click is a no-op', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: currentMonthRecords(),
              // The card's repro, channel 1. An SDUI author writing JSON can
              // never produce a function here, so this value is always broken.
              onEventClick: NOT_A_FUNCTION,
            } as never
          }
        />,
      );

      // The calendar renders normally before AND after the fix — that is the
      // hazard: nothing on screen distinguishes the two.
      await expectCalendarRendered();
      const event = await screen.findByRole('button', { name: 'Computed Standup' });

      // Before the fix: `window.error: onEventClick is not a function`.
      expect(clickErrors(() => fireEvent.click(event))).toEqual([]);
      // Still a calendar afterwards, not a blank page.
      expect(calendarRegion()).not.toBeNull();
    } finally {
      errors.mockRestore();
    }
  });

  it('drops an authored `onEventClick` string written in the `props` CONTAINER', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: currentMonthRecords(),
              // Channel 2: `SchemaRenderer` spreads the container's contents as
              // props too, so a fix that only handled the node's own key would
              // leave this half live (objectui#4452's lesson).
              props: { onEventClick: NOT_A_FUNCTION },
            } as never
          }
        />,
      );

      await expectCalendarRendered();
      const event = await screen.findByRole('button', { name: 'Computed Standup' });

      expect(clickErrors(() => fireEvent.click(event))).toEqual([]);
      expect(calendarRegion()).not.toBeNull();
    } finally {
      errors.mockRestore();
    }
  });

  it('drops an authored `onAction` string — the SAME click, the same crash, the same answer', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: currentMonthRecords(),
              // `onAction` is the renderer's OWN action channel rather than a
              // forwarded prop, but it arrives through the identical props
              // channel and dies on the identical click: `onAction is not a
              // function`. Typing one and not the other would have been half a
              // fix.
              onAction: NOT_A_FUNCTION,
            } as never
          }
        />,
      );

      await expectCalendarRendered();
      const event = await screen.findByRole('button', { name: 'Computed Standup' });

      expect(clickErrors(() => fireEvent.click(event))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  it('drops an authored `onDateClick` string — the whole handler family, not just the reported key', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: currentMonthRecords(),
              onDateClick: NOT_A_FUNCTION,
            } as never
          }
        />,
      );

      await expectCalendarRendered();
      // Any day cell: the month grid's cells carry `role="gridcell"`.
      const cells = document.body.querySelectorAll('[role="gridcell"]');
      expect(cells.length).toBeGreaterThan(0);

      expect(clickErrors(() => fireEvent.click(cells[0]!))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  /* ── must-not-change: the host escape hatch ───────────────────────────── */

  it('MUST-NOT-CHANGE: a host FUNCTION through the trailing props still fires with the event payload', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onEventClick = vi.fn();
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: currentMonthRecords(),
            } as never
          }
          // The host path the card forbids breaking: `SchemaRenderer` spreads
          // its own extra props onto the component last.
          onEventClick={onEventClick}
        />,
      );

      await expectCalendarRendered();
      fireEvent.click(await screen.findByRole('button', { name: 'Computed Standup' }));

      expect(onEventClick).toHaveBeenCalledTimes(1);
      expect(onEventClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'r1', title: 'Computed Standup' }),
      );
    } finally {
      errors.mockRestore();
    }
  });

  it('MUST-NOT-CHANGE: a FUNCTION authored on the node (a programmatic host) still fires', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onEventClick = vi.fn();
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: currentMonthRecords(),
              // Not JSON-authorable, but reachable from a host that builds the
              // node in TS. The hatch discriminates on the VALUE's type, not on
              // which channel it arrived through, so this keeps working.
              onEventClick,
            } as never
          }
        />,
      );

      await expectCalendarRendered();
      fireEvent.click(await screen.findByRole('button', { name: 'Computed Standup' }));

      expect(onEventClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'r1', title: 'Computed Standup' }),
      );
    } finally {
      errors.mockRestore();
    }
  });

  it('MUST-NOT-CHANGE: with no host handler, the click still dispatches `onAction`', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onAction = vi.fn();
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: currentMonthRecords(),
            } as never
          }
          onAction={onAction}
        />,
      );

      await expectCalendarRendered();
      fireEvent.click(await screen.findByRole('button', { name: 'Computed Standup' }));

      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'event-click',
          payload: expect.objectContaining({ id: 'r1', title: 'Computed Standup' }),
        }),
      );
    } finally {
      errors.mockRestore();
    }
  });

  it('MUST-NOT-CHANGE: a host handler REPLACES the `onAction` dispatch (the old spread precedence)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onEventClick = vi.fn();
    const onAction = vi.fn();
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: currentMonthRecords(),
            } as never
          }
          onEventClick={onEventClick}
          onAction={onAction}
        />,
      );

      await expectCalendarRendered();
      fireEvent.click(await screen.findByRole('button', { name: 'Computed Standup' }));

      // The trailing spread used to overwrite `onEventClick={handleEventClick}`,
      // so a host handler has always suppressed the action dispatch. Restated
      // explicitly by the fix, and pinned here so it stays a decision rather
      // than a side effect of prop ordering.
      expect(onEventClick).toHaveBeenCalledTimes(1);
      expect(onAction).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});

describe('calendar-view: the rest of the forward set is consumed or declared (objectui#4453)', () => {
  it('MUST-NOT-CHANGE: the declared `view` input still reaches CalendarView', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: currentMonthRecords(),
              view: 'week',
            } as never
          }
        />,
      );

      await expectCalendarRendered();
      // `view` used to ride the raw spread; it is consumed explicitly now. The
      // month grid is the discriminator — only `MonthView` renders one.
      expect(monthGrid()).toBeNull();
    } finally {
      errors.mockRestore();
    }
  });

  it('MUST-NOT-CHANGE: a node with no `view` still opens on the month grid', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: currentMonthRecords(),
            } as never
          }
        />,
      );

      await expectCalendarRendered();
      expect(monthGrid()).not.toBeNull();
    } finally {
      errors.mockRestore();
    }
  });

  it('treats an off-enum `view` as ABSENT — a usable month calendar, not a bodyless one', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: currentMonthRecords(),
              // The registry declares `enum: ['month','week','day']`.
              // `CalendarView` renders its body under those three values only,
              // so before the fix this produced a header with NO calendar under
              // it at all.
              view: 'agenda',
            } as never
          }
        />,
      );

      await expectCalendarRendered();
      expect(monthGrid()).not.toBeNull();
      expect(await screen.findByRole('button', { name: 'Computed Standup' })).toBeTruthy();
    } finally {
      errors.mockRestore();
    }
  });

  it('renders through an authored `locale` that `Intl` rejects, instead of throwing out of render', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: currentMonthRecords(),
              // MEASURED: `toLocaleDateString('en_US')` throws
              // `RangeError: Incorrect locale information provided` — the
              // underscore spelling is the one a producer writes by accident.
              // Before the fix this string rode the spread into the header's
              // formatter and took the whole render down to the error boundary.
              locale: 'en_US',
            } as never
          }
        />,
      );

      await expectCalendarRendered();
      expect(document.body.textContent ?? '').not.toContain('Incorrect locale information');
    } finally {
      errors.mockRestore();
    }
  });

  it('MUST-NOT-CHANGE: a well-formed `locale` still reaches the header', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              // A December date, whose month name differs between the two
              // locales — unlike "August", which is spelled the same in both.
              currentDate: new Date(2027, 11, 15, 12, 0, 0, 0).toISOString(),
              locale: 'de-DE',
            } as never
          }
        />,
      );

      await expectCalendarRendered();
      expect(headerDateLabel()).toContain('Dezember');
    } finally {
      errors.mockRestore();
    }
  });

  it('MUST-NOT-CHANGE: `className` still lands on the calendar region', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: currentMonthRecords(),
              className: 'zz-authored-class',
            } as never
          }
        />,
      );

      await expectCalendarRendered();
      // `className` is a declared registry input, consumed and forwarded — and
      // `SchemaRenderer` sets it AFTER the node's `props` container, which is
      // why an authored `props.className` was never an exposure here
      // (objectui#4453's grading note).
      expect(calendarRegion()?.getAttribute('class') ?? '').toContain('zz-authored-class');
    } finally {
      errors.mockRestore();
    }
  });

  it('renders a node carrying the whole injected/authored tail at once', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              name: 'canary_node',
              data: currentMonthRecords(),
              // The keys `SchemaRenderer` injects or forwards that no longer
              // reach `CalendarView`: SDUI metadata, the aria surface, and the
              // open tail of authored keys a deny-list structurally cannot
              // enumerate.
              bind: 'data.revenue',
              events: { onClick: [{ action: 'navigate', params: { url: '/x' } }] },
              ariaLabel: 'Canary label',
              ariaDescribedBy: 'canary-desc',
              zzcanary: 'CANARY-STR',
              zzcanaryobj: { nested: true },
              reference_to: 'contacts',
              // Declared and registered here, and read by nobody, when this
              // canary was written. `colorMapping`'s declaration has since been
              // RETIRED (objectui#4493), which is why it belongs in the tail
              // above rather than beside `allowCreate` below: it is now an
              // ordinary unknown authored key.
              colorMapping: { meeting: 'blue' },
              // NOT part of the dropped tail any more. `allowCreate` is a
              // CONSUMED declared input as of objectui#4454 — it supplies the
              // `onAddClick` hatch, so this node also renders the header's
              // "New event" button. Kept on the canary so the combination is
              // exercised: turning the affordance on must not disturb anything
              // this file pins.
              allowCreate: true,
              props: { zzcanaryprop: 'CANARY-PROP' },
            } as never
          }
        />,
      );

      await expectCalendarRendered();
      // Still the real calendar with its computed events, not a degraded one.
      expect(await screen.findByRole('button', { name: 'Computed Standup' })).toBeTruthy();
      // The component's own accessible name is not overwritten by the node's.
      expect(calendarRegion()?.getAttribute('aria-label')).toBe('Calendar');
    } finally {
      errors.mockRestore();
    }
  });
});
