/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29078 — the Dashboards flow at phone width (375 and 390 px).
 *
 * The phone-width audit (#29040) holds every control to a 44 px touch target.
 * Measured on a real Console against the CRM and showcase dashboards, these
 * were 16 to 36 px tall: the filter bar's triggers and option rows, the
 * custom-range calendar's days, the dataset table's sort buttons, drillable
 * rows and pivot cells, its Export CSV button, and the drill drawer's
 * "Open in list". jsdom has no layout, so the floor is pinned the way the
 * Console draws it: a `min-h-11` (44 px) floor below `sm`, released from `sm`
 * up so the desktop keeps its compact sizes.
 *
 * The calendar case is behavioural: below `md` the custom range opens ONE
 * month (two stacked months at 44 px days run past a phone's viewport), and
 * from `md` up it keeps two.
 */

import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DrillNavigationProvider } from '@object-ui/react';
import { resolveDashboardFilterDefs } from '@object-ui/core';
import { DashboardFilterBar } from '../DashboardFilterBar';
import { DatasetWidget } from '../DatasetWidget';
import { OpenInListButton } from '../OpenInListButton';

vi.mock('../DrillDownDrawer', () => ({ DrillDownDrawer: () => null }));

const DESKTOP_WIDTH = window.innerWidth;

function setWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
}

afterEach(() => {
  cleanup();
  setWidth(DESKTOP_WIDTH);
  vi.unstubAllGlobals();
});

/** The floor below `sm`, released from `sm` up. */
function expectPhoneFloor(el: Element) {
  expect(el.className).toContain('min-h-11');
  expect(el.className).toContain('sm:min-h-0');
}

const captions = () =>
  [...document.body.querySelectorAll('.rdp-caption_label')].map((el) => (el.textContent ?? '').trim());

describe('#29078 — the filter bar is 44 px tall on a phone', () => {
  const defs = resolveDashboardFilterDefs({
    dateRange: { field: 'created_at' },
    globalFilters: [
      { field: 'status', type: 'select', options: [{ value: 'open', label: 'Open' }] },
      { field: 'owner', type: 'text' },
    ],
  } as any);

  it('every trigger, the text field and the Reset button carry the phone floor', () => {
    render(
      <DashboardFilterBar
        defs={defs}
        values={{ dateRange: { preset: 'last_7_days' }, status: 'open' }}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    const triggers = screen.getAllByRole('combobox');
    expect(triggers).toHaveLength(2);
    triggers.forEach(expectPhoneFloor);
    expectPhoneFloor(screen.getByTestId('dashboard-filter-owner'));
    expectPhoneFloor(screen.getByRole('button', { name: /reset/i }));
  });

  it('every option row of the date and select lists carries the phone floor', async () => {
    const user = userEvent.setup();
    render(<DashboardFilterBar defs={defs} values={{}} onChange={vi.fn()} />);
    const [dateTrigger, statusTrigger] = screen.getAllByRole('combobox');

    await user.click(dateTrigger);
    const dateOptions = await screen.findAllByRole('option');
    expect(dateOptions.length).toBeGreaterThan(3);
    dateOptions.forEach(expectPhoneFloor);
    await user.keyboard('{Escape}');

    await user.click(statusTrigger);
    const statusOptions = await screen.findAllByRole('option');
    expect(statusOptions.map((o) => o.textContent)).toEqual(['All', 'Open']);
    statusOptions.forEach(expectPhoneFloor);
  });

  async function openCustomRange() {
    const user = userEvent.setup();
    render(<DashboardFilterBar defs={resolveDashboardFilterDefs({ dateRange: { field: 'created_at' } })} values={{}} onChange={vi.fn()} />);
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Custom…' }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  }

  it('below md the custom range opens one month, with 44 px day cells', async () => {
    setWidth(375);
    await openCustomRange();
    await waitFor(() => expect(captions()).toHaveLength(1));
    const root = document.body.querySelector('[data-slot="calendar"]');
    expect(root?.className).toContain('max-md:[--cell-size:2.75rem]');
  });

  it('from md up the custom range keeps its two months (desktop unchanged)', async () => {
    await openCustomRange();
    await waitFor(() => expect(captions()).toHaveLength(2));
  });
});

describe('#29078 — the dataset table and pivot are 44 px touch targets on a phone', () => {
  const rows = [
    { industry: 'Finance', account_count: 3 },
    { industry: 'Technology', account_count: 5 },
  ];
  const fields = [
    { name: 'industry', type: 'text', label: 'Industry' },
    { name: 'account_count', type: 'number', label: 'Accounts' },
  ];
  const drillable = () => ({
    queryDataset: vi.fn(async () => ({
      rows,
      fields,
      object: 'crm_account',
      dimensionFields: { industry: 'industry' },
      drillRawRows: [{ industry: 'fin' }, { industry: 'tech' }],
    })),
  });

  function stubMeta() {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ item: { name: 'crm_account', fields: {} } }) })));
  }

  it('sort buttons and the cells of drillable rows carry the phone floor; Export CSV is 44 px in its own row', async () => {
    stubMeta();
    render(<DatasetWidget widget={{ type: 'table', dataset: 'by_industry', dimensions: ['industry'], values: ['account_count'] }} dataSource={drillable()} />);
    await screen.findByText('Industry');

    screen.getAllByTestId('dataset-table-sort').forEach(expectPhoneFloor);
    const drillRows = screen.getAllByTestId('dataset-drill-row');
    expect(drillRows).toHaveLength(2);
    for (const row of drillRows) {
      for (const td of row.querySelectorAll('td')) expect(td.className).toContain('max-sm:h-11');
    }

    const exportBtn = screen.getByTestId('dataset-export');
    // Desktop: pinned to the corner, as before.
    expect(exportBtn.className).toContain('absolute');
    // Phone: out of the corner (where it would cover the last sort button) and 44 px.
    expect(exportBtn.className).toContain('max-sm:static');
    expect(exportBtn.className).toContain('max-sm:size-11');
  });

  it('a table nobody can drill does not grow its rows', async () => {
    stubMeta();
    render(<DatasetWidget widget={{ type: 'table', dataset: 'by_industry', dimensions: ['industry'], values: ['account_count'] }} dataSource={{ queryDataset: vi.fn(async () => ({ rows, fields })) }} />);
    await screen.findByText('Industry');
    expect(screen.queryAllByTestId('dataset-drill-row')).toHaveLength(0);
    const cells = [...document.querySelectorAll('tbody td')];
    expect(cells.length).toBeGreaterThan(0);
    cells.forEach((td) => expect(td.className).not.toContain('max-sm:h-11'));
  });

  it('drillable pivot cells are 44 px by 44 px', async () => {
    stubMeta();
    const src = {
      queryDataset: vi.fn(async () => ({
        rows: [{ status: 'Open', priority: 'High', task_count: 2 }],
        object: 'task',
        dimensionFields: { status: 'status', priority: 'priority' },
        drillRawRows: [{ status: 'open', priority: 'high' }],
      })),
    };
    render(<DatasetWidget widget={{ type: 'pivot', dataset: 'tasks', dimensions: ['status', 'priority'], values: ['task_count'] }} dataSource={src} />);
    const cell = await screen.findByTestId('dataset-drill-cell');
    expect(cell.className).toContain('max-sm:h-11');
    expect(cell.className).toContain('max-sm:min-w-11');
  });
});

describe('#29078 — the drill drawer\'s "Open in list" is 44 px tall on a phone', () => {
  it('carries the phone floor and keeps a host className', () => {
    const openRecordList = vi.fn();
    render(
      <DrillNavigationProvider value={{ openRecordList }}>
        <OpenInListButton objectName="crm_account" filter={{ industry: 'fin' }} className="ml-auto" />
      </DrillNavigationProvider>,
    );
    const btn = screen.getByTestId('drill-open-in-list');
    expectPhoneFloor(btn);
    expect(btn.className).toContain('ml-auto');
    fireEvent.click(btn);
    expect(openRecordList).toHaveBeenCalledWith('crm_account', { industry: 'fin' });
  });
});
