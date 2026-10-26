/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `plugin-calendar:calendar-view` — the authored `events` collision
 * (objectui#4433, measured by the objectui#4425 phase-1 sweep).
 *
 * The renderer computes a `CalendarViewEvent[]` from `schema.data` and passes it as
 * `events={…}`, then spreads the remaining props AFTER it. `SchemaRenderer`
 * forwards a node's `events` key as a prop — it is not on the renderer's strip
 * list — so a node authoring `events`, the ordinary SDUI action metadata of
 * AGENTS.md section 4 that is legal on any node, landed its `{ onClick: [...] }`
 * OBJECT on the `events` ARRAY prop. `CalendarView` iterates it and throws
 * `events is not iterable`: a spec-legal node lost its calendar to an error
 * card.
 *
 * Two shapes, one collision, and the second is the quiet one:
 *
 *   - an authored `events` OBJECT crashed the component (the reported defect);
 *   - an authored `events` ARRAY did NOT crash — it is iterable, so it silently
 *     REPLACED the computed calendar with itself. Same overwrite, no error
 *     card, so nothing would have reported it.
 *
 * Both are pinned below, because a fix that only stopped the throw would leave
 * the second half live.
 *
 * The authored key is destructured out before the spread (the objectui#4357 /
 * PR #4428 deny-list precedent), so the computed array always wins. That is not
 * a disabled feature: no code in the renderer layer consumes a node's `events`
 * key — `SchemaRenderer` forwards it as a prop and nothing reads it, and the
 * repo's action path is `properties.action` through `ActionRunner`. On this node
 * type the key has never done anything but crash. The last case here pins the
 * action channel this component DOES have, so the strip cannot be mistaken for
 * removing one.
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

/** The SDUI action metadata of AGENTS.md section 4 — legal on any node. */
const AUTHORED_EVENTS = { onClick: [{ action: 'navigate', params: { url: '/x' } }] };

/** Two records in the CURRENT month, so the default month view shows them. */
function currentMonthRecords() {
  const now = new Date();
  const day = (n: number) => new Date(now.getFullYear(), now.getMonth(), n, 10, 0, 0, 0).toISOString();
  return [
    { id: 'r1', title: 'Computed Standup', start: day(10) },
    { id: 'r2', title: 'Computed Review', start: day(12) },
  ];
}

function calendarRegion(): Element | null {
  return document.body.querySelector('[role="region"][aria-label="Calendar"]');
}

describe('calendar-view: authored `events` never reaches CalendarView (objectui#4433)', () => {
  it('renders the calendar for a node whose only authored key is `events`', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              events: AUTHORED_EVENTS,
            } as never
          }
        />,
      );

      // The card's own minimal repro. Before the fix this rendered
      // `SchemaErrorBoundary` with `events is not iterable`.
      await waitFor(() => expect(calendarRegion()).not.toBeNull());
      expect(document.body.textContent ?? '').not.toContain(ERROR_BOUNDARY_MARKER);
      expect(document.body.textContent ?? '').not.toContain('events is not iterable');
    } finally {
      errors.mockRestore();
    }
  });

  it('still displays the events computed from `schema.data` when `events` is authored', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: currentMonthRecords(),
              events: AUTHORED_EVENTS,
            } as never
          }
        />,
      );

      // Protecting the prop into emptiness would satisfy "does not crash" and
      // still lose the calendar's contents, so the computed events are asserted
      // present, not merely non-throwing.
      await waitFor(() => expect(calendarRegion()).not.toBeNull());
      expect(await screen.findByRole('button', { name: 'Computed Standup' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Computed Review' })).toBeTruthy();
    } finally {
      errors.mockRestore();
    }
  });

  it('does not let an authored `events` ARRAY replace the computed events', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: currentMonthRecords(),
              // Iterable, so this half of the collision never threw: it just
              // took the calendar over.
              events: [
                {
                  id: 'authored',
                  title: 'Authored Overwrite',
                  start: new Date(),
                },
              ],
            } as never
          }
        />,
      );

      await waitFor(() => expect(calendarRegion()).not.toBeNull());
      expect(await screen.findByRole('button', { name: 'Computed Standup' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Authored Overwrite' })).toBeNull();
    } finally {
      errors.mockRestore();
    }
  });

  it('leaves the component\'s own action channel working while `events` is authored', async () => {
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
              events: AUTHORED_EVENTS,
            } as never
          }
          onAction={onAction}
        />,
      );

      await waitFor(() => expect(calendarRegion()).not.toBeNull());
      fireEvent.click(await screen.findByRole('button', { name: 'Computed Standup' }));

      // `onAction` is this component's real action channel (the host's prop),
      // and it is unaffected by stripping the authored key.
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
});
