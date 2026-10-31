/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28102 — `ObjectCalendar` opens on `calendar.initialDate`.
 *
 * The spec half declares the key (`CalendarConfigSchema.initialDate`): absent ⇒
 * today; a wrapped date-macro token ⇒ the date `resolveDateMacros` gives it
 * when the calendar opens; `first_record` / `next_record` ⇒ the earliest start
 * date among the records the view's filter selects (on or after today for
 * `next_record`), read with a one-row query; no qualifying record ⇒ today.
 * The seed happens once; user navigation owns the date afterwards.
 *
 * `CalendarView` is stubbed to expose the date it was handed (as the local
 * calendar day) and a navigation button, which is all these rows read.
 */

import React from 'react';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectCalendar } from './ObjectCalendar';

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

vi.mock('./CalendarView', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    CalendarView: ({ currentDate, onNavigate }: any) => (
      <div data-testid="calendar-view" data-current-day={localDay(currentDate)}>
        <button
          type="button"
          onClick={() => onNavigate?.(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 15))}
        >
          next
        </button>
      </div>
    ),
  };
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const TODAY = localDay(new Date());
/** A day `months` months from now, on the 10th, as `YYYY-MM-DD`. */
function monthsAhead(months: number): string {
  const now = new Date();
  return localDay(new Date(now.getFullYear(), now.getMonth() + months, 10));
}
function monthsBack(months: number): string {
  const now = new Date();
  return localDay(new Date(now.getFullYear(), now.getMonth() - months, 10));
}

const shownDay = () => screen.getByTestId('calendar-view').getAttribute('data-current-day');
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));

const VIEW_FILTER = ['stage', '=', 'pending'];

/**
 * A data source whose record fetch answers nothing and whose one-row anchor
 * read (`$top: 1`) answers `anchorRows`; `due` is a `date` field.
 */
function makeDataSource(anchorRows: unknown[] | Promise<unknown[]> | (() => Promise<unknown[]>), dueType = 'date') {
  return {
    find: vi.fn(async (_object: string, params: Record<string, any>) =>
      params?.$top === 1
        ? { data: await (typeof anchorRows === 'function' ? anchorRows() : anchorRows) }
        : { data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({ name: 'renewal', fields: { name: { type: 'text' }, due: { type: dueType } } })),
  };
}

const anchorCalls = (ds: ReturnType<typeof makeDataSource>) =>
  ds.find.mock.calls.filter(([, params]) => (params as any)?.$top === 1);

function block(initialDate?: string, extra: Record<string, unknown> = {}): any {
  return {
    type: 'object-calendar',
    objectName: 'renewal',
    filter: VIEW_FILTER,
    calendar: { startDateField: 'due', titleField: 'name', ...(initialDate ? { initialDate } : {}) },
    ...extra,
  };
}

describe('calendar.initialDate — absent (objectstack#28102)', () => {
  it('CONTROL: a calendar without the key opens on today and issues no anchor read', async () => {
    const ds = makeDataSource([{ id: '1', due: monthsAhead(4) }]);
    render(<ObjectCalendar schema={block()} dataSource={ds as any} />);
    await settle();
    expect(shownDay()).toBe(TODAY);
    expect(anchorCalls(ds)).toHaveLength(0);
  });
});

describe('calendar.initialDate — a date-macro token (objectstack#28102)', () => {
  it('`{next_month_start}` opens on the first day of next month, and the FIRST range reported is already that month', async () => {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const ds = makeDataSource([]);
    const onVisibleRangeChange = vi.fn();
    render(
      <ObjectCalendar
        schema={block('{next_month_start}')}
        dataSource={ds as any}
        onVisibleRangeChange={onVisibleRangeChange}
      />,
    );
    await waitFor(() => expect(shownDay()).toBe(localDay(target)));
    // Seeded synchronously on mount, so a host that windows its fetch on the
    // reported range never asks for today's month first.
    const first = onVisibleRangeChange.mock.calls[0][0] as { start: Date; end: Date };
    expect(first.start.getTime()).toBeLessThanOrEqual(target.getTime());
    expect(first.end.getTime()).toBeGreaterThan(target.getTime());
    expect(anchorCalls(ds)).toHaveLength(0);
  });

  it('`{3_months_from_now}` opens on the date three months ahead', async () => {
    const now = new Date();
    const ds = makeDataSource([]);
    render(<ObjectCalendar schema={block('{3_months_from_now}')} dataSource={ds as any} />);
    // The month the client resolver lands on (it rolls over at a short month's end).
    const expected = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate());
    await waitFor(() => expect(shownDay()?.slice(0, 7)).toBe(localDay(expected).slice(0, 7)));
  });
});

describe('calendar.initialDate — `first_record` (objectstack#28102)', () => {
  it('opens on the earliest start date the one-row read returns', async () => {
    const target = monthsAhead(5);
    const ds = makeDataSource([{ id: '7', due: target }]);
    render(<ObjectCalendar schema={block('first_record')} dataSource={ds as any} />);
    await waitFor(() => expect(shownDay()).toBe(target));
  });

  it('reads ONE row, sorted by the start field ascending, under the view filter and a present start date', async () => {
    const ds = makeDataSource([{ id: '7', due: monthsAhead(5) }]);
    render(<ObjectCalendar schema={block('first_record')} dataSource={ds as any} />);
    await waitFor(() => expect(anchorCalls(ds)).toHaveLength(1));
    const [object, params] = anchorCalls(ds)[0] as [string, Record<string, any>];
    expect(object).toBe('renewal');
    expect(params.$top).toBe(1);
    expect(params.$orderby).toEqual({ due: 'asc' });
    expect(params.$filter).toEqual(['and', ['stage', '=', 'pending'], ['due', 'is_not_null']]);
  });

  it('opens on today when no record qualifies', async () => {
    const ds = makeDataSource([]);
    render(<ObjectCalendar schema={block('first_record')} dataSource={ds as any} />);
    await waitFor(() => expect(anchorCalls(ds)).toHaveLength(1));
    await settle();
    expect(shownDay()).toBe(TODAY);
  });

  it('opens on today when the anchor read fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ds = makeDataSource(() => Promise.reject(new Error('offline')));
    render(<ObjectCalendar schema={block('first_record')} dataSource={ds as any} />);
    await waitFor(() => expect(anchorCalls(ds)).toHaveLength(1));
    await settle();
    expect(shownDay()).toBe(TODAY);
    warn.mockRestore();
  });

  it('reads inline `staticData` through the same query: the earliest dated row, undated rows skipped', async () => {
    const early = monthsBack(2);
    const rows = [
      { id: 'a', name: 'Later', due: monthsAhead(3) },
      { id: 'b', name: 'Undated', due: null },
      { id: 'c', name: 'Earliest', due: early },
    ];
    render(<ObjectCalendar schema={block('first_record', { objectName: undefined, filter: undefined, staticData: rows })} />);
    await waitFor(() => expect(shownDay()).toBe(early));
  });
});

describe('calendar.initialDate — `next_record` (objectstack#28102)', () => {
  it('bounds the read at the start of today, spelled as a calendar day for a `date` start field', async () => {
    const target = monthsAhead(2);
    const ds = makeDataSource([{ id: '3', due: target }]);
    render(<ObjectCalendar schema={block('next_record')} dataSource={ds as any} />);
    await waitFor(() => expect(shownDay()).toBe(target));
    const [, params] = anchorCalls(ds)[0] as [string, Record<string, any>];
    expect(params.$top).toBe(1);
    expect(params.$orderby).toEqual({ due: 'asc' });
    expect(params.$filter).toEqual(['and', ['stage', '=', 'pending'], ['due', '>=', TODAY]]);
  });

  it('bounds a `datetime` start field at the instant of local midnight today', async () => {
    const ds = makeDataSource([], 'datetime');
    render(<ObjectCalendar schema={block('next_record')} dataSource={ds as any} />);
    await waitFor(() => expect(anchorCalls(ds)).toHaveLength(1));
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const [, params] = anchorCalls(ds)[0] as [string, Record<string, any>];
    expect(params.$filter).toEqual(['and', ['stage', '=', 'pending'], ['due', '>=', midnight.toISOString()]]);
  });

  it('skips past records on inline data and opens on the first one from today on', async () => {
    const next = monthsAhead(1);
    const rows = [
      { id: 'a', name: 'Past', due: monthsBack(1) },
      { id: 'b', name: 'Next', due: next },
      { id: 'c', name: 'Later', due: monthsAhead(6) },
    ];
    render(<ObjectCalendar schema={block('next_record', { objectName: undefined, filter: undefined, staticData: rows })} />);
    await waitFor(() => expect(shownDay()).toBe(next));
  });

  it('opens on today when no record lies ahead', async () => {
    const rows = [{ id: 'a', name: 'Past', due: monthsBack(1) }];
    render(<ObjectCalendar schema={block('next_record', { objectName: undefined, filter: undefined, staticData: rows })} />);
    await settle();
    expect(shownDay()).toBe(TODAY);
  });
});

describe('calendar.initialDate — navigation owns the date after the seed (objectstack#28102)', () => {
  it('a navigation after the seed is not reset by a later re-render', async () => {
    const target = monthsAhead(5);
    const ds = makeDataSource([{ id: '7', due: target }]);
    const { rerender } = render(<ObjectCalendar schema={block('first_record')} dataSource={ds as any} />);
    await waitFor(() => expect(shownDay()).toBe(target));

    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    const t = new Date(`${target}T00:00:00`);
    const moved = localDay(new Date(t.getFullYear(), t.getMonth() + 1, 15));
    expect(shownDay()).toBe(moved);

    rerender(<ObjectCalendar schema={block('first_record')} dataSource={ds as any} />);
    await settle();
    expect(shownDay()).toBe(moved);
    expect(anchorCalls(ds)).toHaveLength(1);
  });

  it('an anchor answer that lands after the user navigated does not move the calendar', async () => {
    let answer!: (rows: unknown[]) => void;
    const pending = new Promise<unknown[]>((resolve) => { answer = resolve; });
    const ds = makeDataSource(pending);
    render(<ObjectCalendar schema={block('first_record')} dataSource={ds as any} />);
    await waitFor(() => expect(anchorCalls(ds)).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    const now = new Date();
    const moved = localDay(new Date(now.getFullYear(), now.getMonth() + 1, 15));
    expect(shownDay()).toBe(moved);

    await act(async () => { answer([{ id: '7', due: monthsAhead(5) }]); });
    await settle();
    expect(shownDay()).toBe(moved);
  });
});
