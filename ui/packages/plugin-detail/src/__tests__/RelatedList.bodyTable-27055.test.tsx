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
 * title, ⤢ to enlarge in place, a totals line under its additive columns, and
 * no 「查看全部」 footer. The same list outside the set keeps its own face.
 *
 * objectstack#29943 — which columns the totals line adds up: a `currency`
 * column in one known currency, and a `number` column only when the record's
 * own object rolls it up with `sum`; an ordinal (`version_no`, `seq`) never.
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
    expect(totals.querySelector('[data-body-table-total="total"]')?.textContent).toContain('$65.50');
    // The text column is not totalled, nor a number column no roll-up declares
    // additive (objectstack#29943).
    expect(totals.querySelector('[data-body-table-total="quantity"]')).toBeNull();
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

/**
 * objectstack#29943 — the totals line adds up only the columns something
 * declared additive. The fixtures are hotclm's: a contract's versions
 * (`version_no`, an ordinal) and its payment plan (`seq`, an ordinal, beside
 * two amounts).
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
  const contract = (fields: Record<string, unknown>) => ({ name: 'clm_contract', fields });
  const rollUp = (fn: string, field: string, object = 'clm_payment_plan') => ({
    type: 'summary',
    summaryOperations: { object, field, function: fn },
  });

  function renderPlan(opts: {
    columns: string[];
    rows?: readonly Record<string, unknown>[];
    parent?: { name: string; fields: unknown };
    tenantCurrency?: string;
  }) {
    const rows = opts.rows ?? planRows;
    const list = (
      <RecordBodyTablesContext.Provider value={new Set(['clm_payment_plan.contract'])}>
        <RelatedList
          title="Payment plan"
          type="table"
          api="clm_payment_plan"
          objectName="clm_payment_plan"
          referenceField="contract"
          columns={opts.columns.map((field) => ({ field, label: (planFields as any)[field].label }))}
          data={rows as any[]}
          dataSource={{ find: vi.fn(async () => rows), getObjectSchema: vi.fn(async () => ({ name: 'clm_payment_plan', fields: planFields })) } as any}
        />
      </RecordBodyTablesContext.Provider>
    );
    const withParent = opts.parent ? (
      <RecordContextProvider objectName={opts.parent.name} recordId="c1" objectSchema={opts.parent} data={{ id: 'c1' }}>
        {list}
      </RecordContextProvider>
    ) : (
      list
    );
    return render(
      opts.tenantCurrency ? (
        <LocalizationProvider value={{ currency: opts.tenantCurrency }}>{withParent}</LocalizationProvider>
      ) : (
        withParent
      ),
    );
  }

  const totalsLine = () => document.querySelector('[data-body-table-totals]') as HTMLElement | null;
  const totalOf = (key: string) => totalsLine()?.querySelector(`[data-body-table-total="${key}"]`)?.textContent ?? null;

  it('totals no ordinal column — and draws no line when nothing else adds up', async () => {
    renderPlan({ columns: ['name', 'seq', 'version_no'], parent: contract({}) });
    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());
    expect(totalsLine()).toBeNull();
  });

  it('CONTROL — a currency column beside the ordinals still totals, in its own currency', async () => {
    renderPlan({ columns: ['name', 'seq', 'fee'], parent: contract({}) });
    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());
    expect(totalOf('seq')).toBeNull();
    expect(totalOf('fee')).toContain('€60.25');
  });

  it('totals a number column the parent rolls up with sum', async () => {
    renderPlan({
      columns: ['name', 'seq', 'planned_amount'],
      parent: contract({ planned_total: rollUp('sum', 'planned_amount') }),
    });
    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());
    expect(totalOf('planned_amount')).toContain('383,000.5');
    // The roll-up names one column; the ordinal beside it stays untotalled.
    expect(totalOf('seq')).toBeNull();
  });

  it('reads the roll-up in the array-shaped field container too', async () => {
    renderPlan({
      columns: ['name', 'planned_amount'],
      parent: contract([{ name: 'planned_total', ...rollUp('sum', 'planned_amount') }] as any),
    });
    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());
    expect(totalOf('planned_amount')).toContain('383,000.5');
  });

  it('CONTROL — the same number column without a sum roll-up is not totalled', async () => {
    for (const parent of [
      undefined, // no record page in scope at all
      contract({}),
      contract({ instalments: rollUp('count', 'planned_amount') }),
      contract({ planned_max: rollUp('max', 'planned_amount') }),
      contract({ other_total: rollUp('sum', 'planned_amount', 'clm_invoice') }),
    ]) {
      const { unmount } = renderPlan({ columns: ['name', 'planned_amount'], parent });
      await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());
      expect(totalsLine()).toBeNull();
      unmount();
    }
  });

  it('a record-mode amount totals in the one currency its rows carry', async () => {
    renderPlan({ columns: ['name', 'paid'], parent: contract({}) });
    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());
    expect(totalOf('paid')).toContain('€600.00');
  });

  it('mixed-currency rows get no total', async () => {
    const rows = planRows.map((row, i) => ({ ...row, currency_code: i === 1 ? 'USD' : 'EUR' }));
    renderPlan({ columns: ['name', 'paid'], rows, parent: contract({}) });
    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());
    expect(totalsLine()).toBeNull();
  });

  it('a row whose currency is unknown gets no total, not a bare sum', async () => {
    const rows = planRows.map((row, i) => ({ ...row, currency_code: i === 2 ? '' : 'EUR' }));
    renderPlan({ columns: ['name', 'paid'], rows, parent: contract({}) });
    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());
    expect(totalsLine()).toBeNull();
  });

  it('a dynamic amount totals in the tenant default currency, and not at all without one', async () => {
    const first = renderPlan({ columns: ['name', 'dynamic_fee'], parent: contract({}), tenantCurrency: 'CNY' });
    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());
    expect(totalOf('dynamic_fee')).toMatch(/CN¥|¥/);
    expect(totalOf('dynamic_fee')).toContain('6.00');
    first.unmount();
    renderPlan({ columns: ['name', 'dynamic_fee'], parent: contract({}) });
    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());
    expect(totalsLine()).toBeNull();
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
