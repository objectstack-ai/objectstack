/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12292 — "Save All" reads the batch's outcome PER ROW.
 *
 * A batch is several independent writes: some can land while others are
 * refused, and the server keeps the ones it accepted. The table used to read
 * every batch as all-or-nothing, so one refused row kept every row pending and
 * flagged, rows that had landed included, and a retry sent them again. An
 * `onBatchSave` that knows which rows did not persist now resolves with
 * `{ failed }`, and the table keeps exactly those rows. A rejection still reads
 * as all-or-nothing, because it says nothing about which rows landed; the
 * existing pins in `data-table-inline-edit.test.tsx` hold that half.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
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
    { header: 'Task', accessorKey: 'name', editable: false },
    { header: 'Estimate', accessorKey: 'qty', type: 'number' },
  ],
  data: [
    { id: '1', name: 'Ingest pipeline', qty: 60 },
    { id: '2', name: 'Warehouse schema', qty: 33 },
  ],
} as any;

type Entry = { rowIndex: number; changes: Record<string, any>; row: any };

/** Stage a new value in the Estimate cell of the given body row. */
function stage(container: HTMLElement, rowNumber: number, value: string) {
  const row = container.querySelectorAll('tbody tr')[rowNumber] as HTMLElement;
  const cell = row.querySelectorAll('td')[1] as HTMLElement;
  fireEvent.click(cell);
  const input = cell.querySelector('input') as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe('data-table — Save All reads a per-row batch outcome (objectui#12292)', () => {
  it('keeps and flags only the rows the batch names as failed', async () => {
    const onBatchSave = vi.fn(async (entries: Entry[]) => ({
      failed: entries
        .filter((e) => e.row.id === '2')
        .map((e) => ({ rowIndex: e.rowIndex, error: new Error('Warehouse schema was refused') })),
    }));
    const { container, getByText, getByRole } = renderComponent({ ...schema, onBatchSave });

    stage(container, 0, '61');
    stage(container, 1, '31');
    expect(getByText(/2 rows modified/)).toBeInTheDocument();
    fireEvent.click(getByText(/Save All/));

    await waitFor(() => expect(getByText(/1 row modified/)).toBeInTheDocument());
    expect(onBatchSave).toHaveBeenCalledTimes(1);
    expect(getByRole('button', { name: /Save All \(1\)/ })).toBeInTheDocument();
    expect(container.textContent).toContain('Warehouse schema was refused');
    // The refused row keeps its edit; the row that persisted holds none.
    const rows = container.querySelectorAll('tbody tr');
    expect(rows[1].textContent).toContain('31');
    expect(rows[0].textContent).not.toContain('61');
  });

  it('clears every row when the outcome names no failure', async () => {
    const onBatchSave = vi.fn(async () => ({ failed: [] }));
    const { container, getByText, queryByText } = renderComponent({ ...schema, onBatchSave });

    stage(container, 0, '61');
    stage(container, 1, '31');
    fireEvent.click(getByText(/Save All/));

    await waitFor(() => expect(onBatchSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queryByText(/modified/)).toBeNull());
    expect(container.textContent).not.toContain('Save failed');
  });

  it('keeps every row when a failure names a row the batch never handed over', async () => {
    const onBatchSave = vi.fn(async () => ({
      failed: [{ rowIndex: 999, error: new Error('Unplaceable refusal') }],
    }));
    const { container, getByText } = renderComponent({ ...schema, onBatchSave });

    stage(container, 0, '61');
    stage(container, 1, '31');
    fireEvent.click(getByText(/Save All/));

    await waitFor(() => expect(container.textContent).toContain('Unplaceable refusal'));
    expect(getByText(/2 rows modified/)).toBeInTheDocument();
  });
});
