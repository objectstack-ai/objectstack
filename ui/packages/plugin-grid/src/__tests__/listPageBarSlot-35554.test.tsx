/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35554 — a list page's grid carries no row control and no bulk
 * bar: its selection is drawn into the page bar's slot (`./listPageBarSlot`).
 * A grid outside any page bar's scope (a related list, a page block) keeps
 * its Actions column and its bottom bar.
 *
 * The page bar here is a fixture built on the same `useListPageBarHost` the
 * Console page header calls; the grid, its table, the selection bar and the
 * menus are real.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { useListPageBarHost } from '../listPageBarSlot';
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

/** The fixture page bar: the slot, and the state the list writes. */
const PageBar: React.FC = () => {
  const [slot, setSlot] = React.useState<HTMLDivElement | null>(null);
  const [scope, setScope] = React.useState<HTMLElement | null>(null);
  const state = useListPageBarHost(slot, scope);
  return (
    <div ref={(el) => setScope(el?.parentElement ?? null)} data-testid="page-bar" data-selecting={state.selecting ? 'yes' : 'no'}>
      <div ref={setSlot} data-testid="page-bar-slot" />
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

describe('objectstack#35554 — the list page bar takes the row controls', () => {
  it('a list page grid draws no Actions column and no hover control', async () => {
    const { container } = renderListPage(true);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(container.querySelector('th[data-column-key="_actions"]')).toBeNull();
    expect(screen.queryAllByTestId('row-action-trigger')).toHaveLength(0);
  });

  it('CONTROL: a grid with no page bar keeps its Actions column', async () => {
    const { container } = renderListPage(false);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    await waitFor(() => expect(container.querySelector('th[data-column-key="_actions"]')).not.toBeNull());
    expect(screen.getAllByTestId('row-action-trigger').length).toBeGreaterThan(0);
  });

  it('one row selected: the slot holds the count and that record\'s first two actions, no bottom bar', async () => {
    renderListPage(true);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    tick('Alice');
    const slot = screen.getByTestId('page-bar-slot');
    await waitFor(() => expect(within(slot).getByTestId('list-selection-bar')).toBeInTheDocument());
    expect(screen.getByTestId('page-bar')).toHaveAttribute('data-selecting', 'yes');
    expect(within(slot).getByTestId('list-selection-count')).toHaveTextContent('1');
    expect(within(slot).getByTestId('row-action-inline-submit_approval')).toBeInTheDocument();
    expect(within(slot).getByTestId('row-action-inline-make_quote')).toBeInTheDocument();
    expect(within(slot).queryByTestId('row-action-inline-clone')).toBeNull();
    expect(within(slot).getByTestId('selection-actions-more')).toBeInTheDocument();
    expect(screen.queryByTestId('bulk-actions-bar')).toBeNull();
  });

  it('two rows selected: the bulk actions instead; Cancel restores the page bar', async () => {
    renderListPage(true);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    tick('Alice');
    tick('Bob');
    const slot = screen.getByTestId('page-bar-slot');
    await waitFor(() => expect(within(slot).getByTestId('list-selection-count')).toHaveTextContent('2'));
    expect(within(slot).getByTestId('bulk-action-mass_update')).toBeInTheDocument();
    expect(within(slot).getByTestId('bulk-action-assign')).toBeInTheDocument();
    expect(within(slot).queryByTestId('row-action-inline-submit_approval')).toBeNull();
    expect(screen.queryByTestId('bulk-actions-bar')).toBeNull();
    fireEvent.click(within(slot).getByTestId('list-selection-cancel'));
    await waitFor(() => expect(screen.getByTestId('page-bar')).toHaveAttribute('data-selecting', 'no'));
    expect(within(slot).queryByTestId('list-selection-bar')).toBeNull();
    expect(screen.getAllByRole('checkbox').filter((c) => c.getAttribute('data-state') === 'checked')).toHaveLength(0);
  });

  it('CONTROL: a grid with no page bar keeps the bottom bulk bar', async () => {
    renderListPage(false);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    tick('Alice');
    await waitFor(() => expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument());
  });

  it('Shift extends a selection over the rows between', async () => {
    renderListPage(true);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    tick('Alice');
    const carolCell = screen.getByText('Carol').closest('tr')!.querySelector('[data-slot="row-leading-cell"]')!;
    fireEvent.click(carolCell, { shiftKey: true });
    const slot = screen.getByTestId('page-bar-slot');
    await waitFor(() => expect(within(slot).getByTestId('list-selection-count')).toHaveTextContent('3'));
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
