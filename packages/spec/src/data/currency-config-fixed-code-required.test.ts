// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { CurrencyConfigSchema, FieldSchema } from './field.zod';

/**
 * [#27157] `currencyConfig.defaultCurrency` has no default (ruling 6464202770
 * on #27119, Q2 = X: an amount whose currency is not known takes the tenant
 * default, and nothing guesses).
 *
 * Before: `{ currencyMode: 'fixed' }` parsed to `defaultCurrency: 'CNY'` (a
 * yuan field nobody wrote), and every `dynamic` config's output carried that
 * `'CNY'` too. Now `fixed` without a code is refused with the prescription, at
 * every place the shape is embedded (a currency field and a formula returning
 * `currency` share it), and `dynamic` output carries no code it was not given.
 */

/** The refusal's first sentence: the prescription an author reads. */
const FIRST_SENTENCE =
  "`currencyConfig.currencyMode: 'fixed'` needs `defaultCurrency`, the field's one currency: "
  + "give its ISO 4217 code (e.g. `defaultCurrency: 'USD'`), or use `currencyMode: 'dynamic'` "
  + 'to display amounts in the tenant default currency (the `localization.currency` setting).';

function refusal(result: { success: boolean; error?: { issues: ReadonlyArray<{ code: string; path: PropertyKey[]; message: string }> } }) {
  expect(result.success, 'refused').toBe(false);
  return result.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.'), prescribes: i.message.startsWith(FIRST_SENTENCE) }));
}

describe('currencyConfig — `fixed` needs its code (#27157)', () => {
  it('refuses `fixed` without a code, at `defaultCurrency`, with the prescription', () => {
    expect(refusal(CurrencyConfigSchema.safeParse({ currencyMode: 'fixed' }))).toEqual([
      { code: 'custom', path: 'defaultCurrency', prescribes: true },
    ]);
  });

  it('refuses it on a currency field', () => {
    const r = FieldSchema.safeParse({ name: 'amount', label: 'Amount', type: 'currency', currencyConfig: { currencyMode: 'fixed' } });
    expect(refusal(r)).toEqual([{ code: 'custom', path: 'currencyConfig.defaultCurrency', prescribes: true }]);
  });

  it('refuses it on a formula field returning currency, the same shape (#22727)', () => {
    const r = FieldSchema.safeParse({
      name: 'net', label: 'Net', type: 'formula', expression: 'record.amount - record.tax', returnType: 'currency',
      currencyConfig: { currencyMode: 'fixed' },
    });
    expect(refusal(r)).toEqual([{ code: 'custom', path: 'currencyConfig.defaultCurrency', prescribes: true }]);
  });

  it('passes `fixed` with a code unchanged', () => {
    for (const code of ['USD', 'JPY', 'CNY', 'BTC']) {
      const config = { currencyMode: 'fixed' as const, defaultCurrency: code };
      expect(CurrencyConfigSchema.parse(config)).toEqual(config);
      const field = FieldSchema.parse({ name: 'amount', label: 'Amount', type: 'currency', currencyConfig: config });
      expect(field.currencyConfig).toEqual(config);
    }
  });

  it('gives a `dynamic` config no code it was not given', () => {
    for (const input of [{}, { currencyMode: 'dynamic' as const }]) {
      const out = CurrencyConfigSchema.parse(input);
      expect(out).toEqual({ currencyMode: 'dynamic' });
      expect('defaultCurrency' in out, JSON.stringify(input)).toBe(false);
    }
    // An authored code under `dynamic` is legal and unread; it is returned as written.
    expect(CurrencyConfigSchema.parse({ currencyMode: 'dynamic', defaultCurrency: 'EUR' }))
      .toEqual({ currencyMode: 'dynamic', defaultCurrency: 'EUR' });
  });

  it('parse(parse(x)) is parse(x) for every accepted shape', () => {
    const configs = [
      {}, { currencyMode: 'dynamic' }, { currencyMode: 'dynamic', defaultCurrency: 'EUR' },
      { defaultCurrency: 'GBP' }, { currencyMode: 'fixed', defaultCurrency: 'USD' },
    ];
    for (const config of configs) {
      const once = CurrencyConfigSchema.parse(config);
      expect(CurrencyConfigSchema.parse(once), JSON.stringify(config)).toEqual(once);
      const field = FieldSchema.parse({ name: 'amount', label: 'Amount', type: 'currency', currencyConfig: config });
      expect(FieldSchema.parse(field), JSON.stringify(config)).toEqual(field);
    }
  });
});
