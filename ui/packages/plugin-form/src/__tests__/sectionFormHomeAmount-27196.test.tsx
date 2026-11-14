/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0144 D5 on authored sections, on each host that draws them: the record
 * dialog and drawer (`ModalForm` / `DrawerForm` through `buildSectionFields`)
 * and an inline `ObjectForm` (its own field build): the home field a
 * `record`-mode amount declares draws its read face with the rate and
 * document date the engine converted at, instead of the disabled number box
 * every readonly field gets. The auto-layout form keeps dropping readonly
 * fields, the home field included (`filterSystemFields`), unchanged.
 */
import { describe, it, expect } from 'vitest';
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach } from 'vitest';
import React from 'react';
import { LocalizationProvider } from '@object-ui/i18n';
import { SchemaRendererProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { ModalForm } from '../ModalForm';
import { DrawerForm } from '../DrawerForm';
import { ObjectForm } from '../ObjectForm';

registerAllFields();
afterEach(cleanup);

const OBJ = {
  name: 'fx_invoice',
  fields: {
    title: { type: 'text', label: 'Title' },
    currency_code: { type: 'text', label: 'Currency', valueDomain: 'iso_4217_currency' },
    invoice_date: { type: 'date', label: 'Invoice date' },
    amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code', homeAmount: { field: 'amount_home', rateDate: 'invoice_date', rateField: 'amount_rate' } } },
    amount_home: { type: 'currency', label: 'Amount (home)', readonly: true },
    amount_rate: { type: 'number', label: 'Rate used', readonly: true },
    other_home: { type: 'currency', label: 'Other', readonly: true },
  },
};
const ROW = { id: 'r1', title: 'A', currency_code: 'EUR', invoice_date: '2026-11-01', amount: 10000, amount_home: 71994.24, amount_rate: 0.1389, other_home: 5 };

type Host = 'modal' | 'drawer' | 'inline';
const SECTIONS = [{ label: 'S', fields: ['title', 'amount_home', 'other_home'] }];

async function rows(mode: 'edit' | 'view', host: Host = 'modal') {
  const ds = { getObjectSchema: async () => OBJ, findOne: async () => ROW, create: async () => ROW, update: async () => ROW };
  const base = { type: 'object-form', objectName: 'fx_invoice', mode, recordId: 'r1', sections: SECTIONS } as any;
  const form =
    host === 'modal' ? <ModalForm schema={{ ...base, formType: 'modal', open: true }} dataSource={ds as any} />
    : host === 'drawer' ? <DrawerForm schema={{ ...base, formType: 'drawer', open: true }} dataSource={ds as any} />
    : <ObjectForm schema={base} dataSource={ds as any} />;
  render(<LocalizationProvider value={{ locale: 'en-US', currency: 'CNY' }}>{form}</LocalizationProvider>);
  const container = document.body;
  await waitFor(() => {
    if (!container.querySelector('[data-testid="home-amount-hint"]')) throw new Error('form not ready: ' + (container.querySelector('[data-field="amount_home"]')?.innerHTML ?? container.innerHTML.slice(0, 600)));
  }, { timeout: 5000 });
  return (name: string) => container.querySelector(`[data-field="${name}"]`)!;
}

describe('authored sections: the home field (ADR-0144 D5)', () => {
  for (const [mode, host] of [['edit', 'modal'], ['view', 'modal'], ['edit', 'drawer'], ['edit', 'inline']] as const) {
    it(`${host} ${mode}: draws the amount in the home currency with "Converted at RATE on DATE", no input`, async () => {
      const row = await rows(mode, host);
      const home = row('amount_home');
      expect(home.querySelector('input')).toBeNull();
      expect(home.textContent?.replace(/\u00a0/g, ' ')).toContain('CN¥71,994.24');
      expect(home.querySelector('[data-testid="home-amount-hint"]')?.textContent).toBe('Converted at 0.1389 on Nov 1, 2026');
    });
  }

  it('CONTROL: a readonly currency field no amount names stays the disabled box it was', async () => {
    const row = await rows('edit');
    const other = row('other_home');
    expect((other.querySelector('input') as HTMLInputElement).disabled).toBe(true);
    expect(other.querySelector('[data-testid="home-amount-hint"]')).toBeNull();
  });
});

describe('the live preview under the amount, through the form (ADR-0144 D5)', () => {
  it('an edited record-mode amount shows what the save stores, read through the host adapter', async () => {
    const finds: string[] = [];
    const ds = {
      getObjectSchema: async () => OBJ, findOne: async () => ROW, create: async () => ROW, update: async () => ROW,
      find: async (resource: string) => { finds.push(resource); return { data: [{ rate: 0.1389, effective_date: '2026-10-01' }] }; },
    };
    render(
      <SchemaRendererProvider dataSource={ds as any}>
        <LocalizationProvider value={{ locale: 'en-US', currency: 'CNY' }}>
          <ObjectForm schema={{ type: 'object-form', objectName: 'fx_invoice', mode: 'edit', recordId: 'r1' } as any} dataSource={ds as any} />
        </LocalizationProvider>
      </SchemaRendererProvider>,
    );
    await waitFor(() => {
      const line = document.querySelector('[data-field="amount"] [data-testid="home-amount-preview"]');
      expect(line?.textContent?.replace(/\u00a0/g, ' ')).toBe('≈ CN¥71,994.24 at 0.1389 on Nov 1, 2026');
    }, { timeout: 5000 });
    expect(finds).toEqual(['sys_exchange_rate']);
  });
});

describe('an expression-computed record-mode amount keeps the live preview on its read face (objectstack#32941)', () => {
  // The showcase invoice's `amount`: an `expression` makes the form draw it
  // read-only (objectstack#31759), and the save still re-stores its home
  // amount at the currency and document date the form holds.
  const COMPUTED = { ...OBJ, fields: { ...OBJ.fields, amount: { ...OBJ.fields.amount, expression: 'record.subtotal * 1.1' }, subtotal: { type: 'number', label: 'Subtotal' } } };
  const EUR_ROW = { ...ROW, currency_code: 'EUR', invoice_date: '2026-11-12', amount: 450, subtotal: 409.09, amount_home: 500, amount_rate: 0.9 };
  const RATES: Record<string, Array<[string, number]>> = { EUR: [['2025-01-01', 0.92], ['2026-10-01', 0.9]], JPY: [['2025-01-01', 151.5]] };

  function open(mode: 'edit' | 'view') {
    const ds = {
      getObjectSchema: async () => COMPUTED, findOne: async () => EUR_ROW, create: async () => EUR_ROW, update: async () => EUR_ROW,
      find: async (_resource: string, params: any) => {
        const { currency, effective_date } = params.$filter;
        const row = (RATES[currency] ?? []).filter(([d]) => d <= effective_date.$lte).sort(([a], [b]) => (a < b ? 1 : -1))[0];
        return { data: row ? [{ effective_date: row[0], rate: row[1] }] : [] };
      },
    };
    render(
      <SchemaRendererProvider dataSource={ds as any}>
        <LocalizationProvider value={{ locale: 'en-US', currency: 'USD' }}>
          <ObjectForm schema={{ type: 'object-form', objectName: 'fx_invoice', mode, recordId: 'r1', sections: [{ label: 'S', fields: ['currency_code', 'invoice_date', 'subtotal', 'amount', 'amount_home'] }] } as any} dataSource={ds as any} />
        </LocalizationProvider>
      </SchemaRendererProvider>,
    );
  }
  const amountRow = () => document.querySelector('[data-field="amount"]');
  const preview = () => amountRow()?.querySelector('[data-testid="home-amount-preview"]');

  it('edit form: the amount draws read-only (no input) with the converted line, and follows a changed document date and currency', async () => {
    open('edit');
    await waitFor(() => {
      expect(preview()?.textContent?.replace(/\u00a0/g, ' ')).toBe('≈ $500.00 at 0.9 on Nov 12, 2026');
    }, { timeout: 5000 });
    expect(preview()).toHaveAttribute('data-state', 'converted');
    expect(amountRow()!.querySelector('input')).toBeNull();
    // The document date, typed into the form's own date box and committed.
    const date = document.querySelector('[data-field="invoice_date"] input') as HTMLInputElement;
    fireEvent.change(date, { target: { value: '01/15/2026' } });
    fireEvent.blur(date);
    await waitFor(() => {
      expect(preview()?.textContent?.replace(/\u00a0/g, ' ')).toBe('≈ $489.13 at 0.92 on Jan 15, 2026');
    }, { timeout: 5000 });
    // The currency, picked in the form's own currency select.
    fireEvent.click(document.querySelector('[data-field="currency_code"] [role="combobox"]')!);
    const jpy = await waitFor(() => {
      const option = Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent?.startsWith('JPY'));
      if (!option) throw new Error('no JPY option');
      return option as HTMLElement;
    }, { timeout: 5000 });
    fireEvent.click(jpy);
    await waitFor(() => {
      expect(preview()?.textContent?.replace(/\u00a0/g, ' ')).toBe('≈ $2.97 at 151.5 on Jan 15, 2026');
    }, { timeout: 5000 });
  });

  it('CONTROL: the view-mode form draws the amount with no preview; the home field keeps its "Converted at" line', async () => {
    open('view');
    await waitFor(() => {
      expect(document.querySelector('[data-field="amount_home"] [data-testid="home-amount-hint"]')?.textContent).toBe('Converted at 0.9 on Nov 12, 2026');
    }, { timeout: 5000 });
    expect(amountRow()?.textContent?.replace(/\u00a0/g, ' ')).toContain('€450.00');
    await new Promise((r) => setTimeout(r, 20));
    expect(preview()).toBeFalsy();
  });
});
