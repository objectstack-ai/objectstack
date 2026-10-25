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
 * the real `ObjectGrid`, the invalidation bus, a page change) live in
 * `plugin-grid`'s `inlineEditPendingKeyedByRecord-12310.test.tsx`; these pin
 * the table's own half: what Save All hands over, an id-less row, a record a
 * re-read drops, and an editor left open across a reorder.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll`; see
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

const columns = [
  { header: 'Task', accessorKey: 'name', editable: false },
  { header: 'Estimate', accessorKey: 'qty', type: 'number' },
];

type Entry = { rowIndex: number; changes: Record<string, any>; row: any };

function mount(data: any[], extra: Record<string, unknown> = {}) {
  const Table = ComponentRegistry.get('data-table')!;
  const schemaFor = (rows: any[]) =>
    ({ type: 'data-table', editable: true, singleClickEdit: true, columns, data: rows, ...extra }) as any;
  const utils = render(<Table schema={schemaFor(data)} />);
  return {
    ...utils,
    /** Hand the table a new read of the rows, the way a host re-read does. */
    reread: (rows: any[]) => utils.rerender(<Table schema={schemaFor(rows)} />),
  };
}

const rowOf = (container: HTMLElement, name: string) =>
  Array.from(container.querySelectorAll('tbody tr')).find((tr) => tr.textContent?.includes(name)) as HTMLElement;

const estimateCell = (container: HTMLElement, name: string) =>
  rowOf(container, name).querySelectorAll('td')[1] as HTMLElement;

/** Stage a new Estimate on the row named `name`. */
function stage(container: HTMLElement, name: string, value: string) {
  const cell = estimateCell(container, name);
  fireEvent.click(cell);
  const input = cell.querySelector('input') as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

const names = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('tbody tr')).map((tr) => tr.querySelectorAll('td')[0]?.textContent);

describe('data-table keeps each pending edit on its record (objectui#12310)', () => {
  it('a re-read in a new order draws each edit on its record, and Save All hands each over with its own row', async () => {
    const onBatchSave = vi.fn(async (_entries: Entry[]) => undefined);
    const { container, getByText, reread } = mount(
      [
        { id: 'a', name: 'Alpha', qty: 10 },
        { id: 'b', name: 'Bravo', qty: 20 },
        { id: 'c', name: 'Charlie', qty: 30 },
      ],
      { onBatchSave },
    );
    stage(container, 'Bravo', '21');
    stage(container, 'Alpha', '11');

    reread([
      { id: 'c', name: 'Charlie', qty: 30 },
      { id: 'a', name: 'Alpha', qty: 10 },
      { id: 'b', name: 'Bravo', qty: 20 },
    ]);
    expect(names(container)).toEqual(['Charlie', 'Alpha', 'Bravo']);
    expect(estimateCell(container, 'Charlie')).toHaveTextContent('30');
    expect(estimateCell(container, 'Alpha')).toHaveTextContent('11');
    expect(estimateCell(container, 'Bravo')).toHaveTextContent('21');

    fireEvent.click(getByText(/Save All/));
    await waitFor(() => expect(onBatchSave).toHaveBeenCalledTimes(1));
    const entries = onBatchSave.mock.calls[0][0];
    // `rowIndex` is each record's index in the rows held when Save All ran.
    expect(entries.map((e) => [e.row.id, e.rowIndex, e.changes]).sort()).toEqual([
      ['a', 1, { qty: '11' }],
      ['b', 2, { qty: '21' }],
    ]);
  });

  it('a re-read that drops a record keeps its edit pending, and Save All hands it over with the row it was staged on', async () => {
    const bravo = { id: 'b', name: 'Bravo', qty: 20 };
    const onBatchSave = vi.fn(async (entries: Entry[]) => ({
      failed: entries
        .filter((e) => e.row.id === 'b')
        .map((e) => ({ rowIndex: e.rowIndex, error: new Error('Bravo was refused') })),
    }));
    const { container, getByText, reread } = mount(
      [{ id: 'a', name: 'Alpha', qty: 10 }, bravo, { id: 'c', name: 'Charlie', qty: 30 }],
      { onBatchSave },
    );
    stage(container, 'Bravo', '21');

    reread([{ id: 'a', name: 'Alpha', qty: 10 }, { id: 'c', name: 'Charlie', qty: 30 }]);
    // Kept, counted, and drawn on no other row.
    expect(getByText(/1 row modified/)).toBeInTheDocument();
    expect(container.querySelector('tbody')?.textContent).not.toContain('21');

    fireEvent.click(getByText(/Save All/));
    await waitFor(() => expect(container.textContent).toContain('Bravo was refused'));
    // The row it was typed on, and an index no held row carries.
    expect(onBatchSave.mock.calls[0][0]).toEqual([{ rowIndex: -1, changes: { qty: '21' }, row: bravo }]);
    expect(getByText(/1 row modified/)).toBeInTheDocument();

    // When the record comes back, the kept edit and its failure are drawn on it.
    reread([{ id: 'b', name: 'Bravo', qty: 20 }, { id: 'a', name: 'Alpha', qty: 10 }, { id: 'c', name: 'Charlie', qty: 30 }]);
    expect(estimateCell(container, 'Bravo')).toHaveTextContent('21');
    expect(rowOf(container, 'Bravo').className).toContain('bg-destructive/10');
    expect(rowOf(container, 'Alpha').className).not.toContain('bg-destructive/10');
  });

  it("an open editor stays on its record across a reorder, and commits there", async () => {
    const onBatchSave = vi.fn(async (_entries: Entry[]) => undefined);
    const { container, getByText, reread } = mount(
      [{ id: 'a', name: 'Alpha', qty: 10 }, { id: 'b', name: 'Bravo', qty: 20 }],
      { onBatchSave },
    );
    const cell = estimateCell(container, 'Alpha');
    fireEvent.click(cell);
    fireEvent.change(cell.querySelector('input') as HTMLInputElement, { target: { value: '11' } });

    reread([{ id: 'b', name: 'Bravo', qty: 20 }, { id: 'a', name: 'Alpha', qty: 10 }]);
    expect(names(container)).toEqual(['Bravo', 'Alpha']);
    expect(estimateCell(container, 'Bravo').querySelector('input')).toBeNull();
    const input = estimateCell(container, 'Alpha').querySelector('input') as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(estimateCell(container, 'Alpha')).toHaveTextContent('11');
    expect(estimateCell(container, 'Bravo')).toHaveTextContent('20');
    fireEvent.click(getByText(/Save All/));
    await waitFor(() => expect(onBatchSave).toHaveBeenCalledTimes(1));
    expect(onBatchSave.mock.calls[0][0]).toEqual([
      { rowIndex: 1, changes: { qty: '11' }, row: expect.objectContaining({ id: 'a' }) },
    ]);
  });

  it("an id-less row's edit follows the row object through a client-side sort", async () => {
    const alpha = { name: 'Alpha', qty: 10 };
    const bravo = { name: 'Bravo', qty: 20 };
    const onBatchSave = vi.fn(async (_entries: Entry[]) => undefined);
    const { container, getByText } = mount([alpha, bravo], { onBatchSave });
    stage(container, 'Alpha', '11');

    // Task ascending, then descending: Bravo above Alpha.
    const header = within(container.querySelector('thead') as HTMLElement).getByText('Task');
    fireEvent.click(header);
    fireEvent.click(header);
    expect(names(container)).toEqual(['Bravo', 'Alpha']);
    expect(estimateCell(container, 'Alpha')).toHaveTextContent('11');
    expect(estimateCell(container, 'Bravo')).toHaveTextContent('20');

    fireEvent.click(getByText(/Save All/));
    await waitFor(() => expect(onBatchSave).toHaveBeenCalledTimes(1));
    expect(onBatchSave.mock.calls[0][0]).toEqual([{ rowIndex: 1, changes: { qty: '11' }, row: alpha }]);
  });
});
