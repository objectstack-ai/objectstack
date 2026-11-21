/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35678 — every grid draws ONE selection bar, floated at the
 * bottom centre of its table: 「已选 N 条」 and ×, up to three labelled
 * actions, the rest behind More. Nothing above the list changes. The table
 * keeps room after its last row while the bar floats there.
 *
 * objectstack#35554 — a list page's grid (inside a registered list page scope,
 * `./listPageScope`) still carries no row-end control; a grid outside any
 * scope (a related list, a page block) keeps its Actions column.
 *
 * The page column here is a fixture built on the same `useListPageScope` the
 * Console page bars call; the grid, its table, the selection bar and the menus
 * are real.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { useListPageScope } from '../listPageScope';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';

/**
 * The record-grained CRUD probe (`/api/v1/security/explain`) a row's menu asks
 * for once it is opened: every record is allowed here — the verdicts are not
 * part of this pin, only that the host's fetch answers them.
 */
const apiFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const body = JSON.parse(String(init?.body ?? '{}')) as { object?: string; operation?: string; recordId?: string; recordIds?: string[] };
  const base = { allowed: true, object: body.object, operation: body.operation ?? 'update', principal: { userId: 'u' }, layers: [] };
  const payload = Array.isArray(body.recordIds)
    ? { ...base, records: body.recordIds.map((recordId) => ({ recordId, visible: true })) }
    : typeof body.recordId === 'string'
      ? { ...base, record: { recordId: body.recordId, visible: true } }
      : base;
  return { ok: true, status: 200, json: async () => payload } as unknown as Response;
};

beforeEach(() => __clearRecordCrudVerdictCache());

registerAllFields();

const ROWS = [
  { id: '1', name: 'Alice', amount: 100 },
  { id: '2', name: 'Bob', amount: 200 },
  { id: '3', name: 'Carol', amount: 300 },
];

const SCHEMA: any = {
  type: 'object-grid',
  objectName: 'test_object',
  columns: [
    { field: 'name', label: 'Name' },
    { field: 'amount', label: 'Amount', type: 'number' },
  ],
  data: { provider: 'value', items: ROWS },
  selection: { type: 'multiple' },
  rowActionDefs: [
    { name: 'submit_approval', label: 'Submit for approval' },
    { name: 'make_quote', label: 'Make quote' },
    { name: 'clone', label: 'Clone' },
  ],
  bulkActionDefs: [
    { name: 'mass_update', label: 'Mass update' },
    { name: 'assign', label: 'Assign' },
    { name: 'tag', label: 'Tag' },
  ],
};

/** The fixture page bar: it registers its page column as a list page scope. */
const PageBar: React.FC = () => {
  const [scope, setScope] = React.useState<HTMLElement | null>(null);
  useListPageScope(scope);
  return (
    <div ref={(el) => setScope(el?.parentElement ?? null)} data-testid="page-bar">
      <span>Accounts</span>
      <button type="button">New</button>
    </div>
  );
};

function renderListPage(withPageBar: boolean) {
  return render(
    <SchemaRendererProvider dataSource={undefined} apiFetch={apiFetch}>
    <ActionProvider>
      <div data-testid="page-column">
        {withPageBar && <PageBar />}
        <ObjectGrid
          schema={SCHEMA}
          onEdit={() => {}}
          onDelete={() => {}}
        />
      </div>
    </ActionProvider>
    </SchemaRendererProvider>,
  );
}

const tick = (name: string) => {
  const row = screen.getByText(name).closest('tr')!;
  fireEvent.click(within(row).getByRole('checkbox'));
};

const bar = () => screen.getByTestId('bulk-actions-bar');
const checked = () => screen.getAllByRole('checkbox').filter((c) => c.getAttribute('data-state') === 'checked');

describe('objectstack#35678 — one floating selection bar for every grid', () => {
  it('a list page grid draws no Actions column and no hover control', async () => {
    const { container } = renderListPage(true);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(container.querySelector('th[data-column-key="_actions"]')).toBeNull();
    expect(screen.queryAllByTestId('row-action-trigger')).toHaveLength(0);
  });

  it('CONTROL: a grid in no list page scope keeps its Actions column', async () => {
    const { container } = renderListPage(false);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    await waitFor(() => expect(container.querySelector('th[data-column-key="_actions"]')).not.toBeNull());
    expect(screen.getAllByTestId('row-action-trigger').length).toBeGreaterThan(0);
  });

  it("one row selected: the bar floats in the table with that record's first three actions; the page bar is untouched", async () => {
    renderListPage(true);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    const pageBarBefore = screen.getByTestId('page-bar').outerHTML;
    tick('Alice');
    await waitFor(() => expect(bar()).toBeInTheDocument());
    expect(screen.getByTestId('data-table-floating-bar')).toContainElement(bar());
    expect(within(bar()).getByTestId('bulk-selection-count')).toHaveTextContent('1');
    expect(within(bar()).getByTestId('row-action-inline-submit_approval')).toBeInTheDocument();
    expect(within(bar()).getByTestId('row-action-inline-make_quote')).toBeInTheDocument();
    expect(within(bar()).getByTestId('row-action-inline-clone')).toBeInTheDocument();
    // Edit and Delete are the fourth and fifth: behind More.
    expect(within(bar()).queryByTestId('selection-action-edit')).toBeNull();
    expect(within(bar()).getByTestId('selection-actions-more')).toBeInTheDocument();
    expect(screen.getByTestId('page-bar').outerHTML).toBe(pageBarBefore);
  });

  it('while the bar floats, the table keeps room after its last row; × takes both away', async () => {
    renderListPage(true);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.queryByTestId('data-table-floating-bar-room')).toBeNull();
    tick('Alice');
    tick('Bob');
    await waitFor(() => expect(within(bar()).getByTestId('bulk-selection-count')).toHaveTextContent('2'));
    const room = screen.getByTestId('data-table-floating-bar-room');
    expect(room).toHaveAttribute('aria-hidden', 'true');
    // The room is the table body's last row, after Carol.
    expect(room.parentElement!.lastElementChild).toBe(room);
    fireEvent.click(within(bar()).getByTestId('bulk-selection-clear'));
    await waitFor(() => expect(screen.queryByTestId('bulk-actions-bar')).toBeNull());
    expect(screen.queryByTestId('data-table-floating-bar-room')).toBeNull();
    expect(checked()).toHaveLength(0);
  });

  it('two rows selected: the bulk actions instead', async () => {
    renderListPage(true);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    tick('Alice');
    tick('Bob');
    await waitFor(() => expect(within(bar()).getByTestId('bulk-selection-count')).toHaveTextContent('2'));
    expect(within(bar()).getByTestId('bulk-action-mass_update')).toBeInTheDocument();
    expect(within(bar()).getByTestId('bulk-action-assign')).toBeInTheDocument();
    expect(within(bar()).getByTestId('bulk-action-tag')).toBeInTheDocument();
    expect(within(bar()).queryByTestId('row-action-inline-submit_approval')).toBeNull();
  });

  it('Esc clears the selection', async () => {
    renderListPage(true);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    tick('Alice');
    await waitFor(() => expect(bar()).toBeInTheDocument());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('bulk-actions-bar')).toBeNull());
    expect(checked()).toHaveLength(0);
  });

  it('CONTROL: a grid in no list page scope draws the same bar', async () => {
    renderListPage(false);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    tick('Alice');
    tick('Bob');
    await waitFor(() => expect(within(bar()).getByTestId('bulk-selection-count')).toHaveTextContent('2'));
    expect(screen.getByTestId('data-table-floating-bar')).toContainElement(bar());
  });

  it('Shift extends a selection over the rows between', async () => {
    renderListPage(true);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    tick('Alice');
    const carolCell = screen.getByText('Carol').closest('tr')!.querySelector('[data-slot="row-leading-cell"]')!;
    fireEvent.click(carolCell, { shiftKey: true });
    await waitFor(() => expect(within(bar()).getByTestId('bulk-selection-count')).toHaveTextContent('3'));
  });

  it('right-click on a row: the row\'s actions, Delete last, after a separator, in the danger colour', async () => {
    renderListPage(true);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    fireEvent.contextMenu(screen.getByText('Alice').closest('tr')!);
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    const last = items[items.length - 1];
    expect(last).toHaveAttribute('data-testid', 'row-action-builtin-delete');
    expect(last.className).toContain('text-destructive');
    const separator = within(menu).getByTestId('row-action-delete-separator');
    expect(separator.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(menu).getByTestId('row-action-submit_approval')).toBeInTheDocument();
  });
});
