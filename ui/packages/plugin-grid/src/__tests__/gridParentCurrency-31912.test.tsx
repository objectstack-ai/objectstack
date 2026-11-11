/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0144 D2 as amended, in the object grid: a line amount whose
 * `currencyField` is `invoice.currency_code` draws in its invoice's currency
 * (symbol and fraction digits), and a sibling-pointer amount draws in the
 * row's own code even when the code column is not shown. Both need the
 * grid's read to carry what the resolver reads: the expanded parent, and the
 * sibling code field.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();
afterEach(cleanup);

const LINE_FIELDS = {
  name: { name: 'name', type: 'text', label: 'Line' },
  invoice: { name: 'invoice', type: 'master_detail', reference: 'inv', label: 'Invoice' },
  amount: { name: 'amount', type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: 'invoice.currency_code' } },
  amount2: { name: 'amount2', type: 'currency', label: 'Amount2', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
  currency_code: { name: 'currency_code', type: 'text', valueDomain: 'iso_4217_currency', label: 'Code' },
};
const PARENTS: Record<string, Record<string, unknown>> = {
  i1: { id: 'i1', name: 'INV-1', currency_code: 'EUR' },
  i2: { id: 'i2', name: 'INV-2', currency_code: 'JPY' },
};
// Two lines under INV-1 and one under INV-2. The lines hold no code of their
// own for `amount`; `amount2` reads each line's own `currency_code`.
const RAW = [
  { id: 'l1', name: 'L1', invoice: 'i1', amount: 1234.5, amount2: 10, currency_code: 'EUR' },
  { id: 'l2', name: 'L2', invoice: 'i1', amount: 99, amount2: 10, currency_code: 'JPY' },
  { id: 'l3', name: 'L3', invoice: 'i2', amount: 1234, amount2: 10, currency_code: 'JPY' },
];

/** A source that honours `$select` and `$expand`, as the server does. */
function source() {
  const calls: Array<Record<string, unknown>> = [];
  const ds = {
    find: async (_o: string, p: Record<string, unknown>) => {
      calls.push(p);
      const exp = Array.isArray(p?.$expand) ? (p.$expand as string[]) : typeof p?.$expand === 'string' ? p.$expand.split(',') : [];
      const sel = Array.isArray(p?.$select) ? (p.$select as string[]) : undefined;
      const data = RAW.map((r) => (exp.includes('invoice') ? { ...r, invoice: PARENTS[r.invoice] } : r)).map((r) =>
        sel ? Object.fromEntries(Object.entries(r).filter(([k]) => k === 'id' || sel.includes(k))) : r,
      );
      return { data, total: data.length };
    },
    findOne: async () => null,
    create: async () => ({}),
    update: async () => ({}),
    delete: async () => true,
    getObjectSchema: async () => ({ name: 'inv_line', fields: LINE_FIELDS }),
  };
  return { ds, calls };
}

async function rowsOf(columns: string[]) {
  const { ds, calls } = source();
  render(
    <LocalizationProvider value={{ locale: 'en-US', currency: 'USD' }}>
      <ActionProvider>
        <ObjectGrid schema={{ type: 'object-grid', objectName: 'inv_line', columns: columns.map((field) => ({ field })) } as never} dataSource={ds as never} />
      </ActionProvider>
    </LocalizationProvider>,
  );
  await waitFor(() => expect(screen.getByText('L1')).toBeInTheDocument());
  const rows = [...document.querySelectorAll('tbody tr')].map((tr) => (tr.textContent ?? '').replace(/ /g, ' '));
  return { rows, calls };
}

describe('object grid: an amount that follows its parent (ADR-0144 D2 as amended)', () => {
  it('draws each line in its own invoice\'s currency, with the invoice column not shown', async () => {
    const { rows, calls } = await rowsOf(['name', 'amount']);
    expect(rows).toEqual([
      expect.stringContaining('€1,234.50'),
      expect.stringContaining('€99.00'),
      expect.stringContaining('¥1,234'),
    ]);
    expect(rows[2]).not.toContain('¥1,234.00');
    expect(rows.join()).not.toContain('$');
    expect(calls.some((c) => (c.$expand as string[] | undefined)?.includes('invoice'))).toBe(true);
  });

  it('still does so with the invoice column shown', async () => {
    const { rows } = await rowsOf(['name', 'invoice', 'amount']);
    expect(rows).toEqual([
      expect.stringContaining('€1,234.50'),
      expect.stringContaining('€99.00'),
      expect.stringContaining('¥1,234'),
    ]);
  });
});

describe('object grid: a sibling-pointer amount with its code column not shown (ADR-0144 D2)', () => {
  it('reads each row\'s own code, so the read carries the code field', async () => {
    const { rows, calls } = await rowsOf(['name', 'amount2']);
    expect(rows).toEqual([
      expect.stringContaining('€10.00'),
      expect.stringContaining('¥10'),
      expect.stringContaining('¥10'),
    ]);
    expect(rows[1]).not.toContain('¥10.00');
    expect(calls.some((c) => (c.$select as string[] | undefined)?.includes('currency_code'))).toBe(true);
  });
});
