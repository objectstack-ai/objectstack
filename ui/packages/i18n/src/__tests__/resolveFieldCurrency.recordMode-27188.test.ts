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
import { resolveFieldCurrency, recordCurrencyField, recordCurrencyPath, recordCurrencyReadField, withFollowedParent } from '../currency';

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

// ADR-0144 D2 as amended: a `currencyField` of `<master_detail>.<parent code
// field>` reads the code off the parent row expanded under that relation.
describe('resolveFieldCurrency — the parent path (ADR-0144 D2 as amended)', () => {
  const PATH = { currencyConfig: { currencyMode: 'record' as const, currencyField: 'invoice.currency_code' } };
  const INV_EUR = { id: 'i1', currency_code: 'EUR' };

  it('reads the code off the expanded parent, never a sibling of the same name or the tenant', () => {
    expect(resolveFieldCurrency(PATH, TENANT, { invoice: INV_EUR, currency_code: 'JPY' })).toBe('EUR');
    expect(resolveFieldCurrency(PATH, TENANT, { invoice: 'i1', currency_code: 'JPY' })).toBeUndefined();
    expect(resolveFieldCurrency(PATH, TENANT, { invoice: { id: 'i1', currency_code: '' } })).toBeUndefined();
    expect(resolveFieldCurrency(PATH, TENANT, {})).toBeUndefined();
  });

  it('two lines under one parent read its code; two parents read each their own', () => {
    const INV_JPY = { id: 'i2', currency_code: 'JPY' };
    expect([{ invoice: INV_EUR }, { invoice: INV_EUR }].map((r) => resolveFieldCurrency(PATH, TENANT, r))).toEqual(['EUR', 'EUR']);
    expect([{ invoice: INV_EUR }, { invoice: INV_JPY }].map((r) => resolveFieldCurrency(PATH, TENANT, r))).toEqual(['EUR', 'JPY']);
  });

  it('the sibling pointer still reads the record\'s own field', () => {
    expect(resolveFieldCurrency(RECORD_MODE, TENANT, { invoice: INV_EUR, currency_code: 'JPY' })).toBe('JPY');
  });

  it('splits only a two-segment pointer, and names what a projection must read', () => {
    expect(recordCurrencyPath(PATH)).toEqual({ via: 'invoice', codeField: 'currency_code' });
    expect(recordCurrencyPath(RECORD_MODE)).toBeUndefined();
    for (const bad of ['a.b.c', '.code', 'invoice.']) {
      expect(recordCurrencyPath({ currencyConfig: { currencyMode: 'record', currencyField: bad } })).toBeUndefined();
    }
    expect(recordCurrencyReadField(PATH)).toEqual({ field: 'invoice', expand: true });
    expect(recordCurrencyReadField(RECORD_MODE)).toEqual({ field: 'currency_code', expand: false });
  });

  it('withFollowedParent lays the host\'s parent under the relation, unless the row names another parent', () => {
    expect(withFollowedParent({ invoice: 'i1' }, PATH, INV_EUR)).toEqual({ invoice: INV_EUR });
    expect(withFollowedParent(undefined, PATH, INV_EUR)).toEqual({ invoice: INV_EUR });
    expect(withFollowedParent({ invoice: 'i9' }, PATH, INV_EUR)).toEqual({ invoice: 'i9' });
    const expanded = { invoice: { id: 'i1', currency_code: 'JPY' } };
    expect(withFollowedParent(expanded, PATH, INV_EUR)).toBe(expanded);
    const sibling = { currency_code: 'JPY' };
    expect(withFollowedParent(sibling, RECORD_MODE, INV_EUR)).toBe(sibling);
  });
});
