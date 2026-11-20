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
 * title, ⤢ to enlarge in place, a totals row under its additive columns, and
 * no 「查看全部」 footer. The same list outside the set keeps its own face.
 *
 * objectstack#29943 — which columns the totals row adds up: a `currency`
 * column in one known currency, and a `number` column only when the record's
 * own object rolls it up with `sum`; an ordinal (`version_no`, `seq`) never.
 *
 * objectstack#35597 — the totals are the SERVER's, over every row of the list
 * (the parent's `summary` roll-up when it sums that column over the same rows,
 * else the data source's `aggregate` over the list's condition), drawn as the
 * table's own last row; never a sum of the rows on show. The row cap shows the
 * first rows and 「显示全部 N 条」 expands in place; 「↗」 opens the child's list;
 * an empty body table draws its headers and one empty row with the add entry.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { BODY_TABLE_DENSITY, RelatedList, bodyTableColumnsThatFit } from '../RelatedList';
import { RecordBodyTablesContext, RelatedEnlargeContext } from '../relatedListCompact';

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

/**
 * A server-side `aggregate` over `rows` — every row, whatever the list shows:
 * the spec-shape body (`aggregations`, optional `groupBy`) the record page
 * sends, answered the way `engine.aggregate` answers it.
 */
function serverAggregate(rows: readonly Record<string, unknown>[]) {
  return vi.fn(async (_resource: string, params: any) => {
    const sums = (subset: readonly Record<string, unknown>[]) =>
      Object.fromEntries(
        (params.aggregations as Array<{ field: string; alias: string }>).map((a) => [
          a.alias,
          subset.reduce((n, row) => n + Number(row[a.field] ?? 0), 0),
        ]),
      );
    if (Array.isArray(params.groupBy) && params.groupBy.length > 0) {
      const by = params.groupBy[0] as string;
      const buckets = new Map<unknown, Record<string, unknown>[]>();
      for (const row of rows) buckets.set(row[by], [...(buckets.get(row[by]) ?? []), row]);
      return [...buckets].map(([key, subset]) => ({ [by]: key, ...sums(subset) }));
    }
    return [sums(rows)];
  });
}

const summaryRow = () => document.querySelector('[data-testid="data-table-summary-row"]') as HTMLElement | null;
const summaryOf = (key: string) => document.querySelector(`[data-testid="data-table-summary-${key}"]`)?.textContent ?? null;

const fields = {
  name: { type: 'text', label: 'Product' },
  quantity: { type: 'number', label: 'Quantity' },
  total: { type: 'currency', label: 'Total', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' } },
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

function renderList(body: boolean, opts: {
  onEnlarge?: (id: string) => void;
  onViewAll?: () => void;
  onNew?: () => void;
  data?: any[];
  serverRows?: readonly Record<string, unknown>[];
  aggregate?: boolean;
  pageSize?: number;
} = {}) {
  const aggregate = serverAggregate(opts.serverRows ?? opts.data ?? rows);
  const list = (
    <RelatedList
      title="Line items"
      type="table"
      api="quote_line_item"
      objectName="quote_line_item"
      referenceField="quote"
      parentId="q1"
      columns={columns}
      data={opts.data ?? rows}
      pageSize={opts.pageSize}
      onViewAll={opts.onViewAll ?? vi.fn()}
      onNew={opts.onNew}
      dataSource={{
        find: vi.fn(async () => rows),
        getObjectSchema: vi.fn(async () => ({ name: 'quote_line_item', fields })),
        ...(opts.aggregate === false ? {} : { aggregate }),
      } as any}
    />
  );
  render(
    <RecordBodyTablesContext.Provider value={new Set(body ? ['quote_line_item.quote'] : [])}>
      <RelatedEnlargeContext.Provider value={opts.onEnlarge ?? null}>{list}</RelatedEnlargeContext.Provider>
    </RecordBodyTablesContext.Provider>,
  );
  return { aggregate };
}

describe('RelatedList — the body-table face (objectstack#27055, objectstack#35597)', () => {
  it('draws the full table with the server totals as its last row, and no View All footer', async () => {
    const { aggregate } = renderList(true);
    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument());
    expect(document.querySelector('thead')).not.toBeNull();
    await waitFor(() => expect(summaryOf('total')).toContain('$65.50'));
    // The text column is not totalled, nor a number column no roll-up declares
    // additive (objectstack#29943).
    expect(summaryOf('quantity')).toBeNull();
    expect(summaryOf('name')).toBeNull();
    expect(screen.queryByText(/View all/i, { selector: 'button:not([data-body-table-open-list])' })).not.toBeInTheDocument();
    // One aggregate over the list's condition: the parent relationship.
    expect(aggregate).toHaveBeenCalledWith('quote_line_item', {
      aggregations: [{ function: 'sum', field: 'total', alias: 'total' }],
      where: { quote: 'q1' },
    });
  });

  it('the total is the server\'s over EVERY row, not the rows on show (row cap 1 of 3)', async () => {
    const all = [...rows, { id: 'l3', name: 'Gizmo', quantity: 1, total: 100 }];
    renderList(true, { data: all, pageSize: 1 });
    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument());
    expect(screen.queryByText('Gadget')).not.toBeInTheDocument();
    await waitFor(() => expect(summaryOf('total')).toContain('$165.50'));
  });

  it('past its row cap it offers 「显示全部 N 条」 instead of pages, and expands in place', async () => {
    const all = [...rows, { id: 'l3', name: 'Gizmo', quantity: 1, total: 100 }];
    renderList(true, { data: all, pageSize: 2 });
    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument());
    expect(screen.queryByText('Gizmo')).not.toBeInTheDocument();
    const showAll = document.querySelector('[data-body-table-show-all]') as HTMLElement;
    expect(showAll.textContent).toContain('3');
    expect(screen.queryByText(/Next/i)).not.toBeInTheDocument();
    fireEvent.click(showAll);
    await waitFor(() => expect(screen.getByText('Gizmo')).toBeInTheDocument());
    expect(document.querySelector('[data-body-table-show-all]')).toBeNull();
  });

  it('CONTROL — within its row cap there is nothing to show all', async () => {
    renderList(true, { pageSize: 10 });
    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument());
    expect(document.querySelector('[data-body-table-show-all]')).toBeNull();
  });

  it('↗ opens the child list under this record (the host\'s onViewAll)', async () => {
    const onViewAll = vi.fn();
    renderList(true, { onViewAll });
    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument());
    fireEvent.click(document.querySelector('[data-body-table-open-list]')!);
    expect(onViewAll).toHaveBeenCalledTimes(1);
  });

  it('an empty body table draws its headers and one empty row with the add entry', async () => {
    const onNew = vi.fn();
    renderList(true, { data: [], onNew });
    const empty = await waitFor(() => {
      const el = document.querySelector('[data-body-table-empty]') as HTMLElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    expect(Array.from(empty.querySelectorAll('th')).map((th) => th.textContent)).toEqual(['Product', 'Quantity', 'Total']);
    expect(empty.querySelectorAll('[data-body-table-empty-row]')).toHaveLength(1);
    fireEvent.click(empty.querySelector('[data-body-table-empty-add]')!);
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('a data source with no aggregate draws no totals — never a client sum of the rows', async () => {
    renderList(true, { aggregate: false });
    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument());
    expect(summaryRow()).toBeNull();
  });

  it('collapses from its title and enlarges through ⤢', async () => {
    const onEnlarge = vi.fn();
    renderList(true, { onEnlarge });
    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument());
    fireEvent.click(document.querySelector('[data-related-card-enlarge]')!);
    expect(onEnlarge).toHaveBeenCalledWith('quote_line_item.quote');
    fireEvent.click(screen.getByText('Line items'));
    await waitFor(() => expect(screen.queryByText('Widget')).not.toBeInTheDocument());
  });

  it('CONTROL — outside the set the list keeps its face: View All, no totals, no ↗', async () => {
    const { aggregate } = renderList(false, { onEnlarge: vi.fn() });
    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument());
    expect(summaryRow()).toBeNull();
    expect(aggregate).not.toHaveBeenCalled();
    expect(document.querySelector('[data-related-card-enlarge]')).toBeNull();
    expect(document.querySelector('[data-body-table-open-list]')).toBeNull();
    expect(screen.getByText(/View all/i)).toBeInTheDocument();
    // objectstack#29945 — every data-table header, not only a body table's,
    // carries its whole label for a hover the ellipsis would cut.
    expect(document.querySelector('thead th span[title="Quantity"]')?.textContent).toBe('Quantity');
  });
});

/**
 * objectstack#29943 — the totals row adds up only the columns something
 * declared additive. The fixtures are hotclm's: a contract's versions
 * (`version_no`, an ordinal) and its payment plan (`seq`, an ordinal, beside
 * two amounts). objectstack#35597 — each figure is the server's.
 */
describe('RelatedList — which body-table columns are totalled (objectstack#29943)', () => {
  const planFields = {
    name: { type: 'text', label: 'Instalment' },
    seq: { type: 'number', label: 'Seq', scale: 0 },
    version_no: { type: 'integer', label: 'Version' },
    planned_amount: { type: 'number', label: 'Planned', scale: 2 },
    fee: { type: 'currency', label: 'Fee', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' } },
    paid: { type: 'currency', label: 'Paid', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
    dynamic_fee: { type: 'currency', label: 'Dynamic fee' },
    currency_code: { type: 'text', label: 'Currency' },
    contract: { type: 'master_detail', label: 'Contract', reference: 'clm_contract' },
  };
  const planRows = [
    { id: 'p1', name: 'First', seq: 1, version_no: 1, planned_amount: 1000, fee: 10, paid: 100, dynamic_fee: 1, currency_code: 'EUR' },
    { id: 'p2', name: 'Second', seq: 2, version_no: 2, planned_amount: 2000.5, fee: 20.25, paid: 200, dynamic_fee: 2, currency_code: 'EUR' },
    { id: 'p3', name: 'Third', seq: 3, version_no: 3, planned_amount: 380000, fee: 30, paid: 300, dynamic_fee: 3, currency_code: 'EUR' },
  ];
  const contract = (fields: Record<string, unknown>, data: Record<string, unknown> = {}) => ({ name: 'clm_contract', fields, data });
  const rollUp = (fn: string, field: string, object = 'clm_payment_plan', extra: Record<string, unknown> = {}) => ({
    type: 'summary',
    summaryOperations: { object, field, function: fn, ...extra },
  });

  function renderPlan(opts: {
    columns: string[];
    rows?: readonly Record<string, unknown>[];
    parent?: { name: string; fields: unknown; data?: Record<string, unknown> };
    tenantCurrency?: string;
    filter?: Record<string, unknown>;
    referenceField?: string;
    childFields?: Record<string, unknown>;
  }) {
    const rows = opts.rows ?? planRows;
    const aggregate = serverAggregate(rows);
    const referenceField = opts.referenceField ?? 'contract';
    const childFields = opts.childFields ?? planFields;
    const list = (
      <RecordBodyTablesContext.Provider value={new Set([`clm_payment_plan.${referenceField}`])}>
        <RelatedList
          title="Payment plan"
          type="table"
          api="clm_payment_plan"
          objectName="clm_payment_plan"
          referenceField={referenceField}
          parentId="c1"
          filter={opts.filter as any}
          columns={opts.columns.map((field) => ({ field, label: (childFields as any)[field].label }))}
          data={rows as any[]}
          dataSource={{ find: vi.fn(async () => rows), aggregate, getObjectSchema: vi.fn(async () => ({ name: 'clm_payment_plan', fields: childFields })) } as any}
        />
      </RecordBodyTablesContext.Provider>
    );
    const withParent = opts.parent ? (
      <RecordContextProvider objectName={opts.parent.name} recordId="c1" objectSchema={opts.parent} data={{ id: 'c1', ...(opts.parent.data ?? {}) }}>
        {list}
      </RecordContextProvider>
    ) : (
      list
    );
    const { unmount } = render(
      opts.tenantCurrency ? (
        <LocalizationProvider value={{ currency: opts.tenantCurrency }}>{withParent}</LocalizationProvider>
      ) : (
        withParent
      ),
    );
    return { aggregate, unmount };
  }

  /** Waits for the aggregate reads to settle, then reads the row. */
  async function settled(aggregate: ReturnType<typeof serverAggregate>) {
    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());
    await Promise.all(aggregate.mock.results.map((r) => r.value));
    await new Promise((r) => setTimeout(r, 0));
  }

  it('totals no ordinal column — and draws no row when nothing else adds up', async () => {
    const { aggregate } = renderPlan({ columns: ['name', 'seq', 'version_no'], parent: contract({}) });
    await settled(aggregate);
    expect(summaryRow()).toBeNull();
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('CONTROL — a currency column beside the ordinals still totals, in its own currency', async () => {
    renderPlan({ columns: ['name', 'seq', 'fee'], parent: contract({}) });
    await waitFor(() => expect(summaryOf('fee')).toContain('€60.25'));
    expect(summaryOf('seq')).toBeNull();
  });

  it('totals a number column the parent rolls up with sum, from the server', async () => {
    renderPlan({
      columns: ['name', 'seq', 'planned_amount'],
      parent: contract({ planned_total: rollUp('sum', 'planned_amount') }),
    });
    await waitFor(() => expect(summaryOf('planned_amount')).toContain('383,000.5'));
    // The roll-up names one column; the ordinal beside it stays untotalled.
    expect(summaryOf('seq')).toBeNull();
  });

  it("reads the parent's stored roll-up when it sums the same rows — no aggregate is asked", async () => {
    const { aggregate } = renderPlan({
      columns: ['name', 'planned_amount'],
      parent: contract({ planned_total: rollUp('sum', 'planned_amount') }, { planned_total: 7 }),
    });
    await waitFor(() => expect(summaryOf('planned_amount')).toBe('7'));
    expect(aggregate).not.toHaveBeenCalled();
  });

  // A child with TWO keys to the parent, the second a lookup: a roll-up with
  // no `relationshipField` sums through the one the engine picks — the FIRST
  // (`ObjectQL.buildSummaryIndex`) — so its stored figure is that list's total
  // and never the other list's.
  const twoKeyFields = {
    ...planFields,
    renewal_of: { type: 'lookup', label: 'Renewal of', reference: 'clm_contract' },
  };

  it("a two-key child, roll-up with no relationshipField: the engine's key reads the stored roll-up, the other key asks the server", async () => {
    const parent = contract({ planned_total: rollUp('sum', 'planned_amount') }, { planned_total: 7 });
    const picked = renderPlan({ columns: ['name', 'planned_amount'], childFields: twoKeyFields, parent });
    await waitFor(() => expect(summaryOf('planned_amount')).toBe('7'));
    expect(picked.aggregate).not.toHaveBeenCalled();
    picked.unmount();

    const other = renderPlan({ columns: ['name', 'planned_amount'], childFields: twoKeyFields, referenceField: 'renewal_of', parent });
    await waitFor(() => expect(summaryOf('planned_amount')).toContain('383,000.5'));
    expect(other.aggregate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(other.aggregate.mock.calls[0][1].where)).toContain('renewal_of');
  });

  it('CONTROL — a roll-up naming the second key is that list\'s total', async () => {
    const { aggregate } = renderPlan({
      columns: ['name', 'planned_amount'],
      childFields: twoKeyFields,
      referenceField: 'renewal_of',
      parent: contract({ planned_total: rollUp('sum', 'planned_amount', 'clm_payment_plan', { relationshipField: 'renewal_of' }) }, { planned_total: 7 }),
    });
    await waitFor(() => expect(summaryOf('planned_amount')).toBe('7'));
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('CONTROL — a roll-up with its own filter is not this list\'s total: the server aggregates the list', async () => {
    const { aggregate } = renderPlan({
      columns: ['name', 'planned_amount'],
      parent: contract({ planned_total: rollUp('sum', 'planned_amount', 'clm_payment_plan', { filter: { seq: { $gt: 1 } } }) }, { planned_total: 7 }),
    });
    await waitFor(() => expect(summaryOf('planned_amount')).toContain('383,000.5'));
    expect(aggregate).toHaveBeenCalledTimes(1);
  });

  it("CONTROL — a list with its own filter asks the server over that condition, not the parent's roll-up", async () => {
    const { aggregate } = renderPlan({
      columns: ['name', 'planned_amount'],
      filter: { seq: { $gt: 1 } },
      parent: contract({ planned_total: rollUp('sum', 'planned_amount') }, { planned_total: 7 }),
    });
    await waitFor(() => expect(aggregate).toHaveBeenCalledTimes(1));
    const where = aggregate.mock.calls[0][1].where;
    // The parent relationship AND the list's own filter.
    expect(JSON.stringify(where)).toContain('contract');
    expect(JSON.stringify(where)).toContain('seq');
  });

  it('reads the roll-up in the array-shaped field container too', async () => {
    renderPlan({
      columns: ['name', 'planned_amount'],
      parent: contract([{ name: 'planned_total', ...rollUp('sum', 'planned_amount') }] as any),
    });
    await waitFor(() => expect(summaryOf('planned_amount')).toContain('383,000.5'));
  });

  it('CONTROL — the same number column without a sum roll-up is not totalled', async () => {
    for (const parent of [
      undefined, // no record page in scope at all
      contract({}),
      contract({ instalments: rollUp('count', 'planned_amount') }),
      contract({ planned_max: rollUp('max', 'planned_amount') }),
      contract({ other_total: rollUp('sum', 'planned_amount', 'clm_invoice') }),
    ]) {
      const { aggregate, unmount } = renderPlan({ columns: ['name', 'planned_amount'], parent });
      await settled(aggregate);
      expect(summaryRow()).toBeNull();
      unmount();
    }
  });

  it('a record-mode amount is grouped by its code on the server, and totals in the one currency', async () => {
    const { aggregate } = renderPlan({ columns: ['name', 'paid'], parent: contract({}) });
    await waitFor(() => expect(summaryOf('paid')).toContain('€600.00'));
    expect(aggregate.mock.calls[0][1].groupBy).toEqual(['currency_code']);
  });

  it('mixed-currency rows get no total', async () => {
    const rows = planRows.map((row, i) => ({ ...row, currency_code: i === 1 ? 'USD' : 'EUR' }));
    const { aggregate } = renderPlan({ columns: ['name', 'paid'], rows, parent: contract({}) });
    await settled(aggregate);
    expect(summaryRow()).toBeNull();
  });

  it('a row whose currency is unknown gets no total, not a bare sum', async () => {
    const rows = planRows.map((row, i) => ({ ...row, currency_code: i === 2 ? '' : 'EUR' }));
    const { aggregate } = renderPlan({ columns: ['name', 'paid'], rows, parent: contract({}) });
    await settled(aggregate);
    expect(summaryRow()).toBeNull();
  });

  it('a dynamic amount totals in the tenant default currency', async () => {
    renderPlan({ columns: ['name', 'dynamic_fee'], parent: contract({}), tenantCurrency: 'CNY' });
    await waitFor(() => expect(summaryOf('dynamic_fee')).toMatch(/CN¥|¥/));
    expect(summaryOf('dynamic_fee')).toContain('6.00');
  });

  // objectstack#35710 — with no currency resolving the column's cells still
  // draw as amounts (two places, no symbol); the total is the same server
  // figure drawn the same way, never a missing last row.
  it('with no currency resolving, the total is the server figure drawn as its cells are: an amount, no symbol', async () => {
    const { aggregate } = renderPlan({ columns: ['name', 'dynamic_fee'], parent: contract({}) });
    await waitFor(() => expect(summaryOf('dynamic_fee')).not.toBeNull());
    expect(summaryOf('dynamic_fee')).toMatch(/(^|\D)6\.00$/);
    expect(summaryOf('dynamic_fee')).not.toMatch(/[$€¥£]|[A-Z]{3}/);
    expect(aggregate.mock.calls[0][1].aggregations).toEqual([{ function: 'sum', field: 'dynamic_fee', alias: 'dynamic_fee' }]);
    expect(aggregate.mock.calls[0][1].groupBy ?? []).toEqual([]);
  });
});

/**
 * objectstack#29945 — a body table wider than the details column it sits in
 * (ADR-0085 keeps it there) says so, and ⤢ is offered in words. A table that
 * fits shows none of it.
 *
 * objectstack#35742 — never a half-cut column: the table draws the leading
 * run of its columns, in their priority order, that fits whole in the column,
 * and leaves the rest to ⤢ 「全部列」. Only a table whose FIRST column is wider
 * than the box still scrolls inside it, that column pinned as the row's
 * identity, with the table's right-edge shadow (objectstack#29945).
 *
 * jsdom lays nothing out, so the scroll box's widths are stubbed: each drawn
 * column header is 120 px of scroll width inside a details column of
 * `detailsPx` (680 px unless a case narrows it). The width each column asks
 * for is the inline width the table gives its header.
 */
describe('RelatedList — a body table wider than its column (objectstack#29945, objectstack#35742)', () => {
  const COLUMN_PX = 120;
  let detailsPx = 680;
  const proto = HTMLElement.prototype;
  const saved = {
    scrollWidth: Object.getOwnPropertyDescriptor(proto, 'scrollWidth'),
    clientWidth: Object.getOwnPropertyDescriptor(proto, 'clientWidth'),
  };
  beforeAll(() => {
    Object.defineProperty(proto, 'scrollWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-table-scroll-box') ? this.querySelectorAll('thead th').length * COLUMN_PX : 0;
      },
    });
    Object.defineProperty(proto, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-table-scroll-box') ? detailsPx : 0;
      },
    });
  });
  afterAll(() => {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(proto, key, descriptor);
      else delete (proto as any)[key];
    }
  });
  afterEach(() => {
    detailsPx = 680;
  });

  const wideFields: Record<string, { type: string; label: string }> = {
    name: { type: 'text', label: 'Version' },
    file: { type: 'text', label: 'File' },
    submitter: { type: 'text', label: 'Submitter' },
    owner: { type: 'text', label: 'Business owner' },
    status: { type: 'text', label: 'Status' },
    signed_copy: { type: 'text', label: 'Signed copy' },
    completed: { type: 'text', label: 'Completed' },
    created: { type: 'text', label: 'Created' },
  };
  const wideRows = [
    { id: 'v1', name: 'V1', file: 'a.pdf', submitter: 'Ada', owner: 'Business Lead', status: 'Open', signed_copy: 'yes', completed: '2026-01-02', created: '2026-01-01' },
    { id: 'v2', name: 'V2', file: 'b.pdf', submitter: 'Bo', owner: 'Business Lead', status: 'Done', signed_copy: 'no', completed: '2026-02-02', created: '2026-02-01' },
  ];

  function renderVersions(keys: string[], onEnlarge = vi.fn()) {
    render(
      <RecordBodyTablesContext.Provider value={new Set(['clm_version.contract'])}>
        <RelatedEnlargeContext.Provider value={onEnlarge}>
          <RelatedList
            title="Versions"
            type="table"
            api="clm_version"
            objectName="clm_version"
            referenceField="contract"
            columns={keys.map((field) => ({ field, label: wideFields[field].label }))}
            data={wideRows}
            dataSource={{ find: vi.fn(async () => wideRows), getObjectSchema: vi.fn(async () => ({ name: 'clm_version', fields: wideFields })) } as any}
          />
        </RelatedEnlargeContext.Provider>
      </RecordBodyTablesContext.Provider>,
    );
    return onEnlarge;
  }
  const host = () => document.querySelector('[data-body-table-overflow]') as HTMLElement | null;
  const headerCells = () => Array.from(document.querySelectorAll('thead th')) as HTMLElement[];
  const headerKeys = () => headerCells().map((th) => th.getAttribute('data-column-key'));
  const askedWidth = (th: HTMLElement) => parseFloat(th.style.minWidth);
  const shadow = () => document.querySelector('[data-testid="data-table-scroll-shadow-right"]');
  const enlarge = () => document.querySelector('[data-related-card-enlarge]') as HTMLElement | null;

  it('eight columns in the details column: the leading ones that fit whole are drawn, the rest wait behind ⤢ in words', async () => {
    const all = Object.keys(wideFields);
    const onEnlarge = renderVersions(all);
    await waitFor(() => expect(screen.getByText('V1')).toBeInTheDocument());
    await waitFor(() => expect(host()?.getAttribute('data-body-table-columns-omitted')).not.toBeNull());
    const drawn = headerKeys();
    // The leading run, in priority order — never a column picked from the middle.
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThan(all.length);
    expect(drawn).toEqual(all.slice(0, drawn.length));
    expect(host()?.getAttribute('data-body-table-columns-omitted')).toBe(String(all.length - drawn.length));
    // Width containment: what is drawn fits whole in the column — no column
    // cut at the right edge, so nothing scrolls, nothing is pinned, no shadow.
    expect(headerCells().reduce((sum, th) => sum + askedWidth(th), 0)).toBeLessThanOrEqual(detailsPx);
    expect(host()?.getAttribute('data-body-table-overflow')).toBe('true');
    // The table re-reads its box on a resize of its content, which jsdom
    // never reports; a scroll event asks it the same question.
    fireEvent.scroll(document.querySelector('[data-table-scroll-box]') as HTMLElement);
    await waitFor(() => expect(shadow()).toBeNull());
    expect(headerCells().some((th) => /\bsticky\b/.test(th.className))).toBe(false);
    expect(enlarge()?.getAttribute('data-overflow')).toBe('true');
    // Named by its visible label, not an icon-only aria-label.
    expect(enlarge()?.textContent?.trim()).not.toBe('');
    expect(enlarge()?.hasAttribute('aria-label')).toBe(false);
    fireEvent.click(enlarge()!);
    expect(onEnlarge).toHaveBeenCalledWith('clm_version.contract');
    // A header the ellipsis could cut carries its whole label.
    expect(screen.getByTitle('Business owner')).toBeInTheDocument();
  });

  it('a first column wider than the box still scrolls inside it: pinned, shadowed, and the shadow clears at the end', async () => {
    detailsPx = 60;
    renderVersions(Object.keys(wideFields));
    await waitFor(() => expect(shadow()).not.toBeNull());
    // Never fewer than one column.
    expect(headerKeys()).toEqual(['name']);
    expect(headerCells()[0].className).toMatch(/\bsticky\b/);
    const box = document.querySelector('[data-table-scroll-box]') as HTMLElement;
    Object.defineProperty(box, 'scrollLeft', { configurable: true, value: COLUMN_PX - detailsPx });
    fireEvent.scroll(box);
    await waitFor(() => expect(shadow()).toBeNull());
    expect(headerCells()[0].className).toMatch(/\bsticky\b/);
    expect(host()?.getAttribute('data-body-table-overflow')).toBe('true');
  });

  it('CONTROL — three columns that fit: every column drawn, no shadow, no pinned column, the icon-only ⤢', async () => {
    renderVersions(['name', 'file', 'status']);
    await waitFor(() => expect(screen.getByText('V1')).toBeInTheDocument());
    expect(host()?.getAttribute('data-body-table-overflow')).toBe('false');
    expect(host()?.hasAttribute('data-body-table-columns-omitted')).toBe(false);
    expect(headerKeys()).toEqual(['name', 'file', 'status']);
    expect(shadow()).toBeNull();
    expect(headerCells().some((th) => /\bsticky\b/.test(th.className))).toBe(false);
    expect(enlarge()?.hasAttribute('data-overflow')).toBe(false);
    expect(enlarge()?.textContent?.trim()).toBe('');
    expect(enlarge()?.hasAttribute('aria-label')).toBe(true);
  });
});

describe('bodyTableColumnsThatFit — the leading columns that fit whole (objectstack#35742)', () => {
  const widths = new Map([['a', 200], ['b', 150], ['c', 150], ['d', 100]]);

  it('counts the leading run whose widths sum to no more than the room', () => {
    expect(bodyTableColumnsThatFit(['a', 'b', 'c', 'd'], widths, 520)).toBe(3);
    expect(bodyTableColumnsThatFit(['a', 'b', 'c', 'd'], widths, 500)).toBe(3);
    expect(bodyTableColumnsThatFit(['a', 'b', 'c', 'd'], widths, 499)).toBe(2);
  });

  it('never fewer than one column, and none left out when every column fits', () => {
    expect(bodyTableColumnsThatFit(['a', 'b'], widths, 100)).toBe(1);
    expect(bodyTableColumnsThatFit(['a', 'b', 'c', 'd'], widths, 600)).toBeNull();
  });

  it('a column not yet measured leaves nothing out, so the table draws it and measures again', () => {
    expect(bodyTableColumnsThatFit(['a', 'x', 'b'], widths, 250)).toBeNull();
  });
});

describe('RelatedList — a body table draws the list\'s dense rows (objectstack#35742)', () => {
  // The table's root: the box's ancestor the table lays out at full height.
  const tableRoot = () => document.querySelector('[data-testid="data-table-scroll-box"]')?.closest('.h-full') as HTMLElement | null;

  it('33px data rows (a 32px cell over the row line) under a 32px header, as the list\'s compact rows', async () => {
    renderList(true);
    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument());
    const classes = (tableRoot()?.className ?? '').split(/\s+/);
    expect(BODY_TABLE_DENSITY.split(' ').every((c) => classes.includes(c))).toBe(true);
    // The measures `object-grid` draws a compact row and its header with.
    expect(BODY_TABLE_DENSITY).toContain('[&_tbody_td]:h-8');
    expect(BODY_TABLE_DENSITY).toContain('[&_tbody_td]:py-0');
    expect(BODY_TABLE_DENSITY).toContain('[&_thead_th]:h-8');
    expect(BODY_TABLE_DENSITY).toContain('[&_thead_th]:py-0');
  });

  it('CONTROL — the same list outside the body-table set keeps the table\'s own row height', async () => {
    renderList(false);
    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument());
    expect(tableRoot()?.className ?? '').not.toContain('[&_tbody_td]:h-8');
  });
});
