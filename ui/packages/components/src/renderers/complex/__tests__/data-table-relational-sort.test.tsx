/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression (objectui#3096): clicking a lookup column header sorted by the
 * `$expand`-ed RECORD OBJECT, not by the name in the cell.
 *
 * `aValue < bValue` is always false for two objects, so the comparator returned
 * the constant `1` for every pair — the rows moved (the arrow turned, the order
 * changed) but the resulting order had no relation to the names on screen. The
 * header sort now keys off the same display name the cell renders.
 *
 * The fixture is chosen so the three candidate orders are all distinct: the
 * incoming order and the foreign-key-id order are Mallory/Zoe/Alice, while the
 * displayed-name order is Alice/Mallory/Zoe. Only a sort that reads the label
 * can produce the assertions below.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

const rows = [
  { id: '1', code: 'C-1', owner: { id: 'rec_1a', name: 'Mallory' } },
  { id: '2', code: 'C-2', owner: { id: 'rec_4m', name: 'Zoe' } },
  { id: '3', code: 'C-3', owner: { id: 'rec_9z', name: 'Alice' } },
];

const schema = {
  data: rows,
  pagination: false,
  searchable: false,
  columns: [
    { header: 'Code', accessorKey: 'code' },
    {
      header: 'Owner',
      accessorKey: 'owner',
      // Mirrors the lookup cell renderer: the cell shows the related record's
      // name while the row value stays the expanded object.
      cell: (value: any) => <span>{value?.name ?? '—'}</span>,
    },
  ],
};

function renderTable() {
  const DataTable = ComponentRegistry.get('data-table') as any;
  if (!DataTable) throw new Error('data-table not registered');
  return render(<DataTable schema={schema} />);
}

/** Owner names in DOM row order. */
function ownerColumn(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1) // drop the header row
    .map((row) => within(row).getAllByRole('cell')[1]?.textContent?.trim() ?? '');
}

describe('data-table sorting a relational column', () => {
  beforeAll(() => {
    expect(ComponentRegistry.has('data-table')).toBe(true);
  });

  it('orders by the displayed name, ascending then descending', () => {
    renderTable();
    // Unsorted — and this is also the order the raw foreign-key ids produce,
    // so neither "no sort" nor "sorted by id" can satisfy the next assertion.
    expect(ownerColumn()).toEqual(['Mallory', 'Zoe', 'Alice']);
    expect([...rows].sort((a, b) => a.owner.id.localeCompare(b.owner.id)).map((r) => r.owner.name))
      .toEqual(['Mallory', 'Zoe', 'Alice']);

    fireEvent.click(screen.getByText('Owner'));
    expect(ownerColumn()).toEqual(['Alice', 'Mallory', 'Zoe']);

    fireEvent.click(screen.getByText('Owner'));
    expect(ownerColumn()).toEqual(['Zoe', 'Mallory', 'Alice']);
  });

  it('leaves a third click unsorted, back to the incoming row order', () => {
    renderTable();
    fireEvent.click(screen.getByText('Owner'));
    fireEvent.click(screen.getByText('Owner'));
    fireEvent.click(screen.getByText('Owner'));
    expect(ownerColumn()).toEqual(['Mallory', 'Zoe', 'Alice']);
  });

  it('still sorts a plain text column', () => {
    renderTable();
    fireEvent.click(screen.getByText('Code'));
    expect(ownerColumn()).toEqual(['Mallory', 'Zoe', 'Alice']);
    fireEvent.click(screen.getByText('Code'));
    expect(ownerColumn()).toEqual(['Alice', 'Zoe', 'Mallory']);
  });
});
