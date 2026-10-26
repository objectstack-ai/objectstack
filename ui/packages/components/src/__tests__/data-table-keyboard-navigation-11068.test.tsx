/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `data-table`'s `keyboardNavigation` (objectui#11068) — arrow-key cell
 * navigation on the WAI-ARIA grid pattern, the behaviour `ObjectGrid` relays
 * the `object-grid` node's `keyboardNavigation` to. The relay and its default
 * ("on when the grid renders editable") are pinned in `@object-ui/plugin-grid`
 * (`ObjectGrid.keyboardNavigation-11068.test.tsx`); this file pins what the
 * table does with the flag.
 *
 *   1. OFF (the default): today's table, byte for byte where it matters —
 *      every data cell its own Tab stop, no grid role, no cell address, and an
 *      arrow key left to the browser.
 *   2. ON: the data cells are ONE roving Tab stop; Tab enters them once and the
 *      next Tab leaves; the arrow keys, Home / End and Ctrl+Home / Ctrl+End
 *      move focus; the stop follows focus and survives a shorter page.
 *   3. ON, editable: Enter still opens the focused cell, the editor keeps the
 *      arrows, and an edit ended with Enter or Escape hands focus back to its
 *      cell, so the arrows carry on.
 *
 * Every "unchanged" reading has a lit control that moves on the same probe.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Registers `data-table` at module scope, not in a hook (objectui#3010).
import '../renderers';

afterEach(cleanup);

const COLUMNS = [
  { header: 'Name', accessorKey: 'name' },
  { header: 'Status', accessorKey: 'status' },
  { header: 'Owner', accessorKey: 'owner' },
];

const ROWS = [
  { id: '1', name: 'Alpha', status: 'Open', owner: 'Ada' },
  { id: '2', name: 'Beta', status: 'Closed', owner: 'Bo' },
  { id: '3', name: 'Gamma', status: 'Open', owner: 'Cy' },
];

/**
 * A table whose ONLY tabbable elements are its data cells — no search box, no
 * pager, no selection — between two buttons, so a Tab sequence reads exactly
 * the cells' share of it.
 */
function renderTable(extra: Record<string, unknown> = {}, rows = ROWS) {
  const DataTable = ComponentRegistry.get('data-table')!;
  const schema = {
    type: 'data-table',
    columns: COLUMNS,
    data: rows,
    searchable: false,
    pagination: false,
    ...extra,
  };
  const utils = render(
    <div>
      <button type="button">before</button>
      <DataTable schema={schema} />
      <button type="button">after</button>
    </div>,
  );
  const rerenderTable = (nextExtra: Record<string, unknown>, nextRows: typeof ROWS) =>
    utils.rerender(
      <div>
        <button type="button">before</button>
        <DataTable schema={{ ...schema, ...nextExtra, data: nextRows }} />
        <button type="button">after</button>
      </div>,
    );
  return { ...utils, rerenderTable };
}

/** The data cell at (row, column) — by position, the way the arrows count. */
const cellAt = (container: HTMLElement, row: number, col: number) =>
  container.querySelectorAll('tbody tr')[row].querySelectorAll('td')[col] as HTMLElement;

/** Every body cell that is in the Tab sequence. */
const tabStops = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('tbody td')).filter((td) => td.tabIndex === 0);

/** Press a key on whatever holds focus; `false` means the table took the key. */
const press = (key: string, init: Record<string, unknown> = {}) =>
  fireEvent.keyDown(document.activeElement as Element, { key, ...init });

/* ── 1. Off ──────────────────────────────────────────────────────────────── */

describe('data-table `keyboardNavigation` OFF — the default, unchanged (objectui#11068)', () => {
  it('every data cell is its own Tab stop, the table is a plain table, and no cell carries an address', () => {
    const { container } = renderTable();
    expect(tabStops(container)).toHaveLength(ROWS.length * COLUMNS.length);
    expect(container.querySelector('table')).not.toHaveAttribute('role');
    expect(container.querySelector('[data-grid-cell]')).toBeNull();
  });

  it('an arrow key on a focused cell is left to the browser: focus stays, nothing is prevented', () => {
    const { container } = renderTable();
    cellAt(container, 0, 0).focus();
    expect(press('ArrowDown')).toBe(true);
    expect(press('ArrowRight')).toBe(true);
    expect(document.activeElement).toBe(cellAt(container, 0, 0));
  });

  it('Tab walks every cell, one stop each', async () => {
    const user = userEvent.setup();
    const { container, getByText } = renderTable();
    getByText('before').focus();
    await user.tab();
    expect(document.activeElement).toBe(cellAt(container, 0, 0));
    await user.tab();
    expect(document.activeElement).toBe(cellAt(container, 0, 1));
  });
});

/* ── 2. On ───────────────────────────────────────────────────────────────── */

describe('data-table `keyboardNavigation` ON — one roving Tab stop the arrows move (objectui#11068)', () => {
  it('the data cells are ONE Tab stop, on the first cell, and the table is a grid', () => {
    const { container } = renderTable({ keyboardNavigation: true });
    expect(tabStops(container)).toEqual([cellAt(container, 0, 0)]);
    expect(container.querySelector('table')).toHaveAttribute('role', 'grid');
    expect(cellAt(container, 1, 2)).toHaveAttribute('tabindex', '-1');
  });

  it('Tab enters the cells once and the next Tab leaves the grid; Shift+Tab comes back to the same cell', async () => {
    const user = userEvent.setup();
    const { container, getByText } = renderTable({ keyboardNavigation: true });
    getByText('before').focus();
    await user.tab();
    expect(document.activeElement).toBe(cellAt(container, 0, 0));
    await user.tab();
    expect(document.activeElement).toBe(getByText('after'));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(cellAt(container, 0, 0));
  });

  it('the arrow keys move focus one cell; at an edge focus stays and the key is still the grid\'s', () => {
    const { container } = renderTable({ keyboardNavigation: true });
    cellAt(container, 0, 0).focus();

    expect(press('ArrowRight')).toBe(false);
    expect(document.activeElement).toBe(cellAt(container, 0, 1));
    expect(press('ArrowDown')).toBe(false);
    expect(document.activeElement).toBe(cellAt(container, 1, 1));
    expect(press('ArrowLeft')).toBe(false);
    expect(document.activeElement).toBe(cellAt(container, 1, 0));
    expect(press('ArrowUp')).toBe(false);
    expect(document.activeElement).toBe(cellAt(container, 0, 0));

    // Edges: no wrap, no escape, and no page scroll under a focused cell.
    expect(press('ArrowUp')).toBe(false);
    expect(press('ArrowLeft')).toBe(false);
    expect(document.activeElement).toBe(cellAt(container, 0, 0));
  });

  it('Home / End go to the ends of the row, Ctrl+Home / Ctrl+End to the ends of the page', () => {
    const { container } = renderTable({ keyboardNavigation: true });
    cellAt(container, 1, 1).focus();

    press('End');
    expect(document.activeElement).toBe(cellAt(container, 1, 2));
    press('Home');
    expect(document.activeElement).toBe(cellAt(container, 1, 0));
    press('End', { ctrlKey: true });
    expect(document.activeElement).toBe(cellAt(container, 2, 2));
    press('Home', { ctrlKey: true });
    expect(document.activeElement).toBe(cellAt(container, 0, 0));
  });

  it('Shift, Alt and Meta combinations are left to the browser', () => {
    const { container } = renderTable({ keyboardNavigation: true });
    cellAt(container, 0, 0).focus();
    expect(press('ArrowDown', { shiftKey: true })).toBe(true);
    expect(press('ArrowRight', { altKey: true })).toBe(true);
    expect(press('ArrowRight', { metaKey: true })).toBe(true);
    expect(press('ArrowDown', { ctrlKey: true })).toBe(true);
    expect(document.activeElement).toBe(cellAt(container, 0, 0));
  });

  it('the Tab stop follows focus — an arrow, or a focus from anywhere else — and stays the only one', () => {
    const { container } = renderTable({ keyboardNavigation: true });
    cellAt(container, 0, 0).focus();
    press('ArrowDown');
    expect(tabStops(container)).toEqual([cellAt(container, 1, 0)]);

    // A click (or any focus) on another cell moves the stop there. Inside
    // `act`, so the state the focus wrote is flushed before it is read.
    act(() => cellAt(container, 2, 1).focus());
    expect(document.activeElement).toBe(cellAt(container, 2, 1));
    expect(tabStops(container)).toEqual([cellAt(container, 2, 1)]);
  });

  it('a shorter page never leaves the grid without a Tab stop', () => {
    const { container, rerenderTable } = renderTable({ keyboardNavigation: true });
    act(() => cellAt(container, 2, 2).focus());
    expect(tabStops(container)).toEqual([cellAt(container, 2, 2)]);

    rerenderTable({ keyboardNavigation: true }, ROWS.slice(0, 1));
    expect(tabStops(container)).toEqual([cellAt(container, 0, 2)]);
  });
});

/* ── 3. On, editable ─────────────────────────────────────────────────────── */

describe('data-table `keyboardNavigation` ON with `editable` — Enter edits, and focus comes back (objectui#11068)', () => {
  const editableNav = { keyboardNavigation: true, editable: true };

  it('Enter opens the focused cell, the editor keeps the arrows, and Enter hands focus back to the cell', async () => {
    const { container } = renderTable(editableNav);
    const cell = cellAt(container, 0, 1);
    cell.focus();

    press('Enter');
    const input = await waitFor(() => {
      const el = cell.querySelector('input');
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    expect(document.activeElement).toBe(input);

    // The editor's own keys: the caret moves, the cell does not.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(cell.querySelector('input')).toBe(input);

    fireEvent.change(input, { target: { value: 'Pending' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(cell.querySelector('input')).toBeNull());
    expect(cell).toHaveTextContent('Pending');
    await waitFor(() => expect(document.activeElement).toBe(cell));

    // …so the arrows carry on from the cell that was just edited.
    press('ArrowDown');
    expect(document.activeElement).toBe(cellAt(container, 1, 1));
  });

  it('Escape cancels the edit and hands focus back to the cell too', async () => {
    const { container } = renderTable(editableNav);
    const cell = cellAt(container, 2, 2);
    cell.focus();
    press('Enter');
    const input = await waitFor(() => {
      const el = cell.querySelector('input');
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    fireEvent.change(input, { target: { value: 'Nobody' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(cell.querySelector('input')).toBeNull());
    expect(cell).toHaveTextContent('Cy');
    await waitFor(() => expect(document.activeElement).toBe(cell));
    press('ArrowLeft');
    expect(document.activeElement).toBe(cellAt(container, 2, 1));
  });

  it('LIT CONTROL — with the flag off, the same Enter-commit leaves focus on <body>, where no arrow reaches a cell', async () => {
    const { container } = renderTable({ editable: true });
    const cell = cellAt(container, 0, 1);
    cell.focus();
    press('Enter');
    const input = await waitFor(() => {
      const el = cell.querySelector('input');
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(cell.querySelector('input')).toBeNull());
    expect(document.activeElement).toBe(document.body);
  });
});
