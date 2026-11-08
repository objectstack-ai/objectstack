/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0144 D5 on the record page: the home field a `record`-mode amount
 * declares reads with the rate and document date the engine converted at,
 * taken from the record's own `rateField` / `rateDate` values.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { LocalizationProvider } from '@object-ui/i18n';
import { DetailSection } from '../DetailSection';

const objectSchema = {
  name: 'fx_invoice',
  fields: {
    currency_code: { type: 'text', valueDomain: 'iso_4217_currency' },
    invoice_date: { type: 'date' },
    amount: { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code', homeAmount: { field: 'amount_home', rateDate: 'invoice_date', rateField: 'amount_rate' } } },
    amount_home: { type: 'currency', readonly: true },
    amount_rate: { type: 'number', readonly: true },
    total: { type: 'currency' },
  },
};
const section = { fields: ['amount', 'amount_home', 'total'].map((name) => ({ name, label: name })) } as any;

function page(data: Record<string, unknown>) {
  return render(
    <LocalizationProvider value={{ locale: 'en-US', currency: 'CNY' }}>
      <DetailSection section={section} data={data} objectSchema={objectSchema as any} onEnterInlineEdit={vi.fn()} />
    </LocalizationProvider>,
  ).container;
}
const hints = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-testid="home-amount-hint"]')).map((e) => e.textContent);

describe('DetailSection: the home field (ADR-0144 D5)', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  });

  it('a foreign amount: the home row says the rate and date, and only the home row', () => {
    const c = page({ currency_code: 'EUR', invoice_date: '2026-11-01', amount: 10000, amount_home: 71994.24, amount_rate: 0.1389, total: 3 });
    expect(hints(c)).toEqual(['Converted at 0.1389 on Nov 1, 2026']);
    expect(c.textContent?.replace(/ /g, ' ')).toContain('CN¥71,994.24');
  });

  it('an amount already in the home currency: rate 1', () => {
    expect(hints(page({ currency_code: 'CNY', amount: 500, amount_home: 500, amount_rate: 1, total: 3 }))).toEqual(['In the home currency (rate 1)']);
  });
});
