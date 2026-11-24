/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36618 — a multi-record lookup column in the line-item grid drew
 * "undefined" in the read-only table and in list mode.
 *
 * Both read-only sites rendered `LookupField` without the column's `multiple`,
 * so the stored id list was resolved as ONE id and the single-value face
 * printed its missing label. The editable cell always passed `multiple`; the
 * two read-only sites now pass it too, from the column, never from the value's
 * shape. One case per site; a single-record column is the control.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import * as React from 'react';
import { SchemaRendererContext } from '@object-ui/react';
import { GridFieldWidget as GridField } from './grid-field/GridFieldWidget';

const PRODUCTS = [
  { id: 'p1', name: 'Widget' },
  { id: 'p2', name: 'Gadget' },
];

function makeSource() {
  return {
    find: vi.fn(async (_object: string, params?: { $filter?: Record<string, any> }) => {
      const wanted = params?.$filter?.id?.$in as unknown[] | undefined;
      const rows = wanted ? PRODUCTS.filter((r) => wanted.includes(r.id)) : PRODUCTS;
      return { data: rows.map((r) => ({ ...r })), total: rows.length };
    }),
    findOne: vi.fn(async (_object: string, id: string) => {
      const row = PRODUCTS.find((r) => r.id === id);
      return row ? { ...row } : null;
    }),
  };
}

const multiColumn = { name: 'products', label: 'Products', type: 'lookup', reference: 'product', multiple: true };
const singleColumn = { name: 'product', label: 'Product', type: 'lookup', reference: 'product' };

function renderGrid(mode: 'read-only' | 'list', rows: any[], columns: any[]) {
  return render(
    <SchemaRendererContext.Provider value={{ dataSource: makeSource() } as never}>
      <GridField
        value={rows}
        onChange={() => {}}
        field={{ columns } as never}
        readonly={mode === 'read-only'}
        displayMode={mode === 'list' ? 'list' : undefined}
        onRowExpand={mode === 'list' ? () => {} : undefined}
      />
    </SchemaRendererContext.Provider>,
  );
}

afterEach(cleanup);

describe('a multi-record lookup column reads its records, not "undefined" (objectstack#36618)', () => {
  for (const mode of ['read-only', 'list'] as const) {
    it(`${mode}: a cell holding two product ids draws both product names`, async () => {
      const { container } = renderGrid(mode, [{ products: ['p1', 'p2'] }], [multiColumn]);
      expect(await screen.findByText('Widget')).toBeTruthy();
      expect(await screen.findByText('Gadget')).toBeTruthy();
      expect(container.textContent).not.toContain('undefined');
    });

    it(`${mode}: a single-record column still draws its one name (control)`, async () => {
      const { container } = renderGrid(mode, [{ product: 'p2' }], [singleColumn]);
      await waitFor(() => expect(screen.getByText('Gadget')).toBeTruthy());
      expect(screen.queryByText('Widget')).toBeNull();
      expect(container.textContent).not.toContain('undefined');
    });
  }
});
