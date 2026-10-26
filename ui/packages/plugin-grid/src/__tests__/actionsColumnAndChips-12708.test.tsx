/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12708 — what `ObjectGrid` hands `data-table` for a list at 1024 px.
 *
 * 1. The Actions column is drawn only when a row on screen OFFERS an action:
 *    its row plan (the one `RowActionMenu` draws the cell from) holds an
 *    inline button or a menu item. Wiring alone (`onEdit` / `onDelete`, an
 *    `operations` block) drew an "Actions" header over rows that offered
 *    nothing. Each absence is paired with a presence in a render that differs
 *    only in what the rows offer.
 * 2. A select-typed column carries the `chips` flag, which the table reads as
 *    "floor this column at its widest chip". Its observable is the drawn-size
 *    marker on the header: a chip column with an explicit width is measured, a
 *    text column with one is not.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import type { ObjectGridRowOperations } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

const ROWS = [
  { id: 'r1', name: 'First', status: 'published' },
  { id: 'r2', name: 'Second', status: 'draft' },
];

function renderGrid(opts: {
  rowOperations?: (record: Record<string, unknown>) => ObjectGridRowOperations | null | undefined;
  schema?: Record<string, unknown>;
  objectFields?: Record<string, unknown>;
  wired?: boolean;
} = {}) {
  const schema: any = {
    type: 'object-grid',
    objectName: 'test_object',
    columns: [{ field: 'name', label: 'Name' }],
    data: { provider: 'value', items: ROWS },
    ...opts.schema,
  };
  const wired = opts.wired ?? true;
  return render(
    <ActionProvider>
      <ObjectGrid
        schema={schema}
        objectFields={opts.objectFields}
        {...(wired ? { onEdit: vi.fn(), onDelete: vi.fn() } : {})}
        {...(opts.rowOperations ? { rowOperations: opts.rowOperations } : {})}
      />
    </ActionProvider>,
  );
}

const actionsHeader = () => screen.queryByRole('columnheader', { name: 'Actions' });

async function settle() {
  await waitFor(() => expect(screen.getByText('Second')).toBeInTheDocument());
}

beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('objectui#12708 · the Actions column is drawn only when a row offers an action', () => {
  it('is absent when every row on screen is refused every action', async () => {
    renderGrid({ rowOperations: () => ({ update: false, delete: false }) });
    await settle();
    expect(actionsHeader()).toBeNull();
    expect(screen.queryAllByTestId('row-action-trigger')).toHaveLength(0);
    // Every row keeps the same cell count as the header: no `_actions` cell.
    const headCount = document.querySelectorAll('thead th').length;
    for (const tr of Array.from(document.querySelectorAll('tbody tr'))) {
      expect(tr.children).toHaveLength(headCount);
    }
  });

  it('is drawn as soon as one row offers one, while the other offers nothing', async () => {
    renderGrid({ rowOperations: (record) => (record.id === 'r1' ? { update: false, delete: false } : undefined) });
    await settle();
    expect(actionsHeader()).not.toBeNull();
    // One trigger: the offering row's. The refused row's cell is empty.
    expect(screen.getAllByTestId('row-action-trigger')).toHaveLength(1);
  });

  it('is absent when no action is wired at all (unchanged)', async () => {
    renderGrid({ wired: false });
    await settle();
    expect(actionsHeader()).toBeNull();
  });
});

describe('objectui#12708 · CONTROL — a list whose rows offer actions keeps its pinned Actions column', () => {
  it('draws the column, pinned right, with a trigger on every row', async () => {
    renderGrid();
    await settle();
    const header = actionsHeader();
    expect(header).not.toBeNull();
    expect(header).toHaveClass('sticky', 'right-0');
    expect(screen.getAllByTestId('row-action-trigger')).toHaveLength(ROWS.length);
    const cells = Array.from(document.querySelectorAll('tbody tr')).map((tr) => tr.lastElementChild as HTMLElement);
    for (const cell of cells) expect(cell).toHaveClass('sticky', 'right-0');
  });

  it('draws it for a legacy row action that is not Edit or Delete, with nothing else wired', async () => {
    renderGrid({ wired: false, schema: { rowActions: ['archive'] } });
    await settle();
    expect(actionsHeader()).not.toBeNull();
  });
});

describe('objectui#12708 · a select-typed column is a chip column', () => {
  it('measures the chip column under an explicit width, and not the text column beside it', async () => {
    renderGrid({
      wired: false,
      schema: {
        columns: [
          { field: 'name', label: 'Name', width: 120 },
          { field: 'status', label: 'Status', width: 90 },
        ],
      },
      objectFields: {
        name: { name: 'name', type: 'text', label: 'Name' },
        status: {
          name: 'status',
          type: 'select',
          label: 'Status',
          options: [
            { value: 'published', label: 'Published' },
            { value: 'draft', label: 'Draft' },
          ],
        },
      },
    });
    await settle();
    const head = (name: string) => screen.getByRole('columnheader', { name });
    expect(head('Status').querySelector('[data-auto-width-key="status"]')).not.toBeNull();
    expect(head('Name').querySelector('[data-auto-width-key]')).toBeNull();
  });
});

describe('objectui#12708 · the grouped grid scrolls in the shared overflow box', () => {
  it('its one scroller is the overflow box, and the pinned Actions cells draw the seam shadow', async () => {
    renderGrid({ schema: { grouping: { fields: [{ field: 'status' }] } } });
    await settle();
    const scroller = screen.getByTestId('grouped-grid-scroller');
    expect(scroller).toHaveClass('group/hscroll', 'overflow-auto');
    expect(scroller.querySelector('.min-w-max')).not.toBeNull();
    const header = actionsHeader();
    expect(header).not.toBeNull();
    expect(header).toHaveClass('sticky', 'right-0', 'group-data-[overflow-right=true]/hscroll:before:opacity-100');
    // Wider than the box: the box flags it for the pinned cells, and draws no
    // edge overlay of its own, because the shadow sits at the pinned seam.
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 1477 });
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 768 });
    act(() => { fireEvent.scroll(scroller); });
    expect(scroller).toHaveAttribute('data-overflow-right', 'true');
    expect(screen.queryByTestId('horizontal-overflow-shadow')).toBeNull();
  });
});
