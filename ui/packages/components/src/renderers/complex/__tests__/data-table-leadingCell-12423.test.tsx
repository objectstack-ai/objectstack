/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12423 — the row's leading cell and its row-actions trigger.
 *
 * With selection and row numbers on, ONE leading cell holds both: the number
 * by default, the checkbox on row hover / focus-within / a coarse pointer, and
 * on every row while any row is selected. The header's select-all is always
 * there. The row-actions trigger is in the DOM for every row and hidden by
 * opacity only.
 *
 * jsdom applies no stylesheet, so "visible" is read off the classes that
 * decide it: `opacity-0` on the checkbox's wrapper hides it until a reveal
 * variant applies; `invisible` on the number hides it outright.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

const ROWS = [
  { id: 'a', name: 'Ada' },
  { id: 'b', name: 'Grace' },
  { id: 'c', name: 'Linus' },
];

function renderTable(extra: Record<string, unknown> = {}) {
  const DataTable = ComponentRegistry.get('data-table') as any;
  return render(
    <DataTable
      schema={{
        data: ROWS,
        pagination: false,
        searchable: false,
        columns: [{ header: 'Name', accessorKey: 'name' }],
        selectable: true,
        showRowNumbers: true,
        rowActions: true,
        onRowEdit: vi.fn(),
        ...extra,
      }}
    />,
  );
}

const bodyRows = () =>
  ROWS.map((r) => {
    const tr = screen.getByText(r.name).closest('tr');
    if (!tr) throw new Error(`no row for ${r.name}`);
    return tr as HTMLTableRowElement;
  });

const leadingCell = (tr: HTMLTableRowElement) => tr.querySelector('td[data-slot="row-leading-cell"]') as HTMLElement;
const numberOf = (tr: HTMLTableRowElement) => leadingCell(tr).querySelector('[data-slot="row-number"]') as HTMLElement | null;
const selectOf = (tr: HTMLTableRowElement) => leadingCell(tr).querySelector('[data-slot="row-select"]') as HTMLElement;

beforeAll(() => {
  expect(ComponentRegistry.has('data-table')).toBe(true);
});

describe('data-table leading cell (objectui#12423)', () => {
  it('a row draws its number and no visible checkbox by default, in one leading cell', () => {
    renderTable();
    bodyRows().forEach((tr, i) => {
      // One leading cell, then the data cell, then row actions — no second utility cell.
      expect(tr.querySelectorAll('td')).toHaveLength(3);
      expect(numberOf(tr)).toHaveTextContent(String(i + 1));
      expect(numberOf(tr)).not.toHaveClass('invisible');
      expect(numberOf(tr)).toHaveClass('group-hover/row:invisible', 'group-focus-within/row:invisible');
      expect(selectOf(tr)).toHaveClass('opacity-0', 'group-hover/row:opacity-100', 'group-focus-within/row:opacity-100');
      // Hidden by opacity, not removed: the checkbox is there and named.
      expect(within(selectOf(tr)).getByRole('checkbox', { name: 'Select row' })).toBeInTheDocument();
    });
  });

  it('after one row is selected, every row draws its checkbox and no number', () => {
    renderTable();
    const [first] = bodyRows();
    fireEvent.click(within(selectOf(first)).getByRole('checkbox'));
    for (const tr of bodyRows()) {
      expect(selectOf(tr)).not.toHaveClass('opacity-0');
      expect(numberOf(tr)).toHaveClass('invisible');
    }
    // Cleared again ⇒ back to numbers.
    fireEvent.click(within(selectOf(first)).getByRole('checkbox'));
    for (const tr of bodyRows()) expect(selectOf(tr)).toHaveClass('opacity-0');
  });

  it('the header keeps its select-all checkbox, selection or not', () => {
    renderTable();
    expect(screen.getByRole('checkbox', { name: 'Select all rows' })).toBeInTheDocument();
    fireEvent.click(within(selectOf(bodyRows()[1])).getByRole('checkbox'));
    expect(screen.getByRole('checkbox', { name: 'Select all rows' })).toBeInTheDocument();
    // The number has no header of its own: `#` heads it only without selection.
    expect(screen.queryByText('#')).toBeNull();
  });

  it('with row numbers off the leading cell is blank until hover', () => {
    renderTable({ showRowNumbers: false });
    for (const tr of bodyRows()) {
      expect(numberOf(tr)).toBeNull();
      expect(leadingCell(tr).textContent).toBe('');
      expect(selectOf(tr)).toHaveClass('opacity-0', 'group-hover/row:opacity-100');
    }
  });

  it('control: without selection the row number keeps its own cell under a `#` header', () => {
    renderTable({ selectable: false });
    expect(screen.getByText('#')).toBeInTheDocument();
    for (const tr of bodyRows()) {
      expect(leadingCell(tr)).toBeNull();
      expect(tr.querySelectorAll('[role="checkbox"]')).toHaveLength(0);
    }
  });
});

describe('data-table row-actions trigger (objectui#12423)', () => {
  it('is in the DOM for every row, revealed by opacity on hover, focus-within, a selected row and an open menu', () => {
    renderTable();
    const triggers = screen.getAllByTestId('data-table-row-actions');
    expect(triggers).toHaveLength(ROWS.length);
    for (const trigger of triggers) {
      expect(trigger).toHaveClass(
        'opacity-0',
        'group-hover/row:opacity-100',
        'group-focus-within/row:opacity-100',
        'group-data-[state=selected]/row:opacity-100',
        'data-[state=open]:opacity-100',
      );
      // Never display:none — it keeps its Tab stop and its name.
      expect(trigger).not.toHaveClass('hidden');
      expect(trigger).toHaveAccessibleName('Row actions');
    }
  });
});
