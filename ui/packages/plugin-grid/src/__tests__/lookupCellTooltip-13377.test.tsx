/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13377 — a reference cell's hover tooltip carried the raw id.
 *
 * `data-table`'s cell wrapper set `title` to `String(cellValue)`, and for a
 * `lookup` / `master_detail` column that value is the referenced record's id.
 * So hovering beside the drawn name, or beside "Restricted record"
 * (objectui#13335), showed the id the cell's text withholds. `ObjectGrid` now
 * stamps `foreignKey` on such a column and the table draws no tooltip for it.
 *
 * Driven through the real `ObjectGrid` with a readable and a restricted
 * reference in both a lookup and a master_detail column. The control is the
 * plain text column of the same grid, which keeps its value as its tooltip,
 * and a view column that authors `type: 'text'` over the lookup field: it draws
 * the id as its text, so the flag (read from the authored type first, like
 * `chips`) is not set and its tooltip stays.
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

const OBJECT = 'kb_article_13377';
const REFERENCED = 'kb_case_13377';
const RESTRICTED_ID = 'CASE-RESTRICTED-13377';
const READABLE = { id: 'CASE-READABLE-13377', name: 'Printer jam' };
const ROWS = [
  { id: 'a1', title: 'KA-0025', source_case: RESTRICTED_ID, parent_case: READABLE.id },
  { id: 'a2', title: 'KA-0026', source_case: READABLE.id, parent_case: RESTRICTED_ID },
];

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

/** The body cells under the header `label`, one per row. */
function cellsUnder(container: HTMLElement, label: string): HTMLElement[] {
  const headers = Array.from(container.querySelectorAll('thead th'));
  const index = headers.findIndex((th) => (th.textContent ?? '').trim() === label);
  expect(index, `CONTROL: a "${label}" header rendered`).toBeGreaterThanOrEqual(0);
  const cells = Array.from(container.querySelectorAll('tbody tr')).map((tr) => tr.children[index] as HTMLElement);
  expect(cells, `CONTROL: one "${label}" cell per row`).toHaveLength(ROWS.length);
  return cells;
}

/** Every `title` attribute inside a cell. */
const titlesIn = (cell: HTMLElement) =>
  Array.from(cell.querySelectorAll('[title]')).map((el) => el.getAttribute('title') ?? '');

async function renderGrid(extraColumns: Array<Record<string, unknown>> = []) {
  const ds = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length, hasMore: false, pageSize: 50 })),
    findOne: vi.fn(async (objectName: string, id: string) =>
      objectName === REFERENCED && id === READABLE.id ? READABLE : null,
    ),
    getObjectSchema: async (name: string) =>
      name === REFERENCED
        ? { name, fields: { id: { type: 'text' }, name: { type: 'text' } } }
        : {
            name,
            fields: {
              id: { type: 'text' },
              title: { type: 'text', label: 'Title' },
              source_case: { type: 'lookup', label: 'Source Case', reference: REFERENCED },
              parent_case: { type: 'master_detail', label: 'Parent Case', reference: REFERENCED },
            },
          },
  } as any;
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    data: ROWS,
    pagination: { pageSize: 50 },
    columns: [
      { field: 'title', label: 'Title' },
      { field: 'source_case', label: 'Source Case', type: 'lookup' },
      // No authored type: the flag comes from the object's declared type.
      { field: 'parent_case', label: 'Parent Case' },
      ...extraColumns,
    ],
  };
  const utils = render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <ObjectGrid schema={schema} dataSource={ds} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
  await waitFor(() => expect(screen.getAllByText('Printer jam')).toHaveLength(2), { timeout: 4000 });
  await waitFor(() => expect(screen.getAllByText('Restricted record')).toHaveLength(2), { timeout: 4000 });
  return utils;
}

describe('objectui#13377 — ObjectGrid: a reference cell draws no tooltip carrying the raw id', () => {
  it('a lookup and a master_detail cell, readable and restricted, carry no `title` with the id', async () => {
    const { container } = await renderGrid();
    for (const label of ['Source Case', 'Parent Case']) {
      for (const cell of cellsUnder(container, label)) {
        const titles = titlesIn(cell);
        expect(titles.some((t) => t.includes(RESTRICTED_ID)), `${label}: no tooltip shows the restricted id`).toBe(false);
        expect(titles.some((t) => t.includes(READABLE.id)), `${label}: no tooltip shows the readable id`).toBe(false);
        // The wrapper `data-table` owns, specifically: it carries no tooltip at all.
        const wrapper = cell.querySelector('[data-auto-width-key]');
        expect(wrapper, `CONTROL: ${label} has the table's cell wrapper`).not.toBeNull();
        expect(wrapper!.hasAttribute('title'), `${label}: the wrapper has no title`).toBe(false);
      }
    }
    // The ids are nowhere in the grid's DOM, text or attribute.
    expect(container.innerHTML).not.toContain(RESTRICTED_ID);
    expect(container.innerHTML).not.toContain(READABLE.id);
  });

  it('CONTROL — the plain text column of the same grid keeps its value as its tooltip', async () => {
    const { container } = await renderGrid();
    const [first, second] = cellsUnder(container, 'Title');
    expect(first!.querySelector('[data-auto-width-key]')?.getAttribute('title')).toBe('KA-0025');
    expect(second!.querySelector('[data-auto-width-key]')?.getAttribute('title')).toBe('KA-0026');
  });

  it('CONTROL — a view column authoring `type: \'text\'` over the lookup draws the id as text and keeps its tooltip', async () => {
    const { container } = await renderGrid([{ field: 'source_case', label: 'As Text', type: 'text' }]);
    const [first, second] = cellsUnder(container, 'As Text');
    expect(first!.textContent, 'CONTROL: the authored type draws the raw id').toBe(RESTRICTED_ID);
    expect(first!.querySelector('[data-auto-width-key]')?.getAttribute('title')).toBe(RESTRICTED_ID);
    expect(second!.querySelector('[data-auto-width-key]')?.getAttribute('title')).toBe(READABLE.id);
    // The lookup-typed column over the same field still carries none.
    for (const cell of cellsUnder(container, 'Source Case')) {
      expect(cell.querySelector('[data-auto-width-key]')!.hasAttribute('title')).toBe(false);
    }
  });
});
