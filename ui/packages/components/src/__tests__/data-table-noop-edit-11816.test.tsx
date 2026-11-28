/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11816 — inline edit on an `editable` data-table:
 *
 *  1. a commit saves only when a value differs from the one the row loaded
 *     with. Every commit used to be staged, so opening a cell and leaving it
 *     as it was showed "1 row modified · Save All (1)"; under the per-cell
 *     save (objectstack#35827) such a commit sends no save;
 *  2. the "Actions" label takes the data-column header styling instead of the
 *     cell's larger default type. (The staged arm's edit-only column, headed by
 *     its own name, is retired with that arm.)
 *
 * Each case drives the real renderer, select-first, through the user's own
 * gestures and reads the saves it sends.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { openCellEditor, renderSelectFirstTable } from './test-utils';
// Registers the renderers at module scope, NOT inside a `beforeAll`
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010/#3021).
import '../renderers';
// `react-page` reaches a dynamic `import('@object-ui/react-runtime')`: pay its load
// at collection, never inside a case's clocked window (`check:test-source-alias`).
import '@object-ui/react-runtime';

/** A host-injected editor pair: a multi-value picker and a discrete select. */
const renderCellEditor = ({ column, stage, commit }: any) => {
  if (column.accessorKey === 'tags') {
    return (
      <div>
        <button data-testid="tags-reorder" onClick={() => stage(['b', 'a'])}>reorder</button>
        <button data-testid="tags-drop" onClick={() => stage(['a'])}>drop</button>
        <button data-testid="tags-restore" onClick={() => stage(['a', 'b'])}>restore</button>
      </div>
    );
  }
  if (column.accessorKey === 'priority') {
    // A real select's option sits in a portal; this stand-in sits in the cell,
    // so keep its click from re-entering the cell's own click-to-edit.
    return (
      <button
        data-testid="pick-high"
        onClick={(e) => {
          e.stopPropagation();
          commit('high');
        }}
      >
        High
      </button>
    );
  }
  return null;
};

const makeSchema = (extra: Record<string, unknown> = {}) =>
  ({
    type: 'data-table' as const,
    editable: true,
    rowActions: true,
    onRowSave: vi.fn(() => Promise.resolve()),
    renderCellEditor,
    columns: [
      { header: 'Name', accessorKey: 'name' },
      { header: 'Qty', accessorKey: 'qty', type: 'number' },
      { header: 'Note', accessorKey: 'note' },
      { header: 'Tags', accessorKey: 'tags' },
      { header: 'Priority', accessorKey: 'priority' },
    ],
    data: [{ id: '1', name: 'Alpha', qty: 5, note: null, tags: ['a', 'b'], priority: 'high' }],
    ...extra,
  }) as any;

/** The `<td>` of the first row in column `index`, per `makeSchema`'s order. */
const cell = (container: HTMLElement, index: number) =>
  container.querySelectorAll('tbody tr')[0].querySelectorAll('td')[index] as HTMLElement;
const NAME = 0;
const QTY = 1;
const NOTE = 2;
const TAGS = 3;
const PRIORITY = 4;

/** Renders the table select-first; `saves()` is how many row saves it sent. */
function renderTable(extra: Record<string, unknown> = {}) {
  const schema = makeSchema(extra);
  const utils = renderSelectFirstTable(schema);
  const saves = () => (schema.onRowSave as ReturnType<typeof vi.fn>).mock.calls.length;
  const lastSave = () => (schema.onRowSave as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1];
  return { ...utils, saves, lastSave };
}

/** Open `td`'s built-in editor, run `edit` on its input, then blur it. */
async function editBuiltIn(td: HTMLElement, edit: (input: HTMLInputElement) => void = () => {}) {
  openCellEditor(td);
  const input = document.querySelector('td[data-editing-cell] input') as HTMLInputElement;
  expect(input).toBeTruthy();
  edit(input);
  fireEvent.blur(input);
  await act(async () => {});
}

describe('data-table inline edit — a commit saves only a real change (objectui#11816)', () => {
  // Under the staged model a no-op commit marked the row modified; now each
  // commit saves at once (objectstack#35827), so a no-op commit must send no
  // save at all.
  it('a text cell opened and left as it was saves nothing', async () => {
    const { container, saves } = renderTable();
    await editBuiltIn(cell(container, NAME));
    expect(saves()).toBe(0);
  });

  it('an empty cell left empty saves nothing (the editor seeds it with an empty string)', async () => {
    const { container, saves } = renderTable();
    await editBuiltIn(cell(container, NOTE), (input) => expect(input.value).toBe(''));
    expect(saves()).toBe(0);
  });

  it('a number retyped as the same numeral saves nothing; a different number does', async () => {
    const { container, saves, lastSave } = renderTable();
    // Through `7` first so the editor really holds the input's STRING `'5'`.
    await editBuiltIn(cell(container, QTY), (input) => {
      fireEvent.change(input, { target: { value: '7' } });
      fireEvent.change(input, { target: { value: '5' } });
    });
    expect(saves()).toBe(0);

    await editBuiltIn(cell(container, QTY), (input) => fireEvent.change(input, { target: { value: '6' } }));
    expect(saves()).toBe(1);
    expect(Number((lastSave() as { qty: unknown }).qty)).toBe(6);
  });

  it('a discrete editor committing the loaded code saves nothing', async () => {
    const { container, saves } = renderTable();
    openCellEditor(cell(container, PRIORITY));
    fireEvent.click(screen.getByTestId('pick-high'));
    await act(async () => {});
    expect(screen.queryByTestId('pick-high')).toBeNull(); // committed and closed
    expect(saves()).toBe(0);
  });

  it('an injected editor left by a click outside saves nothing (the reported gesture)', async () => {
    const { container, saves } = renderTable();
    openCellEditor(cell(container, PRIORITY));
    expect(screen.getByTestId('pick-high')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    await act(async () => {});
    expect(screen.queryByTestId('pick-high')).toBeNull(); // left edit mode
    expect(saves()).toBe(0);
  });

  it('a multi-value set in another order is the same value; a smaller set is not', async () => {
    const { container, saves, lastSave } = renderTable();
    openCellEditor(cell(container, TAGS));
    fireEvent.click(screen.getByTestId('tags-reorder'));
    fireEvent.pointerDown(document.body);
    await act(async () => {});
    expect(saves()).toBe(0);

    openCellEditor(cell(container, TAGS));
    fireEvent.click(screen.getByTestId('tags-drop'));
    fireEvent.pointerDown(document.body);
    await act(async () => {});
    expect(saves()).toBe(1);
    expect(lastSave()).toEqual({ tags: ['a'] });
  });

  // "staging the loaded value back un-marks the row" pinned the staged bar's
  // count; with no staging there is no mark to take back.
});

describe('data-table inline edit — the edit column is not a second "Actions" (objectui#11816)', () => {
  // "the save-only column is headed by its own name" pinned the staged arm's
  // edit-only column; select-first draws none (objectstack#35827), pinned in
  // data-table-select-first-35684 "no edit-only column, ever".

  it('a column that can hold a row menu stays "Actions"', () => {
    renderTable({ onRowEdit: () => {} });
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Edit' })).toBeNull();
  });

  it('the "Actions" label is set in the data-column header type', () => {
    renderTable({ editable: false, onRowEdit: () => {} });
    const label = (name: string) =>
      screen.getByRole('columnheader', { name }).querySelector('span') as HTMLElement;
    // 12px since objectstack#36047 (a header is secondary type).
    for (const token of ['text-xs', 'font-medium', 'text-muted-foreground']) {
      expect(label('Name')).toHaveClass(token);
      expect(label('Actions')).toHaveClass(token);
    }
  });
});
