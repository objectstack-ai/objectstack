/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27355 row 8 — a calendar view's footer count says it counts the
 * records loaded for the dates on screen, not the records the view matches.
 *
 * A hosted calendar fetches a date window (objectui#12081), so the footer's
 * count is the window's rows. It read "N records", the same words a grid uses
 * for the view's total, so a reader took a month's rows for the view's size
 * (HotCRM 18.2.0 browser pass, Marketing S6). Counting the view would be a
 * second query; the window's rows are what this view already holds, so the
 * footer now names them as such.
 *
 * The calendar is a registry stub (as in `ListView.calendarDateWindow-12081`):
 * `plugin-calendar` is not a dependency of this package. The rows live in a
 * `ValueDataSource`, which evaluates `$filter` / `$skip` / `$top` the way a
 * backend does, so the window really selects the month.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry, ValueDataSource } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';

/** "Today" for every case here: the calendar opens on October 2026. */
const NOW = new Date(2026, 9, 14, 10, 0, 0);

type Row = Record<string, unknown>;

/** `count` contracts ending on days of `month` (0-based) in 2026. */
function contractsIn(month: number, count: number, prefix: string): Row[] {
  const days = new Date(2026, month + 1, 0).getDate();
  return Array.from({ length: count }, (_, i) => {
    const mm = String(month + 1).padStart(2, '0');
    const dd = String((i % days) + 1).padStart(2, '0');
    return { id: `${prefix}-${i}`, name: `${prefix} ${i}`, end_date: `2026-${mm}-${dd}`, status: 'active' };
  });
}

const STUBBED = ['object-calendar', 'object-grid'] as const;
const previous = new Map<string, unknown>();
beforeAll(() => {
  for (const type of STUBBED) {
    previous.set(type, ComponentRegistry.get(type));
    ComponentRegistry.register(type, () => <div data-testid={`${type}-stub`} />);
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
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function makeDataSource(rows: Row[]) {
  const store = new ValueDataSource<Row>({ items: rows });
  return {
    find: vi.fn(async (object: string, params: any) => store.find(object, params)),
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
        status: { type: 'select', options: [{ label: 'Active', value: 'active' }] },
      },
    }),
  } as any;
}

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

const footerText = () => screen.getByTestId('record-count-bar').textContent ?? '';

// 12 in October (the month on screen) and 30 in March, outside the window.
const ROWS = [...contractsIn(2, 30, 'mar'), ...contractsIn(9, 12, 'oct')];

describe('a calendar view\'s footer counts the records loaded for its dates (objectstack#27355)', () => {
  it('a windowed calendar names its count as the window\'s, and counts the window', async () => {
    renderList({ viewType: 'calendar', calendar: { startDateField: 'end_date', titleField: 'name' } }, makeDataSource(ROWS));
    await waitFor(() => expect(footerText()).toContain('12 records loaded for these dates'));
    expect(footerText()).not.toContain('42');
  });

  it('one record reads in the singular', async () => {
    renderList(
      { viewType: 'calendar', calendar: { startDateField: 'end_date', titleField: 'name' } },
      makeDataSource([...contractsIn(2, 30, 'mar'), ...contractsIn(9, 1, 'oct')]),
    );
    await waitFor(() => expect(footerText()).toContain('1 record loaded for these dates'));
  });

  it('control: a grid over the same object still counts the view, in the same words as before', async () => {
    renderList({ viewType: 'grid' }, makeDataSource(ROWS));
    await waitFor(() => expect(footerText()).toContain('42 records'));
    expect(footerText()).not.toContain('loaded for these dates');
  });

  it('control: a calendar over rows handed in whole counts them as the view', async () => {
    renderList(
      { viewType: 'calendar', calendar: { startDateField: 'end_date', titleField: 'name' }, data: ROWS },
      makeDataSource([]),
    );
    await waitFor(() => expect(footerText()).toContain('42 records'));
    expect(footerText()).not.toContain('loaded for these dates');
  });
});
