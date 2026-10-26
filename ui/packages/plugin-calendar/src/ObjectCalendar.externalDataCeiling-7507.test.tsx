/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7507 — the row-ceiling footnote must not outlive the fetch that
 * raised it (objectui#7210's ceiling, ruling a′).
 *
 * `ObjectCalendar` has five `setData` paths. Four of them also reset
 * `rowCeiling`; the external-`data` sync was the one that did not, so a
 * component that first drew its OWN truncated fetch and then had a short
 * `data` array handed to it kept showing "Showing the first 2000 of 9876
 * records" over twelve rows. The note would be describing a result set that is
 * no longer on screen — which is the same defect the ceiling exists to
 * prevent, pointing the other way: not a silent cut, but a loud claim of one
 * that did not happen.
 *
 * ⚠️ Latent, not reported. Today's only host that passes `data` is
 * `ObjectView`, and it passes it from mount, so `hasExternalData` is true
 * before the internal fetch can ever run and the stale state is unreachable.
 * That is exactly why it is pinned rather than only fixed: nothing about the
 * prop's contract says a host may not start without `data` and supply it
 * later, and a latent defect with no test is one refactor away from being a
 * reported one.
 *
 * REVERSE VERIFICATION — direction predicted before running: remove the
 * `setRowCeiling({ truncated: false })` from the external-`data` effect in
 * `ObjectCalendar` and this file goes red at the "the note is gone" assertion
 * (the note keeps rendering, still naming 2000 and 9876), while the control
 * case — a component that never truncated — stays green.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NON_GRID_ROW_CEILING } from '@object-ui/react';
import { ObjectCalendar } from './ObjectCalendar';

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

// Same reason as the sibling rowCeiling pin: the month grid draws at most four
// events per day cell, so the count has to come off an attribute.
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

function makeRows(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(NOW.getFullYear(), NOW.getMonth(), ((i + offset) % 28) + 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    return {
      id: String(i + offset + 1),
      subject: `Event ${i + offset + 1}`,
      start_at: iso,
      end_at: iso,
    };
  });
}

function makeDataSource(storeSize: number) {
  const store = makeRows(storeSize);
  return {
    find: vi.fn(async (_resource: string, params: any) => {
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

describe('objectui#7507 — an external `data` hand-off clears the row-ceiling note', () => {
  it('a truncated own fetch, then a short external `data`: the note is GONE', async () => {
    const dataSource = makeDataSource(TOTAL_ROWS);
    const { rerender } = render(<ObjectCalendar schema={schema} dataSource={dataSource} />);

    // Live control: the note really was raised by this component's own fetch,
    // so its absence below is a change of state and not a query that never
    // matched anything.
    const note = await screen.findByRole('note');
    expect(note.textContent).toContain(String(NON_GRID_ROW_CEILING));
    expect(note.textContent).toContain(String(TOTAL_ROWS));
    await waitFor(() =>
      expect(screen.getByTestId('calendar-view').getAttribute('data-event-count')).toBe(
        String(NON_GRID_ROW_CEILING),
      ),
    );

    const short = makeRows(12);
    rerender(<ObjectCalendar schema={schema} dataSource={dataSource} data={short} />);

    await waitFor(() =>
      expect(screen.getByTestId('calendar-view').getAttribute('data-event-count')).toBe('12'),
    );
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('external `data` from mount: still no note, and the rows are the parent’s', async () => {
    const dataSource = makeDataSource(TOTAL_ROWS);
    const short = makeRows(9);

    render(<ObjectCalendar schema={schema} dataSource={dataSource} data={short} />);

    await waitFor(() =>
      expect(screen.getByTestId('calendar-view').getAttribute('data-event-count')).toBe('9'),
    );
    // The parent owns the query here, so this component never fetched and has
    // nothing to report a ceiling about.
    expect(dataSource.find).not.toHaveBeenCalled();
    expect(screen.queryByRole('note')).toBeNull();
  });
});
