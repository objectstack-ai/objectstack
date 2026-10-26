/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7210, half 2 — maintainer ruling a′ (2026-09-02), on the calendar.
 *
 * The calendar is the view where a cut is HARDEST to notice from the picture,
 * which is the ruling's whole concern. Its month grid draws at most four
 * events per day cell and a "+N more" affordance, so a month rendered from the
 * first N of a much larger set looks exactly like a full one — the missing
 * records are not missing pixels, they are cells that were never asked about.
 * There is no row count on screen to compare against, so the footnote is the
 * only signal that exists.
 *
 * ⚠️ Environment: jsdom, via this repo's `dom` vitest project. No assertion
 * here depends on container size or on a media query — the note is a sibling
 * in the component's own tree and is present or absent regardless of layout,
 * which is deliberate: `happy-dom` never fires container-size effects and
 * `jsdom` applies media-query rules irrespective of `innerWidth`, so a pin
 * that leaned on either would be unmeasurable rather than merely flaky.
 *
 * REVERSE VERIFICATION — MEASURED on two separate ablations (objectui#7507),
 * because this file grades two different things and one of them was missing:
 *
 *   1. Remove `...nonGridRowCeilingQuery()` from `ObjectCalendar`'s record
 *      fetch ⇒ red at the **`$top` assertion**, and there only; 1 failed /
 *      1 passed. NOT at the footnote, which is what this docblock used to
 *      predict. An adapter with no `$top` answers with the whole filtered set,
 *      `applyNonGridRowCeiling` slices it to the ceiling from the rows in
 *      hand, and both the event count and the note stay correct. Losing the
 *      `$top` is a bandwidth regression, not a correctness one.
 *   2. Hand the view the RAW response instead of the capped rows
 *      (`setData(capped.rows)` → `setData(result.data ?? capped.rows)`) ⇒ red
 *      at the **event-count assertion**, 2001 against 2000. Before #7507 that
 *      mutation left this file green at 4/4: `$top` was still sent and the
 *      footnote still rendered, while 2,001 events were drawn. That is the
 *      hole the count assertion below closes, and it is the ruling's own pin
 *      text — "the DOM row count equals the ceiling".
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NON_GRID_ROW_CEILING, nonGridRowCeilingQuery } from '@object-ui/core';
import { ObjectCalendar } from './ObjectCalendar';

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

// The month grid is irrelevant here — what this file has to observe is HOW MANY
// records reached the view layer, and the grid deliberately hides that: it draws
// at most four events per day cell, so 2,000 events and 2,001 events paint the
// same picture. Stubbing the child the way the gantt pin stubs `GanttView` puts
// the count on an attribute where an assertion can reach it. `importOriginal`
// keeps the module's other exports (`resolveEventColor` and friends) live, the
// same idiom `ObjectCalendar.unscheduled-7071` uses.
vi.mock('./CalendarView', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    CalendarView: ({ events }: any) => (
      <div data-testid="calendar-view" data-event-count={String(events.length)} />
    ),
  };
});

const TOTAL_ROWS = 9876;
const NOW = new Date();

/** Events inside the month the calendar opens on, so they are drawable at all. */
function makeRows(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(NOW.getFullYear(), NOW.getMonth(), (i % 28) + 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    return { id: String(i + 1), subject: `Event ${i + 1}`, start_at: iso, end_at: iso };
  });
}

function makeDataSource(storeSize: number, calls: Array<Record<string, any>>) {
  const store = makeRows(storeSize);
  return {
    find: vi.fn(async (_resource: string, params: any) => {
      calls.push({ ...(params ?? {}) });
      const top = typeof params?.$top === 'number' ? params.$top : store.length;
      return { data: store.slice(0, top), total: store.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'event',
      fields: {
        id: { name: 'id', type: 'text' },
        subject: { name: 'subject', type: 'text' },
        start_at: { name: 'start_at', type: 'date' },
        end_at: { name: 'end_at', type: 'date' },
      },
    })),
  } as any;
}

const schema: any = {
  type: 'calendar',
  objectName: 'event',
  calendar: { titleField: 'subject', startDateField: 'start_at', endDateField: 'end_at' },
  data: { provider: 'object', object: 'event' },
};

describe('objectui#7210 ruling a′ — the calendar caps at the platform ceiling, loudly', () => {
  it('above the ceiling: the query stops at the ceiling and BOTH numbers are named', async () => {
    const calls: Array<Record<string, any>> = [];
    const dataSource = makeDataSource(TOTAL_ROWS, calls);

    render(<ObjectCalendar schema={schema} dataSource={dataSource} />);

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    for (const params of calls) {
      expect(params.$top).toBe(nonGridRowCeilingQuery().$top);
    }

    // ⭐ The ruling's own words — "the DOM row count equals the ceiling". The
    // `$top` and the footnote below it are both true of a view that then drew
    // every row the adapter sent: measured on the merged commit, replacing the
    // capped hand-off with the raw response left this file green at 4/4 with
    // 2,001 events on the grid. This is the assertion that was missing.
    await waitFor(() =>
      expect(screen.getByTestId('calendar-view').getAttribute('data-event-count')).toBe(
        String(NON_GRID_ROW_CEILING),
      ),
    );

    const note = await screen.findByRole('note');
    expect(note.getAttribute('data-row-ceiling-note')).toBe('non-grid');
    expect(note.textContent).toContain(String(NON_GRID_ROW_CEILING));
    expect(note.textContent).toContain(String(TOTAL_ROWS));
  });

  it('below the ceiling: there is NO footnote', async () => {
    const calls: Array<Record<string, any>> = [];
    const dataSource = makeDataSource(12, calls);

    render(<ObjectCalendar schema={schema} dataSource={dataSource} />);

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByText(/Loading/i)).toBeNull());
    // Below the ceiling the count is the whole set, not the ceiling — the other
    // half of "draws at most N", and what keeps the case above from passing on a
    // view that simply caps everything at 2,000 unconditionally.
    expect(screen.getByTestId('calendar-view').getAttribute('data-event-count')).toBe('12');
    expect(screen.queryByRole('note')).toBeNull();
  });
});
