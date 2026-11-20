/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35876 — under `GridHeaderMenu` every column header opens the
 * column menu (sort ascending, sort descending, hide; a header that does not
 * sort offers hide alone) and never sorts by itself; the keyboard reaches the
 * same menu from the focused header. Without the provider the header still
 * sorts on a click.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { GridHeaderMenuProvider } from '../../../context/gridHeaderMenu';
import '../data-table';

const ROWS = [
  { id: '1', name: 'Bob', status: 'open' },
  { id: '2', name: 'Ada', status: 'done' },
  { id: '3', name: 'Cyd', status: 'hold' },
];

afterEach(cleanup);

function DataTable(props: { schema: Record<string, unknown> }) {
  const Impl = ComponentRegistry.get('data-table') as React.ComponentType<{ schema: Record<string, unknown> }> | undefined;
  if (!Impl) throw new Error('data-table not registered');
  return <Impl schema={props.schema} />;
}

/** A server-sorted table, as ObjectGrid hands it from a list page. */
function renderManual(opts: { headerMenu: boolean; sort?: Array<{ field: string; order: 'asc' | 'desc' }>; statusSortable?: boolean }) {
  const onSortChange = vi.fn();
  const schema = {
    type: 'data-table',
    data: ROWS,
    columns: [
      { header: 'Name', accessorKey: 'name' },
      { header: 'Status', accessorKey: 'status', ...(opts.statusSortable === false ? { sortable: false } : {}) },
    ],
    pagination: false,
    manualSorting: true,
    sort: opts.sort ?? [],
    onSortChange,
  };
  const table = <DataTable schema={schema} />;
  render(opts.headerMenu ? <GridHeaderMenuProvider value>{table}</GridHeaderMenuProvider> : table);
  return { onSortChange };
}

const header = (key: string) => document.querySelector<HTMLElement>(`thead th[data-column-key="${key}"]`)!;
const menu = () => screen.queryByTestId('column-context-menu');

describe('data-table — the header opens the column menu (objectstack#35876)', () => {
  it('a click on the header opens the menu and changes no sort', () => {
    const { onSortChange } = renderManual({ headerMenu: true, sort: [{ field: 'name', order: 'asc' }] });
    expect(header('name')).toHaveAttribute('aria-haspopup', 'menu');
    expect(header('name')).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(header('status'));
    expect(within(menu()!).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Sort ascending', 'Sort descending', 'Hide column']);
    expect(header('status')).toHaveAttribute('aria-expanded', 'true');
    expect(onSortChange).not.toHaveBeenCalled();

    // A second click on the same header shuts its menu, still without a sort.
    fireEvent.click(header('status'));
    expect(menu()).toBeNull();
    expect(onSortChange).not.toHaveBeenCalled();
  });

  it('the entry chosen in the menu is the sort the table hands its host', () => {
    const { onSortChange } = renderManual({ headerMenu: true });
    fireEvent.click(header('status'));
    fireEvent.click(within(menu()!).getByText('Sort descending'));
    expect(onSortChange).toHaveBeenCalledTimes(1);
    expect(onSortChange).toHaveBeenLastCalledWith([{ field: 'status', order: 'desc' }]);
    expect(menu()).toBeNull();
  });

  it('the multi-level markers stay on the headers', () => {
    renderManual({ headerMenu: true, sort: [{ field: 'status', order: 'desc' }, { field: 'name', order: 'asc' }] });
    expect(header('status').textContent).toContain('1');
    expect(header('name').textContent).toContain('2');
  });

  it('keyboard: Enter on the focused header opens the menu, arrows move, Enter chooses', async () => {
    const { onSortChange } = renderManual({ headerMenu: true });
    const th = header('name');
    expect(th).toHaveAttribute('tabindex', '0');
    act(() => th.focus());
    await userEvent.keyboard('{Enter}');
    const items = within(menu()!).getAllByRole('menuitem');
    await waitFor(() => expect(items[0]).toHaveFocus());
    expect(onSortChange).not.toHaveBeenCalled();
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(items[1]).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    expect(onSortChange).toHaveBeenLastCalledWith([{ field: 'name', order: 'desc' }]);
    expect(menu()).toBeNull();
    await waitFor(() => expect(th).toHaveFocus());
  });

  it('keyboard: Esc shuts the menu, changes no sort, and gives focus back to the header', async () => {
    const { onSortChange } = renderManual({ headerMenu: true, sort: [{ field: 'name', order: 'asc' }] });
    const th = header('status');
    act(() => th.focus());
    await userEvent.keyboard('{Enter}');
    expect(menu()).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(menu()).toBeNull();
    expect(onSortChange).not.toHaveBeenCalled();
    await waitFor(() => expect(th).toHaveFocus());
  });

  it('a header that does not sort opens a menu with Hide column alone, and changes no sort', () => {
    const { onSortChange } = renderManual({ headerMenu: true, statusSortable: false });
    expect(header('status')).toHaveAttribute('tabindex', '0');
    expect(header('status')).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(header('status'));
    expect(within(menu()!).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Hide column']);
    expect(onSortChange).not.toHaveBeenCalled();
  });

  it('Hide column from the keyboard gives focus to the header beside the hidden one', async () => {
    const { onSortChange } = renderManual({ headerMenu: true });
    act(() => header('name').focus());
    await userEvent.keyboard('{Enter}');
    const items = within(menu()!).getAllByRole('menuitem');
    await waitFor(() => expect(items[0]).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(header('name')).toBeNull();
    await waitFor(() => expect(header('status')).toHaveFocus());
    expect(onSortChange).not.toHaveBeenCalled();
  });

  it('without the provider the header still sorts on a click and draws no menu', () => {
    const { onSortChange } = renderManual({ headerMenu: false });
    expect(header('name')).not.toHaveAttribute('aria-haspopup');
    expect(header('name')).not.toHaveAttribute('tabindex');
    fireEvent.click(header('name'));
    expect(menu()).toBeNull();
    expect(onSortChange).toHaveBeenLastCalledWith([{ field: 'name', order: 'asc' }]);
  });
});
