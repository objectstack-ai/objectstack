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
import { LocalizationProvider } from '@object-ui/i18n';
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
