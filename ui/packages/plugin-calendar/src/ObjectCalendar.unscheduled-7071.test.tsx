/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7071 — a record with NO value in the declared date field is no
 * longer given a fabricated date.
 *
 * Ruled by the maintainer on 2026-09-01 (option 2, minimal form) and
 * re-confirmed on 2026-09-02 after a second seat had recommended option 1: the
 * `start: startDate ? new Date(startDate) : new Date()` fallback is deleted,
 * and the records it used to invent a date for are counted in a collapsed
 * "unscheduled (N)" area instead. ⛔ Option 1 (drop the row, surface a dropped
 * count) was considered and NOT adopted — do not "simplify" this file toward
 * it.
 *
 * ## Why the grid half of every assertion is written against `CalendarView`'s
 * ## `events` prop rather than the rendered grid
 *
 * "Appears in the unscheduled area" alone would pass on an implementation that
 * ALSO still draws the record on today's cell — which is precisely the defect.
 * The two halves must both be asserted, and the strongest available spelling of
 * "nowhere on the grid" is that the event never reaches the grid component at
 * all. `CalendarView` is therefore mocked to record its `events` prop (the same
 * technique as `ObjectCalendar.colorFieldLadder-7243.test.tsx` next door), while
 * the unscheduled area itself renders for real — `ObjectCalendar` owns that DOM.
 *
 * ## The four facts pinned here
 *
 *   1. a record with no start renders in the unscheduled area AND nowhere on
 *      the grid;
 *   2. a record with a start and no end still renders ALL-DAY — the ruling's
 *      "`allDay: !endDate` applies only to records that have a start" must not
 *      over-reach and break the legitimate all-day case;
 *   3. the "(N)" equals the number of startless records;
 *   4. a PRESENT but unparseable value still goes through the `isNaN` filter —
 *      dropped, not bucketed as unscheduled. Absent and malformed are two
 *      different defects and the two code paths stay distinguishable; a fix
 *      that routed both into the same bucket would pass 1-3 and fail here.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { ObjectCalendar } from './ObjectCalendar';

afterEach(cleanup);

// The overlay drawer is irrelevant here and drags in a per-record permission
// probe that would leave the process for real (see the propsContract suite's
// own note on that probe). Stub it out.
vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

let lastEvents: any[] = [];

vi.mock('./CalendarView', async (importOriginal) => {
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
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text' },
    starts_at: { name: 'starts_at', type: 'datetime' },
    ends_at: { name: 'ends_at', type: 'datetime' },
  },
};

/**
 * One row per path through the mapping loop.
 *
 * `no-start-field` and `empty-start` are the two spellings of "no value" this
 * component has always tested with the same truthiness check the deleted
 * fallback used, so both must land in the same bucket.
 */
const ROWS = [
  {
    id: 'timed',
    subject: 'Timed meeting',
    starts_at: '2026-01-05T09:00:00Z',
    ends_at: '2026-01-05T10:00:00Z',
  },
  { id: 'all-day', subject: 'Company holiday', starts_at: '2026-01-06T00:00:00Z' },
  { id: 'no-start-field', subject: 'Someday task' },
  { id: 'empty-start', subject: 'Blank date task', starts_at: '' },
  { id: 'garbage-start', subject: 'Broken date task', starts_at: 'not a date' },
];

const SCHEMA: any = {
  type: 'object-calendar',
  objectName: 'duly_task',
  calendar: {
    startDateField: 'starts_at',
    endDateField: 'ends_at',
    titleField: 'subject',
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

async function renderCalendar(rows: any[] = ROWS) {
  lastEvents = [];
  const view = render(<ObjectCalendar schema={SCHEMA} dataSource={makeDataSource(rows)} />);
  await waitFor(() => expect(screen.getByTestId('calendar-view')).toBeTruthy());
  return view;
}

const idsOnGrid = () => lastEvents.map((e) => String(e.id));
const area = (container: HTMLElement) =>
  container.querySelector('[data-calendar-unscheduled]');
const list = (container: HTMLElement) =>
  container.querySelector('[data-calendar-unscheduled-list]');

describe('objectui#7071 — records with no date land in an unscheduled area, not on today', () => {
  it('ARM 1: a startless record is in the unscheduled area AND nowhere on the grid', async () => {
    const { container } = await renderCalendar();
    await waitFor(() => expect(lastEvents.length).toBeGreaterThan(0));

    // Nowhere on the grid: the event never reaches `CalendarView` at all.
    expect(idsOnGrid()).not.toContain('no-start-field');
    expect(idsOnGrid()).not.toContain('empty-start');
    expect(lastEvents.some((e) => e.data?.id === 'no-start-field')).toBe(false);

    // ...and in the area, once expanded.
    const el = area(container);
    expect(el).not.toBeNull();
    fireEvent.click(el!.querySelector('button')!);
    expect(list(container)!.textContent).toContain('Someday task');
    expect(list(container)!.textContent).toContain('Blank date task');
  });

  it('ARM 1 (the deleted fabrication): no event is stamped with the current moment', async () => {
    await renderCalendar();
    await waitFor(() => expect(lastEvents.length).toBeGreaterThan(0));

    // Before the fix, `no-start-field` and `empty-start` arrived here carrying
    // `new Date()` — a valid Date the `isNaN` guard was guaranteed to pass, on
    // today's cell, indistinguishable from a real event. Every start that
    // reaches the grid now traces back to a value the RECORD carried.
    const now = Date.now();
    for (const event of lastEvents) {
      expect(Math.abs(event.start.getTime() - now)).toBeGreaterThan(60_000);
      expect(new Date(event.data.starts_at).getTime()).toBe(event.start.getTime());
    }
  });

  it('ARM 2: a record with a start and no end still renders ALL-DAY', async () => {
    await renderCalendar();
    await waitFor(() => expect(lastEvents.length).toBeGreaterThan(0));

    const allDay = lastEvents.find((e) => String(e.id) === 'all-day');
    expect(allDay).toBeTruthy();
    expect(allDay.allDay).toBe(true);
    expect(allDay.end).toBeUndefined();

    // The other direction, so "everything is all-day" cannot pass this file:
    // a record with both dates is still a timed event.
    const timed = lastEvents.find((e) => String(e.id) === 'timed');
    expect(timed.allDay).toBe(false);

    // And the arm the ruling settled: a record with NO start is unscheduled,
    // not all-day. It is absent from the grid entirely, so there is no all-day
    // event for it to have become.
    expect(lastEvents.some((e) => String(e.id) === 'no-start-field')).toBe(false);
  });

  it('ARM 3: the count equals the number of startless records', async () => {
    const { container } = await renderCalendar();
    await waitFor(() => expect(lastEvents.length).toBeGreaterThan(0));

    // Two of the five rows have no value in `starts_at`.
    expect(area(container)!.textContent).toContain('Unscheduled (2)');

    // The count is a count of the LIST, not a separate tally that could drift.
    fireEvent.click(area(container)!.querySelector('button')!);
    expect(list(container)!.querySelectorAll('li')).toHaveLength(2);
  });

  it('ARM 4: a PRESENT but unparseable value is filtered, not bucketed as unscheduled', async () => {
    const { container } = await renderCalendar();
    await waitFor(() => expect(lastEvents.length).toBeGreaterThan(0));

    // The `isNaN` guard keeps its original job.
    expect(idsOnGrid()).not.toContain('garbage-start');
    // ...and this is a DIFFERENT fact from "no value": it is not in the area,
    // and it is not in the count (which stays 2, not 3).
    expect(area(container)!.textContent).toContain('Unscheduled (2)');
    fireEvent.click(area(container)!.querySelector('button')!);
    expect(list(container)!.textContent).not.toContain('Broken date task');
  });

  it('the area is collapsed by default and expands on click', async () => {
    const { container } = await renderCalendar();
    await waitFor(() => expect(lastEvents.length).toBeGreaterThan(0));

    const toggle = area(container)!.querySelector('button')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(list(container)).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(list(container)).not.toBeNull();

    fireEvent.click(toggle);
    expect(list(container)).toBeNull();
  });

  it('CONTROL: a calendar whose records all carry a date grows no area at all', async () => {
    const { container } = await renderCalendar(ROWS.slice(0, 2));
    await waitFor(() => expect(lastEvents.length).toBe(2));

    expect(area(container)).toBeNull();
    expect(idsOnGrid()).toEqual(['timed', 'all-day']);
  });

  it('SCOPE FENCE: the area offers no way to schedule anything', async () => {
    // The ruling is explicit that this is a count and a list and nothing more:
    // no drag-to-schedule, no scheduling UI. Pinned so a later "helpful"
    // addition has to argue with a red test instead of slipping in.
    const { container } = await renderCalendar();
    await waitFor(() => expect(lastEvents.length).toBeGreaterThan(0));
    fireEvent.click(area(container)!.querySelector('button')!);

    const el = area(container)!;
    // One control only: the disclosure toggle itself.
    expect(el.querySelectorAll('button')).toHaveLength(1);
    expect(el.querySelectorAll('input, select, textarea, [draggable="true"]')).toHaveLength(0);
    for (const item of Array.from(el.querySelectorAll('li'))) {
      expect(item.getAttribute('draggable')).toBeNull();
      expect(item.getAttribute('role')).toBeNull();
    }
  });
});
