// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import { Invoice, InvoiceLine } from '../src/data/objects/invoice.object.js';

/**
 * objectstack#36005 — an invoice's lines are in the invoice's currency.
 *
 * On a EUR invoice the edit form's line grid and its totals stack drew `$`
 * while "Total incl. Tax" drew `€`: the lines' `unit_price` and `amount` and
 * the `total` Subtotal declared no currency, so every face fell back to the
 * home currency. The numbers were euros all along (the Subtotal sums them, and
 * the invoice's `amount` is that Subtotal plus tax, in `currency_code`).
 *
 * ADR-0144 D2 and D6 as amended (#31743, ruling A) let a `master_detail` child
 * name its parent's code field, and a roll-up through that relation take the
 * parent's currency. The Console already draws both (#31912: the grid's
 * `columnCurrencies`, the totals stack, `record:line_items`); it reads them
 * only from these declarations, so leaving one out raises nothing at boot and
 * the line reads in dollars again.
 */

type CurrencyConfig = { currencyMode?: unknown; currencyField?: unknown };
type FieldDef = { type?: unknown; currencyConfig?: CurrencyConfig; reference?: unknown };

const lineFields = InvoiceLine.fields as Record<string, FieldDef>;
const invoiceFields = Invoice.fields as Record<string, FieldDef>;

describe('showcase invoice lines follow their invoice currency (objectstack#36005)', () => {
  it('the path the lines follow is their own master_detail to the invoice, onto its code field', () => {
    expect(lineFields.invoice?.type).toBe('master_detail');
    expect(lineFields.invoice?.reference).toBe(Invoice.name);
    expect(invoiceFields.currency_code?.type).toBe('text');
  });

  for (const name of ['unit_price', 'amount']) {
    it(`\`${name}\` is a record-mode amount in \`invoice.currency_code\``, () => {
      expect(lineFields[name]?.type).toBe('currency');
      expect(lineFields[name]?.currencyConfig).toEqual({ currencyMode: 'record', currencyField: 'invoice.currency_code' });
    });
  }

  it('the `total` Subtotal rolls the lines up in the invoice currency, the same code `amount` reads', () => {
    expect(invoiceFields.total?.type).toBe('summary');
    expect(invoiceFields.total?.currencyConfig).toEqual({ currencyMode: 'record', currencyField: 'currency_code' });
    expect(invoiceFields.amount?.currencyConfig?.currencyField).toBe('currency_code');
  });
});
