/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28865 (#27524 item 9) — on a desktop the ENLARGED related tab is
 * the child object's list face: `object-grid` over the rows this list read,
 * the branch the phone takes since objectstack#28484, never the generic
 * `data-table`.
 *
 * The list stays the source of truth: its window, page and sort reach the grid
 * on the grid's host channel (React props on `SchemaRenderer`, the ones
 * `plugin-list`'s `ListView` hands the same grid), its own pager stays the one
 * pager, and a row action the grid dispatches goes back to the host's
 * `onRowAction`. The count shows once.
 */

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { FilterScopeProvider } from '@object-ui/react';
import { RelatedList } from '../RelatedList';
import { RelatedListEnlargedContext } from '../relatedListCompact';

/**
 * Capture what `RelatedList` hands to `SchemaRenderer` — the node and the host
 * props beside it — and the action runner the grid would read there.
 */
const h = vi.hoisted(() => ({
  schema: null as any,
  props: null as any,
  execute: null as null | ((action: any) => Promise<any>),
}));
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  function CapturingRenderer({ schema, ...props }: any) {
    const actions = actual.useAction();
    h.schema = schema;
    h.props = props;
    h.execute = actions.execute;
    return null;
  }
  return { ...actual, SchemaRenderer: CapturingRenderer };
});

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1440 });
});

afterEach(() => {
  cleanup();
  h.schema = null;
  h.props = null;
  h.execute = null;
});

const FIELDS = {
  name: { type: 'text', label: 'Name' },
  amount: { type: 'currency', label: 'Amount' },
  account: { type: 'lookup', reference: 'account', label: 'Account' },
  owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner' },
};
const TOTAL = 30;
const ALL_ROWS = Array.from({ length: TOTAL }, (_, i) => ({
  id: `o${i + 1}`,
  name: `Deal ${i + 1}`,
  amount: (i + 1) * 1000,
  account: 'A-1',
  owner_id: i === 0 ? 'u-1' : 'u-2',
}));

function dataSourceFor() {
  return {
    find: vi.fn(async (_object: string, params: any) => {
      const mine = JSON.stringify(params?.$filter ?? null).includes('owner_id');
      const rows = mine ? ALL_ROWS.filter((row) => row.owner_id === 'u-1') : ALL_ROWS;
      const skip = params?.$skip ?? 0;
      const top = params?.$top ?? rows.length;
      return { data: rows.slice(skip, skip + top), total: rows.length };
    }),
    getObjectSchema: vi.fn(async () => ({ name: 'opportunity', fields: FIELDS })),
  };
}

const ROW_ACTIONS = [{ name: 'close_won', label: 'Close won', locations: ['record_related'] }];

function renderList({
  enlarged = true,
  onRowAction,
  onRowEdit,
  onRowDelete,
}: {
  enlarged?: boolean;
  onRowAction?: (...args: any[]) => any;
  onRowEdit?: (row: any) => void;
  onRowDelete?: (row: any) => void;
} = {}) {
  const dataSource = dataSourceFor();
  const utils = render(
    <FilterScopeProvider currentUserId="u-1">
      <RelatedListEnlargedContext.Provider value={enlarged}>
        <RelatedList
          title="Opportunities"
          type="table"
          api="opportunity"
          objectName="opportunity"
          referenceField="account"
          parentId="A-1"
          pageSize={25}
          columns={[{ field: 'name', label: 'Name' }, { field: 'amount', label: 'Amount' }, { field: 'owner_id', label: 'Owner' }]}
          rowActions={onRowAction ? (ROW_ACTIONS as never) : undefined}
          onRowAction={onRowAction as never}
          onRowEdit={onRowEdit}
          onRowDelete={onRowDelete}
          dataSource={dataSource as never}
        />
      </RelatedListEnlargedContext.Provider>
    </FilterScopeProvider>,
  );
  return { ...utils, dataSource };
}

const lastFind = (find: ReturnType<typeof vi.fn>) => find.mock.calls[find.mock.calls.length - 1][1];

describe('the enlarged related tab on a desktop is the child object list face (objectstack#28865)', () => {
  it('hands object-grid the page it read, with its columns, and turns off the grid’s own pager and search', async () => {
    renderList();
    await waitFor(() => expect(h.schema?.data?.items).toHaveLength(25));
    expect(h.schema.type).toBe('object-grid');
    expect(h.schema.objectName).toBe('opportunity');
    expect(h.schema.data.provider).toBe('value');
    expect(h.schema.data.items[0].id).toBe('o1');
    expect(h.schema.columns).toEqual(['name', 'amount', 'owner_id']);
    expect(h.schema.showPagination).toBe(false);
    expect(h.schema.showSearch).toBe(false);
  });

  it('drives the grid on its host channel: this list’s window, page and sort, never node keys', async () => {
    renderList();
    await waitFor(() => expect(h.props?.rowCount).toBe(TOTAL));
    expect(h.props).toMatchObject({ manualPagination: true, page: 1, pageSize: 25, sort: [] });
    expect(h.props.objectFields).toEqual(FIELDS);
    for (const key of ['manualPagination', 'rowCount', 'page', 'onPageChange', 'onSortChange', 'objectFields']) {
      expect(h.schema, `${key} rides the host channel, not the node`).not.toHaveProperty(key);
    }
  });

  it('a header sort from the grid is this list’s sort: one server $orderby, from the first page', async () => {
    const { dataSource } = renderList();
    await waitFor(() => expect(h.props?.rowCount).toBe(TOTAL));
    act(() => h.props.onSortChange([{ field: 'amount', order: 'desc' }]));
    await waitFor(() => expect(lastFind(dataSource.find).$orderby).toEqual([{ field: 'amount', order: 'desc' }]));
    expect(lastFind(dataSource.find).$skip).toBe(0);
    await waitFor(() => expect(h.props.sort).toEqual([{ field: 'amount', order: 'desc' }]));
  });

  it('a page from the grid is this list’s page: the next window is read from the server', async () => {
    const { dataSource } = renderList();
    await waitFor(() => expect(h.props?.rowCount).toBe(TOTAL));
    act(() => h.props.onPageChange(2));
    await waitFor(() => expect(lastFind(dataSource.find).$skip).toBe(25));
    await waitFor(() => expect(h.schema.data.items.map((row: any) => row.id)).toEqual(['o26', 'o27', 'o28', 'o29', 'o30']));
    expect(h.props.page).toBe(2);
    // This list's own pager is the one pager.
    expect(screen.getByText('Previous')).toBeInTheDocument();
  });

  it('DEVIATION, pinned: while the filter box has text the grid still gets this list’s sort on the host channel', async () => {
    // The list sorts its in-memory rows itself in this state (it read them
    // all). Handed as a HOST sort, the grid's manual-sort rule applies: it
    // offers no header sort on a relational column (`owner_id` here), whose
    // stored value is an id. The data-table this face drew before sorted that
    // column by its label in this one state.
    renderList();
    await waitFor(() => expect(h.props?.rowCount).toBe(TOTAL));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Deal 1' } });
    await waitFor(() => expect(h.props.rowCount).toBe(11));
    expect(h.props.manualPagination).toBe(true);
    expect(h.props.onSortChange).toEqual(expect.any(Function));
    expect(h.schema.data.items.every((row: any) => row.name.startsWith('Deal 1'))).toBe(true);
  });

  it('the count shows once: on the 全部 chip, not again on the line under the toolbar', async () => {
    renderList();
    await waitFor(() => expect(document.querySelector('[data-related-chip="all"]')?.textContent).toBe(`All${TOTAL}`));
    // The line keeps only the page; it no longer repeats the 30.
    expect(document.querySelector('[data-related-enlarged-status]')?.textContent).toBe('Page 1 of 2');
  });

  it('a chip that narrows keeps its own count on the line, a different number from 全部’s', async () => {
    renderList();
    await waitFor(() => expect(document.querySelector('[data-related-chip="all"]')?.textContent).toBe(`All${TOTAL}`));
    fireEvent.click(document.querySelector('[data-related-chip="mine"]')!);
    await waitFor(() => expect(document.querySelector('[data-related-enlarged-status]')?.textContent).toMatch(/^1 row/));
  });

  it('row actions: the host’s defs ride to the grid, and a dispatch from the grid reaches onRowAction with the row', async () => {
    const onRowAction = vi.fn(async () => undefined);
    renderList({ onRowAction });
    await waitFor(() => expect(h.schema?.data?.items).toHaveLength(25));
    expect(h.schema.rowActionDefs).toEqual(ROW_ACTIONS);
    const row = h.schema.data.items[2];
    // The grid's own dispatch shape (`objectGridActionsColumn` `onActionDef`).
    const result = await h.execute!({ name: 'close_won', label: 'Close won', params: { _rowRecord: row } });
    expect(onRowAction).toHaveBeenCalledTimes(1);
    expect(onRowAction).toHaveBeenCalledWith(ROW_ACTIONS[0], row);
    expect(result).toEqual({ success: true });
  });

  it('CONTROL: a dispatch that is not one of this list’s row actions reaches the surrounding runner', async () => {
    const onRowAction = vi.fn(async () => undefined);
    renderList({ onRowAction });
    await waitFor(() => expect(h.schema?.data?.items).toHaveLength(25));
    await h.execute!({ type: 'some_bulk_action', params: { records: [] } }).catch(() => undefined);
    await h.execute!({ name: 'not_ours', params: { _rowRecord: h.schema.data.items[0] } }).catch(() => undefined);
    expect(onRowAction).not.toHaveBeenCalled();
  });

  it('row Edit and Delete are this list’s: Edit hands the row on, Delete asks first', async () => {
    const onRowEdit = vi.fn();
    const onRowDelete = vi.fn();
    renderList({ onRowEdit, onRowDelete });
    await waitFor(() => expect(h.schema?.data?.items).toHaveLength(25));
    expect(h.props.onEdit).toBe(onRowEdit);
    act(() => h.props.onDelete(h.schema.data.items[0]));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(onRowDelete).not.toHaveBeenCalled();
  });

  it('CONTROL: a related list that is not enlarged keeps the data-table on a desktop, with no host props', async () => {
    renderList({ enlarged: false });
    await waitFor(() => expect(h.schema?.type).toBe('data-table'));
    expect(h.props).toEqual({});
  });
});

/**
 * objectstack#30033 — with no columns declared for the relation, the columns
 * come from the child's `highlightFields`, which by design never list the
 * record's title. The record's name (ADR-0079, `leadWithNameField` in
 * `@object-ui/core`) leads them, listed once; the grid auto-links its first
 * column to the record (`the auto-linked primary field gets the same anchor`
 * in `plugin-grid`'s `ObjectGrid.linkCellAnchor.test.tsx`). Authored columns
 * are left as authored.
 */
describe('the related table leads with the record name when no columns are declared (objectstack#30033)', () => {
  const NAMED_FIELDS = {
    name: { type: 'text', label: 'Name' },
    account: { type: 'lookup', reference: 'account', label: 'Account' },
    amount: { type: 'currency', label: 'Amount' },
    close_date: { type: 'date', label: 'Close date' },
    probability: { type: 'percent', label: 'Probability' },
  };
  const NAMED_ROWS = [
    { id: 'o1', name: 'Acme Renewal', account: 'A-1', amount: 120000, close_date: '2026-12-01', probability: 60 },
    { id: 'o2', name: 'Acme Expansion', account: 'A-1', amount: 75000, close_date: '2026-12-15', probability: 40 },
  ];

  function renderDerived({
    objectSchema,
    rows = NAMED_ROWS,
    columns,
    enlarged = true,
  }: {
    objectSchema: Record<string, unknown>;
    rows?: Record<string, unknown>[];
    columns?: any[];
    enlarged?: boolean;
  }) {
    const dataSource = {
      find: vi.fn(async () => ({ data: rows, total: rows.length })),
      getObjectSchema: vi.fn(async () => ({ name: 'opportunity', ...objectSchema })),
    };
    render(
      <FilterScopeProvider currentUserId="u-1">
        <RelatedListEnlargedContext.Provider value={enlarged}>
          <RelatedList
            title="Opportunities"
            type="table"
            api="opportunity"
            objectName="opportunity"
            referenceField="account"
            parentId="A-1"
            pageSize={25}
            {...(columns ? { columns } : {})}
            dataSource={dataSource as never}
          />
        </RelatedListEnlargedContext.Provider>
      </FilterScopeProvider>,
    );
  }

  const drawnKeys = (cols: any[]) => cols.map((c: any) => (typeof c === 'string' ? c : c.accessorKey));

  it('highlightFields that omit the name: the enlarged grid’s first column is the name, the highlights follow', async () => {
    renderDerived({
      objectSchema: { fields: NAMED_FIELDS, highlightFields: ['account', 'amount', 'close_date', 'probability'] },
    });
    await waitFor(() => expect(h.schema?.type).toBe('object-grid'));
    await waitFor(() => expect(h.schema.data.items).toHaveLength(2));
    // `account` is the key back to the parent record, so it is dropped as before.
    expect(h.schema.columns).toEqual(['name', 'amount', 'close_date', 'probability']);
  });

  it('a declared nameField that is not name-ish leads the same way', async () => {
    renderDerived({
      objectSchema: {
        nameField: 'deal_title',
        fields: { amount: NAMED_FIELDS.amount, deal_title: { type: 'text', label: 'Deal' } },
        highlightFields: ['amount'],
      },
      rows: [{ id: 'o1', deal_title: 'Acme Renewal', amount: 120000 }],
    });
    await waitFor(() => expect(h.schema?.data?.items).toHaveLength(1));
    expect(h.schema.columns).toEqual(['deal_title', 'amount']);
  });

  it('the name listed in highlightFields too shows once, first', async () => {
    renderDerived({
      objectSchema: { fields: NAMED_FIELDS, highlightFields: ['amount', 'close_date', 'name'] },
    });
    await waitFor(() => expect(h.schema?.data?.items).toHaveLength(2));
    expect(h.schema.columns).toEqual(['name', 'amount', 'close_date']);
  });

  it('CONTROL: columns declared on the relation are drawn exactly as declared, with no name added', async () => {
    renderDerived({
      objectSchema: { fields: NAMED_FIELDS, highlightFields: ['amount', 'close_date'] },
      columns: [{ field: 'amount', label: 'Amount' }, { field: 'probability', label: 'Probability' }],
    });
    await waitFor(() => expect(h.schema?.data?.items).toHaveLength(2));
    expect(h.schema.columns).toEqual(['amount', 'probability']);
  });

  it('the related table that is not enlarged reads the same column set: the name leads it too', async () => {
    renderDerived({
      objectSchema: { fields: NAMED_FIELDS, highlightFields: ['account', 'amount', 'close_date'] },
      enlarged: false,
    });
    await waitFor(() => expect(h.schema?.type).toBe('data-table'));
    await waitFor(() => expect(h.schema.data).toHaveLength(2));
    expect(drawnKeys(h.schema.columns)).toEqual(['name', 'amount', 'close_date']);
  });

  it('no highlightFields: a declared name leads the field walk too', async () => {
    renderDerived({
      objectSchema: {
        nameField: 'deal_title',
        fields: {
          status: { type: 'select', label: 'Status', options: [{ value: 'open', label: 'Open' }] },
          amount: NAMED_FIELDS.amount,
          deal_title: { type: 'text', label: 'Deal' },
        },
      },
      rows: [{ id: 'o1', status: 'open', amount: 120000, deal_title: 'Acme Renewal' }],
    });
    await waitFor(() => expect(h.schema?.data?.items).toHaveLength(1));
    expect(h.schema.columns[0]).toBe('deal_title');
    expect(h.schema.columns.filter((c: string) => c === 'deal_title')).toHaveLength(1);
  });

  it('a titleFormat object with no nameField: the column is the field the platform derives, not the formatted title', async () => {
    // `leadWithNameField` answers in field space: `titleFormat` is a
    // render-only template with no column behind it (ADR-0079), so the lead is
    // the type-aware derivation, here the first title-eligible field.
    renderDerived({
      objectSchema: {
        titleFormat: '{code} · {amount}',
        fields: { code: { type: 'text', label: 'Code' }, amount: NAMED_FIELDS.amount },
        highlightFields: ['amount'],
      },
      rows: [{ id: 'o1', code: 'Q-7', amount: 120000 }],
    });
    await waitFor(() => expect(h.schema?.data?.items).toHaveLength(1));
    expect(h.schema.columns).toEqual(['code', 'amount']);
  });
});
