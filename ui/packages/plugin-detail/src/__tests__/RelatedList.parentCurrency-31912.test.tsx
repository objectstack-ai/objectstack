/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0144 D2 as amended, in a related list on the parent's record page: a
 * line amount whose `currencyField` is `invoice.currency_code` draws in the
 * page record's currency, in each cell and in the body table's totals line,
 * though the rows hold the relation as a bare id. A sibling-pointer amount
 * reads each row's own code.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { RelatedList } from '../RelatedList';
import { RecordBodyTablesContext } from '../relatedListCompact';

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

const LINE_FIELDS = {
  name: { type: 'text', label: 'Line' },
  invoice: { type: 'master_detail', reference: 'inv', label: 'Invoice' },
  amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: 'invoice.currency_code' } },
  fee: { type: 'currency', label: 'Fee', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
  currency_code: { type: 'text', valueDomain: 'iso_4217_currency', label: 'Code' },
};
const ROWS = [
  { id: 'l1', name: 'L1', invoice: 'i1', amount: 1234.5, fee: 10, currency_code: 'JPY' },
  { id: 'l2', name: 'L2', invoice: 'i1', amount: 100, fee: 10, currency_code: 'JPY' },
];
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\u00a0/g, ' ');

function renderOnParent(parent: Record<string, unknown>, columns: Array<{ field: string; label: string }>) {
  return render(
    <LocalizationProvider value={{ locale: 'en-US', currency: 'USD' }}>
      <RecordContextProvider objectName="inv" recordId={String(parent.id)} objectSchema={{ name: 'inv', fields: { currency_code: { type: 'text' } } }} data={parent}>
        <RecordBodyTablesContext.Provider value={new Set(['inv_line.invoice'])}>
          <RelatedList
            title="Lines"
            type="table"
            api="inv_line"
            objectName="inv_line"
            referenceField="invoice"
            columns={columns}
            data={ROWS as any[]}
            dataSource={{ find: vi.fn(async () => ROWS), getObjectSchema: vi.fn(async () => ({ name: 'inv_line', fields: LINE_FIELDS })) } as any}
          />
        </RecordBodyTablesContext.Provider>
      </RecordContextProvider>
    </LocalizationProvider>,
  );
}

describe('related list: lines that follow the page record (ADR-0144 D2 as amended)', () => {
  it('draws each cell and the totals line in the parent\'s currency', async () => {
    renderOnParent({ id: 'i1', currency_code: 'EUR' }, [{ field: 'name', label: 'Line' }, { field: 'amount', label: 'Amount' }]);
    await waitFor(() => expect(screen.getByText('L1')).toBeInTheDocument());
    await waitFor(() => expect(text(document.querySelector('tbody'))).toContain('€1,234.50'));
    expect(text(document.querySelector('tbody'))).toContain('€100.00');
    await waitFor(() => expect(text(document.querySelector('[data-body-table-total="amount"]'))).toContain('€1,334.50'));
  });

  it('a parent in another currency draws in its own', async () => {
    renderOnParent({ id: 'i1', currency_code: 'JPY' }, [{ field: 'name', label: 'Line' }, { field: 'amount', label: 'Amount' }]);
    await waitFor(() => expect(text(document.querySelector('tbody'))).toContain('¥1,235'));
    expect(text(document.querySelector('tbody'))).not.toContain('€');
  });

  it('a sibling-pointer amount reads each row\'s own code', async () => {
    renderOnParent({ id: 'i1', currency_code: 'EUR' }, [{ field: 'name', label: 'Line' }, { field: 'fee', label: 'Fee' }]);
    await waitFor(() => expect(text(document.querySelector('tbody'))).toContain('¥10'));
    expect(text(document.querySelector('tbody'))).not.toContain('€');
  });
});
