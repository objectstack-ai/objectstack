/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28434 — the row context menu `data-table` owns.
 *
 * 1. With no host renderer, a table that draws its own row "⋮" (the
 *    related-list tables) opens Open, then exactly that row's "⋮" items, from
 *    the same resolver; a row inside a selection of two or more, and a table
 *    with no row menu at all, keep the browser's menu.
 * 2. A host renderer (`renderRowContextMenu`) decides alone: its items, with
 *    the row and whether it is selected; `null` keeps the browser's menu.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { PredicateScopeProvider } from '@object-ui/react';
import { DropdownMenuItem } from '../../../ui/dropdown-menu';
import '../data-table';

const ROWS = [
  { id: 'r1', name: 'Open contract', frozen: false },
  { id: 'r2', name: 'Signed contract', frozen: true },
];

const BASE_SCHEMA = {
  type: 'data-table',
  pagination: false,
  searchable: false,
  columns: [{ header: 'Name', accessorKey: 'name' }],
  data: ROWS,
};

/** The related-list shape: the table's own row "⋮" with edit, delete and a child action. */
const RELATED_LIST_SCHEMA = {
  rowActions: true,
  onRowEdit: () => {},
  onRowDelete: () => {},
  rowEditPredicates: { visibleWhen: 'record.frozen != true' },
  rowActionDefs: [{ name: 'renew', label: 'Renew' }],
  onRowActionDef: () => {},
};

function renderTable(schema: Record<string, unknown>) {
  const DataTable = ComponentRegistry.get('data-table') as any;
  if (!DataTable) throw new Error('data-table not registered');
  return render(
    <PredicateScopeProvider scope={{}}>
      <DataTable schema={{ ...BASE_SCHEMA, ...schema }} />
    </PredicateScopeProvider>,
  );
}

const cellOf = (name: string) => screen.getByText(name).closest('td') as HTMLElement;
const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
const contextMenu = () => screen.queryByTestId('row-context-menu');
const itemIds = (menu: HTMLElement) =>
  within(menu).queryAllByRole('menuitem').map((el) => el.getAttribute('data-testid'));
const rightClick = (el: HTMLElement) => fireEvent.contextMenu(el, { button: 2, clientX: 30, clientY: 50 });

async function kebabItemIds(name: string) {
  await userEvent.click(within(rowOf(name)).getByTestId('data-table-row-actions'));
  const menu = await screen.findByRole('menu');
  const ids = itemIds(menu);
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  return ids;
}

afterEach(() => cleanup());

describe('objectstack#28434 · the table\'s own row context menu (no host renderer)', () => {
  it('per row: Open, then exactly that row\'s "⋮" items — a false predicate removes one from both', async () => {
    const onRowClick = vi.fn();
    renderTable({ ...RELATED_LIST_SCHEMA, onRowClick });
    for (const row of ROWS) {
      const kebab = await kebabItemIds(row.name);
      act(() => { rightClick(cellOf(row.name)); });
      const menu = await screen.findByTestId('row-context-menu');
      const ids = itemIds(menu);
      expect(ids[0]).toBe('row-context-open');
      expect(ids.slice(1)).toEqual(kebab);
      expect(kebab.includes('row-action-builtin-edit')).toBe(!row.frozen);
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(contextMenu()).toBeNull());
    }
    // Open is the row click.
    act(() => { rightClick(cellOf('Signed contract')); });
    await userEvent.click(await screen.findByTestId('row-context-open'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: 'r2' });
  });

  it('a row inside a selection of two or more keeps the browser\'s menu: this table has no bulk actions to offer', async () => {
    renderTable({ ...RELATED_LIST_SCHEMA, selectable: 'multiple' });
    for (const name of ['Open contract', 'Signed contract']) {
      await userEvent.click(within(rowOf(name)).getByRole('checkbox'));
    }
    expect(rightClick(cellOf('Open contract'))).toBe(true);
    expect(contextMenu()).toBeNull();
  });

  it('CONTROL — a table with no row menu keeps the browser\'s menu, even with a row click', () => {
    renderTable({ onRowClick: () => {} });
    expect(rightClick(cellOf('Open contract'))).toBe(true);
    expect(contextMenu()).toBeNull();
  });
});

describe('objectstack#28434 · a host renderer decides alone', () => {
  it('draws the host\'s items, given the row and whether it is selected', async () => {
    const renderRowContextMenu = vi.fn((row: any) => (
      <DropdownMenuItem data-testid="host-item">{`Host item for ${row.id}`}</DropdownMenuItem>
    ));
    renderTable({ ...RELATED_LIST_SCHEMA, renderRowContextMenu });
    let allowed = true;
    act(() => { allowed = rightClick(cellOf('Signed contract')); });
    expect(allowed).toBe(false);
    const menu = await screen.findByTestId('row-context-menu');
    // The host's items only — the table's own are not mixed in.
    expect(itemIds(menu)).toEqual(['host-item']);
    expect(menu).toHaveTextContent('Host item for r2');
    expect(renderRowContextMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 'r2' }), { selected: false });
  });

  it('a host answering null keeps the browser\'s menu', () => {
    renderTable({ ...RELATED_LIST_SCHEMA, renderRowContextMenu: () => null });
    expect(rightClick(cellOf('Open contract'))).toBe(true);
    expect(contextMenu()).toBeNull();
  });

  it('the keyboard opens it below the focused cell; Esc closes it and returns focus to that cell', async () => {
    renderTable({
      renderRowContextMenu: () => <DropdownMenuItem data-testid="host-item">Host item</DropdownMenuItem>,
    });
    const cell = cellOf('Open contract');
    cell.focus();
    act(() => { fireEvent.keyDown(cell, { key: 'F10', shiftKey: true }); });
    expect(await screen.findByTestId('row-context-menu')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(contextMenu()).toBeNull());
    expect(cell).toHaveFocus();
  });
});
