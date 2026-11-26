/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #36806 — the line-item grid reads the hand lock. A child field's
 * `uiReadonlyWhen`, carried onto its column by `@object-ui/plugin-form`'s
 * column derivation, locks the cell on the rows its predicate is TRUE over
 * (with the parent header in scope, as `readonlyWhen`), and leaves the others
 * editable. (A `uiReadonly` child field never becomes a column at all: the
 * spec's `deriveInlineGridColumns` skips it, pinned in `@objectstack/spec`.)
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { GridFieldWidget as GridField } from './grid-field/GridFieldWidget';

describe('line-item grid hand lock (uiReadonlyWhen, #36806)', () => {
  const field = {
    columns: [
      { name: 'product', label: 'Product', type: 'text' as const },
      { name: 'qty', label: 'Qty', type: 'number' as const, uiReadonlyWhen: "parent.status != 'draft' || record.shipped == true" },
    ],
  } as any;

  it('locks the cell where the predicate is TRUE, per row and over the header', () => {
    render(
      <GridField
        value={[{ product: 'A', qty: 1, shipped: true }, { product: 'B', qty: 2, shipped: false }]}
        onChange={() => {}}
        field={field}
        contextRecord={{ status: 'draft' }}
      />,
    );
    const qty = screen.getAllByLabelText('Qty') as HTMLInputElement[];
    expect(qty[0].disabled).toBe(true);
    expect(qty[1].disabled).toBe(false);
    expect((screen.getAllByLabelText('Product')[0] as HTMLInputElement).disabled).toBe(false);
  });

  it('locks every row when the header makes the predicate TRUE', () => {
    render(
      <GridField
        value={[{ product: 'B', qty: 2, shipped: false }]}
        onChange={() => {}}
        field={field}
        contextRecord={{ status: 'approved' }}
      />,
    );
    expect((screen.getAllByLabelText('Qty')[0] as HTMLInputElement).disabled).toBe(true);
  });
});
