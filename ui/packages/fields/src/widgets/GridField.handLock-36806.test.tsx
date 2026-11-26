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
        value={[{ id: 'l1', product: 'A', qty: 1, shipped: true }, { id: 'l2', product: 'B', qty: 2, shipped: false }]}
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
        value={[{ id: 'l2', product: 'B', qty: 2, shipped: false }]}
        onChange={() => {}}
        field={field}
        contextRecord={{ status: 'approved' }}
      />,
    );
    expect((screen.getAllByLabelText('Qty')[0] as HTMLInputElement).disabled).toBe(true);
  });

  // Contract delta S5: a create is not judged. A new line (no id) seeds only
  // the grid's columns, so an operand that is not a column (`status`, a
  // hand-locked child field) is absent and the fail-closed verdict would lock
  // the cell on every new line.
  it('does not judge uiReadonlyWhen on a new line, even when its operand is not a column', () => {
    render(
      <GridField
        value={[{ id: 'stored', product: 'A', qty: 1 }, { product: 'B', qty: null }]}
        onChange={() => {}}
        field={{
          columns: [
            { name: 'product', label: 'Product', type: 'text' },
            { name: 'qty', label: 'Qty', type: 'number', uiReadonlyWhen: "record.status != 'draft'" },
          ],
        } as any}
        contextRecord={{}}
      />,
    );
    const qty = screen.getAllByLabelText('Qty') as HTMLInputElement[];
    // The stored line has no `status`: judged, faulted, locked (fail-closed).
    expect(qty[0].disabled).toBe(true);
    // The new line is not judged: editable.
    expect(qty[1].disabled).toBe(false);
  });

  // REWORK S3(a): an authored column over a `uiReadonly` child field carries
  // `uiReadonly: true` (plugin-form's `hydrateColumns`), and the cell reads it.
  it('a column carrying uiReadonly locks every row', () => {
    render(
      <GridField
        value={[{ product: 'A', status: 'x' }]}
        onChange={() => {}}
        field={{
          columns: [
            { name: 'product', label: 'Product', type: 'text' },
            { name: 'status', label: 'Status', type: 'text', uiReadonly: true },
          ],
        } as any}
        contextRecord={{}}
      />,
    );
    expect((screen.getAllByLabelText('Status')[0] as HTMLInputElement).disabled).toBe(true);
    expect((screen.getAllByLabelText('Product')[0] as HTMLInputElement).disabled).toBe(false);
  });
});
