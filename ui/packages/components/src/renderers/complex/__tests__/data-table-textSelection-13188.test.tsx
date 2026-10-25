/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13188 — selecting a cell's text is a copy gesture. A drag that
 * selects text ends in a `click` on the row (or cell) it started in; that
 * click must neither open the record nor start an inline edit, and Ctrl/Cmd+C
 * must copy the selection rather than the cell's raw value. A plain click
 * (no selection) still opens / edits exactly as before.
 *
 * jsdom has no mouse-driven selection, so the drag's outcome is set directly
 * with the Selection API and then the trailing click is fired.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

const ROWS = [
  { id: 'a', name: 'Ada Lovelace', secret: 's1' },
  { id: 'b', name: 'Grace Hopper', secret: 's2' },
];

function renderTable(extra: Record<string, unknown> = {}) {
  const DataTable = ComponentRegistry.get('data-table') as any;
  const onRowClick = vi.fn();
  render(
    <DataTable
      schema={{
        data: ROWS,
        pagination: false,
        searchable: false,
        columns: [
          { header: 'Name', accessorKey: 'name' },
          { header: 'Secret', accessorKey: 'secret', masked: true },
        ],
        onRowClick,
        ...extra,
      }}
    />,
  );
  return { onRowClick };
}

/** Select the first `length` characters of the text in `el` (the drag's outcome). */
function selectText(el: HTMLElement, length = 3) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const text = walker.nextNode() as Text;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, length);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

const cellOf = (text: string) => screen.getByText(text).closest('td') as HTMLElement;

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(() => window.getSelection()?.removeAllRanges());

describe('data-table text selection (objectui#13188)', () => {
  it('a click that ends a text selection in a row does not open the record', () => {
    const { onRowClick } = renderTable();
    selectText(screen.getByText('Grace Hopper'));
    fireEvent.click(screen.getByText('Grace Hopper'));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('a plain click (no selection) still opens the record', () => {
    const { onRowClick } = renderTable();
    fireEvent.click(screen.getByText('Grace Hopper'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0]).toBe(ROWS[1]);
  });

  it('a selection in another row does not block opening this one', () => {
    const { onRowClick } = renderTable();
    selectText(screen.getByText('Ada Lovelace'));
    fireEvent.click(screen.getByText('Grace Hopper'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  describe.each([
    ['single-click edit', { singleClickEdit: true }, 'click'],
    ['double-click edit', { singleClickEdit: false }, 'dblClick'],
  ] as const)('editable, %s', (_label, mode, gesture) => {
    it('selecting text does not enter edit mode', () => {
      const { onRowClick } = renderTable({ editable: true, ...mode });
      selectText(screen.getByText('Ada Lovelace'));
      fireEvent[gesture](cellOf('Ada Lovelace'));
      expect(cellOf('Ada Lovelace').querySelector('input')).toBeNull();
      expect(onRowClick).not.toHaveBeenCalled();
    });

    it('the same gesture without a selection still enters edit mode', () => {
      renderTable({ editable: true, ...mode });
      const cell = cellOf('Ada Lovelace');
      fireEvent[gesture](cell);
      expect(cell.querySelector('input')).not.toBeNull();
    });
  });

  it('Ctrl+C with text selected in the cell leaves the browser copy alone', () => {
    renderTable();
    const cell = cellOf('Ada Lovelace');
    selectText(screen.getByText('Ada Lovelace'));
    const notCancelled = fireEvent.keyDown(cell, { key: 'c', ctrlKey: true });
    expect(notCancelled).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('Ctrl+C with no selection still copies the whole cell value', () => {
    renderTable();
    const notCancelled = fireEvent.keyDown(cellOf('Ada Lovelace'), { key: 'c', ctrlKey: true });
    expect(notCancelled).toBe(false);
    expect(writeText).toHaveBeenCalledWith('Ada Lovelace');
  });

  it('a masked cell still copies nothing, even with its text selected', () => {
    renderTable();
    const masked = cellOf('Ada Lovelace').nextElementSibling as HTMLElement;
    selectText(masked, 1);
    const notCancelled = fireEvent.keyDown(masked, { key: 'c', ctrlKey: true });
    expect(notCancelled).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});
