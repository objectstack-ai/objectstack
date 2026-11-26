/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12322 — a save removes only what it sent, from the pending edits
 * as they stand when it settles.
 *
 * Cell editing stays open while a row save or Save All is in flight (only the
 * save and cancel buttons wait on it). The table used to settle a save by
 * rebuilding the pending map from the copy it read when the save was pressed,
 * so anything staged during the round trip was dropped with no signal: an
 * edit on another row, a second edit on the row being saved, a new value for
 * the cell being saved. Each pin below holds the save's promise open, edits
 * during it, and releases it.
 *
 * The staged model is retired (objectstack#35827): each committed cell saves
 * at once through `onRowSave`, and a commit made during a running save of the
 * same record is sent after it, alone (data-table-autosave-35685 (4)). The
 * pins on what Save All and the row save button kept are gone with them; what
 * is left is an editor opened during a save, which must outlive the settle.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { GridCellSelectionProvider } from '../context/gridCellSelection';
// Registers the renderers at module scope, NOT inside a `beforeAll`; see
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';
// `react-page` reaches a dynamic `import('@object-ui/react-runtime')`: pay its load
// at collection, never inside a case's clocked window (`check:test-source-alias`).
import '@object-ui/react-runtime';

const columns = [
  { header: 'Task', accessorKey: 'name', editable: false },
  { header: 'Estimate', accessorKey: 'qty', type: 'number' },
  { header: 'Note', accessorKey: 'note' },
];

const ALPHA = { id: 'a', name: 'Alpha', qty: 10, note: '' };
const BRAVO = { id: 'b', name: 'Bravo', qty: 20, note: '' };
const CHARLIE = { id: 'c', name: 'Charlie', qty: 30, note: '' };

/** A promise the test settles by hand: the save's round trip, held open. */
function held<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mount(extra: Record<string, unknown>) {
  const Table = ComponentRegistry.get('data-table')!;
  const schema = {
    type: 'data-table',
    editable: true,
    rowActions: true,
    columns,
    data: [ALPHA, BRAVO, CHARLIE],
    ...extra,
  } as any;
  return render(<GridCellSelectionProvider value={{}}><Table schema={schema} /></GridCellSelectionProvider>);
}

const rowOf = (container: HTMLElement, name: string) =>
  Array.from(container.querySelectorAll('tbody tr')).find((tr) => tr.textContent?.includes(name)) as HTMLElement;

const cellOf = (container: HTMLElement, name: string, column: 'qty' | 'note') =>
  rowOf(container, name).querySelectorAll('td')[column === 'qty' ? 1 : 2] as HTMLElement;

const editorIn = (cell: HTMLElement) =>
  cell.matches('[data-editing-cell]') ? (cell.querySelector('input') as HTMLInputElement | null) : null;

/** Select a cell, open its editor, type `value`, and commit with Enter. */
function commit(container: HTMLElement, name: string, column: 'qty' | 'note', value: string) {
  const cell = cellOf(container, name, column);
  fireEvent.click(cell);
  fireEvent.doubleClick(cell);
  const input = editorIn(cell) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('data-table — a save settling leaves an editor opened during it alone (objectui#12322)', () => {
  it('an editor opened during the save stays open, with what was typed, when the save settles', async () => {
    const gate = held();
    const onRowSave = vi.fn((_i: number, _changes: Record<string, unknown>, _row?: unknown) => gate.promise);
    const { container } = mount({ onRowSave });

    commit(container, 'Alpha', 'qty', '11');
    await waitFor(() => expect(onRowSave).toHaveBeenCalledTimes(1));

    const bravo = cellOf(container, 'Bravo', 'qty');
    fireEvent.click(bravo);
    fireEvent.doubleClick(bravo);
    fireEvent.change(editorIn(bravo) as HTMLInputElement, { target: { value: '21' } });

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    const input = editorIn(cellOf(container, 'Bravo', 'qty'));
    expect(input).not.toBeNull();
    expect(input!.value).toBe('21');
    fireEvent.keyDown(input!, { key: 'Enter' });
    await waitFor(() => expect(onRowSave).toHaveBeenCalledTimes(2));
    expect(onRowSave.mock.calls[1][1]).toEqual({ qty: '21' });
    expect(onRowSave.mock.calls[1][2]).toEqual(expect.objectContaining({ id: 'b' }));
  });

  // The pins on what a row save or Save All removed from the pending edits
  // when it settled (another row, another cell of the same row, a cell
  // re-edited back, a per-row { failed }, a rejected batch) went with the
  // pending edits themselves (objectstack#35827). A commit made during a
  // running save is sent after it, alone: data-table-autosave-35685 (4).
});
