/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#27520 (row 6) — a refused inline save says WHY,
 * WHERE: the save bar says every reason whole, one line each, and the cells
 * the refusal names are marked.
 *
 * The server refuses a row field by field (`VALIDATION_FAILED` with one
 * `fields[]` entry per failed rule). The save bar used to cut that to one
 * truncated line, the rest only in a native tooltip, and no cell said which
 * value was wrong.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderComponent } from './test-utils';
// Registers the renderers at module scope, NOT inside a `beforeAll`; see
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

const schema = {
  type: 'data-table' as const,
  editable: true,
  singleClickEdit: true,
  columns: [
    { header: 'Title', accessorKey: 'title' },
    { header: 'Estimate', accessorKey: 'estimate', type: 'number' },
  ],
  data: [
    { id: '1', title: 'Ingest pipeline', estimate: 60 },
    { id: '2', title: 'Warehouse schema', estimate: 33 },
  ],
} as any;

type Entry = { rowIndex: number; changes: Record<string, any>; row: any };

const TITLE = 'Title is required and cannot be cleared';
const ESTIMATE = 'Estimate (h) must be ≥ 0';

/** The refusal `PATCH /data/:object/:id` answers, as `@objectstack/client` decorates it. */
function fieldRefusal(fields: Array<{ field: string; message: string }>) {
  const message = fields.map((f) => f.message).join('; ');
  return Object.assign(new Error(message), {
    code: 'VALIDATION_FAILED',
    httpStatus: 400,
    details: { error: message, code: 'VALIDATION_FAILED', fields: fields.map((f) => ({ ...f, code: 'invalid' })) },
  });
}

const cellOf = (container: HTMLElement, rowNumber: number, colNumber: number) =>
  container.querySelectorAll('tbody tr')[rowNumber].querySelectorAll('td')[colNumber] as HTMLElement;

/** Stage a new value in a body cell. */
function stage(container: HTMLElement, rowNumber: number, colNumber: number, value: string) {
  const cell = cellOf(container, rowNumber, colNumber);
  fireEvent.click(cell);
  const input = cell.querySelector('input') as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

const refusalBar = (container: HTMLElement) =>
  container.querySelector('[data-testid="table-save-refusal"]') as HTMLElement | null;

describe('data-table — a refused save says every reason and marks its cells (#27520)', () => {
  it('Save All: one line per reason, whole, and the two named cells of the refused row marked', async () => {
    const onBatchSave = vi.fn(async (entries: Entry[]) => ({
      failed: entries
        .filter((e) => e.row.id === '1')
        .map((e) => ({
          rowIndex: e.rowIndex,
          error: fieldRefusal([{ field: 'title', message: TITLE }, { field: 'estimate', message: ESTIMATE }]),
        })),
    }));
    const { container, getByText } = renderComponent({ ...schema, onBatchSave });

    stage(container, 0, 0, '');
    stage(container, 0, 1, '-5');
    stage(container, 1, 1, '31');
    fireEvent.click(getByText(/Save All/));

    await waitFor(() => expect(refusalBar(container)).not.toBeNull());
    const bar = refusalBar(container)!;
    expect(bar).toHaveAttribute('role', 'alert');
    expect(within(bar).getAllByRole('listitem').map((li) => li.textContent)).toEqual([TITLE, ESTIMATE]);
    // Said whole: not the `; `-joined summary, and not cut.
    expect(bar.textContent).not.toContain('; ');
    expect(bar.querySelector('.truncate')).toBeNull();

    // The refused row's two cells carry their reasons; the saved row's none.
    expect(cellOf(container, 0, 0)).toHaveAttribute('aria-invalid', 'true');
    expect(cellOf(container, 0, 0)).toHaveAttribute('data-cell-error', TITLE);
    expect(cellOf(container, 0, 1)).toHaveAttribute('aria-invalid', 'true');
    expect(cellOf(container, 0, 1)).toHaveAttribute('data-cell-error', ESTIMATE);
    expect(container.querySelectorAll('tbody tr')[1].querySelector('[aria-invalid="true"]')).toBeNull();
  });

  it('editing a marked cell takes its mark away and leaves the other', async () => {
    const onBatchSave = vi.fn(async (entries: Entry[]) => ({
      failed: entries.map((e) => ({
        rowIndex: e.rowIndex,
        error: fieldRefusal([{ field: 'title', message: TITLE }, { field: 'estimate', message: ESTIMATE }]),
      })),
    }));
    const { container, getByText } = renderComponent({ ...schema, onBatchSave });

    stage(container, 0, 0, '');
    stage(container, 0, 1, '-5');
    fireEvent.click(getByText(/Save All/));
    await waitFor(() => expect(cellOf(container, 0, 1)).toHaveAttribute('aria-invalid', 'true'));

    stage(container, 0, 1, '5');

    await waitFor(() => expect(cellOf(container, 0, 1)).not.toHaveAttribute('aria-invalid'));
    expect(cellOf(container, 0, 0)).toHaveAttribute('aria-invalid', 'true');
  });

  it('a single-row save marks the cell its refusal names, and a later save that lands clears it', async () => {
    const onRowSave = vi
      .fn()
      .mockRejectedValueOnce(fieldRefusal([{ field: 'estimate', message: ESTIMATE }]))
      .mockResolvedValueOnce(undefined);
    // `rowActions` draws the edit column that holds the row's own save button.
    const { container } = renderComponent({ ...schema, rowActions: true, onRowSave });

    stage(container, 0, 1, '-5');
    // The row's own save button (the edit column's save icon).
    const saveRow = () =>
      fireEvent.click(within(container.querySelectorAll('tbody tr')[0] as HTMLElement).getByTitle(/^Save row$/i));
    saveRow();

    await waitFor(() => expect(cellOf(container, 0, 1)).toHaveAttribute('data-cell-error', ESTIMATE));
    expect(refusalBar(container)?.textContent).toContain(ESTIMATE);

    stage(container, 0, 1, '5');
    saveRow();
    await waitFor(() => expect(onRowSave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(container.querySelector('tbody [aria-invalid="true"]')).toBeNull());
  });

  it('a whole-batch rejection says its reasons but marks no cell: no row is named', async () => {
    const onBatchSave = vi.fn(async () => {
      throw fieldRefusal([{ field: 'title', message: TITLE }]);
    });
    const { container, getByText } = renderComponent({ ...schema, onBatchSave });

    stage(container, 0, 0, '');
    stage(container, 1, 1, '31');
    fireEvent.click(getByText(/Save All/));

    await waitFor(() => expect(refusalBar(container)?.textContent).toContain(TITLE));
    expect(container.querySelector('tbody [aria-invalid="true"]')).toBeNull();
  });
});
