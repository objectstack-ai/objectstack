/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26679 — a table drawn INSIDE a dialog opens its rows.
 *
 * The row's click heuristic ignores a click that comes from a dialog, so a
 * Radix overlay portalled out of the row (a confirm, a popover) cannot open
 * the record through React's virtual bubbling. It used to ignore every click
 * whose target had a dialog ancestor at all — and the record drawer is a
 * dialog, so a related list inside a drawer drew `cursor-pointer` rows that
 * opened nothing. Only a dialog that does not contain the row is the click's
 * source now.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { createPortal } from 'react-dom';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

const ROWS = [
  { id: 'a', name: 'Ada' },
  { id: 'b', name: 'Grace' },
];

function renderTable(insideDialog: boolean) {
  const DataTable = ComponentRegistry.get('data-table') as any;
  const onRowClick = vi.fn();
  const table = (
    <DataTable
      schema={{
        data: ROWS,
        pagination: false,
        searchable: false,
        columns: [
          { header: 'Name', accessorKey: 'name' },
          {
            header: 'Overlay',
            accessorKey: 'id',
            // An overlay portalled out of the row, as a Radix dialog is.
            cell: (value: string) =>
              createPortal(
                <div role="dialog" aria-label={`overlay ${value}`}>
                  <span>{`portalled ${value}`}</span>
                </div>,
                document.body,
              ),
          },
        ],
        onRowClick,
      }}
    />
  );
  render(insideDialog ? <div role="dialog" aria-label="drawer">{table}</div> : table);
  return { onRowClick };
}

describe('data-table row click and dialogs (objectstack#26679)', () => {
  it('a table inside a dialog opens the clicked row', () => {
    const { onRowClick } = renderTable(true);
    fireEvent.click(screen.getByText('Grace'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0]).toEqual(ROWS[1]);
  });

  it('control: a click from a dialog portalled out of the row still opens nothing', () => {
    const { onRowClick } = renderTable(true);
    fireEvent.click(screen.getByText('portalled b'));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('control: outside any dialog, the row opens and the portalled overlay does not', () => {
    const { onRowClick } = renderTable(false);
    fireEvent.click(screen.getByText('portalled a'));
    expect(onRowClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Ada'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });
});
