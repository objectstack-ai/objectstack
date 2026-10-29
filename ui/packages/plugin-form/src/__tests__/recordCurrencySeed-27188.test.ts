/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0144 D8 rule 4 — a create form pre-fills a record-currency code field
 * (the field a `record`-mode amount's `currencyField` names) with the
 * organization currency, as a VALUE the user submits; the server never fills
 * one in. Only that field, only with a known organization currency, and never
 * over the author's own `defaultValue` or the caller's record.
 */

import { describe, it, expect } from 'vitest';
import { schemaDefaultValues, seedCreateValues } from '../schemaDefaults';

const INVOICE = {
  fields: {
    currency_code: { type: 'text', valueDomain: 'iso_4217_currency' },
    amount: { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
    // An ISO-domain text field no amount points at is not the record currency.
    billing_currency: { type: 'text', valueDomain: 'iso_4217_currency' },
    total: { type: 'currency', currencyConfig: { currencyMode: 'dynamic' } },
  },
};

describe('create-form seeding of the record currency (ADR-0144 D8 rule 4)', () => {
  it('pre-fills the pointed-at code field with the organization currency', () => {
    expect(schemaDefaultValues(INVOICE, { homeCurrency: 'CNY' })).toEqual({ currency_code: 'CNY' });
  });

  it('seeds nothing while the organization currency is unset', () => {
    expect(schemaDefaultValues(INVOICE, { homeCurrency: undefined })).toEqual({});
    expect(schemaDefaultValues(INVOICE)).toEqual({});
  });

  it('the author\'s defaultValue wins', () => {
    const schema = { fields: { ...INVOICE.fields, currency_code: { ...INVOICE.fields.currency_code, defaultValue: 'EUR' } } };
    expect(schemaDefaultValues(schema, { homeCurrency: 'CNY' }).currency_code).toBe('EUR');
  });

  it('the caller\'s record wins', () => {
    expect(seedCreateValues(INVOICE, { currency_code: 'JPY' }, { homeCurrency: 'CNY' }).currency_code).toBe('JPY');
  });
});
