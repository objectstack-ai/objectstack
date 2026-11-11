/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0144 D2 as amended, on a header-and-lines surface: a line amount whose
 * `currencyField` is `<relationship>.<code>` through the very relation the
 * lines hang under draws in the header's currency. The line grid's columns
 * carry no field definition, so the panel names those columns' currency from
 * the child schema and the header record.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider, RecordContextProvider } from '@object-ui/react';
import { LocalizationProvider } from '@object-ui/i18n';
import '../index';
import { parentCurrencyFieldsOf, followedColumnCurrencies } from '../parentCurrencyColumns';

afterEach(cleanup);

const PATH = { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'po.currency_code' } };
const SIBLING = { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } };
const OTHER_PARENT = { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'contract.currency_code' } };
const CHILD_FIELDS = {
  label: { type: 'text' },
  po: { type: 'master_detail', reference: 'po' },
  contract: { type: 'master_detail', reference: 'contract' },
  amount: PATH,
  fee: SIBLING,
  other: OTHER_PARENT,
  currency_code: { type: 'text', valueDomain: 'iso_4217_currency' },
};

describe('the line columns that follow the header (ADR-0144 D2 as amended)', () => {
  it('names only a path through the panel\'s own relationship', () => {
    expect(Object.keys(parentCurrencyFieldsOf(CHILD_FIELDS, 'po') ?? {})).toEqual(['amount']);
    expect(Object.keys(parentCurrencyFieldsOf(CHILD_FIELDS, 'contract') ?? {})).toEqual(['other']);
    expect(parentCurrencyFieldsOf({ fee: SIBLING }, 'po')).toBeUndefined();
  });

  it('reads the header\'s code; a header with no code yet names no currency', () => {
    const fields = parentCurrencyFieldsOf(CHILD_FIELDS, 'po');
    expect(followedColumnCurrencies(fields, { currency_code: 'EUR' }, 'USD')).toEqual({ amount: 'EUR' });
    expect(followedColumnCurrencies(fields, { currency_code: '' }, 'USD')).toEqual({ amount: undefined });
    expect(followedColumnCurrencies(fields, undefined, 'USD')).toEqual({ amount: undefined });
  });
});

describe('record:line_items on the header\'s page', () => {
  const COLUMNS = [
    { name: 'label', label: 'Line', type: 'text' },
    { name: 'amount', label: 'Amount', type: 'currency' },
    { name: 'fee', label: 'Fee', type: 'currency' },
  ];
  function mount(header: Record<string, unknown>) {
    const adapter = {
      find: vi.fn().mockResolvedValue({ data: [{ id: 'l1', label: 'first', po: 'p1', amount: 1234.5, fee: 7 }, { id: 'l2', label: 'second', po: 'p1', amount: 100, fee: 7 }] }),
      getObjectSchema: vi.fn(async () => ({ name: 'po_line', fields: CHILD_FIELDS })),
      batchTransaction: vi.fn().mockResolvedValue({ results: [] }),
    };
    return render(
      <LocalizationProvider value={{ locale: 'en-US', currency: 'USD' }}>
        <SchemaRendererProvider dataSource={adapter as any}>
          <RecordContextProvider objectName="po" recordId="p1" data={header}>
            <SchemaRenderer schema={{ type: 'record:line_items', properties: { childObject: 'po_line', relationshipField: 'po', columns: COLUMNS, readonly: true } } as any} />
          </RecordContextProvider>
        </SchemaRendererProvider>
      </LocalizationProvider>,
    );
  }

  it('draws both lines\' amount in the header\'s currency; the sibling column is unchanged', async () => {
    const { container } = mount({ id: 'p1', currency_code: 'EUR' });
    await waitFor(() => expect((container.textContent ?? '').replace(/ /g, ' ')).toContain('€1,234.50'));
    const t = (container.textContent ?? '').replace(/ /g, ' ');
    expect(t).toContain('€100.00');
    // The sibling column reads no row code in this grid, as before: the tenant's.
    expect(t).toContain('$7.00');
  });
});
