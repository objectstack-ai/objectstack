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
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { RelatedList } from '../RelatedList';
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
  }) {
    const rows = opts.rows ?? planRows;
    const aggregate = serverAggregate(rows);
    const list = (
      <RecordBodyTablesContext.Provider value={new Set(['clm_payment_plan.contract'])}>
        <RelatedList
          title="Payment plan"
          type="table"
          api="clm_payment_plan"
          objectName="clm_payment_plan"
          referenceField="contract"
          parentId="c1"
          filter={opts.filter as any}
          columns={opts.columns.map((field) => ({ field, label: (planFields as any)[field].label }))}
          data={rows as any[]}
          dataSource={{ find: vi.fn(async () => rows), aggregate, getObjectSchema: vi.fn(async () => ({ name: 'clm_payment_plan', fields: planFields })) } as any}
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

  it('a dynamic amount totals in the tenant default currency, and not at all without one', async () => {
    const first = renderPlan({ columns: ['name', 'dynamic_fee'], parent: contract({}), tenantCurrency: 'CNY' });
    await waitFor(() => expect(summaryOf('dynamic_fee')).toMatch(/CN¥|¥/));
    expect(summaryOf('dynamic_fee')).toContain('6.00');
    first.unmount();
    const { aggregate } = renderPlan({ columns: ['name', 'dynamic_fee'], parent: contract({}) });
    await settled(aggregate);
    expect(summaryRow()).toBeNull();
  });
});

/**
 * objectstack#29945 — a body table wider than the details column it sits in
 * (ADR-0085 keeps it there) says so: the table's right-edge shadow while
 * columns remain to the right, its first column pinned as the row's identity,
 * and ⤢ offered in words. A table that fits shows none of it.
 *
 * jsdom lays nothing out, so the scroll box's widths are stubbed: each column
 * header is 120 px wide inside a 680 px details column.
 */
describe('RelatedList — a body table wider than its column (objectstack#29945)', () => {
  const COLUMN_PX = 120;
  const DETAILS_PX = 680;
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
        return this.hasAttribute('data-table-scroll-box') ? DETAILS_PX : 0;
      },
    });
  });
  afterAll(() => {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(proto, key, descriptor);
      else delete (proto as any)[key];
    }
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
  const shadow = () => document.querySelector('[data-testid="data-table-scroll-shadow-right"]');
  const enlarge = () => document.querySelector('[data-related-card-enlarge]') as HTMLElement | null;

  it('eight columns in the details column: shadow, a pinned first column, ⤢ offered in words', async () => {
    const onEnlarge = renderVersions(Object.keys(wideFields));
    await waitFor(() => expect(screen.getByText('V1')).toBeInTheDocument());
    await waitFor(() => expect(host()?.getAttribute('data-body-table-overflow')).toBe('true'));
    expect(shadow()).not.toBeNull();
    const [first, second] = headerCells();
    expect(first.className).toMatch(/\bsticky\b/);
    expect(second.className).not.toMatch(/\bsticky\b/);
    expect(enlarge()?.getAttribute('data-overflow')).toBe('true');
    // Named by its visible label, not an icon-only aria-label.
    expect(enlarge()?.textContent?.trim()).not.toBe('');
    expect(enlarge()?.hasAttribute('aria-label')).toBe(false);
    fireEvent.click(enlarge()!);
    expect(onEnlarge).toHaveBeenCalledWith('clm_version.contract');
    // A header the ellipsis could cut carries its whole label.
    expect(screen.getByTitle('Business owner')).toBeInTheDocument();
  });

  it('scrolled to the end, the trailing shadow clears and the pinned column stays', async () => {
    renderVersions(Object.keys(wideFields));
    await waitFor(() => expect(shadow()).not.toBeNull());
    const box = document.querySelector('[data-table-scroll-box]') as HTMLElement;
    Object.defineProperty(box, 'scrollLeft', { configurable: true, value: 8 * COLUMN_PX - DETAILS_PX });
    fireEvent.scroll(box);
    await waitFor(() => expect(shadow()).toBeNull());
    expect(headerCells()[0].className).toMatch(/\bsticky\b/);
    expect(host()?.getAttribute('data-body-table-overflow')).toBe('true');
  });

  it('CONTROL — three columns that fit: no shadow, no pinned column, the icon-only ⤢', async () => {
    renderVersions(['name', 'file', 'status']);
    await waitFor(() => expect(screen.getByText('V1')).toBeInTheDocument());
    expect(host()?.getAttribute('data-body-table-overflow')).toBe('false');
    expect(shadow()).toBeNull();
    expect(headerCells().some((th) => /\bsticky\b/.test(th.className))).toBe(false);
    expect(enlarge()?.hasAttribute('data-overflow')).toBe(false);
    expect(enlarge()?.textContent?.trim()).toBe('');
    expect(enlarge()?.hasAttribute('aria-label')).toBe(true);
  });
});
