/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13293 — the header's select-all sits where the rows' checkboxes
 * do. With row numbers on, the rows centre their checkbox (and number) in the
 * leading cell, so select-all is centred too; without them both sit at the
 * cell's start.
 *
 * jsdom lays nothing out, so the alignment is read off the classes that
 * decide it: `justify-center` on the select-all wrapper and on each row's
 * `row-select` wrapper.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

function renderTable(showRowNumbers: boolean) {
  const DataTable = ComponentRegistry.get('data-table') as any;
  return render(
    <DataTable
      schema={{
        data: [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Grace' }],
        pagination: false,
        searchable: false,
        selectable: true,
        showRowNumbers,
        columns: [{ header: 'Name', accessorKey: 'name' }],
      }}
    />,
  );
}

describe('data-table select-all alignment (objectui#13293)', () => {
  it.each([true, false])('select-all is centred exactly when the rows are (showRowNumbers=%s)', (showRowNumbers) => {
    const { container } = renderTable(showRowNumbers);
    const selectAll = container.querySelector('thead [data-slot="select-all"]') as HTMLElement;
    const rowSelects = Array.from(container.querySelectorAll('tbody [data-slot="row-select"]'));
    expect(selectAll).not.toBeNull();
    expect(rowSelects).toHaveLength(2);
    for (const rowSelect of rowSelects) {
      expect(rowSelect.classList.contains('justify-center')).toBe(showRowNumbers);
    }
    expect(selectAll.classList.contains('justify-center')).toBe(showRowNumbers);
    // Centring is over the whole cell only when the side padding is even:
    // the base cell drops the right padding of a cell holding a checkbox.
    const headCell = selectAll.closest('th') as HTMLElement;
    const leadingCells = Array.from(container.querySelectorAll('tbody td[data-slot="row-leading-cell"]'));
    for (const cell of [headCell, ...leadingCells]) {
      expect(cell.classList.contains('px-0')).toBe(showRowNumbers);
    }
  });
});
