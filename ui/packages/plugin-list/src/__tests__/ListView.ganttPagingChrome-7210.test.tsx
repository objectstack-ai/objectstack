/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7210 — the record-count bar describes THIS component's paged query,
 * so it is suppressed on the one surface that does not draw those rows.
 *
 * The bar is shared chrome: one block at the foot of `ListView`, rendered for
 * every `viewType`. On grid, kanban, calendar, gallery, timeline and map it is
 * accurate — those renderers consume the `data` this component hands down. On
 * `gantt` it is not: the registered `object-gantt` renderer forwards no props
 * but `schema`, so the chart queries for itself, with no `$top`
 * (`plugin-gantt/src/ObjectGantt.hostDataProp-7210.test.tsx` pins that half).
 * The bar then reports one request under a chart drawn from another — and it is
 * the only paging disclosure on the screen, so a reader takes it as describing
 * the chart. It cost a browser session and a wrong finding in an application
 * repo before it was disproved.
 *
 * The two controls are the point of this file as much as the gantt case is: a
 * naive edit deletes shared chrome and takes a TRUE footer down with the false
 * one. `kanban` is the load-bearing control — a non-grid, page-scoped surface
 * whose limit warning is correct and must survive.
 *
 * REVERSE VERIFICATION — direction and counts predicted before running: drop
 * `surfaceDrawsFetchedRows` from the bar's render condition and exactly the two
 * gantt cases go RED (the bar and its warning reappear) while both control
 * cases stay GREEN. Observed: 2 failed / 2 passed, as predicted.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';

/** Total rows in the store; the view is authored with a smaller page. */
const TOTAL = 18;
const PAGE_SIZE = 6;

const rows = Array.from({ length: TOTAL }, (_, i) => ({
  id: String(i + 1),
  subject: `Task ${i + 1}`,
  status: i < PAGE_SIZE ? 'open' : 'done',
  visible_from: `2026-01-0${(i % 9) + 1}`,
  due_date: `2026-01-1${(i % 9) + 1}`,
}));

const objectDef = {
  name: 'duly_task',
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text', label: 'Subject' },
    status: { name: 'status', type: 'select', label: 'Status' },
    visible_from: { name: 'visible_from', type: 'date', label: 'Visible From' },
    due_date: { name: 'due_date', type: 'date', label: 'Due' },
  },
};

/**
 * Stand-ins for the three child renderers. The bar under test is `ListView`'s
 * own and is independent of what the child draws, so a spy keeps this file free
 * of a dependency on `plugin-grid` / `plugin-kanban` / `plugin-gantt` — and the
 * gantt spy deliberately does NOT consume `data`, which is what the real
 * renderer does too.
 */
for (const type of ['object-grid', 'object-kanban', 'object-gantt'] as const) {
  ComponentRegistry.register(
    type,
    () => <div data-testid={`${type}-spy`} />,
    { namespace: 'test', label: `${type} spy`, category: 'view' },
  );
}

function makeDataSource() {
  return {
    find: vi.fn(async (_resource: string, params: any) => {
      const top = params?.$top;
      const slice = typeof top === 'number' ? rows.slice(0, top) : rows;
      return { data: slice, total: TOTAL, hasMore: typeof top === 'number' && top < TOTAL };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => objectDef),
  } as any;
}

function baseSchema(viewType: string): any {
  return {
    type: 'list-view',
    objectName: 'duly_task',
    viewType,
    columns: ['subject', 'status', 'visible_from', 'due_date'],
    filter: [['visible_from', 'is_not_null'], ['due_date', 'is_not_null']],
    sort: [{ field: 'visible_from', order: 'asc' }],
    pagination: { pageSize: PAGE_SIZE },
    gantt: {
      startDateField: 'visible_from',
      endDateField: 'due_date',
      titleField: 'subject',
    },
    kanban: { groupByField: 'status' },
  };
}

async function renderView(viewType: string) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={baseSchema(viewType)} dataSource={dataSource} />
    </SchemaRendererProvider>,
  );
  // Wait for the child surface, so every case is asserted on a settled render
  // rather than on a still-loading one (where the bar is absent for a reason
  // that has nothing to do with this change).
  await waitFor(() => expect(screen.getByTestId(`object-${viewType}-spy`)).toBeTruthy());
  return dataSource;
}

describe('objectui#7210 — paging chrome on a surface it does not describe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('gantt: no record-count bar, because the chart is not drawn from the paged query', async () => {
    await renderView('gantt');
    await waitFor(() => expect(screen.queryByTestId('record-count-bar')).toBeNull());
    expect(screen.queryByTestId('record-count-bar')).toBeNull();
  });

  it('gantt: no "showing first N records" warning either', async () => {
    await renderView('gantt');
    await waitFor(() => expect(screen.queryByTestId('record-count-bar')).toBeNull());
    expect(screen.queryByTestId('data-limit-warning')).toBeNull();
  });

  it('CONTROL grid: the paging footer is unchanged', async () => {
    await renderView('grid');
    const bar = await screen.findByTestId('record-count-bar');
    // Server pagination is live here, so the honest figure is the grand total.
    expect(bar.textContent).toContain(String(TOTAL));
  });

  it('CONTROL kanban: a correctly page-scoped non-grid surface keeps its warning', async () => {
    await renderView('kanban');
    const bar = await screen.findByTestId('record-count-bar');
    expect(bar.textContent).toContain(String(PAGE_SIZE));
    const warning = await screen.findByTestId('data-limit-warning');
    expect(warning.textContent).toContain(String(PAGE_SIZE));
  });
});
