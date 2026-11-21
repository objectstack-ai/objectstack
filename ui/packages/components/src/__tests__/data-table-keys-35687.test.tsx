/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The keys of `data-table`'s select-first cell model (objectstack#35687);
 * what a click does is `data-table-select-first-35684.test.tsx`.
 *
 *   1. On the selected cell: the arrows and Tab move the selection; Escape
 *      clears it; typing opens the editor with the typed text in place of the
 *      value (a number column gets the number); Ctrl/Cmd+V converts and
 *      commits; Ctrl/Cmd+C copies. (Backspace: section 4.)
 *   2. While editing: Enter commits and stays on the cell (objectstack#36023;
 *      it moved down before), Tab / Shift+Tab commit and move right / left,
 *      Escape cancels and keeps the selection. In a multi-line editor Enter
 *      is the editor's and Ctrl/Cmd+Enter commits.
 *   3. An input method: the keys pressed while it composes, and the 229
 *      Enter a browser raises after `compositionend`, never commit; a
 *      composition started on the selected cell opens the editor with the
 *      whole composed text.
 *   4. objectstack#36023: Backspace / Delete clear the cell and save at once,
 *      unless the host says why not (a required field); a picker's editor is a
 *      panel under the cell, which keeps its value drawn; a commit the browser
 *      or the host refuses keeps the editor and the input, says why under it,
 *      and Escape discards.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Registers `data-table` at module scope, not in a hook (objectui#3010).
import '../renderers';
// `react-page` reaches a dynamic `import('@object-ui/react-runtime')`: pay its load
// at collection, never inside a case's clocked window (`check:test-source-alias`).
import '@object-ui/react-runtime';
import { GridCellSelectionProvider, type GridCellSelection } from '../context/gridCellSelection';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ROWS = [
  { id: '1', name: 'Alpha', amount: 10, notes: 'one' },
  { id: '2', name: 'Beta', amount: 20, notes: 'two' },
  { id: '3', name: 'Gamma', amount: 30, notes: 'three' },
];

function renderTable(extra: Record<string, unknown> = {}, selection: GridCellSelection = {}) {
  const DataTable = ComponentRegistry.get('data-table')!;
  const onCellChange = vi.fn();
  const schema = {
    type: 'data-table',
    columns: [
      { header: 'Name', accessorKey: 'name' },
      { header: 'Amount', accessorKey: 'amount', type: 'number' },
      { header: 'Notes', accessorKey: 'notes' },
    ],
    data: ROWS,
    editable: true,
    searchable: false,
    pagination: false,
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
  const selected = () => {
    const td = utils.container.querySelector('td[data-selected-cell]');
    return td ? td.getAttribute('data-grid-cell') : null;
  };
  const editor = () =>
    utils.container.querySelector<HTMLInputElement | HTMLTextAreaElement>('td[data-editing-cell] input, td[data-editing-cell] textarea');
  const catcher = () => utils.container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]')!;
  const select = (row: number, col: number) => fireEvent.click(cell(row, col));
  return { ...utils, cell, selected, editor, catcher, select, onCellChange };
}

describe('data-table select-first keys — on the selected cell (objectstack#35687)', () => {
  it('the arrows move the selection, Tab moves along the row, Escape clears it', () => {
    const t = renderTable();
    t.select(0, 0);
    fireEvent.keyDown(t.catcher(), { key: 'ArrowDown' });
    expect(t.selected()).toBe('1:0');
    fireEvent.keyDown(t.catcher(), { key: 'ArrowRight' });
    expect(t.selected()).toBe('1:1');
    fireEvent.keyDown(t.catcher(), { key: 'Tab' });
    expect(t.selected()).toBe('1:2');
    fireEvent.keyDown(t.catcher(), { key: 'Tab' });
    expect(t.selected()).toBe('2:0');
    fireEvent.keyDown(t.catcher(), { key: 'Tab', shiftKey: true });
    expect(t.selected()).toBe('1:2');
    expect(t.editor()).toBeNull();
    fireEvent.keyDown(t.catcher(), { key: 'Escape' });
    expect(t.selected()).toBeNull();
  });

  it('typing replaces the value with the typed text, and Escape puts the value back', () => {
    const t = renderTable();
    t.select(0, 0);
    fireEvent.change(t.catcher(), { target: { value: 'Z' } });
    expect(t.editor()).toHaveValue('Z');
    fireEvent.keyDown(t.editor()!, { key: 'Escape' });
    expect(t.editor()).toBeNull();
    expect(t.cell(0, 0)).toHaveTextContent('Alpha');
    expect(t.selected()).toBe('0:0');
    expect(t.onCellChange).not.toHaveBeenCalled();
  });

  it('typing 5 on a number cell edits 5, and Escape leaves the old figure', () => {
    const t = renderTable();
    t.select(1, 1);
    fireEvent.change(t.catcher(), { target: { value: '5' } });
    expect(t.editor()).toHaveValue(5);
    fireEvent.keyDown(t.editor()!, { key: 'Escape' });
    expect(t.cell(1, 1)).toHaveTextContent('20');
    expect(t.onCellChange).not.toHaveBeenCalled();
  });

  it('Ctrl/Cmd+V converts the text to the column and commits it; text that is no value writes nothing', () => {
    const t = renderTable();
    t.select(0, 1);
    fireEvent.paste(t.catcher(), { clipboardData: { getData: () => '42\n' } });
    expect(t.onCellChange).toHaveBeenCalledWith(0, 'amount', 42, ROWS[0]);
    t.onCellChange.mockClear();
    fireEvent.paste(t.catcher(), { clipboardData: { getData: () => 'forty-two' } });
    expect(t.onCellChange).not.toHaveBeenCalled();
    // The host's reading of the text wins.
    const h = renderTable({}, { describeCell: () => ({ fromText: (text) => text.toUpperCase() }) });
    h.select(0, 0);
    fireEvent.paste(h.catcher(), { clipboardData: { getData: () => 'zed' } });
    expect(h.onCellChange).toHaveBeenCalledWith(0, 'name', 'ZED', ROWS[0]);
  });

  it('Ctrl/Cmd+C copies the selected value', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const had = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      const t = renderTable();
      t.select(2, 0);
      fireEvent.keyDown(t.catcher(), { key: 'c', ctrlKey: true });
      expect(writeText).toHaveBeenCalledWith('Gamma');
    } finally {
      if (had) Object.defineProperty(navigator, 'clipboard', had);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it('with CapsLock on, Ctrl+C (key `C`) still copies', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const had = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      const t = renderTable();
      t.select(2, 0);
      fireEvent.keyDown(t.catcher(), { key: 'C', ctrlKey: true });
      expect(writeText).toHaveBeenCalledWith('Gamma');
    } finally {
      if (had) Object.defineProperty(navigator, 'clipboard', had);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it('with CapsLock on, Ctrl+V (key `V`) types nothing into the cell, and the paste still commits', () => {
    const t = renderTable();
    t.select(0, 1);
    fireEvent.keyDown(t.catcher(), { key: 'V', ctrlKey: true });
    expect(t.editor()).toBeNull();
    fireEvent.paste(t.catcher(), { clipboardData: { getData: () => '42' } });
    expect(t.onCellChange).toHaveBeenCalledWith(0, 'amount', 42, ROWS[0]);
  });
});

describe('data-table select-first keys — while editing', () => {
  it('Enter commits and stays on the cell, focus on it; Tab commits and moves right; Shift+Tab left (objectstack#36023)', () => {
    const t = renderTable();
    t.select(0, 0);
    fireEvent.change(t.catcher(), { target: { value: 'A' } });
    fireEvent.keyDown(t.editor()!, { key: 'Enter' });
    expect(t.onCellChange).toHaveBeenLastCalledWith(0, 'name', 'A', ROWS[0]);
    expect(t.editor()).toBeNull();
    expect(t.selected()).toBe('0:0');
    expect(document.activeElement).toBe(t.catcher());
    fireEvent.keyDown(t.catcher(), { key: 'Enter' });
    fireEvent.keyDown(t.editor()!, { key: 'Tab' });
    expect(t.selected()).toBe('0:1');
    expect(t.editor()).toBeNull();
    fireEvent.keyDown(t.catcher(), { key: 'F2' });
    fireEvent.keyDown(t.editor()!, { key: 'Tab', shiftKey: true });
    expect(t.selected()).toBe('0:0');
    expect(t.onCellChange).toHaveBeenCalledTimes(3);
  });

  it('Escape cancels and keeps the cell selected, with focus on it', () => {
    const t = renderTable();
    t.select(2, 2);
    fireEvent.keyDown(t.catcher(), { key: 'Enter' });
    fireEvent.change(t.editor()!, { target: { value: 'changed' } });
    fireEvent.keyDown(t.editor()!, { key: 'Escape' });
    expect(t.editor()).toBeNull();
    expect(t.cell(2, 2)).toHaveTextContent('three');
    expect(t.selected()).toBe('2:2');
    expect(document.activeElement).toBe(t.catcher());
  });

  it('a multi-line editor keeps Enter, and Ctrl/Cmd+Enter commits it', () => {
    const renderCellEditor = (ctx: { value: unknown; stage: (v: unknown) => void }) => (
      <textarea aria-label="notes editor" value={String(ctx.value ?? '')} onChange={(e) => ctx.stage(e.target.value)} />
    );
    const t = renderTable({ renderCellEditor });
    t.select(0, 2);
    fireEvent.keyDown(t.catcher(), { key: 'Enter' });
    const area = t.container.querySelector('textarea')!;
    fireEvent.keyDown(area, { key: 'Enter' });
    expect(t.container.querySelector('textarea')).not.toBeNull();
    fireEvent.keyDown(area, { key: 'Enter', metaKey: true });
    expect(t.container.querySelector('textarea')).toBeNull();
    expect(t.onCellChange).toHaveBeenCalledTimes(1);
    expect(t.selected()).toBe('0:2');
  });
});

describe('data-table select-first keys — an input method', () => {
  it('a composition on the selected cell opens the editor with the whole text, and its keys never commit', () => {
    const t = renderTable();
    t.select(0, 0);
    const box = t.catcher();
    fireEvent.compositionStart(box);
    // The pinyin under composition, and the Enter that picks the candidate.
    fireEvent.change(box, { target: { value: 'zhong' } });
    expect(t.editor()).toBeNull();
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    expect(t.editor()).toBeNull();
    box.value = '中';
    fireEvent.compositionEnd(box);
    expect(t.editor()).toHaveValue('中');
    // Safari raises the candidate's Enter after `compositionend`, as 229.
    fireEvent.keyDown(t.editor()!, { key: 'Enter', keyCode: 229 });
    expect(t.editor()).toHaveValue('中');
    expect(t.onCellChange).not.toHaveBeenCalled();
    // A plain Enter then commits it.
    fireEvent.keyDown(t.editor()!, { key: 'Enter' });
    expect(t.onCellChange).toHaveBeenCalledWith(0, 'name', '中', ROWS[0]);
  });

  it('Enter, Escape and Tab pressed while composing in an open editor neither commit, cancel nor move', () => {
    const t = renderTable();
    t.select(1, 0);
    fireEvent.keyDown(t.catcher(), { key: 'Enter' });
    for (const key of ['Enter', 'Escape', 'Tab']) {
      fireEvent.keyDown(t.editor()!, { key, isComposing: true });
      expect(t.editor()).not.toBeNull();
    }
    expect(t.selected()).toBe('1:0');
    expect(t.onCellChange).not.toHaveBeenCalled();
  });
});

describe('data-table select-first — clearing, the panel under the cell, a refused commit (objectstack#36023)', () => {
  it.each(['Backspace', 'Delete'])('%s clears the cell and saves at once, with no editor', (key) => {
    const t = renderTable();
    t.select(1, 1);
    fireEvent.keyDown(t.catcher(), { key });
    expect(t.editor()).toBeNull();
    expect(t.onCellChange).toHaveBeenCalledWith(1, 'amount', null, ROWS[1]);
    expect(t.selected()).toBe('1:1');
  });

  it('a cell the host refuses to clear keeps its value and says why on the cell', () => {
    const t = renderTable({}, { describeCell: () => ({ clearRefusal: 'Amount is required' }) });
    t.select(1, 1);
    fireEvent.keyDown(t.catcher(), { key: 'Backspace' });
    expect(t.onCellChange).not.toHaveBeenCalled();
    expect(t.editor()).toBeNull();
    expect(t.cell(1, 1)).toHaveTextContent('20');
    expect(document.querySelector('[data-testid="cell-readonly-reason"]')).toHaveTextContent('Amount is required');
  });

  it('a two-state cell has nothing to clear: Backspace writes nothing', () => {
    const t = renderTable({}, { describeCell: () => ({ toggles: true }) });
    t.select(0, 0);
    fireEvent.keyDown(t.catcher(), { key: 'Delete' });
    expect(t.onCellChange).not.toHaveBeenCalled();
  });

  it('a read-only cell says it is read-only and is not cleared', () => {
    const t = renderTable({}, { describeCell: () => ({ readOnlyReason: 'This value is calculated.' }) });
    t.select(0, 0);
    fireEvent.keyDown(t.catcher(), { key: 'Backspace' });
    expect(t.onCellChange).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="cell-readonly-reason"]')).toHaveTextContent('This value is calculated.');
  });

  it('`editor: below` opens a panel under the cell, which keeps drawing its value; the default covers it', () => {
    const below = renderTable({}, { describeCell: (_row, key) => (key === 'name' ? { editor: 'below' } : null) });
    below.select(0, 0);
    fireEvent.keyDown(below.catcher(), { key: 'Enter' });
    const host = below.cell(0, 0);
    expect(host.querySelector('[data-slot="cell-editor-overlay"]')).toHaveAttribute('data-placement', 'below');
    expect(host.querySelector('[data-slot="cell-display"]')).toHaveTextContent('Alpha');
    fireEvent.keyDown(below.editor()!, { key: 'Escape' });
    cleanup();
    // CONTROL: no fact, the layer covers the cell and the cell's text is not drawn under it.
    const cover = renderTable();
    cover.select(0, 0);
    fireEvent.keyDown(cover.catcher(), { key: 'Enter' });
    expect(cover.cell(0, 0).querySelector('[data-slot="cell-editor-overlay"]')).toHaveAttribute('data-placement', 'cover');
    expect(cover.cell(0, 0).querySelector('[data-slot="cell-display"]')).toBeNull();
  });

  it('a value the host refuses keeps the editor and the input, says why, and Enter does not move', () => {
    const validate = vi.fn((v: unknown) => (Number(v) > 100 ? 'Amount must be at most 100' : null));
    const t = renderTable({}, { describeCell: (_row, key) => (key === 'amount' ? { validate } : null) });
    t.select(0, 1);
    fireEvent.change(t.catcher(), { target: { value: '5' } });
    fireEvent.change(t.editor()!, { target: { value: '500' } });
    fireEvent.keyDown(t.editor()!, { key: 'Enter' });
    expect(validate).toHaveBeenCalledWith('500');
    expect(t.onCellChange).not.toHaveBeenCalled();
    expect(t.editor()).toHaveValue(500);
    expect(t.selected()).toBe('0:1');
    expect(t.cell(0, 1).querySelector('[data-testid="cell-edit-refusal"]')).toHaveTextContent('Amount must be at most 100');
    // Tab is refused the same way.
    fireEvent.keyDown(t.editor()!, { key: 'Tab' });
    expect(t.selected()).toBe('0:1');
    expect(t.onCellChange).not.toHaveBeenCalled();
    // Correcting the value takes the reason away, and Tab commits and moves on.
    fireEvent.change(t.editor()!, { target: { value: '50' } });
    expect(t.cell(0, 1).querySelector('[data-testid="cell-edit-refusal"]')).toBeNull();
    fireEvent.keyDown(t.editor()!, { key: 'Tab' });
    expect(t.onCellChange).toHaveBeenCalledWith(0, 'amount', '50', ROWS[0]);
    expect(t.selected()).toBe('0:2');
  });

  it('Escape after a refusal discards the edit', () => {
    const t = renderTable({}, { describeCell: () => ({ validate: () => 'No.' }) });
    t.select(0, 0);
    fireEvent.change(t.catcher(), { target: { value: 'Z' } });
    fireEvent.keyDown(t.editor()!, { key: 'Enter' });
    expect(t.editor()).toHaveValue('Z');
    fireEvent.keyDown(t.editor()!, { key: 'Escape' });
    expect(t.editor()).toBeNull();
    expect(t.cell(0, 0)).toHaveTextContent('Alpha');
    expect(t.onCellChange).not.toHaveBeenCalled();
  });

  it('text a number box cannot read is refused by the table itself', () => {
    const t = renderTable();
    t.select(0, 1);
    fireEvent.change(t.catcher(), { target: { value: '5' } });
    const input = t.editor() as HTMLInputElement;
    // jsdom never reports bad input; the browser does for text in a number box.
    Object.defineProperty(input, 'validity', { configurable: true, value: { badInput: true, typeMismatch: false } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(t.onCellChange).not.toHaveBeenCalled();
    expect(t.cell(0, 1).querySelector('[data-testid="cell-edit-refusal"]')).toHaveTextContent('Enter a number.');
    // CONTROL: once the box reads, the commit goes through.
    Object.defineProperty(input, 'validity', { configurable: true, value: { badInput: false, typeMismatch: false } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(t.onCellChange).toHaveBeenCalledWith(0, 'amount', 5, ROWS[0]);
  });

  it('an in-cell box that already says why it cannot read its text is refused without a second sentence', () => {
    const t = renderTable();
    t.select(0, 1);
    fireEvent.change(t.catcher(), { target: { value: '5' } });
    const input = t.editor() as HTMLInputElement;
    // The in-cell number face marks its box and draws its own bad-input line.
    input.setAttribute('aria-invalid', 'true');
    Object.defineProperty(input, 'validity', { configurable: true, value: { badInput: true, typeMismatch: false } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(t.onCellChange).not.toHaveBeenCalled();
    expect(t.editor()).not.toBeNull();
    expect(t.cell(0, 1).querySelector('[data-testid="cell-edit-refusal"]')).toBeNull();
  });

  it('a press outside an injected editor holding a refused value keeps the editor, and the click selects nothing', () => {
    const t = renderTable(
      {
        renderCellEditor: (ctx: any) => (
          <input data-testid="injected" value={ctx.value ?? ''} onChange={(e) => ctx.stage(e.target.value)} />
        ),
      },
      { describeCell: (_row, key) => (key === 'name' ? { validate: (v) => (v === '' ? 'Name is required' : null) } : null) },
    );
    t.select(0, 0);
    fireEvent.keyDown(t.catcher(), { key: 'Enter' });
    const injected = () => t.container.querySelector<HTMLInputElement>('[data-testid="injected"]');
    fireEvent.change(injected()!, { target: { value: '' } });
    fireEvent.pointerDown(t.cell(2, 2));
    fireEvent.click(t.cell(2, 2));
    expect(injected()).not.toBeNull();
    expect(t.selected()).toBe('0:0');
    expect(t.onCellChange).not.toHaveBeenCalled();
    expect(t.cell(0, 0).querySelector('[data-testid="cell-edit-refusal"]')).toHaveTextContent('Name is required');
    // CONTROL: a value the host accepts commits on the press outside.
    fireEvent.change(injected()!, { target: { value: 'Omega' } });
    fireEvent.pointerDown(t.cell(2, 2));
    expect(injected()).toBeNull();
    expect(t.onCellChange).toHaveBeenCalledWith(0, 'name', 'Omega', ROWS[0]);
  });

  it('the selected cell is framed by a child under the frozen columns, not by its outline, and Esc leaves no ring', () => {
    const t = renderTable({ frozenColumns: 1 });
    const frame = (row: number, col: number) => t.cell(row, col).querySelector('[data-slot="cell-selection-frame"]');
    t.select(0, 1);
    // The frame sits in the cell's own layer (below the sticky z-10 column).
    expect(frame(0, 1)).toHaveClass('absolute', 'inset-0', 'pointer-events-none');
    expect(frame(0, 1)!.className).not.toMatch(/z-(?:[1-9]\d|\[(?:[1-9]\d))/);
    expect(t.cell(0, 1).className).not.toContain('outline-primary');
    // A frozen cell selected is framed the same way.
    t.select(0, 0);
    expect(frame(0, 1)).toBeNull();
    expect(frame(0, 0)).not.toBeNull();
    // Esc deselects: the focus stays on the cell, which draws no ring at all.
    fireEvent.keyDown(t.catcher(), { key: 'Escape' });
    expect(t.selected()).toBeNull();
    expect(document.activeElement).toBe(t.cell(0, 0));
    expect(t.cell(0, 0)).toHaveClass('outline-none');
    expect(frame(0, 0)).toBeNull();
  });
});
