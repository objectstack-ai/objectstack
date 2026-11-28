/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression: inline cell editing on an `editable` data-table must be usable
 * for per-row data entry (e.g. 生产报工 where each row gets its own actual
 * date). Two bugs made it unusable:
 *
 *   A) Clicking an editable cell entered edit mode AND bubbled up to the row's
 *      onClick → onRowClick, which in ObjectGrid opens the record-detail drawer.
 *      The edit cell must stopPropagation so the drawer never opens.
 *   B) The inline editor was a hardcoded text <Input> for every field type, so
 *      date columns could only be typed by hand. A `type: 'date'` column must
 *      render a native date picker (<input type="date">).
 *
 * Mounted select-first with a per-cell save, the one way the table edits
 * (objectstack#35827): a click selects a cell and a double-click opens it.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { openCellEditor, renderSelectFirstTable } from './test-utils';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';
// `react-page` reaches a dynamic `import('@object-ui/react-runtime')`: pay its load
// at collection, never inside a case's clocked window (`check:test-source-alias`).
import '@object-ui/react-runtime';

const editableSchema = {
  type: 'data-table' as const,
  editable: true,
  columns: [
    { header: '工序', accessorKey: 'name', editable: false },
    { header: '实际开始时间', accessorKey: 'actual_start', type: 'date' },
    { header: '报工数量', accessorKey: 'qty', type: 'number' },
  ],
  data: [{ id: '1', name: '将军柱下料', actual_start: '', qty: '' }],
} as any;

describe('data-table — inline edit is per-row usable', () => {
  it('A) clicking an editable cell does NOT fire onRowClick (no detail drawer)', () => {
    const onRowClick = vi.fn();
    const { container } = renderSelectFirstTable({ ...editableSchema, onRowClick });

    const cell = Array.from(container.querySelectorAll('td')).find((td) =>
      td.textContent?.includes('将军柱下料')
    ) as HTMLElement;
    // sanity: the readonly name cell is editable:false, so it should still
    // behave like a normal row click.
    expect(cell).toBeTruthy();

    // Click the editable date cell (3rd column has no text yet → locate by index).
    const cells = container.querySelectorAll('tbody td');
    const dateCell = cells[1] as HTMLElement; // 实际开始时间
    fireEvent.click(dateCell);

    expect(onRowClick).not.toHaveBeenCalled();
  });

  // A2) pinned the staged arm's split, where a click on a read-only cell of an
  // editable table opened the record. Select-first, a click selects any cell
  // and opens nothing (objectstack#35827); that is data-table-select-first-35684.

  it('B) a date column renders a native date picker, not a free-text input', () => {
    const { container } = renderSelectFirstTable(editableSchema);

    const cells = container.querySelectorAll('tbody td');
    const dateCell = cells[1] as HTMLElement; // 实际开始时间
    openCellEditor(dateCell);

    const input = container.querySelector('td[data-editing-cell] input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.type).toBe('date');
  });

  it('B2) a number column renders a numeric input', () => {
    const { container } = renderSelectFirstTable(editableSchema);

    const cells = container.querySelectorAll('tbody td');
    const qtyCell = cells[2] as HTMLElement; // 报工数量
    openCellEditor(qtyCell);

    const input = container.querySelector('td[data-editing-cell] input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.type).toBe('number');
  });

  it('C) editing a cell then clicking away (blur) commits the typed value', () => {
    // Regression: switching cells dropped the in-flight value because only
    // Enter/Escape committed the edit. Blur must save it too.
    const onCellChange = vi.fn();
    const { container } = renderSelectFirstTable({ ...editableSchema, onCellChange });

    const cells = container.querySelectorAll('tbody td');
    const qtyCell = cells[2] as HTMLElement; // 报工数量
    openCellEditor(qtyCell);

    const input = container.querySelector('td[data-editing-cell] input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '42' } });
    // Click away (focus leaves the editor) — value must persist, not vanish.
    fireEvent.blur(input);

    expect(onCellChange).toHaveBeenCalledTimes(1);
    expect(onCellChange).toHaveBeenCalledWith(0, 'qty', '42', expect.anything());
  });

  it('C2) pressing Escape discards the edit and does NOT commit on blur', () => {
    const onCellChange = vi.fn();
    const { container } = renderSelectFirstTable({ ...editableSchema, onCellChange });

    const cells = container.querySelectorAll('tbody td');
    const qtyCell = cells[2] as HTMLElement; // 报工数量
    openCellEditor(qtyCell);

    const input = container.querySelector('td[data-editing-cell] input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    // The ensuing blur must not resurrect the cancelled value.
    fireEvent.blur(input);

    expect(onCellChange).not.toHaveBeenCalled();
  });

  // D, D2 and E pinned the staged "Save All" bar: a rejected batch keeping its
  // pending change, a resolved batch showing no failure, and Save All closing a
  // picker that staged without closing. The bar is retired (objectstack#35827).
  // Each cell now saves on commit: a refused save keeping the typed value and
  // saying the server's reason on the cell is data-table-autosave-35685 (2);
  // an injected editor that stages and stays open being committed by a press
  // outside is data-table-injected-editor-focus-6859 (D).
});
