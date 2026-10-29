/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0144 D2 — a `record`-mode amount's currency is the value of the sibling
 * code field its `currencyConfig.currencyField` names, read off the record in
 * scope. No value ⇒ no currency: never the tenant default, never a stray
 * `defaultCurrency`, never a node-level `currency`.
 */

import { describe, it, expect } from 'vitest';
import { resolveFieldCurrency, recordCurrencyField } from '../currency';

const RECORD_MODE = { currencyConfig: { currencyMode: 'record' as const, currencyField: 'currency_code' } };
const TENANT = 'CNY';

describe('resolveFieldCurrency — record mode (ADR-0144 D2)', () => {
  it('reads the record\'s code field', () => {
    expect(resolveFieldCurrency(RECORD_MODE, TENANT, { amount: 1, currency_code: 'EUR' })).toBe('EUR');
    expect(resolveFieldCurrency(RECORD_MODE, TENANT, { amount: 1, currency_code: 'JPY' })).toBe('JPY');
  });

  it('no record, or a blank code, resolves to no currency — not the tenant default', () => {
    expect(resolveFieldCurrency(RECORD_MODE, TENANT)).toBeUndefined();
    expect(resolveFieldCurrency(RECORD_MODE, TENANT, null)).toBeUndefined();
    expect(resolveFieldCurrency(RECORD_MODE, TENANT, { currency_code: '' })).toBeUndefined();
    expect(resolveFieldCurrency(RECORD_MODE, TENANT, { currency_code: null })).toBeUndefined();
    expect(resolveFieldCurrency(RECORD_MODE, TENANT, { other: 'USD' })).toBeUndefined();
  });

  it('a node-level currency or a stray defaultCurrency does not outrank the record', () => {
    const field = {
      currency: 'USD',
      defaultCurrency: 'GBP',
      currencyConfig: { currencyMode: 'record' as const, currencyField: 'currency_code', defaultCurrency: 'CNY' },
    };
    expect(resolveFieldCurrency(field, TENANT, { currency_code: 'EUR' })).toBe('EUR');
    expect(resolveFieldCurrency(field, TENANT, {})).toBeUndefined();
  });

  it('a record is ignored outside record mode', () => {
    expect(resolveFieldCurrency({ currencyConfig: { currencyMode: 'dynamic' } }, TENANT, { currency_code: 'EUR' })).toBe('CNY');
    expect(
      resolveFieldCurrency({ currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' } }, TENANT, { currency_code: 'EUR' }),
    ).toBe('JPY');
  });

  it('recordCurrencyField names the pointer only under record mode', () => {
    expect(recordCurrencyField(RECORD_MODE)).toBe('currency_code');
    expect(recordCurrencyField({ currencyConfig: { currencyMode: 'record' } })).toBeUndefined();
    expect(recordCurrencyField({ currencyConfig: { currencyMode: 'fixed', currencyField: 'x' } })).toBeUndefined();
    expect(recordCurrencyField(undefined)).toBeUndefined();
  });
});
