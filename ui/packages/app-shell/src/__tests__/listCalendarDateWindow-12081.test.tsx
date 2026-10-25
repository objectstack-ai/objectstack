/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12081 item 2 — a calendar under a list view draws every record of
 * the month it shows, and moving to another month fetches that month.
 *
 * Measured on objectstack-ai/hotclm#87 (17.7.0): the Console's calendar over
 * `clm_contract` asked for `top=100` with no date window, so with 122 contracts
 * up to 22 were never drawn. The list view fetched one unpaged batch of the
 * object and handed it to the calendar.
 *
 * ## Why this file lives in `app-shell`
 *
 * The two halves sit in two packages — `ListView` in `plugin-list`, which now
 * windows its calendar fetch, and `ObjectCalendar` in `plugin-calendar`, which
 * reports the days it draws — and neither depends on the other. `app-shell`
 * depends on both, so the REAL calendar is mounted under the REAL list here
 * with no new dependency edge (the reason
 * `displayPageSizeFromSpec-9853.test.tsx` lives here too). Each half's own pin
 * sits in its package: `ListView.calendarDateWindow-12081.test.tsx` and
 * `ObjectCalendar.visibleRange-12081.test.tsx`.
 *
 * The records live in a `ValueDataSource`, which evaluates `$filter`, `$skip`
 * and `$top` the way a backend does. October holds 122 contracts at most four
 * a day, the most a month cell draws without a "+N more", so every one of them
 * is an event on screen; 40 August contracts are listed ahead of them, which is
 * what a first batch of the object reaches first.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ValueDataSource } from '@object-ui/core';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '@object-ui/plugin-list';
// Registers the real `object-calendar` renderer, the one `ListView` mounts.
import '@object-ui/plugin-calendar';

const NOW = new Date(2026, 9, 14, 10, 0, 0);

type Row = Record<string, unknown>;

/** `count` contracts ending on days of `month` (1-based) in 2026, spread over its days. */
function contractsIn(month: number, count: number, prefix: string): Row[] {
  const days = new Date(2026, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    name: `${prefix} ${String(i).padStart(3, '0')}`,
    end_date: `2026-${mm}-${String((i % days) + 1).padStart(2, '0')}`,
  }));
}

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
    getObjectSchema: vi.fn(async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text' }, end_date: { type: 'date' } },
    })),
  } as any;
}

function mountCalendarList(ds: any) {
  return render(
    <SchemaRendererProvider dataSource={ds}>
      <ActionProvider>
        <ListView
          schema={{
            type: 'list-view',
            objectName: 'clm_contract',
            viewType: 'calendar',
            columns: ['name'],
            calendar: { startDateField: 'end_date', titleField: 'name' },
          } as any}
          dataSource={ds}
        />
      </ActionProvider>
    </SchemaRendererProvider>,
  );
}

/** The event chips the month grid drew whose title starts with `prefix`. */
const drawn = (prefix: string) =>
  screen.queryAllByRole('button').filter((el) => (el.getAttribute('aria-label') ?? '').startsWith(`${prefix} `));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a calendar under a list view draws its whole month, and fetches the month it moves to (objectui#12081)', () => {
  it('(a) all 122 October contracts are drawn, past the first fetch batch', async () => {
    const ds = makeDataSource([...contractsIn(8, 40, 'aug'), ...contractsIn(10, 122, 'oct')]);
    mountCalendarList(ds);

    await waitFor(() => expect(drawn('oct')).toHaveLength(122));
    expect(drawn('aug')).toHaveLength(0);
    // No step asked for more than the fetch batch: walked, not a bigger cap.
    for (const params of ds.calls) expect(params.$top).toBeLessThanOrEqual(100);
  });

  it('(b) moving to November fetches November, and draws it whole', async () => {
    const ds = makeDataSource([...contractsIn(10, 20, 'oct'), ...contractsIn(11, 110, 'nov')]);
    mountCalendarList(ds);
    await waitFor(() => expect(drawn('oct')).toHaveLength(20));
    const before = ds.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Next period' }));

    await waitFor(() => expect(drawn('nov')).toHaveLength(110));
    expect(ds.calls.length).toBeGreaterThan(before);
    // The calendar kept the month it moved to across the refetch: it was not
    // unmounted and reopened on today.
    expect(screen.getByLabelText(/November 2026/)).toBeInTheDocument();
  });
});
