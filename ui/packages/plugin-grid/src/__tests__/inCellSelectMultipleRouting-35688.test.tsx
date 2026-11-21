/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35688 (S2), measured through the real `ObjectGrid` → `data-table`
 * path with the real `@object-ui/fields` editors: a `select` declared
 * `multiple` draws the check list in the cell editor, and each check only
 * stages. The edit is saved when the user moves on, as for `multiselect`.
 * A single `select` still saves on the pick (CONTROL).
 *
 * S3: a lookup cell opens its candidate list in place and a pick ends the
 * edit; on a select-first grid a rating is set by a digit, with no editor.
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

beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OBJECT = 'task_35688_s2';
const COLORS = [
  { label: 'Red', value: 'red' },
  { label: 'Green', value: 'green' },
  { label: 'Blue', value: 'blue' },
];

function makeDataSource() {
  const store: Record<string, any> = {
    r1: { id: 'r1', title: 'Design system', priority: 'high', colors: ['blue'], score: 2, tier: null },
  };
  return {
    find: vi.fn(async (objectName: string) => {
      if (objectName === 'tier_35688') {
        const tiers = [{ id: 'gold', name: 'Gold' }, { id: 'silver', name: 'Silver' }];
        return { data: tiers, total: tiers.length, hasMore: false, pageSize: 50 };
      }
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
            { label: 'High', value: 'high' },
          ],
        },
        colors: { type: 'select', multiple: true, label: 'Colors', options: COLORS },
        score: { type: 'rating', label: 'Score', max: 5 },
        tier: {
          type: 'lookup',
          label: 'Tier',
          reference: 'tier_35688',
          options: [
            { label: 'Gold', value: 'gold' },
            { label: 'Silver', value: 'silver' },
          ],
        },
      },
    }),
  } as any;
}

function renderGrid(cellSelection = false) {
  const ds = makeDataSource();
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    editable: true,
    singleClickEdit: true,
    columns: [
      { field: 'title', label: 'Title', type: 'text' },
      { field: 'priority', label: 'Priority', type: 'select' },
      { field: 'colors', label: 'Colors', type: 'select' },
      { field: 'score', label: 'Score', type: 'rating' },
      { field: 'tier', label: 'Tier', type: 'lookup' },
    ],
    pagination: { pageSize: 50 },
  };
  const utils = render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <div>
          <button data-testid="outside">outside</button>
          <ObjectGrid schema={schema} dataSource={ds} cellSelection={cellSelection || undefined} />
        </div>
      </SchemaRendererProvider>
    </ActionProvider>,
  );
  return { ...utils, ds };
}

/** The body cell under the header named `label`. */
function cellUnder(container: HTMLElement, label: string): HTMLElement {
  const headers = Array.from(container.querySelectorAll('thead th'));
  const at = headers.findIndex((th) => th.textContent?.trim().startsWith(label));
  expect(at).toBeGreaterThanOrEqual(0);
  return container.querySelectorAll('tbody tr')[0].querySelectorAll('td')[at] as HTMLElement;
}

// The grid batches edits (no `cellSelection`, so no per-cell autosave): what a
// pick wrote shows as the row's pending change, and nothing reaches `update`.
describe('ObjectGrid cell editor: a select declared multiple (objectstack#35688 S2)', () => {
  it('each check stages and the editor stays open; moving on closes it with every check', async () => {
    const { container } = renderGrid();
    await waitFor(() => expect(screen.getByText('Design system')).toBeInTheDocument());

    fireEvent.click(cellUnder(container, 'Colors'));
    await waitFor(() => expect(screen.getByTestId('in-cell-option-red')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('in-cell-option-red'));
    // Still open after the first check, with the check on.
    expect(screen.getByTestId('in-cell-option-green')).toBeInTheDocument();
    expect(screen.getByTestId('in-cell-option-red')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByTestId('in-cell-option-green'));
    expect(screen.getByTestId('in-cell-option-green')).toHaveAttribute('aria-selected', 'true');

    fireEvent.pointerDown(screen.getByTestId('outside'));
    await waitFor(() => expect(screen.queryByTestId('in-cell-option-red')).toBeNull());
    // This grid batches its edits: the row carries the three colours, pending.
    await waitFor(() => expect(screen.getByText(/1 row modified/)).toBeInTheDocument());
    const cell = cellUnder(container, 'Colors');
    for (const label of ['Blue', 'Red', 'Green']) expect(cell.textContent).toContain(label);
    expect(screen.queryByTestId('in-cell-option-red')).toBeNull();
  });

  it('CONTROL: a single select saves on the pick and closes', async () => {
    const { container } = renderGrid();
    await waitFor(() => expect(screen.getByText('Design system')).toBeInTheDocument());

    fireEvent.click(cellUnder(container, 'Priority'));
    await waitFor(() => expect(screen.getByTestId('in-cell-option-low')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('in-cell-option-low'));

    // The pick closes the editor, and the click that made it does not open it again.
    await waitFor(() => expect(screen.queryByTestId('in-cell-option-low')).toBeNull());
    await waitFor(() => expect(screen.getByText(/1 row modified/)).toBeInTheDocument());
    expect(cellUnder(container, 'Priority').textContent).toContain('Low');
  });
});

describe('ObjectGrid cell editor: lookups and ratings (objectstack#35688 S3)', () => {
  it('a lookup cell opens its candidate list in place; a pick ends the edit', async () => {
    const { container } = renderGrid();
    await waitFor(() => expect(screen.getByText('Design system')).toBeInTheDocument());

    fireEvent.click(cellUnder(container, 'Tier'));
    await waitFor(() => expect(screen.getByTestId('lookup-in-cell')).toBeInTheDocument());
    fireEvent.click(await screen.findByText('Silver'));

    await waitFor(() => expect(screen.queryByTestId('lookup-in-cell')).toBeNull());
    await waitFor(() => expect(screen.getByText(/1 row modified/)).toBeInTheDocument());
  });

  it('on a select-first grid a digit sets the rating and opens no editor', async () => {
    const { container, ds } = renderGrid(true);
    await waitFor(() => expect(screen.getByText('Design system')).toBeInTheDocument());

    fireEvent.click(cellUnder(container, 'Score'));
    const catcher = container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]')!;
    fireEvent.keyDown(catcher, { key: 'Enter' });
    expect(container.querySelector('[data-slot="cell-editor-overlay"]')).toBeNull();
    fireEvent.keyDown(catcher, { key: '4' });
    await waitFor(() => expect(ds.update).toHaveBeenCalled());
    expect(ds.update.mock.calls[0].slice(0, 3)).toEqual([OBJECT, 'r1', { score: 4 }]);
  });
});
