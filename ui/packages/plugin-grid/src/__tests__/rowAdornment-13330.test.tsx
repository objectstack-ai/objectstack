/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13330 — `rowAdornment`, a host-drawn node beside one row's title.
 *
 * Pinned on the real ObjectGrid:
 *   - the node sits in the cell of the object's declared `nameField` when a
 *     column shows it, even when that column is not the first; else in the
 *     first shown column; never in another cell;
 *   - it is drawn AFTER the cell's own content, which stays as it was;
 *   - a row whose answer is `null` draws nothing;
 *   - in the card view it sits in the card's title.
 * Control: without the prop, no row carries a wrapper and every cell is what
 * it was.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const ORIGINAL_INNER_WIDTH = window.innerWidth;
const setWidth = (value: number) =>
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value });

afterEach(() => {
  cleanup();
  setWidth(ORIGINAL_INNER_WIDTH);
});

const FIELDS = {
  id: { type: 'text' },
  name: { type: 'text', label: 'Name' },
  notes: { type: 'text', label: 'Notes' },
};

const ROWS = [
  { id: 'r1', name: 'Plant A check', notes: 'Boiler room' },
  { id: 'r2', name: 'Plant B check', notes: 'Loading dock' },
];

/** Marks r1 only: r2's answer is `null`. */
const markFirst = (row: any) => (row.id === 'r1' ? <span data-testid="adornment">Flag</span> : null);

function renderGrid(opts: {
  columns: unknown[];
  objectExtra?: Record<string, unknown>;
  rowAdornment?: (row: any) => React.ReactNode;
  width?: number;
}) {
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: async (name: string) => ({ name, fields: FIELDS, ...(opts.objectExtra ?? {}) }),
  } as any;
  const schema: any = {
    type: 'object-grid',
    objectName: 'showcase_inspection',
    columns: opts.columns,
    pagination: { pageSize: 50 },
  };
  setWidth(opts.width ?? 1280);
  render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource}>
        <ObjectGrid
          schema={schema}
          dataSource={dataSource}
          {...(opts.rowAdornment ? { rowAdornment: opts.rowAdornment } : {})}
        />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/** The cell that draws `text`. */
async function cellOf(text: string): Promise<HTMLElement> {
  const at = await screen.findByText(text);
  const cell = at.closest('td');
  expect(cell).not.toBeNull();
  return cell as HTMLElement;
}

describe('ObjectGrid rowAdornment (objectui#13330)', () => {
  it('sits in the declared name field’s cell, though a column before it shows', async () => {
    renderGrid({ columns: [{ field: 'notes' }, { field: 'name' }], objectExtra: { nameField: 'name' }, rowAdornment: markFirst });
    await waitFor(async () => expect((await cellOf('Plant A check')).querySelector('[data-testid="adornment"]')).not.toBeNull());
    expect((await cellOf('Boiler room')).querySelector('[data-testid="adornment"]')).toBeNull();
    // After the cell's own content, which is unchanged.
    const cell = await cellOf('Plant A check');
    expect(cell).toHaveTextContent(/^Plant A check\s*Flag$/);
    // A row whose answer is null draws nothing.
    expect((await cellOf('Plant B check')).querySelector('[data-testid="adornment"]')).toBeNull();
    expect(screen.getAllByTestId('adornment')).toHaveLength(1);
  });

  it('sits in the first shown column when the object declares no name field', async () => {
    renderGrid({ columns: [{ field: 'notes' }, { field: 'name' }], rowAdornment: markFirst });
    await waitFor(async () => expect((await cellOf('Boiler room')).querySelector('[data-testid="adornment"]')).not.toBeNull());
    expect((await cellOf('Plant A check')).querySelector('[data-testid="adornment"]')).toBeNull();
  });

  it('sits in the card’s title in the card view', async () => {
    renderGrid({ columns: [{ field: 'notes' }, { field: 'name' }], objectExtra: { nameField: 'name' }, rowAdornment: markFirst, width: 390 });
    const titles = await screen.findAllByTestId('grid-card-title');
    expect(titles).toHaveLength(2);
    expect(titles[0]).toHaveTextContent('Plant A check');
    expect(titles[0].querySelector('[data-testid="adornment"]')).not.toBeNull();
    expect(titles[1].querySelector('[data-testid="adornment"]')).toBeNull();
  });

  it('CONTROL: without the prop no row carries a wrapper, and every cell is what it was', async () => {
    renderGrid({ columns: [{ field: 'notes' }, { field: 'name' }], objectExtra: { nameField: 'name' } });
    const cell = await cellOf('Plant A check');
    expect(cell).toHaveTextContent(/^Plant A check$/);
    expect(document.querySelector('[data-testid="grid-row-adornment"]')).toBeNull();
  });
});
