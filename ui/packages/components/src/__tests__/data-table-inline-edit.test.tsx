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
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { renderComponent } from './test-utils';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

const editableSchema = {
  type: 'data-table' as const,
  editable: true,
  singleClickEdit: true,
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
    const { container } = renderComponent({ ...editableSchema, onRowClick });

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

  it('A2) clicking a readonly (editable:false) cell still fires onRowClick (sanity)', () => {
    const onRowClick = vi.fn();
    const { container } = renderComponent({ ...editableSchema, onRowClick });

    const nameCell = Array.from(container.querySelectorAll('tbody td')).find((td) =>
      td.textContent?.includes('将军柱下料')
    ) as HTMLElement;
    fireEvent.click(nameCell);

    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('B) a date column renders a native date picker, not a free-text input', () => {
    const { container } = renderComponent(editableSchema);

    const cells = container.querySelectorAll('tbody td');
    const dateCell = cells[1] as HTMLElement; // 实际开始时间
    fireEvent.click(dateCell);

    const input = dateCell.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.type).toBe('date');
  });

  it('B2) a number column renders a numeric input', () => {
    const { container } = renderComponent(editableSchema);

    const cells = container.querySelectorAll('tbody td');
    const qtyCell = cells[2] as HTMLElement; // 报工数量
    fireEvent.click(qtyCell);

    const input = qtyCell.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.type).toBe('number');
  });

  it('C) editing a cell then clicking away (blur) commits the typed value', () => {
    // Regression: switching cells dropped the in-flight value because only
    // Enter/Escape committed the edit. Blur must save it too.
    const onCellChange = vi.fn();
    const { container } = renderComponent({ ...editableSchema, onCellChange });

    const cells = container.querySelectorAll('tbody td');
    const qtyCell = cells[2] as HTMLElement; // 报工数量
    fireEvent.click(qtyCell);

    const input = qtyCell.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '42' } });
    // Click away (focus leaves the editor) — value must persist, not vanish.
    fireEvent.blur(input);

    expect(onCellChange).toHaveBeenCalledTimes(1);
    expect(onCellChange).toHaveBeenCalledWith(0, 'qty', '42', expect.anything());
  });

  it('C2) pressing Escape discards the edit and does NOT commit on blur', () => {
    const onCellChange = vi.fn();
    const { container } = renderComponent({ ...editableSchema, onCellChange });

    const cells = container.querySelectorAll('tbody td');
    const qtyCell = cells[2] as HTMLElement; // 报工数量
    fireEvent.click(qtyCell);

    const input = qtyCell.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    // The ensuing blur must not resurrect the cancelled value.
    fireEvent.blur(input);

    expect(onCellChange).not.toHaveBeenCalled();
  });

  it('D) a failed save surfaces the server error and keeps the pending change', async () => {
    // Regression: a rejected save (e.g. a 400 validation failure) was swallowed
    // with only console.error — the toolbar stayed stuck, the cell kept the
    // unsaved value, and the author got no feedback. The reason must surface.
    const onBatchSave = vi.fn().mockRejectedValue({
      // Shape the ObjectStack adapter decorates onto thrown errors.
      details: { message: 'Invalid task status transition.' },
    });
    const { container, getByText } = renderComponent({ ...editableSchema, onBatchSave });

    // Stage an edit.
    const cells = container.querySelectorAll('tbody td');
    const qtyCell = cells[2] as HTMLElement; // 报工数量
    fireEvent.click(qtyCell);
    const input = qtyCell.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.blur(input);

    // Save All → saveBatch → onBatchSave rejects.
    fireEvent.click(getByText(/Save All/i));
    expect(onBatchSave).toHaveBeenCalledTimes(1);

    // The server's reason is surfaced, not swallowed.
    await waitFor(() =>
      expect(container.textContent).toContain('Invalid task status transition'),
    );
    // And the pending change is kept (Save All still offered) — no silent drop
    // and no phantom "saved" state.
    expect(getByText(/Save All/i)).toBeInTheDocument();
  });

  it('D2) a successful save does NOT show a save-failure message', async () => {
    const onBatchSave = vi.fn().mockResolvedValue(undefined);
    const { container, getByText } = renderComponent({ ...editableSchema, onBatchSave });

    const cells = container.querySelectorAll('tbody td');
    const qtyCell = cells[2] as HTMLElement;
    fireEvent.click(qtyCell);
    const input = qtyCell.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.blur(input);

    fireEvent.click(getByText(/Save All/i));
    await waitFor(() => expect(onBatchSave).toHaveBeenCalledTimes(1));

    expect(container.textContent).not.toContain('Save failed');
  });

  it('E) a staged editor (e.g. a lookup picker) exits edit mode after Save All', async () => {
    // Regression: relational pickers (lookup/master_detail/user/owner) keep their
    // widget open on pick — they `stage` the value rather than commit-and-close.
    // saveBatch cleared pendingChanges but never cleared `editingCell`, so after
    // 全部保存 the saved cell stayed stuck showing the picker widget instead of
    // reverting to the resolved display value. Save All must close any open editor.
    const onBatchSave = vi.fn().mockResolvedValue(undefined);
    // A host-injected editor that mimics a lookup: picking a value STAGES it and
    // deliberately keeps the editor open (no commit/close).
    const renderCellEditor = ({ column, stage }: any) =>
      column.accessorKey === 'qty' ? (
        <button data-testid="picker" onClick={() => stage('picked')}>
          picker
        </button>
      ) : null;

    const { container, getByText, getByTestId, queryByTestId } = renderComponent({
      ...editableSchema,
      onBatchSave,
      renderCellEditor,
    });

    const cells = container.querySelectorAll('tbody td');
    const qtyCell = cells[2] as HTMLElement; // uses the injected picker editor
    fireEvent.click(qtyCell);

    // Editor is open; pick a value — it stages and stays open (no close).
    fireEvent.click(getByTestId('picker'));
    expect(queryByTestId('picker')).toBeInTheDocument();

    // Save All persists the staged value AND must exit edit mode.
    fireEvent.click(getByText(/Save All/i));
    await waitFor(() => expect(onBatchSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queryByTestId('picker')).not.toBeInTheDocument());
  });
});
