/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The record page's body-table editor, the third host of the line grid,
 * judges a pick's amount by each line column's own currency, as the other
 * hosts do (objectstack#36249): a line price following a EUR invoice withholds
 * a home-currency price, and a pick between two amounts in the same currency
 * fills as before.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RecordContextProvider, SchemaRendererContext } from '@object-ui/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import {
  RecordBodyTableEditor,
  RecordEditSessionContext,
  type BodyTableEditHandle,
  type RecordEditSession,
} from './RecordBodyTableEditor';

registerAllFields();
afterEach(() => cleanup());

const LINE_SCHEMA = {
  name: 'fx_line',
  fields: {
    invoice: { type: 'master_detail', label: 'Invoice', reference: 'fx_invoice' },
    product: { type: 'lookup', label: 'Product', reference: 'fx_product' },
    description: { type: 'text', label: 'Description' },
    unit_price: {
      type: 'currency',
      label: 'Unit Price',
      currencyConfig: { currencyMode: 'record', currencyField: 'invoice.currency_code' },
    },
  },
};
const PRODUCT_SCHEMA = {
  name: 'fx_product',
  fields: {
    name: { type: 'text', label: 'Name' },
    description: { type: 'text', label: 'Description' },
    unit_price: { type: 'currency', label: 'Unit Price' },
  },
};
const PRODUCTS = [{ id: 'p1', name: 'Widget', description: 'A widget', unit_price: 100 }];

const FIXED_EUR = { currencyMode: 'fixed', defaultCurrency: 'EUR' } as const;
const withPrice = (schema: typeof LINE_SCHEMA | typeof PRODUCT_SCHEMA, price: Record<string, unknown>) => ({
  ...schema,
  fields: { ...schema.fields, unit_price: price },
});

function mount(
  invoiceCurrency: string,
  schemas: { line?: Record<string, unknown>; product?: Record<string, unknown> } = {},
) {
  const lineSchema = schemas.line ?? LINE_SCHEMA;
  const productSchema = schemas.product ?? PRODUCT_SCHEMA;
  const ds = {
    getObjectSchema: vi.fn(async (name: string) => (name === 'fx_product' ? productSchema : lineSchema)),
    find: vi.fn(async (name: string, params?: { $filter?: { id?: { $in?: unknown[] } } }) => {
      if (name !== 'fx_product') {
        return { data: [{ id: 'l1', invoice: 'i1', product: null, description: null, unit_price: null }] };
      }
      const wanted = params?.$filter?.id?.$in;
      const rows = PRODUCTS.filter((r) => !wanted || wanted.includes(r.id));
      return { data: rows.map((r) => ({ ...r })), total: rows.length };
    }),
    findOne: vi.fn(async (_o: string, id: string) => {
      const row = PRODUCTS.find((r) => r.id === id);
      return row ? { ...row } : null;
    }),
    onMutation: () => () => {},
  };
  let handle: BodyTableEditHandle | null = null;
  const session: RecordEditSession = {
    register: (h) => {
      handle = h;
      return () => { handle = null; };
    },
    reportDirty: () => {},
    saving: false,
  };
  render(
    <LocalizationProvider value={{ currency: 'USD' }}>
      <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
        <RecordContextProvider
          objectName="fx_invoice"
          recordId="i1"
          dataSource={ds as never}
          data={{ id: 'i1', currency_code: invoiceCurrency } as never}
        >
          <RecordEditSessionContext.Provider value={session}>
            <RecordBodyTableEditor objectName="fx_line" relationshipField="invoice" />
          </RecordEditSessionContext.Provider>
        </RecordContextProvider>
      </SchemaRendererContext.Provider>
    </LocalizationProvider>,
  );
  return { ds, rows: () => (handle as BodyTableEditHandle | null)?.snapshot()?.rows ?? null };
}

async function pickWidget(ds: { getObjectSchema: ReturnType<typeof vi.fn> }): Promise<void> {
  const trigger = await screen.findByTestId('lookup-trigger');
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith('fx_product'));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => {
    fireEvent.click(trigger);
  });
  const option = await waitFor(() => {
    const el = screen.getAllByRole('option').find((o) => (o.getAttribute('title') ?? o.textContent ?? '').includes('Widget'));
    if (!el) throw new Error('Widget not offered');
    return el;
  }, { timeout: 3000 });
  await act(async () => {
    fireEvent.click(option);
  });
}

describe('RecordBodyTableEditor — a pick does not copy an amount across currencies (objectstack#36249)', () => {
  it('a line following a EUR invoice: the home price is withheld and the line says why', async () => {
    const { ds, rows } = mount('EUR');
    await pickWidget(ds);
    await waitFor(() => expect(rows()?.[0]).toMatchObject({ product: 'p1', description: 'A widget' }));
    expect(rows()![0].unit_price ?? null).toBeNull();
    const note = await screen.findByTestId('line-items-autofill-withheld-0');
    expect(note.textContent).toContain('$100.00');
    expect(note.textContent).toContain('EUR');
  });

  it('a fixed EUR line price: a fixed EUR product price fills under a USD home currency', async () => {
    const { ds, rows } = mount('USD', {
      line: withPrice(LINE_SCHEMA, { type: 'currency', label: 'Unit Price', currencyConfig: FIXED_EUR }),
      product: withPrice(PRODUCT_SCHEMA, { type: 'currency', label: 'Unit Price', currencyConfig: FIXED_EUR }),
    });
    await pickWidget(ds);
    await waitFor(() => expect(rows()?.[0]).toMatchObject({ product: 'p1', unit_price: 100 }));
    expect(screen.queryByTestId('line-items-autofill-withheld-0')).toBeNull();
  });

  it('a fixed EUR line price: a home-currency product price is withheld', async () => {
    const { ds, rows } = mount('USD', {
      line: withPrice(LINE_SCHEMA, { type: 'currency', label: 'Unit Price', currencyConfig: FIXED_EUR }),
    });
    await pickWidget(ds);
    await waitFor(() => expect(rows()?.[0]).toMatchObject({ product: 'p1', description: 'A widget' }));
    expect(rows()![0].unit_price ?? null).toBeNull();
    expect((await screen.findByTestId('line-items-autofill-withheld-0')).textContent).toContain('EUR');
  });

  it('a line following a USD invoice: the home price fills as before, with no note', async () => {
    const { ds, rows } = mount('USD');
    await pickWidget(ds);
    await waitFor(() => expect(rows()?.[0]).toMatchObject({ product: 'p1', description: 'A widget', unit_price: 100 }));
    expect(screen.queryByTestId('line-items-autofill-withheld-0')).toBeNull();
  });
});
