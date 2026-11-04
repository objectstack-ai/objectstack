/**
 * objectstack#30024 — under client-side sorting an explicit column honours its
 * FIELD's `sortable: false`.
 *
 * The grid's column generator has four paths. Paths B-D read the field's own
 * flag (`fieldDef?.sortable !== false`); path A, the explicit `columns` path,
 * read only the COLUMN's `sortable`. So a view listing a field its author
 * marked `sortable: false` still offered a sort click wherever the sort stays
 * in the browser (`manualSortingOn` off: inline rows).
 *
 * Seat ruling B: under client-side sorting the header reads the two author
 * flags (column and field), and the served projection judges only a sort that
 * leaves the browser (`withSortability`). That keeps the #3950 doctrine
 * (ObjectGrid's `withSortability` docblock, pinned by
 * `ObjectGrid.unmaterializedSort.test.tsx`): a client-side sort orders by the
 * value the cell shows, so a `formula` header stays live, even when a
 * projection that refuses it was served.
 *
 * Every negative cell sits beside a positive control on the same table.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { resolveObjectSortability } from '@objectstack/spec/api';
import { attachObjectSortability } from '@object-ui/core';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const OBJECT = {
  name: 'crm_opportunity',
  fields: {
    id: { type: 'text' },
    name: { type: 'text', label: 'Name' },
    amount: { type: 'currency', label: 'Amount' },
    internal_code: { type: 'text', label: 'Internal Code', sortable: false },
    expected_revenue: { type: 'formula', label: 'Expected Revenue', expression: 'amount * 2' },
  },
};

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    getObjectSchema: async () => {
      const schema = JSON.parse(JSON.stringify(OBJECT));
      attachObjectSortability(schema, resolveObjectSortability(OBJECT));
      return schema;
    },
  } as any;
}

function renderClientSortedGrid() {
  const ds = makeDataSource();
  const schema: any = {
    type: 'object-grid',
    objectName: 'crm_opportunity',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'amount', label: 'Amount' },
      { field: 'internal_code', label: 'Internal Code' },
      { field: 'expected_revenue', label: 'Expected Revenue' },
    ],
    // Inline rows: the sort never leaves the browser (`manualSortingOn` off).
    data: {
      provider: 'value',
      items: [
        { id: 'a', name: 'A', amount: 10, internal_code: 'Z-1', expected_revenue: 20 },
        { id: 'b', name: 'B', amount: 30, internal_code: 'A-9', expected_revenue: 60 },
      ],
    },
  };
  const utils = render(
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={ds} />
    </ActionProvider>,
  );
  return { ...utils, ds };
}

const headerCell = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll('thead th')).find((th) =>
    th.textContent?.trim() === label,
  ) as HTMLElement;

/** DataTable makes a sortable header `cursor-pointer`, and not an unsortable one. */
const offersSort = (th: HTMLElement) => th.className.includes('cursor-pointer');

describe('client-side sorting honours the field\'s own sortable: false (objectstack#30024)', () => {
  it('a column on a sortable: false field offers no sort, while a sortable sibling still does', async () => {
    const { container, ds } = renderClientSortedGrid();
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());
    // Wait for the object schema to land, so the field flag is what is read.
    await waitFor(() => expect(offersSort(headerCell(container, 'Internal Code'))).toBe(false));
    expect(offersSort(headerCell(container, 'Amount'))).toBe(true);
    expect(offersSort(headerCell(container, 'Name'))).toBe(true);
    // The sort is the browser's: no request was asked to order anything.
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('keeps the #3950 doctrine: the formula header stays live under client-side sorting, even with a refusing projection served', async () => {
    const served = resolveObjectSortability(OBJECT) as { fields: Record<string, any> };
    expect(served.fields.expected_revenue?.sortable).toBe(false);
    const { container } = renderClientSortedGrid();
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());
    await waitFor(() => expect(offersSort(headerCell(container, 'Internal Code'))).toBe(false));
    expect(offersSort(headerCell(container, 'Expected Revenue'))).toBe(true);
  });
});
