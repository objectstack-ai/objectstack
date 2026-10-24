/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12081 item 2 — a calendar view hosted by a list view draws every
 * record in the window it shows, not the first 100 of the object.
 *
 * Measured on `objectstack-ai/hotclm#87` (17.7.0): the Console's calendar over
 * `clm_contract` sent `GET …?top=100&select=…,end_date` with no date window, so
 * with 122 contracts up to 22 were never drawn, and the only signal was this
 * view's "Showing first 100 records" note. The 100 is this component's ONE
 * unpaged fetch (`DEFAULT_LIST_FETCH_BATCH_SIZE`), handed to the calendar as
 * `data`.
 *
 * The direction (triage, objectui#12081 comment 6093502833): fetch the visible
 * date window, filtered on the calendar's date field, and page through it;
 * ⛔ no bigger cap. The fetch batch stays 100 (objectui#9853, ruling
 * 5824040487), and the walk stops at the platform ceiling with its loud
 * footnote (objectui#7210, ruling a′).
 *
 * ## Test-source note
 *
 * `plugin-calendar` is not a dependency of `plugin-list`, so the calendar here
 * is a registry stub that records what this view hands it and can report a
 * visible range through the `onVisibleRangeChange` host callback, the way the
 * real `ObjectCalendar` does. The records live in a `ValueDataSource`, which
 * evaluates `$filter`, `$skip` and `$top` the way a backend does, so a window
 * that is not sent cannot select the right rows by accident. The real calendar
 * under the real list is pinned one package over, in
 * `packages/app-shell/src/__tests__/listCalendarDateWindow-12081.test.tsx`.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { PaginationConfigSchema } from '@objectstack/spec/ui';
import { ComponentRegistry, NON_GRID_ROW_CEILING, ValueDataSource } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';

/** The unpaged views' fetch batch (objectui#9853): the step every request takes. */
const FETCH_BATCH = 100;

/** "Today" for every case here: the calendar opens on October 2026. */
const NOW = new Date(2026, 9, 14, 10, 0, 0);

type Row = Record<string, unknown>;

/** `count` contracts ending on days of `month` (0-based) in 2026, at most four a day. */
function contractsIn(month: number, count: number, prefix: string): Row[] {
  const days = new Date(2026, month + 1, 0).getDate();
  return Array.from({ length: count }, (_, i) => {
    const day = (i % days) + 1;
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return { id: `${prefix}-${i}`, name: `${prefix} ${i}`, end_date: `2026-${mm}-${dd}`, status: 'active' };
  });
}

let lastCalendarProps: any = null;
let lastGridProps: any = null;
let lastKanbanProps: any = null;

const STUBBED = ['object-calendar', 'object-grid', 'object-kanban'] as const;
const previous = new Map<string, unknown>();
beforeAll(() => {
  for (const type of STUBBED) {
    previous.set(type, ComponentRegistry.get(type));
    ComponentRegistry.register(type, (props: any) => {
      if (type === 'object-calendar') lastCalendarProps = props;
      if (type === 'object-grid') lastGridProps = props;
      if (type === 'object-kanban') lastKanbanProps = props;
      return <div data-testid={`${type}-stub`} />;
    });
  }
});
afterAll(() => {
  for (const type of STUBBED) {
    const prev = previous.get(type);
    if (prev) ComponentRegistry.register(type, prev as any);
    else ComponentRegistry.unregister(type);
  }
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  lastCalendarProps = null;
  lastGridProps = null;
  lastKanbanProps = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A data source over `rows` that records every query it was asked. */
function makeDataSource(rows: Row[]) {
  const store = new ValueDataSource<Row>({ items: rows });
  const calls: Array<Record<string, any>> = [];
  return {
    calls,
    find: vi.fn(async (object: string, params: any) => {
      calls.push(params);
      return store.find(object, params);
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        end_date: { type: 'date' },
        start_date: { type: 'date' },
        status: { type: 'select', options: [{ label: 'Active', value: 'active' }] },
      },
    }),
  } as any;
}

const CALENDAR_VIEW = {
  viewType: 'calendar',
  calendar: { startDateField: 'end_date', titleField: 'name' },
};

const renderList = (schemaExtra: Record<string, unknown>, ds: any) =>
  render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView
        schema={{
          type: 'list-view',
          objectName: 'clm_contract',
          columns: ['name', 'status'],
          ...schemaExtra,
        } as any}
        dataSource={ds}
      />
    </SchemaRendererProvider>,
  );

/** The ids the calendar was last handed. */
const handedIds = (): string[] => ((lastCalendarProps?.data ?? []) as Row[]).map((r) => String(r.id));

describe('ListView — a hosted calendar is handed every record of its visible window (objectui#12081 item 2)', () => {
  it('(a) a visible month holding more than one fetch batch hands the calendar every record in it', async () => {
    // 122 in October (the hotclm count), 40 in August listed ahead of them and
    // 40 in December after. The month cannot be drawn from one batch, and the
    // first batch of the object is mostly August.
    const october = contractsIn(9, 122, 'oct');
    const rows = [...contractsIn(7, 40, 'aug'), ...october, ...contractsIn(11, 40, 'dec')];
    const ds = makeDataSource(rows);
    renderList(CALENDAR_VIEW, ds);

    await waitFor(() => {
      for (const r of october) expect(handedIds()).toContain(r.id);
    });
    // Paged in fetch-batch steps: no request asks for more than the batch.
    for (const params of ds.calls) expect(params.$top).toBeLessThanOrEqual(FETCH_BATCH);
    // …and paged through, not capped: the walk took more than one step.
    expect(ds.calls.length).toBeGreaterThan(1);
    // Every step carries the window on the field the calendar draws by.
    expect(lastCalendarProps.schema.startDateField).toBe('end_date');
    for (const params of ds.calls) expect(JSON.stringify(params.$filter)).toContain('"end_date"');
    // The records of months the grid does not show are not the calendar's: a
    // window that was not sent would have handed August's over first.
    expect(handedIds().filter((id) => id.startsWith('aug-') || id.startsWith('dec-'))).toEqual([]);
    // Nothing this view cannot reach: no "Showing first 100" note.
    expect(screen.queryByTestId('data-limit-warning')).toBeNull();
  });

  it('(b) a reported range the held window does not cover fetches that window', async () => {
    const rows = [...contractsIn(9, 30, 'oct'), ...contractsIn(11, 130, 'dec')];
    const ds = makeDataSource(rows);
    renderList(CALENDAR_VIEW, ds);
    await waitFor(() => expect(handedIds()).toContain('oct-29'));
    expect(typeof lastCalendarProps.onVisibleRangeChange).toBe('function');

    // The calendar moved to December 2026: its month grid, Monday-first.
    const before = ds.calls.length;
    await act(async () => {
      lastCalendarProps.onVisibleRangeChange({ start: new Date(2026, 10, 30), end: new Date(2027, 0, 11) });
    });
    await waitFor(() => {
      for (let i = 0; i < 130; i++) expect(handedIds()).toContain(`dec-${i}`);
    });
    expect(ds.calls.length).toBeGreaterThan(before);
    expect(handedIds().filter((id) => id.startsWith('oct-'))).toEqual([]);
  });

  it('(b) a reported range the held window covers asks for nothing', async () => {
    const ds = makeDataSource(contractsIn(9, 30, 'oct'));
    renderList(CALENDAR_VIEW, ds);
    await waitFor(() => expect(handedIds()).toContain('oct-29'));
    const before = ds.calls.length;

    // The calendar's own month grid, then a week inside it: both inside the
    // window the first fetch covered.
    await act(async () => {
      lastCalendarProps.onVisibleRangeChange({ start: new Date(2026, 8, 28), end: new Date(2026, 10, 9) });
    });
    await act(async () => {
      lastCalendarProps.onVisibleRangeChange({ start: new Date(2026, 9, 12), end: new Date(2026, 9, 19) });
    });
    expect(ds.calls.length).toBe(before);
  });

  it('(c) a window over the platform ceiling hands the calendar N rows and says N of M under it', async () => {
    const total = NON_GRID_ROW_CEILING + 50;
    const ds = makeDataSource(contractsIn(9, total, 'oct'));
    renderList(CALENDAR_VIEW, ds);

    await waitFor(() => expect(handedIds()).toHaveLength(NON_GRID_ROW_CEILING));
    const note = await screen.findByRole('note');
    expect(note).toHaveAttribute('data-row-ceiling-note', 'non-grid');
    expect(note.textContent).toContain(String(NON_GRID_ROW_CEILING));
    expect(note.textContent).toContain(String(total));
    // The walk never asked past one probe row beyond the ceiling.
    const asked = ds.calls.reduce((sum: number, p: any) => sum + p.$top, 0);
    expect(asked).toBe(NON_GRID_ROW_CEILING + 1);
    for (const params of ds.calls) expect(params.$top).toBeLessThanOrEqual(FETCH_BATCH);
  });

  it('a window that fits draws no ceiling note', async () => {
    const ds = makeDataSource(contractsIn(9, 122, 'oct'));
    renderList(CALENDAR_VIEW, ds);
    await waitFor(() => expect(handedIds()).toHaveLength(122));
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('the records with no start date ride along, for the calendar\'s unscheduled area', async () => {
    const undated = [{ id: 'undated-1', name: 'Evergreen', end_date: null, status: 'active' }];
    const ds = makeDataSource([...contractsIn(9, 10, 'oct'), ...contractsIn(3, 10, 'apr'), ...undated]);
    renderList(CALENDAR_VIEW, ds);
    await waitFor(() => expect(handedIds()).toContain('oct-9'));
    expect(handedIds()).toContain('undated-1');
    expect(handedIds().filter((id) => id.startsWith('apr-'))).toEqual([]);
  });

  it('with an end field bound, a span that opens before the window and runs into it is fetched', async () => {
    const spans = [
      { id: 'into', name: 'Into October', start_date: '2026-08-20', end_date: '2026-10-05', status: 'active' },
      { id: 'before', name: 'All in August', start_date: '2026-08-01', end_date: '2026-08-10', status: 'active' },
    ];
    const ds = makeDataSource(spans);
    renderList({ viewType: 'calendar', calendar: { startDateField: 'start_date', endDateField: 'end_date' } }, ds);
    await waitFor(() => expect(handedIds()).toContain('into'));
    expect(handedIds()).not.toContain('before');
  });

  it('the view\'s own filter still narrows the window', async () => {
    const rows = [
      ...contractsIn(9, 5, 'active'),
      ...contractsIn(9, 5, 'closed').map((r) => ({ ...r, status: 'closed' })),
    ];
    const ds = makeDataSource(rows);
    renderList({ ...CALENDAR_VIEW, filter: [['status', '=', 'active']] }, ds);
    await waitFor(() => expect(handedIds()).toContain('active-4'));
    expect(handedIds().filter((id) => id.startsWith('closed-'))).toEqual([]);
  });
});

describe('CONTROL — every other view asks exactly what it asked before (objectui#12081)', () => {
  /** The display default the paged grid reads from the protocol. */
  const SPEC_DISPLAY_DEFAULT: number = PaginationConfigSchema.parse({}).pageSize;

  it('the paged grid: one page, its `$top`, no window, and the next page by `$skip`', async () => {
    const ds = makeDataSource(contractsIn(9, 122, 'oct'));
    renderList({ viewType: 'grid' }, ds);
    await waitFor(() => expect(lastGridProps?.manualPagination).toBe(true));
    expect(ds.calls).toEqual([
      { $orderby: undefined, $top: SPEC_DISPLAY_DEFAULT, $select: ['id', 'name', 'status'] },
    ]);
    expect(typeof lastGridProps.onVisibleRangeChange).toBe('undefined');

    await act(async () => { lastGridProps.onPageChange(2); });
    await waitFor(() => expect(ds.calls).toHaveLength(2));
    expect(ds.calls[1]).toEqual({
      $orderby: undefined,
      $top: SPEC_DISPLAY_DEFAULT,
      $skip: SPEC_DISPLAY_DEFAULT,
      $select: ['id', 'name', 'status'],
    });
  });

  it('the board: still one fetch batch, no window', async () => {
    const ds = makeDataSource(contractsIn(9, 122, 'oct'));
    renderList({ viewType: 'kanban', kanban: { groupByField: 'status' } }, ds);
    // objectui#12619 — the board pages its own lanes and is handed no rows;
    // this view's own query, below, is what it asked before.
    await waitFor(() => expect(lastKanbanProps?.lanePaging).toBeDefined());
    expect(lastKanbanProps.data).toBeUndefined();
    expect(ds.calls).toHaveLength(1);
    expect(ds.calls[0].$top).toBe(FETCH_BATCH);
    expect(ds.calls[0].$filter).toBeUndefined();
    expect(ds.calls[0].$skip).toBeUndefined();
  });

  it('a calendar with no start binding is not windowed: it keeps the one batch and draws its refusal', async () => {
    const ds = makeDataSource(contractsIn(9, 122, 'oct'));
    renderList({ viewType: 'calendar' }, ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await waitFor(() => expect(lastCalendarProps).not.toBeNull());
    expect(ds.calls).toHaveLength(1);
    expect(ds.calls[0].$top).toBe(FETCH_BATCH);
    expect(ds.calls[0].$filter).toBeUndefined();
    expect(lastCalendarProps.onVisibleRangeChange).toBeUndefined();
  });
});
