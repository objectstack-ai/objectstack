/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11816, measured through the real `ObjectGrid` → `data-table` path
 * with the real `@object-ui/fields` editors — the shape the card was filed on
 * (showcase Tasks → Edit inline):
 *
 *  - opening a select cell and clicking away without choosing used to show
 *    "1 row modified · Save All (1)" for a row nobody changed;
 *  - with inline edit on, the grid drew TWO columns headed "Actions": its own
 *    row-menu column and the data-table's per-row cancel/save column.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
  // Radix select uses pointer capture; jsdom lacks these.
  if (!(Element.prototype as any).hasPointerCapture) {
    (Element.prototype as any).hasPointerCapture = () => false;
  }
  if (!(Element.prototype as any).setPointerCapture) {
    (Element.prototype as any).setPointerCapture = () => {};
  }
  if (!(Element.prototype as any).releasePointerCapture) {
    (Element.prototype as any).releasePointerCapture = () => {};
  }
});

// The row menu asks the record-level verdict endpoint; serve it from a double.
beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OBJECT = 'task_11816';

function makeDataSource() {
  const store: Record<string, any> = {
    r1: { id: 'r1', title: 'Design system', priority: 'high' },
  };
  return {
    find: vi.fn(async () => {
      const data = Object.values(store).map((r) => ({ ...r }));
      return { data, total: data.length, hasMore: false, pageSize: 50 };
    }),
    findOne: vi.fn(async (_o: string, id: string) => ({ ...store[id] })),
    update: vi.fn(async (_o: string, id: string, changes: Record<string, any>) => {
      store[id] = { ...store[id], ...changes };
      return { ...store[id] };
    }),
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        title: { type: 'text', label: 'Title' },
        priority: {
          type: 'select',
          label: 'Priority',
          options: [
            { label: 'Low', value: 'low' },
            { label: 'Medium', value: 'medium' },
            { label: 'High', value: 'high' },
          ],
        },
      },
    }),
  } as any;
}

function renderGrid() {
  const ds = makeDataSource();
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    editable: true,
    singleClickEdit: true,
    columns: [
      { field: 'title', label: 'Title', type: 'text' },
      { field: 'priority', label: 'Priority', type: 'select' },
    ],
    pagination: { pageSize: 50 },
  };
  const utils = render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <div>
          <button data-testid="outside">outside</button>
          {/* Row Edit/Delete handlers: the grid's own row-menu column exists. */}
          <ObjectGrid schema={schema} dataSource={ds} onEdit={() => {}} onDelete={() => {}} />
        </div>
      </SchemaRendererProvider>
    </ActionProvider>,
  );
  return { ...utils, ds };
}

const modified = () => screen.queryByText(/rows? modified/);

describe('ObjectGrid inline edit (objectui#11816)', () => {
  it('a select cell opened and left without a choice does not mark the row modified', async () => {
    const { container, ds } = renderGrid();
    await waitFor(() => expect(screen.getByText('Design system')).toBeInTheDocument());

    const row = container.querySelector('tbody tr') as HTMLElement;
    const priorityTd = Array.from(row.querySelectorAll('td')).find(
      (td) => td.textContent?.trim() === 'High',
    ) as HTMLElement;
    expect(priorityTd).toBeTruthy();
    fireEvent.click(priorityTd);
    // The select editor is open on the cell…
    await waitFor(() => expect(priorityTd.querySelector('[role="combobox"]')).toBeTruthy());

    // …and the user clicks away without choosing.
    fireEvent.pointerDown(screen.getByTestId('outside'));
    await waitFor(() => expect(priorityTd.querySelector('[role="combobox"]')).toBeNull());

    expect(modified()).toBeNull();
    expect(screen.queryByText(/Save All/)).toBeNull();
    expect(ds.update).not.toHaveBeenCalled();
  });

  it('draws one "Actions" column; the cancel/save column is headed by its own name', async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText('Design system')).toBeInTheDocument());

    expect(screen.getAllByRole('columnheader', { name: 'Actions' })).toHaveLength(1);
    expect(screen.getByRole('columnheader', { name: 'Edit' })).toBeInTheDocument();
  });
});
