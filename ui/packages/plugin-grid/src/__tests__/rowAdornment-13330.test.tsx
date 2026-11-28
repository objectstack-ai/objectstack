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
  hostCells?: Record<string, (value: any, row: any) => React.ReactNode>;
  rowTint?: (row: any) => string | null | undefined;
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
          {...(opts.hostCells ? { hostCells: opts.hostCells } : {})}
          {...(opts.rowTint ? { rowTint: opts.rowTint } : {})}
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

/**
 * objectstack#36897 — `hostCells` (a host draws a column's cells, by field)
 * and `rowTint` (a host tints a row by a palette name), for a host whose rows
 * are not records of an object (the console's metadata list).
 */
describe('ObjectGrid hostCells and rowTint (objectstack#36897)', () => {
  const rowOf = async (text: string) => (await cellOf(text)).closest('tr') as HTMLElement;

  it('a column whose field the host draws shows the host node; the other columns keep their own cells', async () => {
    renderGrid({
      columns: [{ field: 'name' }, { field: 'notes' }],
      hostCells: { notes: (value, row) => <span data-testid={`host-${row.id}`}>{`[${String(value)}]`}</span> },
    });
    const host = await screen.findByTestId('host-r1');
    expect(host).toHaveTextContent('[Boiler room]');
    expect(host.closest('td')).toHaveTextContent(/^\[Boiler room\]$/);
    expect(screen.getByTestId('host-r2')).toHaveTextContent('[Loading dock]');
    // The name column is the grid's own cell, unchanged.
    expect(await cellOf('Plant A check')).toHaveTextContent(/^Plant A check$/);
  });

  it('a row the host tints carries the palette tint; a null answer and a name outside the palette tint nothing', async () => {
    renderGrid({
      columns: [{ field: 'name' }, { field: 'notes' }],
      rowTint: (row) => (row.id === 'r1' ? 'red' : 'bg-red-500'),
    });
    const tinted = await rowOf('Plant A check');
    expect(tinted.className).toContain('[--os-row-tint:var(--color-red-100)]');
    const plain = await rowOf('Plant B check');
    expect(plain.className).not.toContain('--color-red-100');
    expect(plain.className).not.toContain('bg-red-500');
  });

  it('CONTROL: without either prop every cell is the grid\'s own and no row is tinted', async () => {
    renderGrid({ columns: [{ field: 'name' }, { field: 'notes' }] });
    expect(await cellOf('Boiler room')).toHaveTextContent(/^Boiler room$/);
    expect((await rowOf('Plant A check')).className).not.toContain('--os-row-tint:var(');
  });
});
