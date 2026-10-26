/**
 * ObjectGrid column-state persistence — the OUTBOUND half (objectui#6175).
 *
 * The inbound half (seed `columnState` from the host / localStorage, re-sync on
 * external change) already worked and is pinned by `gridNonAuthorKeys.test.tsx`.
 * The outbound half was DEAD: `saveColumnState` (`ObjectGrid.tsx:661`) had exactly
 * two call sites — `onColumnResize` and `onColumnReorder` on the synthesised
 * `dataTableSchema` — and `data-table.tsx` invoked NEITHER, so a user's drag was
 * never written anywhere.
 *
 * ⚠️ These tests deliberately observe the WRITE, never the read-back. A test that
 * seeds a width and re-reads it passes with the outbound half still dead, because
 * the inbound half is what answers it. Each case therefore asserts on BOTH outbound
 * channels of `saveColumnState`:
 *   1. `localStorage.setItem(columnStorageKey, …)` — the per-browser fallback, and
 *   2. the `onColumnStateChange` prop — the host channel that `ObjectView` turns
 *      into a write of the user's own list state (it was
 *      `dataSource.updateViewConfig` until objectui#12418 / objectui#12504).
 *
 * Every spy and the storage are recreated per case (no module-level mock object
 * carrying one case's write into the next).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

const rows = [
  { id: '1', name: 'Alice', amount: 100 },
  { id: '2', name: 'Bob', amount: 200 },
];

beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

const STORAGE_KEY = 'grid-columns-test_object';

function renderGrid(onColumnStateChange: (s: any) => void, opts?: Record<string, any>) {
  const schema: any = {
    type: 'object-grid',
    objectName: 'test_object',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'amount', label: 'Amount', type: 'number' },
    ],
    data: { provider: 'value', items: rows },
    ...opts,
  };
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} onColumnStateChange={onColumnStateChange} />
    </ActionProvider>
  );
}

/** Drag the resize handle of the header cell whose label is `header`. */
function dragResize(header: string, byPx: number) {
  const th = screen.getByText(header).closest('th') as HTMLElement;
  expect(th).toBeTruthy();
  const handle = th.querySelector('.cursor-col-resize') as HTMLElement;
  expect(handle).toBeTruthy();
  fireEvent.mouseDown(handle, { clientX: 100 });
  fireEvent.mouseMove(document, { clientX: 100 + byPx });
  fireEvent.mouseUp(document);
}

describe('ObjectGrid column-state persistence (outbound half)', () => {
  it('writes the new width to localStorage AND notifies the host when a column is resized', async () => {
    const onColumnStateChange = vi.fn();
    renderGrid(onColumnStateChange);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    expect(onColumnStateChange).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    dragResize('Name', 160);

    // Channel 1 — the host callback (the console stores it on the user's own list state).
    await waitFor(() => expect(onColumnStateChange).toHaveBeenCalled());
    const notified = onColumnStateChange.mock.calls.at(-1)![0];
    expect(notified.widths).toEqual({ name: 160 });

    // Channel 2 — the per-browser fallback.
    const stored = localStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).widths).toEqual({ name: 160 });
  });

  it('writes the new order to localStorage AND notifies the host when columns are reordered', async () => {
    const onColumnStateChange = vi.fn();
    renderGrid(onColumnStateChange, { reorderableColumns: true });
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    expect(onColumnStateChange).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    const nameTh = screen.getByText('Name').closest('th') as HTMLElement;
    const amountTh = screen.getByText('Amount').closest('th') as HTMLElement;
    const dataTransfer = { effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(nameTh, { dataTransfer });
    fireEvent.dragOver(amountTh, { dataTransfer });
    fireEvent.drop(amountTh, { dataTransfer });

    await waitFor(() => expect(onColumnStateChange).toHaveBeenCalled());
    const notified = onColumnStateChange.mock.calls.at(-1)![0];
    expect(notified.order).toEqual(['amount', 'name']);

    const stored = localStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).order).toEqual(['amount', 'name']);
  });
});
