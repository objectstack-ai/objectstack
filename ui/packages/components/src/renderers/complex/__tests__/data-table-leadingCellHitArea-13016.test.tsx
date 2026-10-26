/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13016 — the row's leading cell is the selection's hit area. On a tall row the 16px
 * checkbox is a small target, and a click that missed it bubbled to the row
 * and opened the record. A click anywhere in the leading cell now toggles the
 * row's selection and never reaches `onRowClick`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

const ROWS = [
  { id: 'a', name: 'Ada' },
  { id: 'b', name: 'Grace' },
];

function renderTable(extra: Record<string, unknown> = {}) {
  const DataTable = ComponentRegistry.get('data-table') as any;
  const onRowClick = vi.fn();
  const onSelectionChange = vi.fn();
  render(
    <DataTable
      schema={{
        data: ROWS,
        pagination: false,
        searchable: false,
        columns: [{ header: 'Name', accessorKey: 'name' }],
        selectable: true,
        onRowClick,
        onSelectionChange,
        ...extra,
      }}
    />,
  );
  return { onRowClick, onSelectionChange };
}

const leadingCellOf = (name: string) =>
  screen.getByText(name).closest('tr')!.querySelector('td[data-slot="row-leading-cell"]') as HTMLElement;
const checkboxOf = (name: string) =>
  leadingCellOf(name).querySelector('[role="checkbox"]') as HTMLElement;

describe.each([
  ['with row numbers', { showRowNumbers: true }],
  ['without row numbers', { showRowNumbers: false }],
])('data-table leading cell hit area (%s)', (_label, extra) => {
  it('a click on the cell beside the checkbox selects the row and does not open it', () => {
    const { onRowClick, onSelectionChange } = renderTable(extra);
    const cell = leadingCellOf('Ada');
    fireEvent.click(cell.querySelector('[data-slot="row-select"]') ?? cell);
    expect(onRowClick).not.toHaveBeenCalled();
    expect(checkboxOf('Ada')).toHaveAttribute('aria-checked', 'true');
    expect(onSelectionChange).toHaveBeenLastCalledWith([ROWS[0]]);

    fireEvent.click(cell);
    expect(onRowClick).not.toHaveBeenCalled();
    expect(checkboxOf('Ada')).toHaveAttribute('aria-checked', 'false');
  });

  it('every row\'s leading cell is a hit area, not only the first', () => {
    const { onRowClick, onSelectionChange } = renderTable(extra);
    const cell = leadingCellOf('Grace');
    fireEvent.click(cell.querySelector('[data-slot="row-select"]') ?? cell);
    expect(onRowClick).not.toHaveBeenCalled();
    expect(checkboxOf('Grace')).toHaveAttribute('aria-checked', 'true');
    expect(checkboxOf('Ada')).toHaveAttribute('aria-checked', 'false');
    expect(onSelectionChange).toHaveBeenLastCalledWith([ROWS[1]]);
  });

  it('a click on the checkbox itself toggles once', () => {
    const { onRowClick } = renderTable(extra);
    fireEvent.click(checkboxOf('Grace'));
    expect(checkboxOf('Grace')).toHaveAttribute('aria-checked', 'true');
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('a click on a data cell still opens the record', () => {
    const { onRowClick } = renderTable(extra);
    fireEvent.click(screen.getByText('Ada'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });
});
