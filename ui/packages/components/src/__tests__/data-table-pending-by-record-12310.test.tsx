/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12310 — a pending inline edit, an open editor and a failed save
 * belong to their RECORD (`row.id`), never to the position the row held.
 *
 * The table used to key all three by page-local row index, so a re-read that
 * handed the rows over in a new order drew a kept edit on another record, and
 * Save All wrote it there. The end-to-end pins (the card's sequence through
 * the real `ObjectGrid`, the invalidation bus, a page change) pinned Save All
 * and went with it.
 *
 * The staged model is retired (objectstack#35827): each committed cell saves
 * at once through `onRowSave`, so no edit is kept pending across a re-read and
 * there is no Save All to hand rows over. What is left of this card's table
 * half is the open editor: it stays on its record across a reorder and commits
 * there. A saved row keeping its place in a client sort is
 * data-table-autosave-35685 (6).
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
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
];

function mount(data: any[], extra: Record<string, unknown> = {}) {
  const Table = ComponentRegistry.get('data-table')!;
  const tree = (rows: any[]) => (
    <GridCellSelectionProvider value={{}}>
      <Table schema={{ type: 'data-table', editable: true, columns, data: rows, ...extra } as any} />
    </GridCellSelectionProvider>
  );
  const utils = render(tree(data));
  return {
    ...utils,
    /** Hand the table a new read of the rows, the way a host re-read does. */
    reread: (rows: any[]) => utils.rerender(tree(rows)),
  };
}

const rowOf = (container: HTMLElement, name: string) =>
  Array.from(container.querySelectorAll('tbody tr')).find((tr) => tr.textContent?.includes(name)) as HTMLElement;

const estimateCell = (container: HTMLElement, name: string) =>
  rowOf(container, name).querySelectorAll('td')[1] as HTMLElement;

const editorIn = (cell: HTMLElement) =>
  cell.matches('[data-editing-cell]') ? (cell.querySelector('input') as HTMLInputElement | null) : null;

const names = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('tbody tr')).map((tr) => tr.querySelectorAll('td')[0]?.textContent);

describe('data-table keeps an open editor on its record (objectui#12310)', () => {
  it('an open editor stays on its record across a reorder, and commits there', async () => {
    const onRowSave = vi.fn(async (_i: number, _changes: Record<string, unknown>, _row?: unknown) => undefined);
    const { container, reread } = mount(
      [{ id: 'a', name: 'Alpha', qty: 10 }, { id: 'b', name: 'Bravo', qty: 20 }],
      { onRowSave },
    );
    const cell = estimateCell(container, 'Alpha');
    fireEvent.click(cell);
    fireEvent.doubleClick(cell);
    fireEvent.change(editorIn(cell) as HTMLInputElement, { target: { value: '11' } });

    reread([{ id: 'b', name: 'Bravo', qty: 20 }, { id: 'a', name: 'Alpha', qty: 10 }]);
    expect(names(container)).toEqual(['Bravo', 'Alpha']);
    expect(editorIn(estimateCell(container, 'Bravo'))).toBeNull();
    const input = editorIn(estimateCell(container, 'Alpha'));
    expect(input).not.toBeNull();
    fireEvent.keyDown(input as HTMLInputElement, { key: 'Enter' });

    await waitFor(() => expect(onRowSave).toHaveBeenCalledTimes(1));
    expect(onRowSave.mock.calls[0][1]).toEqual({ qty: '11' });
    expect(onRowSave.mock.calls[0][2]).toEqual(expect.objectContaining({ id: 'a' }));
    expect(estimateCell(container, 'Bravo')).toHaveTextContent('20');
  });

  // The other pins held what Save All handed over after a re-read in a new
  // order, after a re-read that dropped a record, and for an id-less row
  // through a client sort. With no pending edits and no Save All
  // (objectstack#35827) there is nothing kept across a re-read to hand over.
});
