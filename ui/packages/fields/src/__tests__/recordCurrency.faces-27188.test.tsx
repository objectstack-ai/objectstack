/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0144 D2 on the `@object-ui/fields` faces: a `record`-mode amount shows
 * the currency of its own row / form record, and a record-currency code field
 * (`valueDomain: 'iso_4217_currency'`) renders the grouped ISO 4217 select.
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocalizationProvider, homeAmountSourceOf, withHomeAmountSource } from '@object-ui/i18n';
import { CurrencyCellRenderer } from '../index';
import { CurrencyField } from '../widgets/CurrencyField';
import { TextField } from '../widgets/TextField';
import { currencyCodeGroups, isoCurrencyCodes, usedCurrencyCodesOf, CurrencyCodeField } from '../widgets/CurrencyCodeField';

afterEach(cleanup);

const TENANT = { locale: 'en-US', currency: 'CNY' };
const AMOUNT = {
  name: 'amount',
  type: 'currency',
  currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' },
} as any;
const text = (s: string | null) => (s ?? '').replace(/\u00a0/g, ' ');

function cell(row: Record<string, unknown> | undefined): string {
  const { container, unmount } = render(
    <LocalizationProvider value={TENANT}>
      <CurrencyCellRenderer value={row?.amount ?? 1234.5} field={AMOUNT} dependentValues={row} />
    </LocalizationProvider>,
  );
  const out = text(container.textContent);
  unmount();
  return out;
}

describe('CurrencyCellRenderer — record mode', () => {
  it('three rows in three currencies show three symbols', () => {
    expect(cell({ amount: 1234.5, currency_code: 'USD' })).toBe('$1,234.50');
    expect(cell({ amount: 1234.5, currency_code: 'EUR' })).toBe('€1,234.50');
    expect(cell({ amount: 1234, currency_code: 'JPY' })).toBe('¥1,234');
  });

  it('a row with no code shows a plain number, never the tenant CN¥', () => {
    expect(cell({ amount: 1234.5 })).not.toContain('CN¥');
    expect(cell({ amount: 1234.5, currency_code: '' })).toBe('1,234.50');
    expect(cell(undefined)).toBe('1,234.50');
  });
});

describe('CurrencyField — the amount box follows the selected code', () => {
  function box(code: string | undefined) {
    const { container, unmount } = render(
      <LocalizationProvider value={TENANT}>
        <CurrencyField value={10} onChange={() => {}} field={AMOUNT} dependentValues={{ currency_code: code }} />
      </LocalizationProvider>,
    );
    const input = container.querySelector('input')!;
    const out = { step: input.getAttribute('step'), adornment: text(container.querySelector('span')?.textContent ?? '') };
    unmount();
    return out;
  }

  it('symbol and minor-unit step follow the record code', () => {
    expect(box('USD')).toEqual({ step: '0.01', adornment: '$' });
    expect(box('JPY')).toEqual({ step: '1', adornment: '¥' });
    expect(box('KWD').step).toBe('0.001');
  });

  it('no code: no symbol, and not the tenant one', () => {
    expect(box(undefined).adornment).toBe('');
  });
});

describe('the record-currency code select (CurrencyCodeField)', () => {
  it('groups available (home, rated, used, current) ahead of all ISO 4217, without duplicates', () => {
    const groups = currencyCodeGroups({ home: 'CNY', rated: ['USD'], used: ['EUR', 'USD'], current: 'JPY', iso: ['CNY', 'EUR', 'GBP', 'JPY', 'USD'] });
    expect(groups.available).toEqual(['CNY', 'USD', 'EUR', 'JPY']);
    expect(groups.all).toEqual(['GBP']);
  });

  it('never offers a code the iso_4217_currency domain refuses', () => {
    const groups = currencyCodeGroups({ home: 'XXX1', current: 'BTC', iso: ['USD'] });
    expect(groups.available).toEqual([]);
    expect(isoCurrencyCodes()).toContain('USD');
    expect(isoCurrencyCodes()).not.toContain('BTC');
  });

  it('reads the used codes the form renderer hands down on the field metadata', () => {
    expect(usedCurrencyCodesOf({ usedCurrencyCodes: ['EUR', 5, 'GBP'] })).toEqual(['EUR', 'GBP']);
    expect(usedCurrencyCodesOf({})).toEqual([]);
    expect(usedCurrencyCodesOf(undefined)).toEqual([]);
  });

  it('offers the used codes in "Available", after the home currency', () => {
    render(
      <LocalizationProvider value={TENANT}>
        <CurrencyCodeField
          value=""
          onChange={() => {}}
          field={{ name: 'currency_code', type: 'text', valueDomain: 'iso_4217_currency', usedCurrencyCodes: ['GBP', 'EUR'] } as any}
        />
      </LocalizationProvider>,
    );
    fireEvent.click(screen.getByRole('combobox'));
    const available = screen.getByText('Available').closest('[cmdk-group]') as HTMLElement;
    const codes = within(available).getAllByRole('option').map((o) => o.textContent?.slice(0, 3));
    expect(codes).toEqual([TENANT.currency, 'GBP', 'EUR']);
  });

  it('a text field declaring the ISO 4217 domain renders the select, not a free-text box', () => {
    render(
      <LocalizationProvider value={TENANT}>
        <TextField value="EUR" onChange={() => {}} field={{ name: 'currency_code', type: 'text', valueDomain: 'iso_4217_currency' } as any} />
      </LocalizationProvider>,
    );
    expect(screen.getByRole('combobox')).toHaveTextContent('EUR');
    expect(document.querySelector('input[type="text"]')).toBeNull();
  });

  it('read-only shows the code with its name', () => {
    render(
      <LocalizationProvider value={TENANT}>
        <TextField value="EUR" onChange={() => {}} readonly field={{ name: 'currency_code', type: 'text', valueDomain: 'iso_4217_currency' } as any} />
      </LocalizationProvider>,
    );
    expect(screen.getByText(/^EUR — /)).toBeInTheDocument();
  });
});

// ADR-0144 D5: a home field draws its read face with the rate and document
// date the engine converted at, read from the record; the stamp is the
// producer's (`withHomeAmountSource`), so an unstamped amount is unchanged.
describe('home field faces (ADR-0144 D5)', () => {
  const FIELDS = {
    currency_code: { type: 'text', valueDomain: 'iso_4217_currency' },
    invoice_date: { type: 'date' },
    amount: { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code', homeAmount: { field: 'amount_home', rateDate: 'invoice_date', rateField: 'amount_rate' } } },
    amount_home: { type: 'currency', readonly: true },
    amount_rate: { type: 'number', readonly: true },
  };
  const HOME = withHomeAmountSource({ name: 'amount_home', ...FIELDS.amount_home }, FIELDS, 'amount_home') as any;
  const FOREIGN = { currency_code: 'EUR', invoice_date: '2026-11-01', amount: 10000, amount_home: 71994.24, amount_rate: 0.1389 };
  const SAME = { currency_code: 'CNY', invoice_date: '', amount: 500, amount_home: 500, amount_rate: 1 };

  function face(el: React.ReactElement) {
    const { container, unmount } = render(<LocalizationProvider value={TENANT}>{el}</LocalizationProvider>);
    const out = {
      text: text(container.textContent),
      inputs: container.querySelectorAll('input').length,
      hint: text(container.querySelector('[data-testid="home-amount-hint"]')?.textContent ?? null),
    };
    unmount();
    return out;
  }

  it('reads the source off the object, and stamps nothing on a field no amount names', () => {
    expect(homeAmountSourceOf(FIELDS, 'amount_home')).toEqual({ amountField: 'amount', codeField: 'currency_code', rateDateField: 'invoice_date', rateField: 'amount_rate' });
    expect(homeAmountSourceOf(FIELDS, 'amount_rate')).toBeUndefined();
    const plain = { type: 'currency' };
    expect(withHomeAmountSource(plain, FIELDS, 'plain')).toBe(plain);
  });

  it('the form widget draws the read face, never an input, with the rate and date', () => {
    const out = face(<CurrencyField value={71994.24} onChange={() => {}} field={HOME} dependentValues={FOREIGN} disabled />);
    expect(out.inputs).toBe(0);
    expect(out.text).toContain('CN¥71,994.24');
    expect(out.hint).toBe('Converted at 0.1389 on Nov 1, 2026');
  });

  it('the record-page cell says the same, and an amount in the home currency says rate 1', () => {
    expect(face(<CurrencyCellRenderer value={71994.24} field={HOME} dependentValues={FOREIGN} />).hint).toBe('Converted at 0.1389 on Nov 1, 2026');
    expect(face(<CurrencyCellRenderer value={500} field={HOME} dependentValues={SAME} />).hint).toBe('In the home currency (rate 1)');
  });

  it('no stored rate (a blank amount): no hint', () => {
    expect(face(<CurrencyCellRenderer value={0} field={HOME} dependentValues={{ ...FOREIGN, amount_rate: null }} />).hint).toBe('');
  });

  it('CONTROL: an unstamped amount renders as before, an input in the form and a bare cell', () => {
    const plain = { name: 'amount_home', ...FIELDS.amount_home } as any;
    expect(face(<CurrencyField value={71994.24} onChange={() => {}} field={plain} dependentValues={FOREIGN} disabled />).inputs).toBe(1);
    const cellOut = face(<CurrencyCellRenderer value={71994.24} field={plain} dependentValues={FOREIGN} />);
    expect(cellOut).toEqual({ text: 'CN¥71,994.24', inputs: 0, hint: '' });
  });
});
