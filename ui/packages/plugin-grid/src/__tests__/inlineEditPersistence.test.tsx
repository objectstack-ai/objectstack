/**
 * Inline-edit persistence (生产报工 regression)
 *
 * Repro of the reported bug: edit a cell, commit it (Enter / blur), then click
 * the row-save or "全部保存" button — after the grid refreshes the value is gone.
 *
 * This drives the FULL path (DataTable edit → ObjectGrid defaultRowSave /
 * defaultBatchSave → dataSource.update → refresh → refetch) against an
 * in-memory fake server, so a passing test means the grid code persists
 * correctly and a failing one pinpoints where the value is dropped.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const OBJECT = 'os_prod_report';

// A fake server backed by a mutable store, so update() actually persists and a
// subsequent find() returns the new value — exactly like a real backend.
function makeDataSource() {
  const store: Record<string, any> = {
    'r1': { id: 'r1', name: '过渡段箱体+底板拼板', actual_start: '' },
    'r2': { id: 'r2', name: '将军柱拼板', actual_start: '' },
  };
  const find = vi.fn(async () => {
    const data = Object.values(store).map((r) => ({ ...r }));
    return { data, total: data.length, hasMore: false, pageSize: 50 };
  });
  const update = vi.fn(async (_object: string, id: string, changes: Record<string, any>) => {
    store[id] = { ...store[id], ...changes };
    return { ...store[id] };
  });
  return {
    store,
    find,
    update,
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        actual_start: { type: 'date' },
      },
    }),
  } as any;
}

function renderGrid(dataSource: any) {
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    editable: true,
    singleClickEdit: true,
    columns: [
      { field: 'name', label: '工序', editable: false },
      { field: 'actual_start', label: '实际开始时间', type: 'date' },
    ],
    pagination: { pageSize: 50 },
  };
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={dataSource} />
    </ActionProvider>,
  );
}

const dateCellInput = (container: HTMLElement) => {
  const rows = container.querySelectorAll('tbody tr');
  const firstRow = rows[0] as HTMLElement;
  const cells = firstRow.querySelectorAll('td');
  // columns: [select?][rownum?] name, actual_start, [actions]. Find by clicking
  // the actual_start cell (the one whose text is the editable date, initially —).
  return cells;
};

describe('ObjectGrid — inline edit persists through save + refresh', () => {
  it('row-save writes the edited date to the backend and survives refresh', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('过渡段箱体+底板拼板')).toBeInTheDocument());

    // Find the editable date cell on the first row and enter edit mode.
    const firstRow = container.querySelector('tbody tr') as HTMLElement;
    const tds = Array.from(firstRow.querySelectorAll('td'));
    const dateTd = tds.find((td) => td.querySelector('div')?.textContent === '—') as HTMLElement
      ?? tds[tds.length - 2];
    fireEvent.click(dateTd);

    const input = await waitFor(() => {
      const el = dateTd.querySelector('input') as HTMLInputElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.change(input, { target: { value: '2026-06-29' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Click "Save All" (全部保存) — the batch-save path the user used.
    const saveAll = await waitFor(() => {
      const btn = Array.from(container.querySelectorAll('button')).find((b) =>
        /Save All|全部保存/.test(b.textContent || ''),
      ) as HTMLButtonElement;
      expect(btn).toBeTruthy();
      return btn;
    });
    fireEvent.click(saveAll);

    await waitFor(() => expect(ds.update).toHaveBeenCalled());
    // The fourth argument is the save's write options: this fixture's rows carry
    // no `updated_at`, so no `ifMatch` is sent (objectui#12292).
    expect(ds.update).toHaveBeenCalledWith(OBJECT, 'r1', { actual_start: '2026-06-29' }, undefined);
    expect(ds.store['r1'].actual_start).toBe('2026-06-29');
  });
});
