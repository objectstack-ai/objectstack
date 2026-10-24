/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `plugin-calendar:calendar-view` — the two declared-but-inert inputs, decided
 * by measurement in OPPOSITE directions (objectui#4454, objectui#4493).
 *
 * Both keys were the same defect on paper — an authorable input declared in the
 * registry with nothing reading it, the one state ADR-0049's enforce-or-remove
 * framing says must not persist — and the measurement separated them:
 *
 *   - `allowCreate` (objectui#4454) is ENFORCED. The handler it would gate was
 *     already BUILT in the renderer (`handleAddClick`, dispatching
 *     `{ type: 'create' }` on the component's own `onAction` channel) and simply
 *     never passed, so the intent existed and the wiring was the missing line.
 *   - `colorMapping` (objectui#4493) is REMOVED. Nothing anywhere read it — not
 *     the renderer, not `CalendarView`, which resolves a colour from
 *     `event.color` — and no measured app authors it, so the declaration is
 *     retired rather than given an implementation nobody asked for.
 *
 * ## Why `onAddClick` and not a new prop
 *
 * `CalendarView` renders its "New event" button behind `{onAddClick && …}` and
 * declares `onAddClick?: () => void`. Post-objectui#4453 that key is one of the
 * renderer's DECLARED function-typed host hatches (`HOST_CALLBACKS`), so the
 * affordance already had a live host path. `allowCreate` therefore goes THROUGH
 * that hatch — an authored `true` supplies the renderer's own handler as the
 * hatch's value — rather than around it via a second, parallel prop. One key,
 * one declared type, one answer.
 *
 * ## The absent-key answer is load-bearing
 *
 * `undefined` is what makes the button not render, and it is the answer for
 * every input that is not the boolean `true`: absent, `false`, and the off-type
 * spellings an author can write in JSON (`'true'`, `1`). That is the same rule
 * every other resolver at this boundary follows, and it is what keeps
 * today's behaviour byte-identical for everyone who never authored the key.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
// Module scope: the registration side effect this file renders through
// (AGENTS.md 测试纪律 — never inside a hook).
import './index';

/** The text `SchemaErrorBoundary` renders when a widget throws during RENDER. */
const ERROR_BOUNDARY_MARKER = 'failed to render';

/**
 * The add affordance's accessible name — `CalendarView`'s own
 * `t('calendar.newEvent')`, whose English default is "New event".
 */
const ADD_BUTTON_NAME = 'New event';

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

async function expectCalendarRendered() {
  await waitFor(() => expect(calendarRegion()).not.toBeNull());
  expect(document.body.textContent ?? '').not.toContain(ERROR_BOUNDARY_MARKER);
}

function addButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: ADD_BUTTON_NAME });
}

describe('calendar-view: `allowCreate` drives the add affordance (objectui#4454)', () => {
  it('authored `allowCreate: true` on the NODE renders the add affordance, and clicking it dispatches `create`', async () => {
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
              allowCreate: true,
            } as never
          }
          onAction={onAction}
        />,
      );

      await expectCalendarRendered();

      // Before the fix: `handleAddClick` was built and never passed, so
      // `CalendarView` saw no `onAddClick` and this button did not exist.
      const button = addButton();
      expect(button).not.toBeNull();

      fireEvent.click(button as HTMLElement);

      // The behaviour the flag turns on is the renderer's OWN action channel —
      // the same `onAction` every other gesture on this widget dispatches to.
      expect(onAction).toHaveBeenCalledWith({ type: 'create', payload: {} });
    } finally {
      errors.mockRestore();
    }
  });

  it('authored `allowCreate: true` in the `props` CONTAINER does the same', async () => {
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
              // The second authoring channel `SchemaRenderer` spreads
              // separately. A fix that only handled the node's own key would
              // leave this half dead (objectui#4452's lesson).
              props: { allowCreate: true },
            } as never
          }
          onAction={onAction}
        />,
      );

      await expectCalendarRendered();
      const button = addButton();
      expect(button).not.toBeNull();

      fireEvent.click(button as HTMLElement);
      expect(onAction).toHaveBeenCalledWith({ type: 'create', payload: {} });
    } finally {
      errors.mockRestore();
    }
  });

  it('MUST-NOT-CHANGE: an ABSENT `allowCreate` renders no add affordance', async () => {
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
      expect(addButton()).toBeNull();
    } finally {
      errors.mockRestore();
    }
  });

  it('MUST-NOT-CHANGE: an explicit `allowCreate: false` renders no add affordance', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: currentMonthRecords(),
              allowCreate: false,
            } as never
          }
        />,
      );

      await expectCalendarRendered();
      expect(addButton()).toBeNull();
    } finally {
      errors.mockRestore();
    }
  });

  it.each([
    ['the string `true`', 'true'],
    ['the number 1', 1],
    ['an object', { enabled: true }],
  ])(
    'off-type `allowCreate` (%s) gets the absent-key answer — no affordance, no crash',
    async (_label, raw) => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        render(
          <SchemaRenderer
            schema={
              {
                type: 'plugin-calendar:calendar-view',
                id: 'n',
                data: currentMonthRecords(),
                // The input declares `type: 'boolean'`. Anything else is
                // off-spec metadata, and this boundary's answer to off-spec
                // metadata is the absent-key answer — never a coercion
                // (AGENTS.md #0.1).
                allowCreate: raw,
              } as never
            }
          />,
        );

        await expectCalendarRendered();
        expect(addButton()).toBeNull();
      } finally {
        errors.mockRestore();
      }
    },
  );

  it('MUST-NOT-CHANGE: a host `onAddClick` function still works with no `allowCreate` at all', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hostAdd = vi.fn();
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
          onAddClick={hostAdd}
        />,
      );

      await expectCalendarRendered();
      const button = addButton();
      expect(button).not.toBeNull();

      fireEvent.click(button as HTMLElement);
      expect(hostAdd).toHaveBeenCalledTimes(1);
    } finally {
      errors.mockRestore();
    }
  });

  it('a host `onAddClick` REPLACES the `allowCreate` dispatch, matching the `onEventClick` precedence', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hostAdd = vi.fn();
    const onAction = vi.fn();
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: currentMonthRecords(),
              allowCreate: true,
            } as never
          }
          onAddClick={hostAdd}
          onAction={onAction}
        />,
      );

      await expectCalendarRendered();
      fireEvent.click(addButton() as HTMLElement);

      // Same rule the sibling hatch already pins: a host handler REPLACES the
      // `onAction` dispatch rather than running alongside it.
      expect(hostAdd).toHaveBeenCalledTimes(1);
      expect(onAction).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it('an authored `onAddClick` STRING still cannot reach the component (objectui#4453 stays closed)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: currentMonthRecords(),
              // Off-type on the declared hatch: dropped, so the affordance is
              // governed by `allowCreate` alone and no string can land on a
              // function-typed prop.
              onAddClick: 'NOT-A-FUNCTION',
              allowCreate: true,
            } as never
          }
        />,
      );

      await expectCalendarRendered();
      const button = addButton();
      expect(button).not.toBeNull();

      // The renderer's own handler is what is wired, so the click is a normal
      // no-op dispatch (no `onAction` host prop here) rather than a
      // `onAddClick is not a function` throw.
      expect(() => fireEvent.click(button as HTMLElement)).not.toThrow();
      expect(calendarRegion()).not.toBeNull();
    } finally {
      errors.mockRestore();
    }
  });
});

describe('calendar-view: `colorMapping` is retired (objectui#4493)', () => {
  it('the registry no longer declares a `colorMapping` input', () => {
    const meta = ComponentRegistry.getMeta('calendar-view', 'plugin-calendar');
    const declared = (meta?.inputs ?? []).map((input) => input.name);

    // The removal itself. `colorMapping` was declared, documented in
    // `content/docs/plugins/plugin-calendar.mdx` as
    // `colorMapping?: Record< string, string >`, and read by nothing — an
    // author who wrote it got no mapping, no warning and no error.
    expect(declared).not.toContain('colorMapping');

    // The inputs that stay, so this pin fails loudly if the removal ever takes
    // a neighbour with it.
    expect(declared).toEqual([
      'data',
      'titleField',
      'startDateField',
      'endDateField',
      'allDayField',
      'colorField',
      'view',
      'currentDate',
      'allowCreate',
      'className',
    ]);
  });

  it('an authored `colorMapping` changes nothing — it falls into the open tail and is dropped', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SchemaRenderer
          schema={
            {
              type: 'plugin-calendar:calendar-view',
              id: 'n',
              data: [
                // `colorField` defaults to `color`, so this record's colour is
                // the raw picklist value `meeting` — exactly the case the
                // documented `colorMapping` claimed to translate.
                {
                  id: 'r1',
                  title: 'Computed Standup',
                  start: new Date(
                    new Date().getFullYear(),
                    new Date().getMonth(),
                    10,
                    10,
                    0,
                    0,
                    0,
                  ).toISOString(),
                  color: 'meeting',
                },
              ],
              colorMapping: { meeting: 'blue' },
            } as never
          }
        />,
      );

      await expectCalendarRendered();
      // Still the real calendar with its computed event: retiring the
      // declaration is not a behaviour change, because the key never had a read
      // site to lose. It is now an ordinary unknown authored key, dropped at the
      // renderer boundary like any other (objectui#4453).
      expect(await screen.findByRole('button', { name: 'Computed Standup' })).toBeTruthy();
    } finally {
      errors.mockRestore();
    }
  });
});
