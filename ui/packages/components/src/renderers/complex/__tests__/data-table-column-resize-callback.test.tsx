/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `DataTable` reports a settled column resize through `onColumnResize`
 * (objectui#6175).
 *
 * `DataTableSchema` has declared `onColumnResize?: (columnKey, width) => void`
 * (`data-display.ts:791`) all along, and this renderer invoked it NOWHERE — the
 * resize drag mutated local `columnWidths` state and stopped there. ObjectGrid's
 * `saveColumnState` hung off exactly that key, so no user-dragged column width
 * ever reached `localStorage` or the host's own store (then the shared view,
 * through `dataSource.updateViewConfig`, since retired in objectui#12504).
 *
 * ⚠️ These assertions observe the CALL, not a rendered width: the drag already
 * applied the width to local state before the fix, so anything that only inspects
 * the DOM after a drag passes on the UNFIXED renderer too.
 *
 * Spies are created per case — no module-level mock carrying one case's calls
 * into the next.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

const baseSchema = {
  columns: [
    { header: 'Name', accessorKey: 'name' },
    { header: 'Amount', accessorKey: 'amount' },
  ],
  data: [{ name: 'Alice', amount: 100 }],
  pagination: false,
  searchable: false,
};

function renderTable(extra: Record<string, any>) {
  const DataTable = ComponentRegistry.get('data-table') as any;
  if (!DataTable) throw new Error('data-table not registered');
  return render(<DataTable schema={{ ...baseSchema, ...extra }} />);
}

function resizeHandleFor(header: string): HTMLElement {
  const th = screen.getByText(header).closest('th') as HTMLElement;
  expect(th).toBeTruthy();
  const handle = th.querySelector('.cursor-col-resize') as HTMLElement;
  expect(handle).toBeTruthy();
  return handle;
}

describe('data-table reports column resizes to the host', () => {
  it('fires onColumnResize once at mouseup, with the column key and settled width', () => {
    const onColumnResize = vi.fn();
    renderTable({ resizableColumns: true, onColumnResize });

    fireEvent.mouseDown(resizeHandleFor('Name'), { clientX: 100 });
    expect(onColumnResize).not.toHaveBeenCalled();

    // Two moves in ONE drag: the host turns this callback into a persisted write
    // to shared view config, so it must report the settled value once rather than
    // stream every intermediate width.
    fireEvent.mouseMove(document, { clientX: 200 });
    fireEvent.mouseMove(document, { clientX: 260 });
    expect(onColumnResize).not.toHaveBeenCalled();

    fireEvent.mouseUp(document);

    expect(onColumnResize).toHaveBeenCalledTimes(1);
    expect(onColumnResize).toHaveBeenCalledWith('name', 160);
  });

  /**
   * ⚠️ Measured: this case is the ONE assertion here that still PASSES on a
   * revert of the fix — the unfixed renderer fires nothing at all, so "did not
   * fire" is trivially true there. It is a guard against over-firing (a future
   * per-mousemove or per-mouseup-without-drag callback would redden it), NOT a
   * pin of the fix. The three cases that DO distinguish the two states of the
   * world are the one above and both cases in
   * `plugin-grid/src/__tests__/columnStatePersistence.test.tsx`.
   */
  it('does not fire when the drag never moved', () => {
    const onColumnResize = vi.fn();
    renderTable({ resizableColumns: true, onColumnResize });

    fireEvent.mouseDown(resizeHandleFor('Amount'), { clientX: 100 });
    fireEvent.mouseUp(document);

    expect(onColumnResize).not.toHaveBeenCalled();
  });
});
