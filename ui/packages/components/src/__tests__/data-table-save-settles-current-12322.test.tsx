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
 */
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll`; see
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

const columns = [
  { header: 'Task', accessorKey: 'name', editable: false },
  { header: 'Estimate', accessorKey: 'qty', type: 'number' },
  { header: 'Note', accessorKey: 'note' },
];

type Entry = { rowIndex: number; changes: Record<string, any>; row: any };

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
    singleClickEdit: true,
    rowActions: true,
    columns,
    data: [ALPHA, BRAVO, CHARLIE],
    ...extra,
  } as any;
  return render(<Table schema={schema} />);
}

const rowOf = (container: HTMLElement, name: string) =>
  Array.from(container.querySelectorAll('tbody tr')).find((tr) => tr.textContent?.includes(name)) as HTMLElement;

const cellOf = (container: HTMLElement, name: string, column: 'qty' | 'note') =>
  rowOf(container, name).querySelectorAll('td')[column === 'qty' ? 1 : 2] as HTMLElement;

/** Stage `value` in one cell, committed on blur the way a click elsewhere commits it. */
function stage(container: HTMLElement, name: string, column: 'qty' | 'note', value: string) {
  const cell = cellOf(container, name, column);
  fireEvent.click(cell);
  const input = cell.querySelector('input') as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

const saveRowOf = (container: HTMLElement, name: string) =>
  within(rowOf(container, name)).getByTitle('Save row');

/** What a Save All pressed now hands over: the edits still pending, row by row. */
async function pendingAsSent(
  onBatchSave: ReturnType<typeof vi.fn>,
  getByText: (text: RegExp) => HTMLElement,
) {
  const before = onBatchSave.mock.calls.length;
  fireEvent.click(getByText(/Save All/));
  await waitFor(() => expect(onBatchSave).toHaveBeenCalledTimes(before + 1));
  const entries = onBatchSave.mock.calls[before][0] as Entry[];
  return entries.map((e) => [e.row.id, e.changes]);
}

describe('data-table — a save removes only what it sent (objectui#12322)', () => {
  it('a row save held open: an edit staged on another row stays pending and drawn when it settles', async () => {
    const gate = held();
    const onRowSave = vi.fn(() => gate.promise);
    const onBatchSave = vi.fn(async (_entries: Entry[]) => undefined);
    const { container, getByText } = mount({ onRowSave, onBatchSave });

    stage(container, 'Alpha', 'qty', '11');
    fireEvent.click(saveRowOf(container, 'Alpha'));
    expect(onRowSave).toHaveBeenCalledWith(0, { qty: '11' }, ALPHA);

    stage(container, 'Bravo', 'qty', '21');
    expect(getByText(/2 rows modified/)).toBeInTheDocument();

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    expect(getByText(/1 row modified/)).toBeInTheDocument();
    expect(cellOf(container, 'Bravo', 'qty')).toHaveTextContent('21');
    expect(await pendingAsSent(onBatchSave, getByText)).toEqual([['b', { qty: '21' }]]);
  });

  it('Save All held open: an edit staged on another row stays pending and drawn when it settles', async () => {
    const gate = held();
    const onBatchSave = vi.fn((_entries: Entry[]) => gate.promise);
    const { container, getByText } = mount({ onBatchSave });

    stage(container, 'Alpha', 'qty', '11');
    fireEvent.click(getByText(/Save All/));
    expect(onBatchSave).toHaveBeenCalledTimes(1);

    stage(container, 'Bravo', 'qty', '21');
    expect(getByText(/2 rows modified/)).toBeInTheDocument();

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    expect(getByText(/1 row modified/)).toBeInTheDocument();
    expect(cellOf(container, 'Bravo', 'qty')).toHaveTextContent('21');
    onBatchSave.mockImplementation(async () => undefined);
    expect(await pendingAsSent(onBatchSave, getByText)).toEqual([['b', { qty: '21' }]]);
  });

  it.each([
    ['row save', 'row'],
    ['Save All', 'all'],
  ] as const)('%s: the cell being saved, re-edited during the save, keeps its new value pending', async (_label, via) => {
    const gate = held();
    const onRowSave = vi.fn(() => gate.promise);
    const onBatchSave = vi.fn((_entries: Entry[]) => gate.promise);
    const { container, getByText } = mount({ onRowSave, onBatchSave });

    stage(container, 'Alpha', 'qty', '11');
    fireEvent.click(via === 'row' ? saveRowOf(container, 'Alpha') : getByText(/Save All/));
    stage(container, 'Alpha', 'qty', '12');

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    expect(getByText(/1 row modified/)).toBeInTheDocument();
    expect(cellOf(container, 'Alpha', 'qty')).toHaveTextContent('12');
    onBatchSave.mockImplementation(async () => undefined);
    expect(await pendingAsSent(onBatchSave, getByText)).toEqual([['a', { qty: '12' }]]);
  });

  it('a cell re-edited back to its loaded value during its save stays pending, since the save writes the old edit', async () => {
    const gate = held();
    const onRowSave = vi.fn(() => gate.promise);
    const onBatchSave = vi.fn(async (_entries: Entry[]) => undefined);
    const { container, getByText } = mount({ onRowSave, onBatchSave });

    stage(container, 'Alpha', 'qty', '11');
    fireEvent.click(saveRowOf(container, 'Alpha'));
    // 10 is what Alpha loaded with, and 11 is on its way to the server: once
    // the save lands, 10 is a change again.
    stage(container, 'Alpha', 'qty', '10');
    expect(getByText(/1 row modified/)).toBeInTheDocument();

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    expect(getByText(/1 row modified/)).toBeInTheDocument();
    expect(await pendingAsSent(onBatchSave, getByText)).toEqual([['a', { qty: '10' }]]);
  });

  it('another cell of the row being saved, staged during its save, stays pending on its own', async () => {
    const gate = held();
    const onRowSave = vi.fn(() => gate.promise);
    const onBatchSave = vi.fn(async (_entries: Entry[]) => undefined);
    const { container, getByText } = mount({ onRowSave, onBatchSave });

    stage(container, 'Alpha', 'qty', '11');
    fireEvent.click(saveRowOf(container, 'Alpha'));
    stage(container, 'Alpha', 'note', 'reviewed');

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    expect(getByText(/1 row modified/)).toBeInTheDocument();
    expect(cellOf(container, 'Alpha', 'note')).toHaveTextContent('reviewed');
    expect(await pendingAsSent(onBatchSave, getByText)).toEqual([['a', { note: 'reviewed' }]]);
  });

  it('Save All with a per-row { failed }: the failed row stays flagged, a row staged during the save stays unflagged', async () => {
    const gate = held<{ failed: Array<{ rowIndex: number; error: Error }> }>();
    const onBatchSave = vi.fn((_entries: Entry[]) => gate.promise);
    const { container, getByText } = mount({ onBatchSave });

    stage(container, 'Alpha', 'qty', '11');
    stage(container, 'Bravo', 'qty', '21');
    fireEvent.click(getByText(/Save All/));
    const sent = onBatchSave.mock.calls[0][0];
    expect(sent.map((e) => e.row.id)).toEqual(['a', 'b']);

    stage(container, 'Charlie', 'qty', '31');
    expect(getByText(/3 rows modified/)).toBeInTheDocument();

    const bravo = sent.find((e) => e.row.id === 'b')!;
    await act(async () => {
      gate.resolve({ failed: [{ rowIndex: bravo.rowIndex, error: new Error('Bravo was refused') }] });
      await gate.promise;
    });

    expect(getByText(/2 rows modified/)).toBeInTheDocument();
    expect(container.textContent).toContain('Bravo was refused');
    expect(cellOf(container, 'Bravo', 'qty')).toHaveTextContent('21');
    expect(cellOf(container, 'Charlie', 'qty')).toHaveTextContent('31');
    expect(rowOf(container, 'Bravo').className).toContain('bg-destructive/10');
    expect(rowOf(container, 'Charlie').className).not.toContain('bg-destructive/10');
    expect(rowOf(container, 'Alpha').className).not.toContain('bg-destructive/10');

    onBatchSave.mockImplementation(async () => ({ failed: [] }));
    expect(await pendingAsSent(onBatchSave, getByText)).toEqual([
      ['b', { qty: '21' }],
      ['c', { qty: '31' }],
    ]);
  });

  it('a rejected Save All flags the rows it sent, not a row staged during the save', async () => {
    const gate = held();
    const onBatchSave = vi.fn((_entries: Entry[]) => gate.promise);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, getByText } = mount({ onBatchSave });

    stage(container, 'Alpha', 'qty', '11');
    fireEvent.click(getByText(/Save All/));
    stage(container, 'Charlie', 'qty', '31');

    await act(async () => {
      gate.reject(new Error('Network down'));
      await gate.promise.catch(() => undefined);
    });

    expect(getByText(/2 rows modified/)).toBeInTheDocument();
    expect(container.textContent).toContain('Network down');
    expect(rowOf(container, 'Alpha').className).toContain('bg-destructive/10');
    expect(rowOf(container, 'Charlie').className).not.toContain('bg-destructive/10');
    consoleError.mockRestore();
  });

  it('an editor opened during the save stays open, with what was typed, when the save settles', async () => {
    const gate = held();
    const onBatchSave = vi.fn((_entries: Entry[]) => gate.promise);
    const { container, getByText } = mount({ onBatchSave });

    stage(container, 'Alpha', 'qty', '11');
    fireEvent.click(getByText(/Save All/));

    const bravo = cellOf(container, 'Bravo', 'qty');
    fireEvent.click(bravo);
    fireEvent.change(bravo.querySelector('input') as HTMLInputElement, { target: { value: '21' } });

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    const input = cellOf(container, 'Bravo', 'qty').querySelector('input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('21');
    fireEvent.blur(input);
    expect(getByText(/1 row modified/)).toBeInTheDocument();
    expect(cellOf(container, 'Bravo', 'qty')).toHaveTextContent('21');
  });
});
