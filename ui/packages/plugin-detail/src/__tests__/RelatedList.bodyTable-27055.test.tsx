/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27055, Target 8 — a related list the default record page draws
 * as the record's BODY table (its relationship id in
 * `RecordBodyTablesContext`): the full table face, collapsible from its
 * title, ⤢ to enlarge in place, a totals line under its numeric columns, and
 * no 「查看全部」 footer. The same list outside the set keeps its own face.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { RelatedList } from '../RelatedList';
import { RecordBodyTablesContext, RelatedEnlargeContext } from '../relatedListCompact';

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

const fields = {
  name: { type: 'text', label: 'Product' },
  quantity: { type: 'number', label: 'Quantity' },
  total: { type: 'currency', label: 'Total', currencyConfig: { defaultCurrency: 'USD' } },
};
const rows = [
  { id: 'l1', name: 'Widget', quantity: 2, total: 20 },
  { id: 'l2', name: 'Gadget', quantity: 3, total: 45.5 },
];
const columns = [
  { field: 'name', label: 'Product' },
  { field: 'quantity', label: 'Quantity' },
  { field: 'total', label: 'Total' },
];

function renderList(body: boolean, onEnlarge?: (id: string) => void) {
  const list = (
    <RelatedList
      title="Line items"
      type="table"
      api="quote_line_item"
      objectName="quote_line_item"
      referenceField="quote"
      columns={columns}
      data={rows}
      onViewAll={vi.fn()}
      dataSource={{ find: vi.fn(async () => rows), getObjectSchema: vi.fn(async () => ({ name: 'quote_line_item', fields })) } as any}
    />
  );
  return render(
    <RecordBodyTablesContext.Provider value={new Set(body ? ['quote_line_item.quote'] : [])}>
      <RelatedEnlargeContext.Provider value={onEnlarge ?? null}>{list}</RelatedEnlargeContext.Provider>
    </RecordBodyTablesContext.Provider>,
  );
}

describe('RelatedList — the body-table face (objectstack#27055)', () => {
  it('draws the full table with a totals line and no View All', async () => {
    renderList(true);
    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument());
    expect(document.querySelector('thead')).not.toBeNull();
    const totals = document.querySelector('[data-body-table-totals]') as HTMLElement;
    expect(totals).toBeTruthy();
    expect(totals.querySelector('[data-body-table-total="quantity"]')?.textContent).toContain('5');
    expect(totals.querySelector('[data-body-table-total="total"]')?.textContent).toContain('65.50');
    // The text column is not totalled.
    expect(totals.querySelector('[data-body-table-total="name"]')).toBeNull();
    expect(screen.queryByText(/View all/i)).not.toBeInTheDocument();
  });

  it('collapses from its title and enlarges through ⤢', async () => {
    const onEnlarge = vi.fn();
    renderList(true, onEnlarge);
    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument());
    fireEvent.click(document.querySelector('[data-related-card-enlarge]')!);
    expect(onEnlarge).toHaveBeenCalledWith('quote_line_item.quote');
    fireEvent.click(screen.getByText('Line items'));
    await waitFor(() => expect(screen.queryByText('Widget')).not.toBeInTheDocument());
  });

  it('CONTROL — outside the set the list keeps its face: View All, no totals', async () => {
    renderList(false, vi.fn());
    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument());
    expect(document.querySelector('[data-body-table-totals]')).toBeNull();
    expect(document.querySelector('[data-related-card-enlarge]')).toBeNull();
    expect(screen.getByText(/View all/i)).toBeInTheDocument();
  });
});
