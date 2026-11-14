/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0144 D2 as amended, on the master-detail form: a line amount whose
 * `currencyField` is `po.currency_code` draws in the header's currency, read
 * off the live header record, in the line grid. The columns name no type, so
 * the form reads the child schema (a collection whose every column is typed
 * reads none, and keeps the tenant currency: a known gap).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { LocalizationProvider } from '@object-ui/i18n';
import { MasterDetailForm } from '../MasterDetailForm';

afterEach(cleanup);

const OBJECTS: Record<string, { name: string; fields: Record<string, any> }> = {
  po: { name: 'po', fields: { ref: { type: 'text', label: 'Ref' }, currency_code: { type: 'text', label: 'Code' }, tax_rate: { type: 'number', label: 'Tax rate' } } },
  po_line: {
    name: 'po_line',
    fields: {
      po: { type: 'master_detail', reference: 'po', label: 'Purchase order' },
      label: { type: 'text', label: 'Line' },
      amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: 'po.currency_code' } },
    },
  },
};

function makeDataSource(header: Record<string, unknown> = { id: 'po1', ref: 'PO-1', currency_code: 'EUR' }) {
  return {
    getObjectSchema: vi.fn(async (name: string) => OBJECTS[name] ?? { name, fields: {} }),
    find: vi.fn(async (name: string) =>
      name === 'po_line'
        ? { data: [{ id: 'l1', po: 'po1', label: 'first', amount: 1234.5 }, { id: 'l2', po: 'po1', label: 'second', amount: 100 }] }
        : { data: [] },
    ),
    findOne: vi.fn(async () => header),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
    batchTransaction: vi.fn().mockResolvedValue({ results: [] }),
  } as any;
}

const DETAILS = [{ childObject: 'po_line', relationshipField: 'po', title: 'Lines', columns: [{ name: 'label', label: 'Line' }, { name: 'amount', label: 'Amount' }], amountField: 'amount' }];

describe('master-detail form: lines that follow the header (ADR-0144 D2 as amended)', () => {
  it('the totals stack is in the header\'s currency', async () => {
    const { container } = render(
      <LocalizationProvider value={{ locale: 'en-US', currency: 'USD' }}>
        <MasterDetailForm
          schema={{ objectName: 'po', mode: 'edit', recordId: 'po1', details: DETAILS } as any}
          dataSource={makeDataSource({ id: 'po1', ref: 'PO-1', currency_code: 'EUR', tax_rate: 10 })}
        />
      </LocalizationProvider>,
    );
    await waitFor(() => expect((container.textContent ?? '').replace(/\u00a0/g, ' ')).toContain('€1,334.50'));
    expect((container.textContent ?? '').replace(/\u00a0/g, ' ')).not.toContain('$1,334.50');
  });

  it('draws the lines in the header\'s currency, never the tenant\'s', async () => {
    const { container } = render(
      <LocalizationProvider value={{ locale: 'en-US', currency: 'USD' }}>
        <MasterDetailForm
          schema={{ objectName: 'po', mode: 'edit', recordId: 'po1', details: [{ childObject: 'po_line', relationshipField: 'po', title: 'Lines', columns: [{ name: 'label', label: 'Line' }, { name: 'amount', label: 'Amount' }], amountField: 'amount' }] } as any}
          dataSource={makeDataSource()}
        />
      </LocalizationProvider>,
    );
    const section = () => container.querySelector('section');
    await waitFor(() => expect(section()?.querySelectorAll('input[value="first"], td').length).toBeGreaterThan(0));
    await waitFor(() => expect((section()?.textContent ?? '').replace(/\u00a0/g, ' ')).toContain('€'));
    const t = (section()?.textContent ?? '').replace(/\u00a0/g, ' ');
    expect(t).not.toContain('$');
  });
});
