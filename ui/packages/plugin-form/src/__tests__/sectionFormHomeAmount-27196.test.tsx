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
import { render, waitFor, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import React from 'react';
import { LocalizationProvider } from '@object-ui/i18n';
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
