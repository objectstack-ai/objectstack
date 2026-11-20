/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#33542 — the footer total of a roll-up (`summary`) column is
 * formatted as the list cell draws the same field.
 *
 * HotCRM's All Invoices footer read "Paid 230,000" for a `Field.summary` with
 * `scale: 2`, beside "Open 215,000.00" for a currency field: the footer's
 * formatter keyed on the column type, and a `summary` fell to the plain
 * default, which never reads `scale`. The served object metadata carries the
 * summary's `scale` (measured on the showcase's `showcase_expense_report`).
 *
 * The cell draws a summary through `FormulaCellRenderer`: as money when the
 * summary declares its currency (`currencyConfig`, `summaryDeclaresCurrency`),
 * else as a number at its `resolveFieldScale` width. The footer now takes the
 * same two arms, the ones a plain `currency` / `number` column takes.
 *
 * Pinned through the real `ObjectGrid` footer, its field catalogue read from
 * the data source's object schema, under a real `I18nProvider` in en and zh-CN:
 *
 *  - a summary with `scale: 2` totals to two decimals;
 *  - a summary declaring a `fixed` currency totals exactly as a plain currency
 *    column with the same config does;
 *  - CONTROL: a summary with no `scale` and no currency keeps today's face.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, I18nProvider } from '@object-ui/react';

beforeAll(() => {
  registerAllFields();
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});
beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OBJECT = 'invoice_33542';

const CNY = { currencyMode: 'fixed', defaultCurrency: 'CNY' } as const;

/** The served field catalogue: three roll-ups and a plain currency field. */
const FIELDS = {
  id: { type: 'text', label: 'Id' },
  invoice_number: { type: 'text', label: 'Invoice Number' },
  paid_amount: {
    type: 'summary', label: 'Paid', scale: 2,
    summaryOperations: { object: 'payment', field: 'amount', function: 'sum' },
  },
  paid_cny: {
    type: 'summary', label: 'Paid (CNY)', scale: 2, currencyConfig: CNY,
    summaryOperations: { object: 'payment', field: 'amount', function: 'sum' },
  },
  billed_cny: { type: 'currency', label: 'Billed (CNY)', currencyConfig: CNY },
  payment_count: {
    type: 'summary', label: 'Payments',
    summaryOperations: { object: 'payment', function: 'count' },
  },
};

/** Totals: 230,000 for every amount column, 7 payments. */
const ROWS = [
  { id: 'i1', invoice_number: 'INV-1', paid_amount: 100000, paid_cny: 100000, billed_cny: 100000, payment_count: 3 },
  { id: 'i2', invoice_number: 'INV-2', paid_amount: 130000, paid_cny: 130000, billed_cny: 130000, payment_count: 4 },
];

function renderGrid(language: 'en' | 'zh-CN') {
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS.map((r) => ({ ...r })), total: ROWS.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: vi.fn(async (name: string) => ({ name, fields: FIELDS })),
  } as any;
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    columns: [
      { field: 'invoice_number', label: 'Invoice Number' },
      { field: 'paid_amount', label: 'Paid', summary: 'sum' },
      { field: 'paid_cny', label: 'Paid (CNY)', summary: 'sum' },
      { field: 'billed_cny', label: 'Billed (CNY)', summary: 'sum' },
      { field: 'payment_count', label: 'Payments', summary: 'sum' },
    ],
    pagination: { pageSize: 50 },
  };
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <ActionProvider>
        <ObjectGrid schema={schema} dataSource={dataSource} />
      </ActionProvider>
    </I18nProvider>,
  );
}

/** The footer text of a column once the grid has its field catalogue. */
async function footerOf(field: string): Promise<string> {
  // objectstack#35548 — the figure is a cell of the table's own last row,
  // under its column; the first column's cell also holds the row's lead.
  const cell = await screen.findByTestId(`data-table-summary-${field}`);
  const lead = cell.querySelector('[data-testid="data-table-summary-lead"]')?.textContent ?? '';
  return (cell.textContent ?? '').replace(lead, '');
}

describe('a summary column footer total is formatted as its cell (objectstack#33542)', () => {
  it('en: a summary with scale 2 totals to two decimals', async () => {
    renderGrid('en');
    await waitFor(async () => expect(await footerOf('paid_amount')).toContain('Sum: 230,000.00'));
  });

  it('zh-CN: a summary with scale 2 totals to two decimals, under the zh prefix', async () => {
    renderGrid('zh-CN');
    await waitFor(async () => expect(await footerOf('paid_amount')).toContain('合计:230,000.00'));
  });

  it.each(['en', 'zh-CN'] as const)('%s: a summary declaring a fixed currency totals as a plain currency column does', async (language) => {
    renderGrid(language);
    await waitFor(async () => expect(await footerOf('billed_cny')).toMatch(/230,000\.00/));
    const currencyTotal = (await footerOf('billed_cny')).replace(/^.*?:/, '');
    // The plain currency column draws money (a currency sign beside the amount).
    expect(currencyTotal).not.toBe('230,000.00');
    expect((await footerOf('paid_cny')).replace(/^.*?:/, '')).toBe(currencyTotal);
  });

  it('CONTROL: a summary with no scale and no currency keeps the plain total', async () => {
    renderGrid('en');
    // The catalogue has landed once the plain currency column draws money.
    await waitFor(async () => expect(await footerOf('billed_cny')).toMatch(/230,000\.00/));
    expect(await footerOf('payment_count')).toContain('Sum: 7');
    expect(await footerOf('payment_count')).not.toContain('7.0');
  });
});
