/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The header context menu offers a sort exactly where the header does
 * (objectui#10727).
 *
 * A column declared `sortable: false` (`TableColumn.sortable`, "Whether column
 * is sortable") had an inert header, but its context menu still offered Sort
 * ascending / Sort descending: the menu gated on the table-wide
 * `sortingEnabled` and the masked flag only, never on `col.sortable`. The
 * producers that set the flag (`ObjectGrid`, `RelatedList`) set it on columns
 * the server cannot order by, so the menu put that sort on the wire anyway.
 *
 * Every negative here sits beside a positive control in the same render: a
 * sortable column whose menu still offers the sort. The menu's "Hide column"
 * entry is the control that the menu opened at all. The masked-column half of
 * the same menu stays pinned in `data-table-masked-client-paths-10657.test.tsx`.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

// Not in either column's order, so a client sort by either one is visible.
const ROWS = [
  { id: '1', name: 'Bob', status: 'open' },
  { id: '2', name: 'Ada', status: 'done' },
  { id: '3', name: 'Cyd', status: 'hold' },
];

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

function tableSchema(status: { sortable?: boolean }, extra: Record<string, unknown> = {}) {
  return {
    type: 'data-table',
    data: ROWS,
    columns: [
      { header: 'Name', accessorKey: 'name' },
      {
        header: 'Status',
        accessorKey: 'status',
        ...(status.sortable === undefined ? {} : { sortable: status.sortable }),
      },
    ],
    pagination: false,
    ...extra,
  };
}

function DataTable(props: { schema: Record<string, unknown> }) {
  const Impl = ComponentRegistry.get('data-table') as any;
  if (!Impl) throw new Error('data-table not registered');
  return <Impl schema={props.schema} />;
}

const drawnNames = () =>
  Array.from(document.querySelectorAll('tbody tr')).map(
    (tr) => (tr.querySelector('td')?.textContent ?? '').trim(),
  );

const header = (label: string): HTMLElement => {
  const th = Array.from(document.querySelectorAll('thead th')).find(
    (el) => (el.textContent ?? '').trim() === label,
  );
  expect(th, `CONTROL: a "${label}" header rendered`).toBeTruthy();
  return th as HTMLElement;
};

/** Open the header context menu on `label` and return it. */
const openMenu = (label: string): HTMLElement => {
  fireEvent.contextMenu(header(label));
  const menu = screen.getByTestId('column-context-menu');
  expect(within(menu).queryByText('Hide column'), 'CONTROL: the menu opened').not.toBeNull();
  return menu;
};

const offersSort = (menu: HTMLElement) => ({
  asc: within(menu).queryByText('Sort ascending') !== null,
  desc: within(menu).queryByText('Sort descending') !== null,
});

describe('data-table header context menu reads `isColumnSortable` (objectui#10727)', () => {
  it('a `sortable: false` column offers no sort entry; a sortable column does', () => {
    render(<DataTable schema={tableSchema({ sortable: false })} />);
    expect(header('Status').className, 'the header already refuses').not.toContain('cursor-pointer');

    const statusMenu = openMenu('Status');
    expect(offersSort(statusMenu), 'no sort entry for the `sortable: false` column').toEqual({
      asc: false,
      desc: false,
    });
    fireEvent.click(document.body);

    const nameMenu = openMenu('Name');
    expect(offersSort(nameMenu), 'CONTROL: the sortable column offers both').toEqual({ asc: true, desc: true });
    fireEvent.click(within(nameMenu).getByText('Sort descending'));
    expect(drawnNames(), 'CONTROL: the offered sort orders the rows').toEqual(['Cyd', 'Bob', 'Ada']);
  });

  it('under manual sorting the menu asks the host for nothing on a `sortable: false` column', () => {
    const onSortChange = vi.fn();
    render(
      <DataTable schema={tableSchema({ sortable: false }, { manualSorting: true, sort: [], onSortChange })} />,
    );

    expect(offersSort(openMenu('Status')), 'no sort entry to ask with').toEqual({ asc: false, desc: false });
    fireEvent.click(document.body);
    expect(onSortChange).not.toHaveBeenCalled();

    const nameMenu = openMenu('Name');
    fireEvent.click(within(nameMenu).getByText('Sort ascending'));
    expect(onSortChange, 'CONTROL: the sortable column reports its sort').toHaveBeenCalledWith([
      { field: 'name', order: 'asc' },
    ]);
  });

  it('an open menu follows the producer: the entries go when it stamps `sortable: false`', () => {
    const { rerender } = render(<DataTable schema={tableSchema({})} />);
    expect(offersSort(openMenu('Status')), 'CONTROL: offered while the flag is absent').toEqual({
      asc: true,
      desc: true,
    });

    rerender(<DataTable schema={tableSchema({ sortable: false })} />);
    expect(offersSort(screen.getByTestId('column-context-menu')), 'withdrawn with the flag').toEqual({
      asc: false,
      desc: false,
    });
  });
});
