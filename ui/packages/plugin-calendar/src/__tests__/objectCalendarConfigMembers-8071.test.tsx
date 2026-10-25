/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8071 slice 5 — the member shape of `object-calendar.calendar`.
 *
 * The registration declares `{ name: 'calendar', type: 'object', description:
 * '`startDateField`, endDateField, titleField, colorField' }` and says nothing
 * about how those four names are used once inside the object — that is exactly
 * what a member pin has to state (objectui#8068's criterion: constrain the
 * shape the RENDERER reads, not the declaration).
 *
 * `getCalendarConfig` (`ObjectCalendar.tsx`) reads the whole object as one unit
 * — `if (schema.calendar) return schema.calendar` — with NO merge against the
 * flat legacy spelling the same function falls back to when `calendar` is
 * absent. So the sharp claim this file makes, that no other file makes, is
 * PRECEDENCE: an authored `calendar` object wins OUTRIGHT over a conflicting
 * flat spelling on the same schema, rather than the two being merged key by
 * key. `ObjectCalendar.unconfiguredRefusal-7029.test.tsx`'s last control shows
 * the nested block working; it never puts a CONFLICTING flat spelling next to
 * it, so it cannot show which one wins.
 *
 * The other two claims — that `startDateField` / `endDateField` NAME the record
 * fields that become an event's `start` / `end`, and that `titleField` OUTRANKS
 * the object's own default display-name resolution — are read directly off the
 * emitted event objects, which nothing else in this package's suite asserts
 * numerically (the 7243 ladder file and the 8026 all-day file both drive real
 * renders through this same config, but assert `color`/DOM-lane placement, never
 * `start/end/title` values).
 *
 * ⛔ NOT re-pinned here, because each already has its own file and re-testing it
 * would just be a second copy to drift from the first:
 *   - `colorField`'s resolution ladder — `ObjectCalendar.colorFieldLadder-7243.test.tsx`.
 *   - `allDayField` — `ObjectCalendar.allDayFieldIsHonoured-8026.test.tsx`.
 *   - the required-ness of `startDateField` (no config at all → refusal screen) —
 *     `ObjectCalendar.unconfiguredRefusal-7029.test.tsx`.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectCalendar } from '../ObjectCalendar';

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

let lastEvents: any[] = [];

vi.mock('../CalendarView', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    CalendarView: ({ events }: any) => {
      lastEvents = events;
      return <div data-testid="calendar-view" data-event-count={String(events.length)} />;
    },
  };
});

const OBJECT_SCHEMA = {
  name: 'duly_task',
  // The object's OWN default title pointer (ADR-0079) — deliberately a
  // DIFFERENT field than the one each fixture's `titleField` names, so a title
  // pin can only pass by reading the declared key, never by coincidence.
  nameField: 'subject',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text' },
    nickname: { name: 'nickname', type: 'text' },
    kickoff: { name: 'kickoff', type: 'datetime' },
    wrapup: { name: 'wrapup', type: 'datetime' },
    other_start: { name: 'other_start', type: 'datetime' },
    other_title: { name: 'other_title', type: 'text' },
  },
};

const ROW = {
  id: 'r1',
  subject: 'Default display name',
  nickname: 'Authored event title',
  kickoff: '2026-03-01T09:00:00.000Z',
  wrapup: '2026-03-02T17:00:00.000Z',
  other_start: '2099-12-31T00:00:00.000Z',
  other_title: 'WRONG — from the flat spelling',
};

function makeDataSource(rows: any[] = [ROW]) {
  return {
    find: vi.fn(async () => ({ data: rows, total: rows.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => OBJECT_SCHEMA),
  } as any;
}

/** Renders `schema` and waits for the mocked `CalendarView` to receive events. */
async function eventsFor(schema: Record<string, unknown>, rows: any[] = [ROW]) {
  lastEvents = [];
  render(
    <ObjectCalendar
      schema={{ type: 'object-calendar', objectName: 'duly_task', ...schema } as any}
      dataSource={makeDataSource(rows)}
    />,
  );
  await waitFor(() => expect(lastEvents.length).toBe(rows.length));
  return lastEvents;
}

describe('object-calendar.calendar — member shape (objectui#8071 slice 5)', () => {
  it('`startDateField` and `endDateField` name the record fields that become the event span', async () => {
    const [event] = await eventsFor({
      calendar: { startDateField: 'kickoff', endDateField: 'wrapup', titleField: 'nickname' },
    });
    expect(event.start).toEqual(new Date(ROW.kickoff));
    expect(event.end).toEqual(new Date(ROW.wrapup));
  });

  it('CONTROL: an unauthored `endDateField` leaves the event with no end at all', async () => {
    const [event] = await eventsFor({
      calendar: { startDateField: 'kickoff', titleField: 'nickname' },
    });
    expect(event.start).toEqual(new Date(ROW.kickoff));
    expect(event.end).toBeUndefined();
  });

  it('`titleField` outranks the object\'s own default display-name field', async () => {
    const [event] = await eventsFor({
      calendar: { startDateField: 'kickoff', titleField: 'nickname' },
    });
    // `nameField: 'subject'` would resolve to ROW.subject ("Default display
    // name") if `titleField` were not read first — see `resolveTitle` in
    // `ObjectCalendar.tsx`.
    expect(event.title).toBe(ROW.nickname);
  });

  it('CONTROL: with no `titleField` authored, the object\'s default display name is used', async () => {
    const [event] = await eventsFor({
      calendar: { startDateField: 'kickoff' },
    });
    expect(event.title).toBe(ROW.subject);
  });

  it('an authored `calendar` object wins OUTRIGHT over a conflicting flat legacy spelling', async () => {
    // Both spellings are present and DISAGREE. `getCalendarConfig` returns
    // `schema.calendar` unconditionally when it is set — it never merges the
    // two — so every field must come from the nested object and NONE from the
    // flat siblings, not even the ones the nested object leaves unset.
    const [event] = await eventsFor({
      calendar: { startDateField: 'kickoff', titleField: 'nickname' },
      startDateField: 'other_start',
      titleField: 'other_title',
      endDateField: 'wrapup',
    });
    expect(event.start).toEqual(new Date(ROW.kickoff));
    expect(event.title).toBe(ROW.nickname);
    // The flat `endDateField` is NOT absorbed piecemeal: the nested object
    // omits it, and the object as a whole is what wins, so the event still has
    // no end — the flat sibling's `wrapup` never reaches this record.
    expect(event.end).toBeUndefined();
  });

  it('CONTROL: with no `calendar` object authored, the flat legacy spelling is read instead', async () => {
    const [event] = await eventsFor({
      startDateField: 'other_start',
      titleField: 'other_title',
    });
    expect(event.start).toEqual(new Date(ROW.other_start));
    expect(event.title).toBe(ROW.other_title);
  });
});
