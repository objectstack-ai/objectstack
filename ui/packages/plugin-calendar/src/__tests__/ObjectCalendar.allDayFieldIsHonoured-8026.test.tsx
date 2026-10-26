/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8026 — `ObjectCalendar` READS the `allDayField` it resolves.
 *
 * ## The defect
 *
 * `getCalendarConfig` put `allDayField` into the config it returns and named it
 * in the `calendarConfig` memo's dependency list, and the events pass then
 * destructured four keys and inferred the flag from `!endDate`. So a record
 * with a real end date that IS flagged all-day drew as an ordinary timed event,
 * with no diagnostic — and the value was arriving: `ListView`'s
 * `collectViewFields` already puts the field into the fetch and `ObjectView`'s
 * `calendarViewOptions` forwards the authored `calendar` block verbatim.
 *
 * ## Why these rows read the LANE and not the event object
 *
 * The flag's whole meaning is where the event is drawn. `CalendarView` has its
 * own classifier on top of `event.allDay` — midnight-to-midnight, or 24h or
 * longer, is all-day whatever the flag says — so an assertion on the computed
 * `allDay` value would pass for fixtures that render identically, and the
 * fixtures below are chosen to sit OUTSIDE that classifier (09:00 to 10:30, one
 * day, neither boundary midnight). That is what makes the flag the only thing
 * deciding the lane. Timed bars carry the same `title` attribute as all-day
 * bars, so the title cannot discriminate either — the lane can, and it exists
 * in the DOM only when at least one event is classified all-day.
 *
 * ## The no-key decision this file pins (the part that is NOT the sibling's)
 *
 * The sibling `calendar-view-renderer.tsx` spells `schema.allDayField ||
 * 'allDay'`. This component deliberately does NOT take that default, and row 4
 * is what holds the line: an UNDECLARED `allDayField` does not make this
 * renderer read a field named `allDay` off a business-object record. Measured
 * reason — this component honours none of that sibling's five field-name
 * defaults, and an absent `startDateField` reaches the refusal screen rather
 * than a guess (objectui#7029, ruled objectstack#13748 batch #19 option A,
 * whose content was deleting fabricated field bindings upstream). The sibling's
 * defaults describe the canonical AUTHORED EVENT shape a `calendar-view` node
 * literally carries in its `data`; these records are ObjectQL records, where
 * nothing makes `allDay` a field name.
 *
 * Rows 5 and 6 are the other half of that decision: a calendar that never
 * authored the key renders exactly as it did before this card.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { en } from '@object-ui/i18n';
import { ObjectCalendar } from '../ObjectCalendar';

afterEach(cleanup);

/** Read from the pack, never restated — objectui#7454's lesson. */
const PACK_ALL_DAY = en.calendar.allDay;

const TITLE = 'Company offsite';

/** Today at a wall-clock time, so the current week view always contains it. */
const at = (hours: number, minutes: number) => {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
};

/**
 * 09:00 to 10:30 on one day. Deliberately outside `CalendarView`'s own all-day
 * classifier: neither boundary is midnight and the span is well under 24h, so
 * nothing but `event.allDay` can put this bar in the all-day lane.
 */
const TIMED_START = at(9, 0);
const TIMED_END = at(10, 30);

const OBJECT_SCHEMA = {
  name: 'duly_task',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text' },
    starts_at: { name: 'starts_at', type: 'datetime' },
    ends_at: { name: 'ends_at', type: 'datetime' },
    is_all_day: { name: 'is_all_day', type: 'boolean' },
    allDay: { name: 'allDay', type: 'boolean' },
  },
};

const makeDataSource = (rows: any[]) =>
  ({
    find: vi.fn(async () => ({ data: rows, total: rows.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => OBJECT_SCHEMA),
  }) as any;

/**
 * The all-day lane, located by STRUCTURE. Its first child is the label gutter —
 * a leaf div whose text is the `calendar.allDay` pack value — so the gutter's
 * parent is the lane. Both assumptions fail loudly rather than silently reading
 * some other element.
 */
function allDayLane(container: HTMLElement): HTMLElement | null {
  const gutter = Array.from(container.querySelectorAll('div')).find(
    (el) => el.children.length === 0 && (el.textContent ?? '').trim() === PACK_ALL_DAY,
  );
  if (!gutter) return null;
  const lane = gutter.parentElement;
  if (!lane || lane.firstElementChild !== gutter) {
    throw new Error('all-day lane shape changed — the pack label is no longer the lane\'s first child');
  }
  return lane as HTMLElement;
}

const bar = (root: ParentNode) => root.querySelector(`[title="${TITLE}"]`);

/** `true` when the event was drawn in the all-day lane, `false` when drawn timed. */
async function renderAndReadLane(calendar: Record<string, unknown>, row: Record<string, unknown>) {
  const schema: any = {
    type: 'object-calendar',
    objectName: 'duly_task',
    defaultView: 'week',
    calendar,
  };
  const { container } = render(
    <ObjectCalendar schema={schema} dataSource={makeDataSource([{ id: 'r1', subject: TITLE, ...row }])} />,
  );
  // The event must be on screen before the lane is read, otherwise "not in the
  // all-day lane" and "nothing rendered at all" are the same observation.
  await waitFor(() => expect(bar(container)).not.toBeNull());
  const lane = allDayLane(container);
  return { container, drawnAllDay: !!lane && !!bar(lane) };
}

const CONFIG_WITH_KEY = {
  startDateField: 'starts_at',
  endDateField: 'ends_at',
  titleField: 'subject',
  allDayField: 'is_all_day',
};

const CONFIG_NO_KEY = {
  startDateField: 'starts_at',
  endDateField: 'ends_at',
  titleField: 'subject',
};

describe('objectui#8026 — a declared `allDayField` decides the lane', () => {
  it('THE DEFECT: a record with a real end date AND a truthy flag renders all-day', async () => {
    // Before this card: `allDay: !endDate` made this `false` because the record
    // HAS an end date, and `CalendarView`'s own classifier cannot rescue a
    // 90-minute mid-morning event. The author's declaration was discarded.
    const { drawnAllDay } = await renderAndReadLane(CONFIG_WITH_KEY, {
      starts_at: TIMED_START,
      ends_at: TIMED_END,
      is_all_day: true,
    });
    expect(drawnAllDay).toBe(true);
  });

  it('CONTROL: the same config with a FALSY flag stays a timed event', async () => {
    // Without this row the fix could be "always all-day" and row 1 would still
    // be green.
    const { container, drawnAllDay } = await renderAndReadLane(CONFIG_WITH_KEY, {
      starts_at: TIMED_START,
      ends_at: TIMED_END,
      is_all_day: false,
    });
    expect(drawnAllDay).toBe(false);
    // …and it is drawn, just not in the lane.
    expect(bar(container)).not.toBeNull();
  });

  it('CONTROL: the field READ is the one the author declared, not a fixed name', async () => {
    // `is_all_day` (declared) says no; `allDay` (the sibling's default name)
    // says yes. A renderer reading the declared key answers "timed".
    const { drawnAllDay } = await renderAndReadLane(CONFIG_WITH_KEY, {
      starts_at: TIMED_START,
      ends_at: TIMED_END,
      is_all_day: false,
      allDay: true,
    });
    expect(drawnAllDay).toBe(false);
  });
});

describe('objectui#8026 — an UNDECLARED `allDayField` changes nothing', () => {
  it('does NOT default to a field named `allDay` — the sibling\'s default is not imported', async () => {
    // ⛔ This row goes red the moment someone ports `schema.allDayField ||
    // 'allDay'` verbatim from `calendar-view-renderer.tsx`. That would put the
    // last fabricated field binding back into the one renderer whose refusal
    // screen exists to refuse guessing (objectui#7029).
    const { drawnAllDay } = await renderAndReadLane(CONFIG_NO_KEY, {
      starts_at: TIMED_START,
      ends_at: TIMED_END,
      allDay: true,
    });
    expect(drawnAllDay).toBe(false);
  });

  it('MUST-NOT-CHANGE: no end date still infers all-day (objectui#7071 arm intact)', async () => {
    const { drawnAllDay } = await renderAndReadLane(
      { startDateField: 'starts_at', titleField: 'subject' },
      { starts_at: TIMED_START },
    );
    expect(drawnAllDay).toBe(true);
  });

  it('MUST-NOT-CHANGE: a start AND an end still render timed', async () => {
    const { drawnAllDay } = await renderAndReadLane(CONFIG_NO_KEY, {
      starts_at: TIMED_START,
      ends_at: TIMED_END,
    });
    expect(drawnAllDay).toBe(false);
  });
});
