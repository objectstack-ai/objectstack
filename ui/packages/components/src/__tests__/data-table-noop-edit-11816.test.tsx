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
 *  1. a row counts as modified only when a value differs from the one it
 *     loaded with. Every commit used to be staged, so opening a cell and
 *     leaving it as it was showed "1 row modified · Save All (1)";
 *  2. staging the loaded value back un-marks the row;
 *  3. the trailing column that only ever holds a modified row's cancel/save
 *     pair is not headed "Actions" — `ObjectGrid` already draws a host column
 *     of that name beside it — and the "Actions" label takes the data-column
 *     header styling instead of the cell's larger default type.
 *
 * Each case drives the real renderer through the user's own gestures and reads
 * the toolbar the user reads.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { renderComponent } from './test-utils';
// Registers the renderers at module scope, NOT inside a `beforeAll`
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010/#3021).
import '../renderers';

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
    singleClickEdit: true,
    rowActions: true,
    onBatchSave: vi.fn(),
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

/** What the toolbar says about staged edits; `null` when nothing is staged. */
const modified = () => screen.queryByText(/rows? modified/)?.textContent ?? null;

/** Open `td`'s built-in editor, run `edit` on its input, then blur it. */
function editBuiltIn(td: HTMLElement, edit: (input: HTMLInputElement) => void = () => {}) {
  fireEvent.click(td);
  const input = td.querySelector('input') as HTMLInputElement;
  expect(input).toBeTruthy();
  edit(input);
  fireEvent.blur(input);
}

describe('data-table inline edit — a row is modified only by a real change (objectui#11816)', () => {
  it('a text cell opened and left as it was stages nothing', () => {
    const { container } = renderComponent(makeSchema());
    editBuiltIn(cell(container, NAME));
    expect(modified()).toBeNull();
    expect(screen.queryByText(/Save All/)).toBeNull();
  });

  it('an empty cell left empty stages nothing (the editor seeds it with an empty string)', () => {
    const { container } = renderComponent(makeSchema());
    editBuiltIn(cell(container, NOTE), (input) => expect(input.value).toBe(''));
    expect(modified()).toBeNull();
  });

  it('a number retyped as the same numeral stages nothing; a different number does', () => {
    const { container } = renderComponent(makeSchema());
    // Through `7` first so the editor really holds the input's STRING `'5'`.
    editBuiltIn(cell(container, QTY), (input) => {
      fireEvent.change(input, { target: { value: '7' } });
      fireEvent.change(input, { target: { value: '5' } });
    });
    expect(modified()).toBeNull();

    editBuiltIn(cell(container, QTY), (input) => fireEvent.change(input, { target: { value: '6' } }));
    expect(modified()).toBe('1 row modified');
  });

  it('staging the loaded value back un-marks the row', () => {
    const { container } = renderComponent(makeSchema());
    editBuiltIn(cell(container, QTY), (input) => fireEvent.change(input, { target: { value: '6' } }));
    expect(modified()).toBe('1 row modified');

    editBuiltIn(cell(container, QTY), (input) => fireEvent.change(input, { target: { value: '5' } }));
    expect(modified()).toBeNull();
    expect(screen.queryByText(/Save All/)).toBeNull();
  });

  it('a discrete editor committing the loaded code stages nothing', () => {
    const { container } = renderComponent(makeSchema());
    fireEvent.click(cell(container, PRIORITY));
    fireEvent.click(screen.getByTestId('pick-high'));
    expect(screen.queryByTestId('pick-high')).toBeNull(); // committed and closed
    expect(modified()).toBeNull();
  });

  it('an injected editor left by a click outside stages nothing (the reported gesture)', () => {
    const { container } = renderComponent(makeSchema());
    fireEvent.click(cell(container, PRIORITY));
    expect(screen.getByTestId('pick-high')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('pick-high')).toBeNull(); // left edit mode
    expect(modified()).toBeNull();
  });

  it('a multi-value set in another order is the same value; a smaller set is not', () => {
    const { container } = renderComponent(makeSchema());
    fireEvent.click(cell(container, TAGS));
    fireEvent.click(screen.getByTestId('tags-reorder'));
    expect(modified()).toBeNull();
    fireEvent.click(screen.getByTestId('tags-drop'));
    expect(modified()).toBe('1 row modified');
    fireEvent.click(screen.getByTestId('tags-restore'));
    expect(modified()).toBeNull();
  });
});

describe('data-table inline edit — the edit column is not a second "Actions" (objectui#11816)', () => {
  it('the save-only column is headed by its own name, not "Actions"', () => {
    renderComponent(makeSchema());
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Edit' })).toBeInTheDocument();
  });

  it('a column that can hold a row menu stays "Actions"', () => {
    renderComponent(makeSchema({ onRowEdit: () => {} }));
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Edit' })).toBeNull();
  });

  it('the "Actions" label is set in the data-column header type', () => {
    renderComponent(makeSchema({ editable: false, onRowEdit: () => {} }));
    const label = (name: string) =>
      screen.getByRole('columnheader', { name }).querySelector('span') as HTMLElement;
    for (const token of ['text-xs', 'font-medium', 'text-muted-foreground']) {
      expect(label('Name')).toHaveClass(token);
      expect(label('Actions')).toHaveClass(token);
    }
  });
});
