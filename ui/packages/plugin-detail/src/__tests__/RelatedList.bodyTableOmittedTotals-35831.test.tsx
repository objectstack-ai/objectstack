/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35831 — a body table that leaves summed columns out for width
 * (objectstack#35742's `bodyTableColumnsThatFit`) keeps their totals on the
 * Overview: a line under the table names each left-out column and draws its
 * total, formatted as the column's own total is (the record's currency for a
 * line amount that follows its parent). The drawn columns keep their figures
 * in the table's last row, unchanged; a table that leaves nothing out shows no
 * added line.
 *
 * jsdom lays nothing out, so the scroll box's widths are stubbed as in the
 * body-table face's own pins: each drawn column header is 120 px of scroll
 * width inside a details column of `detailsPx`. The width each column asks
 * for is the inline width the table gives its header.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { RelatedList } from '../RelatedList';
import { RecordBodyTablesContext, RelatedEnlargeContext } from '../relatedListCompact';

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

const COLUMN_PX = 120;
const WIDE_PX = 100_000;
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

/** A server-side `aggregate` over every row, as `engine.aggregate` answers it. */
function serverAggregate(rows: readonly Record<string, unknown>[]) {
  return vi.fn(async (_resource: string, params: any) => [
    Object.fromEntries(
      (params.aggregations as Array<{ field: string; alias: string }>).map((a) => [
        a.alias,
        rows.reduce((n, row) => n + Number(row[a.field] ?? 0), 0),
      ]),
    ),
  ]);
}

const usd = { currencyMode: 'fixed', defaultCurrency: 'USD' };
const FIELDS: Record<string, Record<string, unknown>> = {
  name: { type: 'text', label: 'Line' },
  quote: { type: 'master_detail', reference: 'quote', label: 'Quote' },
  price: { type: 'currency', label: 'Unit price', currencyConfig: usd },
  sku: { type: 'text', label: 'SKU' },
  description: { type: 'text', label: 'Description' },
  owner: { type: 'text', label: 'Business owner' },
  status: { type: 'text', label: 'Status' },
  region: { type: 'text', label: 'Region' },
  note: { type: 'text', label: 'Note' },
  // A line amount in the page record's currency (ADR-0144 D2 as amended).
  line_amount: { type: 'currency', label: 'Line amount', currencyConfig: { currencyMode: 'record', currencyField: 'quote.currency_code' } },
  tax: { type: 'currency', label: 'Tax', currencyConfig: usd },
};
const ROWS = [
  { id: 'l1', name: 'L1', quote: 'q1', price: 10, sku: 'A-1', description: 'Widget', owner: 'Ada', status: 'Open', region: 'EU', note: 'x', line_amount: 1234.5, tax: 12.25 },
  { id: 'l2', name: 'L2', quote: 'q1', price: 20.5, sku: 'B-2', description: 'Gadget', owner: 'Bo', status: 'Done', region: 'US', note: 'y', line_amount: 100, tax: 7.75 },
];
const ALL = ['name', 'price', 'sku', 'description', 'owner', 'status', 'region', 'note', 'line_amount', 'tax'];

function renderLines(keys: readonly string[]) {
  const aggregate = serverAggregate(ROWS);
  render(
    <LocalizationProvider value={{ locale: 'en-US', currency: 'USD' }}>
      <RecordContextProvider objectName="quote" recordId="q1" objectSchema={{ name: 'quote', fields: { currency_code: { type: 'text' } } }} data={{ id: 'q1', currency_code: 'EUR' }}>
        <RecordBodyTablesContext.Provider value={new Set(['quote_line.quote'])}>
          <RelatedEnlargeContext.Provider value={vi.fn()}>
            <RelatedList
              title="Lines"
              type="table"
              api="quote_line"
              objectName="quote_line"
              referenceField="quote"
              parentId="q1"
              columns={keys.map((field) => ({ field, label: FIELDS[field].label as string }))}
              data={ROWS as any[]}
              dataSource={{ find: vi.fn(async () => ROWS), aggregate, getObjectSchema: vi.fn(async () => ({ name: 'quote_line', fields: FIELDS })) } as any}
            />
          </RelatedEnlargeContext.Provider>
        </RecordBodyTablesContext.Provider>
      </RecordContextProvider>
    </LocalizationProvider>,
  );
  return { aggregate };
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/ /g, ' ');
const host = () => document.querySelector('[data-body-table-overflow]') as HTMLElement | null;
const headerKeys = () => Array.from(document.querySelectorAll('thead th')).map((th) => th.getAttribute('data-column-key'));
const summaryRow = () => document.querySelector('[data-testid="data-table-summary-row"]');
const summaryOf = (key: string) => document.querySelector(`[data-testid="data-table-summary-${key}"]`)?.textContent ?? null;
const omittedLine = () => document.querySelector('[data-body-table-omitted-totals]') as HTMLElement | null;
const omittedTotal = (key: string) => omittedLine()?.querySelector(`[data-body-table-total="${key}"]`) ?? null;

/** Draws the table at `px` and waits for its totals to settle. */
async function drawAt(px: number, keys: readonly string[] = ALL) {
  detailsPx = px;
  renderLines(keys);
  await waitFor(() => expect(screen.getByText('L1')).toBeInTheDocument());
}

describe('RelatedList — the totals of body-table columns left out for width (objectstack#35831)', () => {
  it('a narrow table that leaves summed columns out names each one and keeps its total on a line under the table', async () => {
    await drawAt(680);
    await waitFor(() => expect(host()?.getAttribute('data-body-table-columns-omitted')).not.toBeNull());
    // The two summed columns at the end did not fit; the price column did.
    expect(headerKeys()).toContain('price');
    expect(headerKeys()).not.toContain('line_amount');
    expect(headerKeys()).not.toContain('tax');
    await waitFor(() => expect(omittedLine()).not.toBeNull());
    // Each left-out total, under its column's name, formatted as its column's
    // own total: the line amount in the page record's currency.
    const lineAmount = omittedTotal('line_amount');
    expect(text(lineAmount)).toContain('Line amount');
    expect(text(lineAmount)).toContain('€1,334.50');
    const tax = omittedTotal('tax');
    expect(text(tax)).toContain('Tax');
    expect(text(tax)).toContain('$20.00');
    // A drawn column's total stays in its column, never repeated on the line.
    expect(summaryOf('price')).toContain('$30.50');
    expect(omittedTotal('price')).toBeNull();
    expect(omittedLine()!.querySelectorAll('[data-body-table-total]')).toHaveLength(2);
  });

  it('a left-out total reads the same as the one the table draws in its column when it fits (same currency, same figure)', async () => {
    await drawAt(WIDE_PX);
    await waitFor(() => expect(summaryOf('line_amount')).not.toBeNull());
    const wide = { line_amount: text(document.querySelector('[data-testid="data-table-summary-line_amount"]')), tax: summaryOf('tax')!.replace(/ /g, ' ') };
    cleanup();
    await drawAt(680);
    await waitFor(() => expect(omittedTotal('tax')).not.toBeNull());
    expect(text(omittedTotal('line_amount')?.lastElementChild)).toBe(wide.line_amount);
    expect(text(omittedTotal('tax')?.lastElementChild)).toBe(wide.tax);
  });

  it('every summed column left out: the line carries them all and no empty totals row is drawn', async () => {
    await drawAt(680, ['name', 'sku', 'description', 'owner', 'status', 'region', 'note', 'line_amount', 'tax']);
    await waitFor(() => expect(omittedTotal('tax')).not.toBeNull());
    expect(text(omittedTotal('line_amount'))).toContain('€1,334.50');
    expect(summaryRow()).toBeNull();
  });

  it('CONTROL — a table that leaves no column out shows no added line, every total in its column', async () => {
    await drawAt(WIDE_PX);
    await waitFor(() => expect(summaryOf('tax')).not.toBeNull());
    expect(host()?.hasAttribute('data-body-table-columns-omitted')).toBe(false);
    expect(headerKeys()).toEqual(ALL);
    expect(summaryOf('price')).toContain('$30.50');
    expect(text(document.querySelector('[data-testid="data-table-summary-line_amount"]'))).toContain('€1,334.50');
    expect(summaryOf('tax')).toContain('$20.00');
    expect(omittedLine()).toBeNull();
    expect(document.querySelector('[data-body-table-totals]')).toBeNull();
  });

  it('CONTROL — the drawn columns\' totals are the same with and without columns left out', async () => {
    await drawAt(WIDE_PX);
    await waitFor(() => expect(summaryOf('price')).not.toBeNull());
    const wide = summaryOf('price');
    const lead = text(document.querySelector('[data-testid="data-table-summary-lead"]'));
    cleanup();
    await drawAt(680);
    await waitFor(() => expect(omittedLine()).not.toBeNull());
    expect(summaryOf('price')).toBe(wide);
    expect(text(document.querySelector('[data-testid="data-table-summary-lead"]'))).toBe(lead);
  });

  it('CONTROL — a table that leaves out only unsummed columns shows no added line', async () => {
    await drawAt(680, ['name', 'price', 'sku', 'description', 'owner', 'status', 'region', 'note']);
    await waitFor(() => expect(host()?.getAttribute('data-body-table-columns-omitted')).not.toBeNull());
    await waitFor(() => expect(summaryOf('price')).toContain('$30.50'));
    expect(omittedLine()).toBeNull();
  });
});
