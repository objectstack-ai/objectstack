/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Regression coverage: auto-derived related-list columns must NOT lead with
 * system audit fields (created_at / updated_at / …). For a child object with no
 * name/title field (e.g. invoice lines), those system fields previously filled
 * the leading columns and pushed business columns (qty, price, amount) past the
 * column cap. System audit fields are now sorted last.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { RelatedList } from '../RelatedList';

/**
 * Desktop, pinned rather than inherited (objectui#8399). `RelatedList` reads
 * `useIsMobile` (breakpoint 768): above it a `type="table"` list renders a real
 * `data-table`, below it an `object-gallery` card layout with no headers, no
 * cells and no sort.
 *
 * Every case here reads the derived column ORDER through rendered headers.
 *
 * happy-dom's ambient `innerWidth` is 1024, so the desktop branch was inherited
 * here rather than chosen.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

// Read the column order straight off the schema handed to the renderer. This
// used to infer it from the row of sort buttons, which a `table` list no longer
// renders now that its column headers carry the sort (objectui#3106) — and
// which was always a proxy for the thing under test anyway.
const h = vi.hoisted(() => ({ schema: null as any }));
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    SchemaRenderer: (props: any) => {
      h.schema = props.schema;
      return null;
    },
  };
});

// Declare the system audit fields FIRST to reproduce the pre-fix ordering.
const fields = {
  created_at: { type: 'datetime', label: 'Created At' },
  updated_at: { type: 'datetime', label: 'Last Modified At' },
  created_by: { type: 'text', label: 'Created By' },
  updated_by: { type: 'text', label: 'Updated By' },
  product: { type: 'text', label: 'Product' },
  description: { type: 'text', label: 'Description' },
  quantity: { type: 'number', label: 'Qty' },
};

const makeDS = (rows: any[]) => ({
  find: vi.fn(async () => rows),
  getObjectSchema: vi.fn(async () => ({ name: 'line', fields })),
});

describe('RelatedList — system audit columns are deprioritized', () => {
  it('orders business columns before created_at / updated_at', async () => {
    const rows = [{
      id: 'l1', product: 'Widget', description: 'd', quantity: 2,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
      created_by: 'u', updated_by: 'u',
    }];
    render(
      <RelatedList
        title="Lines"
        type="table"
        api="line"
        objectName="line"
        referenceField="invoice"
        parentId="INV-1"
        sortable
        dataSource={makeDS(rows) as any}
      />,
    );

    const labels = await waitFor(() => {
      const texts = (h.schema?.columns ?? []).map((c: any) => String(c.header ?? '').trim());
      if (!texts.some((t: string) => t.includes('Product'))) throw new Error('columns not ready');
      return texts;
    });
    const idx = (s: string) => labels.findIndex((t: string) => t.includes(s));

    expect(idx('Product')).toBeGreaterThanOrEqual(0);
    // A business field must lead; any shown system audit column comes after it.
    if (idx('Created At') >= 0) expect(idx('Product')).toBeLessThan(idx('Created At'));
    if (idx('Last Modified At') >= 0) expect(idx('Product')).toBeLessThan(idx('Last Modified At'));
  });
});
