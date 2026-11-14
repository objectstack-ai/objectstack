/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0144 D2 as amended, on a line's own detail view: an amount whose
 * `currencyField` is `invoice.currency_code` reads the code off the expanded
 * invoice, so the read expands the `master_detail` even when no section shows
 * it, and the amount draws in the invoice's currency.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { DetailView } from '../DetailView';

registerAllFields();

const LINE_FIELDS: Record<string, any> = {
  name: { type: 'text', label: 'Name' },
  invoice: { type: 'master_detail', reference: 'inv', label: 'Invoice' },
  amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: 'invoice.currency_code' } },
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ allowed: true }), text: async () => '{"allowed":true}' })) as never);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('detail view: an amount that follows its parent (ADR-0144 D2 as amended)', () => {
  it('expands the master_detail no section shows, and draws the amount in the parent\'s currency', async () => {
    const findOne = vi.fn(async (_o: string, _id: string, params?: { $expand?: string[] }) => ({
      id: 'l1',
      name: 'L1',
      amount: 1234.5,
      invoice: params?.$expand?.includes('invoice') ? { id: 'i1', name: 'INV-1', currency_code: 'EUR' } : 'i1',
    }));
    const ds = { find: vi.fn(async () => ({ data: [] })), findOne, create: vi.fn(), update: vi.fn(), delete: vi.fn(), getObjectSchema: vi.fn(async (name: string) => ({ name, fields: LINE_FIELDS })) };
    const { container } = render(
      <LocalizationProvider value={{ locale: 'en-US', currency: 'USD' }}>
        <DetailView
          schema={{ type: 'detail-view', objectName: 'inv_line', resourceId: 'l1', sections: [{ title: 'Basics', fields: [{ name: 'name', label: 'Name' }, { name: 'amount', label: 'Amount' }] }] } as never}
          dataSource={ds as never}
        />
      </LocalizationProvider>,
    );
    await waitFor(() => expect(findOne).toHaveBeenCalled());
    expect(findOne.mock.calls.at(-1)?.[2]?.$expand).toContain('invoice');
    await waitFor(() => expect((container.textContent ?? '').replace(/\u00a0/g, ' ')).toContain('€1,234.50'));
  });
});
