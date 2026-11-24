/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34601 — an editable table's foreign-key column is never drawn
 * narrower than the record picker needs.
 *
 * Its cells edit through the record picker, but its width was estimated from
 * the short names they draw ('Widget A' is 112px), so the picker's trigger got
 * a few dozen px and its open list cut every option. The auto-sized width of
 * such a column is floored at 168px, the width `GridField` gives its lookup
 * columns. Arithmetic only: happy-dom lays nothing out, so
 * the estimate reads the drawn text's length (8px a character plus 48px). The
 * pixels a browser lays out are the PR's live reading.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

function DataTable(props: { schema: Record<string, unknown> }) {
  const Impl = ComponentRegistry.get('data-table') as React.ComponentType<{ schema: unknown }> | undefined;
  if (!Impl) throw new Error('data-table not registered');
  return <Impl schema={props.schema} />;
}

const headerWidth = (label: string): string => {
  const th = Array.from(document.querySelectorAll('thead th')).find(
    (el) => (el.textContent ?? '').trim() === label,
  ) as HTMLElement | undefined;
  expect(th, `CONTROL: a "${label}" header rendered`).toBeTruthy();
  return th!.style.width;
};

/** A one-column table over a product lookup whose cell draws the product's short name. */
const schema = (table: Record<string, unknown>, column: Record<string, unknown>) => ({
  type: 'data-table',
  data: [{ id: '1', product: 'prod_7f3a' }],
  columns: [{ header: 'Product', accessorKey: 'product', cell: () => 'Widget A', ...column }],
  pagination: false,
  searchable: false,
  ...table,
});

afterEach(() => {
  cleanup();
});

describe('an editable foreign-key column is floored at the record picker width (objectstack#34601)', () => {
  it('is drawn at 168px, not at the 112px its short name needs', () => {
    render(<DataTable schema={schema({ editable: true }, { foreignKey: true })} />);
    expect(headerWidth('Product')).toBe('168px');
  });

  it('keeps the estimate where the column opens no picker', () => {
    // CONTROL: the same column, read-only table: 'Widget A' is 8 * 8 + 48.
    render(<DataTable schema={schema({}, { foreignKey: true })} />);
    expect(headerWidth('Product'), 'read-only table').toBe('112px');
    cleanup();
    render(<DataTable schema={schema({ editable: true }, {})} />);
    expect(headerWidth('Product'), 'editable table, not a foreign key').toBe('112px');
    cleanup();
    render(<DataTable schema={schema({ editable: true }, { foreignKey: true, editable: false })} />);
    expect(headerWidth('Product'), 'editable table, column that does not edit').toBe('112px');
  });

  it('leaves an estimate already past the floor, and an explicit width, as they are', () => {
    render(<DataTable schema={schema({ editable: true }, { foreignKey: true, cell: () => 'ObjectStack Platform (SMB Edition)' })} />);
    // 34 drawn characters: 34 * 8 + 48.
    expect(headerWidth('Product'), 'a wide name').toBe('320px');
    cleanup();
    render(<DataTable schema={schema({ editable: true }, { foreignKey: true, width: 90 })} />);
    expect(headerWidth('Product'), 'an explicit width is drawn as written').toBe('90px');
  });
});
