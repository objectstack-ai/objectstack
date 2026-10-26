/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3951 — grid columns have ONE key spelling, and it is the declared
 * one: `name`, the key of `GridFieldMetadata['columns']` (`@object-ui/types`),
 * which is `@objectstack/spec`'s inline grid column by reference since
 * objectui#11070 — the same key the grid docs page and every `fields-grid`
 * catalog example author.
 *
 * `GridField` used to declare its own local column interface keyed by `field`
 * and read `c.field` everywhere — `key={c.field}`, `row[c.field]`,
 * `blank[c.field]`, `applyCell(rowIdx, col.field, …)`. Metadata authored
 * against the published type therefore rendered a grid with the right row
 * COUNT and every cell EMPTY, plus a React "unique key" warning for every
 * column (the key was `undefined`). The three demos on `/docs/fields/grid`
 * shipped in exactly that state.
 *
 * The fixtures below are typed as `GridFieldMetadata['columns']` on purpose:
 * the pin is anchored to the DECLARED contract, not to the widget's own idea
 * of it, so the two can never silently drift apart again. Per AGENTS.md #0.1 the fix is
 * one spelling at the producer — there is deliberately no `c.field ?? c.name`
 * alias to make the retired spelling keep working.
 *
 * Reverse verification: restore the reader to `c.field` and every case here
 * goes red — cell inputs read back `''` because `row[undefined]` is
 * `undefined`. The other half of the bug, the React missing-key warning, is
 * pinned in `GridField.keyWarning.test.tsx` rather than here: React emits that
 * warning only ONCE per owner component, so a second render inside this file
 * observes nothing and the assertion would pass for an empty reason. It needs
 * to own the first render of the file, hence its own file.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { GridFieldMetadata } from '@object-ui/types';
import { GridField } from './GridField';

/** Authored exactly as `GridFieldMetadata['columns']` declares — keyed by `name`. */
const columns: NonNullable<GridFieldMetadata['columns']> = [
  { name: 'product', label: 'Product', type: 'text' },
  { name: 'quantity', label: 'Qty', type: 'number' },
  { name: 'price', label: 'Price', type: 'currency' },
];

/** The `fields-grid/grid-with-data` catalog example's rows, verbatim. */
const rows = [
  { product: 'Widget A', quantity: 2, price: 29.99 },
  { product: 'Widget B', quantity: 1, price: 49.99 },
];

const field = { type: 'grid', name: 'order_items', columns } as GridFieldMetadata;

describe('GridField reads the DECLARED column spelling (objectui#3951)', () => {
  it('renders every cell populated from metadata authored as the declared column type', () => {
    render(<GridField value={rows} onChange={() => {}} field={field} />);

    // One cell input per column per row, each echoing the row's stored value —
    // this is the assertion the `field`-keyed reader could not satisfy.
    const products = screen.getAllByLabelText('Product') as HTMLInputElement[];
    const quantities = screen.getAllByLabelText('Qty') as HTMLInputElement[];
    const prices = screen.getAllByLabelText('Price') as HTMLInputElement[];

    expect(products[0].value).toBe('Widget A');
    expect(quantities[0].value).toBe('2');
    expect(prices[0].value).toBe('29.99');
    expect(products[1].value).toBe('Widget B');
    expect(quantities[1].value).toBe('1');
    expect(prices[1].value).toBe('49.99');

    // Not one empty cell across the authored rows (the ghost/new row is last
    // and is legitimately blank, so only the authored rows are checked).
    for (const cell of [...products.slice(0, 2), ...quantities.slice(0, 2), ...prices.slice(0, 2)]) {
      expect(cell.value).not.toBe('');
    }
  });

  it('the read-only surface shows the stored values, not blanks', () => {
    render(<GridField value={rows} onChange={() => {}} field={field} readonly />);
    expect(screen.getByText('Widget A')).toBeTruthy();
    expect(screen.getByText('Widget B')).toBeTruthy();
  });

  it('a blank row is keyed by the declared column names', () => {
    const onChange = vi.fn();
    render(<GridField value={[]} onChange={onChange} field={field} />);
    fireEvent.click(screen.getByRole('button', { name: /Add line/i }));
    expect(onChange).toHaveBeenCalledWith([{ product: null, quantity: null, price: null }]);
  });

  it('an edited cell writes back under the declared column name', () => {
    const onChange = vi.fn();
    render(<GridField value={[{ product: 'Widget A' }]} onChange={onChange} field={field} />);
    fireEvent.change((screen.getAllByLabelText('Qty') as HTMLInputElement[])[0], { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith([{ product: 'Widget A', quantity: 7 }]);
  });
});
