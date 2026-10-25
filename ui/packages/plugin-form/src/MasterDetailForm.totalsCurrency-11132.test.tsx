/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The master-detail form's document totals stack (Subtotal / Tax / Total)
 * shows the currency of the amounts it adds, never a constant sign
 * (objectui#11132). It used to prefix a literal `¥` whatever the amount field's
 * or the tenant's currency.
 *
 * The currency comes from `resolveFieldCurrency` on the entry's amount field,
 * the one precedence every currency face shares: the field's fixed currency,
 * else the tenant default (ADR-0053). The amount is `Intl`'s currency format in
 * the display locale, so the width is the currency's own minor unit.
 *
 * Every case enters the same line (1234.5) under a 10% header tax rate, so the
 * three lines read 1234.5 / 123.45 / 1357.95 before formatting.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from './MasterDetailForm';

registerAllFields();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PARENT = 'po';
const PARENT_SCHEMA = {
  name: PARENT,
  fields: {
    ref: { type: 'text', label: 'Ref' },
    // Present so the Subtotal / Tax / Total stack renders.
    tax_rate: { type: 'number', label: 'Tax Rate' },
  },
};

/** A child whose `line_total` amount field carries `lineTotal`'s extra keys. */
function lineSchema(name: string, lineTotal: Record<string, unknown> = {}) {
  return {
    name,
    fields: {
      po: { type: 'master_detail', label: 'PO', reference: PARENT },
      line_total: { type: 'currency', label: 'Line Total', ...lineTotal },
    },
  };
}

function dataSource(children: Record<string, ReturnType<typeof lineSchema>>) {
  return {
    getObjectSchema: vi.fn(async (obj: string) => (obj === PARENT ? PARENT_SCHEMA : children[obj])),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
  } as never;
}

/**
 * The three ways an entry reaches the form, one per branch of its resolve
 * effect: fully configured (no child schema is fetched), identity-only columns
 * hydrated from the child schema (the shape `inlineColumns` produces), and a
 * bare `childObject` whose FK, columns and amount field are all derived.
 */
const FULL = {
  childObject: 'po_line',
  relationshipField: 'po',
  amountField: 'line_total',
  columns: [{ name: 'line_total', label: 'Line Total', type: 'currency' }],
};
const HYDRATED = {
  childObject: 'po_line',
  relationshipField: 'po',
  amountField: 'line_total',
  columns: [{ name: 'line_total' }],
};
const DERIVED = { childObject: 'po_line' };

interface Stack {
  subtotal: string;
  tax: string;
  total: string;
}

/** Render, enter one 1234.5 line and a 10% tax rate, and read the three lines. */
async function renderStack(opts: {
  details: unknown[];
  children: Record<string, ReturnType<typeof lineSchema>>;
  tenantCurrency?: string;
  locale?: string;
}): Promise<Stack> {
  const view = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: opts.locale ?? 'en', currency: opts.tenantCurrency }}>
        <MasterDetailForm
          schema={{ objectName: PARENT, mode: 'create', fields: ['ref', 'tax_rate'], details: opts.details } as never}
          dataSource={dataSource(opts.children)}
        />
      </LocalizationProvider>
    </I18nProvider>,
  );
  const cell = await waitFor(() => screen.getAllByLabelText('Line Total')[0] as HTMLInputElement);
  fireEvent.change(cell, { target: { value: '1234.5' } });
  const rate = await waitFor(() => {
    const el = view.container.querySelector('input[name="tax_rate"]') as HTMLInputElement | null;
    expect(el).not.toBeNull();
    return el!;
  });
  fireEvent.change(rate, { target: { value: '10' } });
  // Settled once the tax line carries the rate's amount (123.45 in any width).
  return waitFor(() => {
    const read = (id: string) => (screen.getByTestId(id).textContent ?? '').replace(/\s+/g, ' ').trim();
    const stack = { subtotal: read('md-subtotal'), tax: read('md-tax'), total: read('md-grand-total') };
    expect(stack.tax).toMatch(/12[34]/);
    expect(stack.subtotal).toMatch(/1.23[45]/);
    return stack;
  });
}

describe('the master-detail totals stack shows the amounts’ own currency (objectui#11132)', () => {
  it.each([
    ['fully configured', FULL],
    ['hydrated columns', HYDRATED],
    ['derived', DERIVED],
  ])('a USD tenant reads `$` on all three lines — %s entry', async (_shape, detail) => {
    const stack = await renderStack({
      details: [detail],
      children: { po_line: lineSchema('po_line') },
      tenantCurrency: 'USD',
    });
    expect(stack).toEqual({ subtotal: '$1,234.50', tax: '$123.45', total: '$1,357.95' });
  });

  it.each([
    ['hydrated columns', HYDRATED],
    ['derived', DERIVED],
  ])('an amount field with a FIXED currency shows that one, not the tenant’s — %s entry', async (_shape, detail) => {
    const stack = await renderStack({
      details: [detail],
      children: { po_line: lineSchema('po_line', { currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' } }) },
      tenantCurrency: 'USD',
    });
    expect(stack).toEqual({ subtotal: '€1,234.50', tax: '€123.45', total: '€1,357.95' });
  });

  it('a DYNAMIC currency config is not a fixed one: the tenant’s currency wins over its defaultCurrency', async () => {
    // The resolver's own `currencyMode` rule (objectui#10422) reaches the stack:
    // it reads the field through `resolveFieldCurrency`, not a hand-read key.
    const stack = await renderStack({
      details: [DERIVED],
      children: { po_line: lineSchema('po_line', { currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'EUR' } }) },
      tenantCurrency: 'USD',
    });
    expect(stack).toEqual({ subtotal: '$1,234.50', tax: '$123.45', total: '$1,357.95' });
  });

  it('the width is the currency’s minor unit: a JPY tenant reads whole yen, where the stack used to print two places', async () => {
    const stack = await renderStack({
      details: [FULL],
      children: { po_line: lineSchema('po_line') },
      tenantCurrency: 'JPY',
    });
    expect(stack).toEqual({ subtotal: '¥1,235', tax: '¥123', total: '¥1,358' });
  });

  it('the sign sits where the display locale puts it, with that locale’s grouping (de-DE)', async () => {
    const stack = await renderStack({
      details: [FULL],
      children: { po_line: lineSchema('po_line') },
      tenantCurrency: 'USD',
      locale: 'de-DE',
    });
    expect(stack).toEqual({ subtotal: '1.234,50 $', tax: '123,45 $', total: '1.357,95 $' });
  });

  it('with no currency known anywhere, the lines are plain numbers: no guessed sign', async () => {
    const stack = await renderStack({
      details: [FULL],
      children: { po_line: lineSchema('po_line') },
    });
    expect(stack).toEqual({ subtotal: '1,234.50', tax: '123.45', total: '1,357.95' });
  });

  it('entries whose amounts resolve to DIFFERENT currencies share no sign: the subtotal adds both', async () => {
    const fees = { childObject: 'po_fee', title: 'Fees' };
    const stack = await renderStack({
      details: [DERIVED, fees],
      children: {
        po_line: lineSchema('po_line'),
        po_fee: lineSchema('po_fee', { currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' } }),
      },
      tenantCurrency: 'USD',
    });
    expect(stack).toEqual({ subtotal: '1,234.50', tax: '123.45', total: '1,357.95' });
  });
});
