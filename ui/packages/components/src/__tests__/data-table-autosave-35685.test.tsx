/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `data-table`'s per-cell save in the select-first model (objectstack#35685),
 * behind the `GridCellSelection` a host mounts.
 *
 *   1. A committed cell sends its record's update at once: one call, that
 *      cell only; no save bar, no row Save/Cancel column, no amber row; the
 *      cell says saving, then saved. A boolean flipped on Space saves too.
 *   2. A refused update keeps the typed value and says the server's reason on
 *      the cell; Esc, selected or editing, goes back to the stored value.
 *   3. A row holding a refused cell sends its next commit together with it,
 *      as one update (a rule that needs two fields changed together).
 *   4. A commit made while the record's save runs is sent after it, alone.
 *   5. A refusal naming a field the list cannot edit offers to open the record.
 *   6. A client-sorted row a save updated stays where it is until the rows load.
 *   7. Control: without the provider the save bar model is unchanged.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Registers `data-table` at module scope, not in a hook (objectui#3010).
import '../renderers';
// `react-page` reaches a dynamic `import('@object-ui/react-runtime')`: pay its load
// at collection, never inside a case's clocked window (`check:test-source-alias`).
import '@object-ui/react-runtime';
import { GridCellSelectionProvider } from '../context/gridCellSelection';

afterEach(cleanup);

const ROWS = [
  { id: '1', name: 'Alpha', stage: 'open', lost_reason: '', done: false },
  { id: '2', name: 'Beta', stage: 'open', lost_reason: '', done: true },
];

/** The refusal `PATCH /data/:object/:id` answers, as `@objectstack/client` decorates it. */
function fieldRefusal(fields: Array<{ field: string; message: string }>) {
  const message = fields.map((f) => f.message).join('; ');
  return Object.assign(new Error(message), {
    code: 'VALIDATION_FAILED',
    httpStatus: 400,
    details: { error: message, code: 'VALIDATION_FAILED', fields: fields.map((f) => ({ ...f, code: 'invalid' })) },
  });
}

type Save = (rowIndex: number, changes: Record<string, unknown>, row: any) => Promise<void>;

function schemaOf(onRowSave: Save, extra: Record<string, unknown> = {}) {
  return {
    type: 'data-table',
    columns: [
      { header: 'Name', accessorKey: 'name' },
      { header: 'Stage', accessorKey: 'stage' },
      { header: 'Lost reason', accessorKey: 'lost_reason' },
      { header: 'Done', accessorKey: 'done', type: 'boolean' },
    ],
    data: ROWS,
    editable: true,
    searchable: false,
    pagination: false,
    rowActions: true,
    onRowSave,
    ...extra,
  };
}

function renderTable(onRowSave: Save, extra: Record<string, unknown> = {}, withProvider = true) {
  const DataTable = ComponentRegistry.get('data-table')!;
  const tree = (schema: any) => (withProvider
    ? <GridCellSelectionProvider value={{}}><DataTable schema={schema} /></GridCellSelectionProvider>
    : <DataTable schema={schema} />);
  const utils = render(tree(schemaOf(onRowSave, extra)));
  const cell = (row: number, col: number) =>
    utils.container.querySelectorAll('tbody tr')[row].querySelectorAll('td[data-grid-cell]')[col] as HTMLElement;
  const editor = () => utils.container.querySelector<HTMLInputElement>('td[data-editing-cell] input');
  const catcher = () => utils.container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]');
  /** Select a cell, type `value` over it, and commit with Enter. */
  const typeAndEnter = (row: number, col: number, value: string) => {
    fireEvent.click(cell(row, col));
    fireEvent.change(catcher()!, { target: { value: value.slice(0, 1) } });
    fireEvent.change(editor()!, { target: { value } });
    fireEvent.keyDown(editor()!, { key: 'Enter' });
  };
  const rerenderWith = (extraNext: Record<string, unknown>) => utils.rerender(tree(schemaOf(onRowSave, { ...extra, ...extraNext })));
  return { ...utils, cell, editor, catcher, typeAndEnter, rerenderWith };
}

/** A save the test settles by hand. */
function deferredSave() {
  const calls: Array<{ changes: Record<string, unknown>; resolve: () => void; reject: (e: unknown) => void }> = [];
  const onRowSave = vi.fn((_i: number, changes: Record<string, unknown>, _row?: unknown) => new Promise<void>((resolve, reject) => {
    calls.push({ changes, resolve, reject });
  }));
  return { onRowSave, calls };
}

describe('data-table autosave — a committed cell saves at once (objectstack#35685)', () => {
  it('sends one update with that cell only, draws no save bar, no edit column and no amber row', async () => {
    const { onRowSave, calls } = deferredSave();
    const t = renderTable(onRowSave);
    t.typeAndEnter(0, 0, 'Alpha 2');
    await waitFor(() => expect(onRowSave).toHaveBeenCalledTimes(1));
    expect(onRowSave.mock.calls[0][1]).toEqual({ name: 'Alpha 2' });
    expect(onRowSave.mock.calls[0][2]).toBe(ROWS[0]);
    // The cell says it is saving, over its own edge.
    expect(t.cell(0, 0).querySelector('[data-slot="cell-save-state"]')).toHaveAttribute('data-state', 'saving');
    expect(screen.queryByText(/Save All/)).toBeNull();
    expect(screen.queryByText(/row modified/)).toBeNull();
    expect(t.container.querySelector('button[title="Save row"]')).toBeNull();
    expect(t.container.querySelector('[data-testid="data-table-edit-column-header"]')).toBeNull();
    const firstRow = t.container.querySelectorAll('tbody tr')[0] as HTMLElement;
    expect(firstRow.className).not.toContain('bg-amber-50');
    expect(t.cell(0, 0).className).not.toContain('text-amber-700');
    await act(async () => { calls[0].resolve(); });
    expect(t.cell(0, 0).querySelector('[data-slot="cell-save-state"]')).toHaveAttribute('data-state', 'saved');
    expect(onRowSave).toHaveBeenCalledTimes(1);
  });

  it('an unchanged commit sends nothing', async () => {
    const onRowSave = vi.fn(async () => {});
    const t = renderTable(onRowSave);
    fireEvent.click(t.cell(0, 0));
    fireEvent.keyDown(t.catcher()!, { key: 'Enter' });
    fireEvent.keyDown(t.editor()!, { key: 'Enter' });
    await act(async () => {});
    expect(onRowSave).not.toHaveBeenCalled();
  });

  it('a boolean flipped on Space saves at once', async () => {
    const onRowSave = vi.fn(async (_i: number, _changes: Record<string, unknown>) => {});
    const t = renderTable(onRowSave);
    fireEvent.click(t.cell(0, 3));
    fireEvent.keyDown(t.catcher()!, { key: ' ' });
    await waitFor(() => expect(onRowSave).toHaveBeenCalledTimes(1));
    expect(onRowSave.mock.calls[0][1]).toEqual({ done: true });
  });
});

describe('data-table autosave — a refusal keeps the edit and says why', () => {
  it('keeps the typed value, marks the cell with the server reason, and Esc goes back to the stored value', async () => {
    const onRowSave = vi.fn(async () => { throw fieldRefusal([{ field: 'name', message: 'Name is required' }]); });
    const t = renderTable(onRowSave);
    t.typeAndEnter(0, 0, 'Alp');
    await waitFor(() => expect(t.cell(0, 0)).toHaveAttribute('aria-invalid', 'true'));
    expect(t.cell(0, 0)).toHaveTextContent('Alp');
    expect(screen.getByTestId('cell-save-failure')).toHaveTextContent('Name is required');
    // Back on the cell: editing again starts from what was typed.
    fireEvent.click(t.cell(0, 0));
    fireEvent.keyDown(t.catcher()!, { key: 'Enter' });
    expect(t.editor()).toHaveValue('Alp');
    // Esc in the editor drops the kept edit.
    fireEvent.keyDown(t.editor()!, { key: 'Escape' });
    expect(t.editor()).toBeNull();
    expect(t.cell(0, 0)).toHaveTextContent('Alpha');
    expect(t.cell(0, 0)).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByTestId('cell-save-failure')).toBeNull();
  });

  it('Esc on the selected refused cell drops the edit too', async () => {
    const onRowSave = vi.fn(async () => { throw new Error('Server unavailable'); });
    const t = renderTable(onRowSave);
    t.typeAndEnter(1, 0, 'Bet');
    await waitFor(() => expect(t.cell(1, 0)).toHaveAttribute('aria-invalid', 'true'));
    // A reason the refusal names on no field is said on the edited cell.
    expect(screen.getByTestId('cell-save-failure')).toHaveTextContent('Server unavailable');
    fireEvent.click(t.cell(1, 0));
    fireEvent.keyDown(t.catcher()!, { key: 'Escape' });
    expect(t.cell(1, 0)).toHaveTextContent('Beta');
    expect(t.cell(1, 0)).not.toHaveAttribute('aria-invalid');
  });
});

describe('data-table autosave — a refused row sends its next commit together with the kept cell', () => {
  it('stage refused for a missing lost reason; filling the reason sends both in one update', async () => {
    const onRowSave = vi.fn(async (_i: number, changes: Record<string, unknown>) => {
      if (changes.stage === 'lost' && !changes.lost_reason) {
        throw fieldRefusal([{ field: 'lost_reason', message: 'A lost deal needs a reason' }]);
      }
    });
    const t = renderTable(onRowSave);
    t.typeAndEnter(0, 1, 'lost');
    await waitFor(() => expect(t.cell(0, 2)).toHaveAttribute('aria-invalid', 'true'));
    // The named cell carries its reason; the edited one keeps its value.
    expect(t.cell(0, 2)).toHaveAttribute('data-cell-error', 'A lost deal needs a reason');
    expect(t.cell(0, 1)).toHaveTextContent('lost');
    t.typeAndEnter(0, 2, 'Budget');
    await waitFor(() => expect(onRowSave).toHaveBeenCalledTimes(2));
    expect(onRowSave.mock.calls[1][1]).toEqual({ stage: 'lost', lost_reason: 'Budget' });
    await waitFor(() => expect(t.cell(0, 2)).not.toHaveAttribute('aria-invalid'));
    expect(t.cell(0, 1)).not.toHaveAttribute('aria-invalid');
  });
});

describe('data-table autosave — a commit during a running save waits for it', () => {
  it('sends the second cell alone once the first save lands', async () => {
    const { onRowSave, calls } = deferredSave();
    const t = renderTable(onRowSave);
    t.typeAndEnter(0, 0, 'Alpha 2');
    await waitFor(() => expect(onRowSave).toHaveBeenCalledTimes(1));
    t.typeAndEnter(0, 1, 'won');
    await act(async () => {});
    expect(onRowSave).toHaveBeenCalledTimes(1);
    await act(async () => { calls[0].resolve(); });
    await waitFor(() => expect(onRowSave).toHaveBeenCalledTimes(2));
    expect(onRowSave.mock.calls[1][1]).toEqual({ stage: 'won' });
  });
});

describe('data-table autosave — a rule the list cannot complete', () => {
  it('offers to open the record when the refusal names a field the list does not draw', async () => {
    const onRowClick = vi.fn();
    const onRowSave = vi.fn(async () => { throw fieldRefusal([{ field: 'close_date', message: 'A closed deal needs a close date' }]); });
    const t = renderTable(onRowSave, { onRowClick });
    t.typeAndEnter(0, 1, 'won');
    const open = await screen.findByTestId('cell-save-open-record');
    expect(screen.getByTestId('cell-save-failure')).toHaveTextContent('A closed deal needs a close date');
    fireEvent.click(open);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0]).toBe(ROWS[0]);
  });

  it('offers nothing when every named field is a cell the list edits', async () => {
    const onRowSave = vi.fn(async () => { throw fieldRefusal([{ field: 'lost_reason', message: 'Needs a reason' }]); });
    const t = renderTable(onRowSave, { onRowClick: vi.fn() });
    t.typeAndEnter(0, 1, 'lost');
    await screen.findByTestId('cell-save-failure');
    expect(screen.queryByTestId('cell-save-open-record')).toBeNull();
  });
});

describe('data-table autosave — a saved row keeps its place until the rows load', () => {
  const names = (c: HTMLElement) => [...c.querySelectorAll('tbody tr')].map((tr) => tr.querySelectorAll('td[data-grid-cell]')[0].textContent);

  it('a client-sorted row updated in place stays put; a new load sorts it', async () => {
    const onRowSave = vi.fn(async () => {});
    const t = renderTable(onRowSave);
    // Sort by Name ascending: Alpha, Beta.
    fireEvent.click(screen.getByText('Name'));
    expect(names(t.container)).toEqual(['Alpha', 'Beta']);
    t.typeAndEnter(0, 0, 'Zulu');
    await waitFor(() => expect(onRowSave).toHaveBeenCalledTimes(1));
    // The host draws the saved row in place of the one it read, as `ObjectGrid` does.
    t.rerenderWith({ data: [{ ...ROWS[0], name: 'Zulu' }, ROWS[1]] });
    await act(async () => {});
    expect(names(t.container)).toEqual(['Zulu', 'Beta']);
    // A load: every row is a new object.
    t.rerenderWith({ data: [{ ...ROWS[0], name: 'Zulu' }, { ...ROWS[1] }] });
    await waitFor(() => expect(names(t.container)).toEqual(['Beta', 'Zulu']));
  });
});

describe('data-table autosave — control: without the provider the save bar stays', () => {
  it('a commit stages, the bar shows, and nothing is sent until Save', async () => {
    const onRowSave = vi.fn(async () => {});
    const t = renderTable(onRowSave, { singleClickEdit: true }, false);
    const cell = t.container.querySelectorAll('tbody tr')[0].querySelectorAll('td')[0] as HTMLElement;
    fireEvent.click(cell);
    const input = cell.querySelector('input')!;
    fireEvent.change(input, { target: { value: 'Alpha 2' } });
    fireEvent.blur(input);
    await act(async () => {});
    expect(onRowSave).not.toHaveBeenCalled();
    expect(screen.getByText(/row modified/)).toBeInTheDocument();
  });
});

describe('data-table autosave — a select-first table with no row save keeps the save bar', () => {
  // Under the provider the per-cell save needs `onRowSave` to call; a table
  // wired with `onBatchSave` alone stages as before, so an edit is never held
  // where nothing can send it.
  it('a commit stages, the bar and the row buttons show, and Save All sends it', async () => {
    const onBatchSave = vi.fn(async (_changes: unknown[]) => {});
    const t = renderTable(undefined as unknown as Save, { onBatchSave });
    t.typeAndEnter(0, 0, 'Alpha 2');
    await act(async () => {});
    expect(onBatchSave).not.toHaveBeenCalled();
    expect(screen.getByText(/row modified/)).toBeInTheDocument();
    expect(t.container.querySelector('[data-slot="cell-save-state"]')).toBeNull();
    fireEvent.click(screen.getByText(/Save All/));
    await waitFor(() => expect(onBatchSave).toHaveBeenCalledTimes(1));
    expect((onBatchSave.mock.calls[0][0] as Array<{ changes: unknown }>)[0].changes).toEqual({ name: 'Alpha 2' });
  });
});

describe('data-table autosave — Esc in the editor while the row is saving', () => {
  it('takes back only that edit and leaves the sent value alone', async () => {
    const { onRowSave, calls } = deferredSave();
    const t = renderTable(onRowSave);
    t.typeAndEnter(0, 0, 'Alpha 2');
    await waitFor(() => expect(onRowSave).toHaveBeenCalledTimes(1));
    // Reopen the cell whose value is on the wire, type, then Esc.
    fireEvent.click(t.cell(0, 0));
    fireEvent.change(t.catcher()!, { target: { value: 'X' } });
    fireEvent.change(t.editor()!, { target: { value: 'Xyz' } });
    fireEvent.keyDown(t.editor()!, { key: 'Escape' });
    await act(async () => {});
    expect(t.cell(0, 0).textContent).toContain('Alpha 2');
    expect(t.editor()).toBeNull();
    // The typed-over text was never sent: the one save is the first commit.
    await act(async () => { calls[0].resolve(); });
    expect(onRowSave).toHaveBeenCalledTimes(1);
    expect(onRowSave.mock.calls[0][1]).toEqual({ name: 'Alpha 2' });
  });
});
