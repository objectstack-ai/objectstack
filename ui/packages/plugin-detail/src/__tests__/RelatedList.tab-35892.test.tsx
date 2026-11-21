/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35892 — the record page's related tab is the child object's
 * full list: the list page's condition row (`list-conditions`, through the
 * registry), its grid with the column menu, cell editing, selection and the
 * footer row, rows that load as the page scrolls, and 「Discard」 while the
 * reader changed anything. What they change holds for this visit to the
 * record: across a remount (another tab and back), not on another record.
 * The tab title's count is every child; a filter never changes it.
 */

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { RelatedList } from '../RelatedList';
import { RelatedListEnlargedContext, RelatedListTotalReportContext } from '../relatedListCompact';
import { resetRelatedTabConditionsForTests } from '../relatedTabConditions';

/** What `RelatedList` hands each `SchemaRenderer`, by node type. */
const h = vi.hoisted(() => ({ byType: {} as Record<string, { schema: any; props: any }> }));
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  function CapturingRenderer({ schema, ...props }: any) {
    h.byType[schema?.type] = { schema, props };
    if (schema?.type === 'list-conditions' && props.onDiscard) {
      return <button type="button" data-testid="condition-discard" onClick={props.onDiscard}>Discard</button>;
    }
    return null;
  }
  return { ...actual, SchemaRenderer: CapturingRenderer };
});

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1440 });
  // `plugin-list` registers it in the app; this package cannot import that one.
  if (!ComponentRegistry.has('list-conditions')) ComponentRegistry.register('list-conditions', () => null);
});

afterEach(() => {
  cleanup();
  h.byType = {};
  resetRelatedTabConditionsForTests();
});

const FIELDS = {
  name: { type: 'text', label: 'Name' },
  amount: { type: 'currency', label: 'Amount' },
  opportunity: { type: 'lookup', reference: 'opportunity', label: 'Opportunity' },
};
const ROWS = Array.from({ length: 12 }, (_, i) => ({ id: `q${i + 1}`, name: `Quote ${i + 1}`, amount: (i + 1) * 100, opportunity: 'O-1' }));

function dataSourceFor() {
  return {
    find: vi.fn(async (_object: string, params: any) => {
      const narrowed = JSON.stringify(params?.$filter ?? null).includes('amount');
      const rows = narrowed ? ROWS.filter((row) => row.amount > 600) : ROWS;
      return { data: rows.slice(params?.$skip ?? 0, (params?.$skip ?? 0) + (params?.$top ?? rows.length)), total: rows.length };
    }),
    getObjectSchema: vi.fn(async () => ({ name: 'quote', fields: FIELDS })),
  };
}

function Tab({ parentId = 'O-1', dataSource, onTotal, onRowDelete }: {
  parentId?: string;
  dataSource: ReturnType<typeof dataSourceFor>;
  onTotal?: (n: number) => void;
  onRowDelete?: (row: any) => Promise<void> | void;
}) {
  return (
    <RelatedListTotalReportContext.Provider value={onTotal}>
      <RelatedListEnlargedContext.Provider value>
        <RelatedList
          title="Quotes"
          type="table"
          api="quote"
          objectName="quote"
          referenceField="opportunity"
          parentId={parentId}
          pageSize={5}
          columns={[{ field: 'name', label: 'Name' }, { field: 'amount', label: 'Amount' }]}
          onRowDelete={onRowDelete}
          dataSource={dataSource as never}
        />
      </RelatedListEnlargedContext.Provider>
    </RelatedListTotalReportContext.Provider>
  );
}

const lastFind = (find: ReturnType<typeof vi.fn>) => find.mock.calls[find.mock.calls.length - 1][1];
const conditions = () => h.byType['list-conditions'];
const grid = () => h.byType['object-grid'];
const AMOUNT_OVER_600 = ['amount', '>', 600];
const AMOUNT_GROUP = { id: 'root', logic: 'and' as const, conditions: [{ id: 'r1', field: 'amount', operator: '>', value: 600 }] };

describe('the related tab is the child object\'s full list (objectstack#35892)', () => {
  it('draws the list page\'s condition row with the child object and the table\'s columns, and no Discard yet', async () => {
    render(<Tab dataSource={dataSourceFor()} />);
    await waitFor(() => expect(grid()?.schema.data.items).toHaveLength(12));
    expect(conditions().props).toMatchObject({ objectName: 'quote', shownFields: ['name', 'amount'], sort: [] });
    expect(conditions().props.objectDef?.fields).toEqual(FIELDS);
    expect(conditions().props).not.toHaveProperty('onDiscard');
    for (const key of ['sort', 'filters', 'onSortChange', 'onFiltersChange']) {
      expect(conditions().schema, `${key} is a host prop, never a node key`).not.toHaveProperty(key);
    }
  });

  it('hands the grid the list page\'s host keys: column menu, select-first cells, footer row, its query, selection', async () => {
    const onRowDelete = vi.fn();
    render(<Tab dataSource={dataSourceFor()} onRowDelete={onRowDelete} />);
    await waitFor(() => expect(grid()?.props.findParams).toBeDefined());
    expect(grid().props).toMatchObject({ headerMenu: true, cellSelection: true, residentSummaryRow: true, rowCount: 12 });
    expect(grid().props.findParams.$filter).toBeDefined();
    expect(typeof grid().props.onBulkDelete).toBe('function');
    expect(typeof grid().props.onColumnSummaryPick).toBe('function');
    expect(grid().schema).toHaveProperty('editable');
  });

  it('a filter reaches the query beside the parent scope; the tab title keeps every child, the footer the matches', async () => {
    const ds = dataSourceFor();
    const onTotal = vi.fn();
    render(<Tab dataSource={ds} onTotal={onTotal} />);
    await waitFor(() => expect(onTotal).toHaveBeenLastCalledWith(12));
    act(() => conditions().props.onFiltersChange(AMOUNT_GROUP, AMOUNT_OVER_600));
    await waitFor(() => expect(grid().schema.data.items).toHaveLength(6));
    const sent = JSON.stringify(lastFind(ds.find).$filter);
    expect(sent).toContain('opportunity');
    expect(sent).toContain('amount');
    expect(grid().props.rowCount).toBe(6);
    expect(onTotal).not.toHaveBeenCalledWith(6);
    expect(onTotal).toHaveBeenLastCalledWith(12);
  });

  it('a sort of several levels is one $orderby from the first row; a header pick leads it', async () => {
    const ds = dataSourceFor();
    render(<Tab dataSource={ds} />);
    await waitFor(() => expect(grid()?.schema.data.items).toHaveLength(12));
    act(() => conditions().props.onSortChange([
      { id: 'a', field: 'amount', order: 'desc' },
      { id: 'b', field: 'name', order: 'asc' },
    ]));
    await waitFor(() => expect(lastFind(ds.find).$orderby).toEqual([
      { field: 'amount', order: 'desc' },
      { field: 'name', order: 'asc' },
    ]));
    expect(lastFind(ds.find).$skip).toBe(0);
    act(() => grid().props.onSortChange([{ field: 'name', order: 'desc' }]));
    await waitFor(() => expect(lastFind(ds.find).$orderby).toEqual([
      { field: 'name', order: 'desc' },
      { field: 'amount', order: 'desc' },
    ]));
  });

  it('「Discard」 appears once something changed and puts the tab back', async () => {
    const ds = dataSourceFor();
    render(<Tab dataSource={ds} />);
    await waitFor(() => expect(grid()?.schema.data.items).toHaveLength(12));
    act(() => conditions().props.onFiltersChange(AMOUNT_GROUP, AMOUNT_OVER_600));
    fireEvent.click(await screen.findByTestId('condition-discard'));
    await waitFor(() => expect(grid().schema.data.items).toHaveLength(12));
    expect(screen.queryByTestId('condition-discard')).toBeNull();
    expect(JSON.stringify(lastFind(ds.find).$filter)).not.toContain('amount');
  });

  it('a footer calculation the reader picks rides back on its column, and counts as a change', async () => {
    render(<Tab dataSource={dataSourceFor()} />);
    await waitFor(() => expect(grid()?.schema.data.items).toHaveLength(12));
    act(() => grid().props.onColumnSummaryPick('amount', 'sum'));
    await waitFor(() => expect(grid().schema.columns).toEqual([{ field: 'name' }, { field: 'amount', summary: 'sum' }]));
    expect(conditions().props.onDiscard).toBeDefined();
  });

  it('holds across a remount on the same record (another tab and back), and is gone on another record', async () => {
    const ds = dataSourceFor();
    const first = render(<Tab dataSource={ds} />);
    await waitFor(() => expect(grid()?.schema.data.items).toHaveLength(12));
    act(() => conditions().props.onFiltersChange(AMOUNT_GROUP, AMOUNT_OVER_600));
    await waitFor(() => expect(grid().schema.data.items).toHaveLength(6));
    first.unmount();
    h.byType = {};
    const again = render(<Tab dataSource={ds} />);
    await waitFor(() => expect(grid()?.schema.data.items).toHaveLength(6));
    expect(conditions().props.filters).toEqual(AMOUNT_GROUP);
    again.unmount();
    h.byType = {};
    render(<Tab dataSource={ds} parentId="O-2" />);
    await waitFor(() => expect(grid()?.schema.data.items).toHaveLength(12));
    expect(conditions().props.filters.conditions).toEqual([]);
  });

  it('a filter that matches nothing says so, and the condition row stays to change it', async () => {
    const ds = dataSourceFor();
    ds.find.mockImplementation(async (_o: string, params: any) => (
      JSON.stringify(params?.$filter ?? null).includes('amount') ? { data: [], total: 0 } : { data: ROWS, total: ROWS.length }
    ));
    render(<Tab dataSource={ds} />);
    await waitFor(() => expect(grid()?.schema.data.items).toHaveLength(12));
    act(() => conditions().props.onFiltersChange(AMOUNT_GROUP, AMOUNT_OVER_600));
    await waitFor(() => expect(document.querySelector('[data-related-enlarged-empty]')?.textContent).toBe('No records match the filter'));
    expect(document.querySelector('[data-related-enlarged-conditions]')).not.toBeNull();
  });

  it('the bulk bar\'s delete asks once, counting the rows, then deletes each and reads again', async () => {
    const ds = dataSourceFor();
    const onRowDelete = vi.fn(async () => undefined);
    render(<Tab dataSource={ds} onRowDelete={onRowDelete} />);
    await waitFor(() => expect(grid()?.schema.data.items).toHaveLength(12));
    const reads = ds.find.mock.calls.length;
    act(() => grid().props.onBulkDelete(ROWS.slice(0, 3)));
    expect(await screen.findByText('Selected: 3. This cannot be undone.')).toBeInTheDocument();
    expect(onRowDelete).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('[data-related-bulk-delete-confirm]')!);
    await waitFor(() => expect(onRowDelete).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(ds.find.mock.calls.length).toBeGreaterThan(reads));
  });
});
