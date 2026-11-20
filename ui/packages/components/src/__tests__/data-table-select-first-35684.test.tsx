/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `data-table`'s select-first cell model (objectstack#35684), behind the
 * `GridCellSelection` a host mounts. The list page mounts it through
 * `ObjectGrid`'s `cellSelection`; its keys while selected and while editing
 * are `data-table-keys-35687.test.tsx`.
 *
 *   1. A click selects a cell: a ring, no editor, no record opened. Without
 *      the provider the same click still edits (the control).
 *   2. Double-click, Enter or F2 edits; the value is kept.
 *   3. Space opens the record; a two-state cell flips on Space or on a second
 *      click instead, and commits.
 *   4. A link the cell draws keeps its own click; a double-click on the cell
 *      around it edits.
 *   5. A cell that opens no editor says why on the cell: the host's sentence,
 *      else the table's own.
 *   6. A touch tap opens the record and edits nothing.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Registers `data-table` at module scope, not in a hook (objectui#3010).
import '../renderers';
import { GridCellSelectionProvider, type GridCellSelection } from '../context/gridCellSelection';

afterEach(cleanup);

const ROWS = [
  { id: '1', name: 'Alpha', amount: 10, done: false, site: 'a.example' },
  { id: '2', name: 'Beta', amount: 20, done: true, site: 'b.example' },
];

function renderTable({
  selection = {},
  extra = {},
}: { selection?: GridCellSelection | null; extra?: Record<string, unknown> } = {}) {
  const DataTable = ComponentRegistry.get('data-table')!;
  const onRowClick = vi.fn();
  const onCellChange = vi.fn();
  const onSiteClick = vi.fn();
  const schema = {
    type: 'data-table',
    columns: [
      { header: 'Name', accessorKey: 'name' },
      { header: 'Amount', accessorKey: 'amount', type: 'number' },
      { header: 'Done', accessorKey: 'done', type: 'boolean' },
      {
        header: 'Site',
        accessorKey: 'site',
        cell: (value: string) => (
          <a href={`https://${value}`} onClick={(e) => { e.preventDefault(); onSiteClick(value); }}>{value}</a>
        ),
      },
    ],
    data: ROWS,
    editable: true,
    singleClickEdit: true,
    searchable: false,
    pagination: false,
    onRowClick,
    onCellChange,
    ...extra,
  };
  const utils = render(
    <GridCellSelectionProvider value={selection}>
      <DataTable schema={schema} />
    </GridCellSelectionProvider>,
  );
  const cell = (row: number, col: number) =>
    utils.container.querySelectorAll('tbody tr')[row].querySelectorAll('td[data-grid-cell]')[col] as HTMLElement;
  const editor = () => utils.container.querySelector<HTMLInputElement>('td[data-editing-cell] input');
  const catcher = () => utils.container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]');
  return { ...utils, cell, editor, catcher, onRowClick, onCellChange, onSiteClick };
}

describe('data-table select-first — a click selects (objectstack#35684)', () => {
  it('selects the cell with a ring and focus in it, and neither edits nor opens the record', () => {
    const t = renderTable();
    fireEvent.click(t.cell(0, 0));
    expect(t.cell(0, 0)).toHaveAttribute('data-selected-cell');
    expect(t.cell(0, 0)).toHaveAttribute('aria-selected', 'true');
    expect(t.cell(0, 0).className).toContain('outline-primary');
    expect(t.editor()).toBeNull();
    expect(t.onRowClick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(t.catcher());
    // Another cell takes the selection.
    fireEvent.click(t.cell(1, 1));
    expect(t.cell(0, 0)).not.toHaveAttribute('data-selected-cell');
    expect(t.cell(1, 1)).toHaveAttribute('data-selected-cell');
  });

  it('control: without the provider the same click still opens the editor', () => {
    const t = renderTable({ selection: null });
    fireEvent.click(t.cell(0, 0));
    expect(t.editor()).not.toBeNull();
    expect(t.cell(0, 0)).not.toHaveAttribute('data-selected-cell');
  });
});

describe('data-table select-first — double-click, Enter and F2 edit', () => {
  it('a double-click opens the editor on the value, caret after it', () => {
    const t = renderTable();
    fireEvent.click(t.cell(0, 0));
    fireEvent.doubleClick(t.cell(0, 0));
    expect(t.editor()).toHaveValue('Alpha');
    expect(t.editor()!.selectionStart).toBe(5);
    expect(t.editor()!.selectionEnd).toBe(5);
    expect(t.onRowClick).not.toHaveBeenCalled();
  });

  it.each(['Enter', 'F2'])('%s on the selected cell opens the editor on the value', (key) => {
    const t = renderTable();
    fireEvent.click(t.cell(1, 0));
    fireEvent.keyDown(t.catcher()!, { key });
    expect(t.editor()).toHaveValue('Beta');
  });
});

describe('data-table select-first — Space opens; a two-state cell flips', () => {
  it('Space on the selected cell opens the record', () => {
    const t = renderTable();
    fireEvent.click(t.cell(0, 0));
    fireEvent.keyDown(t.catcher()!, { key: ' ' });
    expect(t.onRowClick).toHaveBeenCalledTimes(1);
    expect(t.onRowClick.mock.calls[0][0]).toBe(ROWS[0]);
    expect(t.editor()).toBeNull();
  });

  it('Space on a selected boolean flips it and commits, and opens nothing', () => {
    const t = renderTable();
    fireEvent.click(t.cell(0, 2));
    fireEvent.keyDown(t.catcher()!, { key: ' ' });
    expect(t.onCellChange).toHaveBeenCalledWith(0, 'done', true, ROWS[0]);
    expect(t.onRowClick).not.toHaveBeenCalled();
  });

  it('the first click selects a boolean; a second click flips it', () => {
    const t = renderTable();
    fireEvent.click(t.cell(1, 2));
    expect(t.onCellChange).not.toHaveBeenCalled();
    fireEvent.click(t.cell(1, 2));
    expect(t.onCellChange).toHaveBeenCalledWith(1, 'done', false, ROWS[1]);
  });
});

describe('data-table select-first — a link in a cell keeps its click', () => {
  it('a click on the link follows it and selects nothing; a double-click beside it edits', () => {
    const t = renderTable();
    fireEvent.click(screen.getByText('a.example'));
    expect(t.onSiteClick).toHaveBeenCalledWith('a.example');
    expect(t.cell(0, 3)).not.toHaveAttribute('data-selected-cell');
    fireEvent.doubleClick(screen.getByText('a.example'));
    expect(t.editor()).toBeNull();
    // The cell around the link.
    fireEvent.click(t.cell(0, 3));
    expect(t.cell(0, 3)).toHaveAttribute('data-selected-cell');
    fireEvent.doubleClick(t.cell(0, 3));
    expect(t.editor()).toHaveValue('a.example');
  });
});

describe('data-table select-first — a cell that opens no editor says why', () => {
  it("the host's sentence, on a double-click and on Enter, and no editor", () => {
    const t = renderTable({
      selection: {
        describeCell: (_row, key) => (key === 'amount' ? { readOnlyReason: 'This value is calculated.' } : null),
      },
    });
    fireEvent.click(t.cell(0, 1));
    fireEvent.doubleClick(t.cell(0, 1));
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent('This value is calculated.');
    expect(t.editor()).toBeNull();
    // The next key closes it; Enter asks again.
    fireEvent.keyDown(t.catcher()!, { key: 'ArrowLeft' });
    expect(screen.queryByTestId('cell-readonly-reason')).toBeNull();
    fireEvent.keyDown(t.catcher()!, { key: 'ArrowRight' });
    fireEvent.keyDown(t.catcher()!, { key: 'Enter' });
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent('This value is calculated.');
    expect(t.editor()).toBeNull();
  });

  it("the table's own sentence when the column is not editable and the host names none", () => {
    const t = renderTable({ extra: { editable: false } });
    fireEvent.click(t.cell(0, 0));
    expect(t.cell(0, 0)).toHaveAttribute('data-selected-cell');
    fireEvent.doubleClick(t.cell(0, 0));
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent("This cell can't be edited here.");
    expect(t.editor()).toBeNull();
  });

  it('typing into a read-only cell writes nothing and says why', () => {
    const t = renderTable({ selection: { describeCell: () => ({ readOnlyReason: 'Locked.' }) } });
    fireEvent.click(t.cell(0, 0));
    fireEvent.change(t.catcher()!, { target: { value: 'x' } });
    expect(t.editor()).toBeNull();
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent('Locked.');
    expect(t.onCellChange).not.toHaveBeenCalled();
  });
});

describe('data-table select-first — a touch tap opens the record', () => {
  it('opens the record through the row and selects or edits nothing', () => {
    const t = renderTable();
    const row = t.container.querySelectorAll('tbody tr')[0];
    fireEvent.pointerDown(row, { pointerType: 'touch' });
    fireEvent.click(t.cell(0, 0));
    expect(t.onRowClick).toHaveBeenCalledTimes(1);
    expect(t.cell(0, 0)).not.toHaveAttribute('data-selected-cell');
    fireEvent.doubleClick(t.cell(0, 0));
    expect(t.editor()).toBeNull();
  });
});
