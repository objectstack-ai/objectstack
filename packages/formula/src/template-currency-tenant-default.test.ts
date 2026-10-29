// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `currency` hole with no argument formats in the tenant default currency
 * (`localization.currency`), handed in on the context's reserved `currency`
 * channel — the code a currency field and a dashboard measure read. With no
 * tenant default the hole is refused at render, by name: nothing formats in
 * USD, or in any currency nobody chose.
 *
 * Authoring is unchanged: the no-argument form compiles and validates, because
 * whether a tenant default exists is a fact of the render, not of the text.
 */
import { describe, expect, it } from 'vitest';

import { currencyDefaultRefusal } from './index';
import { formatValue, templateEngine } from './template-engine';
import { validateExpression } from './validate';

const evaluate = (source: string, record: Record<string, unknown>, extra: { locale?: string; currency?: string } = {}) =>
  templateEngine.evaluate<string>({ dialect: 'template', source }, { record, locale: 'en-US', ...extra });

describe('no argument: the tenant default currency', () => {
  it.each([
    ['CNY', 'en-US', 'CN¥1,234.50'],
    ['CNY', 'zh-CN', '¥1,234.50'],
    ['EUR', 'en-US', '€1,234.50'],
    ['JPY', 'en-US', '¥1,235'],
  ])('formats in %s for a %s reader', (currency, locale, expected) => {
    expect(evaluate('{{ record.amount | currency }}', { amount: 1234.5 }, { locale, currency })).toEqual({
      ok: true,
      value: expected,
    });
  });

  it('a hole that names its code does not read the tenant default', () => {
    expect(evaluate('{{ record.amount | currency:EUR }}', { amount: 1234.5 }, { currency: 'CNY' })).toEqual({
      ok: true,
      value: '€1,234.50',
    });
  });

  it('a root named `currency` is a value, never the tenant default', () => {
    const r = templateEngine.evaluate<string>(
      { dialect: 'template', source: '{{ amount | currency }} {{ currency }}' },
      { extra: { amount: 1234.5, currency: 'EUR' }, locale: 'en-US' },
    );
    expect(r.ok).toBe(false);
  });

  it('formats an empty value as empty, like every formatter', () => {
    expect(evaluate('[{{ record.amount | currency }}]', { amount: null }, { currency: 'CNY' })).toEqual({
      ok: true,
      value: '[]',
    });
  });
});

describe('no argument and no tenant default: refused at render, by name', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['lowercase', 'usd'],
    ['not a code', 'dollars'],
  ])('refuses the sentence when the tenant default is %s', (_label, currency) => {
    const r = evaluate('Due {{ record.amount | currency }} today', { amount: 1234.5 }, currency === undefined ? {} : { currency });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('runtime');
    expect(r.error.message).toContain('{{ record.amount | currency }}');
    expect(r.error.message).toContain('localization.currency');
    expect(r.error.message).toContain('currency:EUR');
    expect(r.error.message).not.toContain('$');
  });

  it('refuses whatever the value: the refusal does not depend on the data', () => {
    const r = evaluate('{{ record.amount | currency }}', { amount: null });
    expect(r.ok).toBe(false);
  });

  it('refuses the whole sentence, even when another hole names its code', () => {
    const r = evaluate('{{ record.a | currency:EUR }} / {{ record.b | currency }}', { a: 1, b: 2 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain('{{ record.b | currency }}');
  });

  it('a sentence with no no-argument currency hole does not need a tenant default', () => {
    expect(evaluate('{{ record.amount | currency:EUR }} {{ record.amount | number:1 }}', { amount: 1234.5 })).toEqual({
      ok: true,
      value: '€1,234.50 1,234.5',
    });
  });
});

describe('authoring is unchanged', () => {
  it('the no-argument form compiles and validates: a tenant default is a fact of the render', () => {
    expect(templateEngine.compile('Due {{ record.amount | currency }}').ok).toBe(true);
    const v = validateExpression('template', { dialect: 'template', source: 'Due {{ record.amount | currency }}' });
    expect(v.ok).toBe(true);
  });
});

describe('formatValue (the mail renderer reads it)', () => {
  it('formats no argument in the tenant default it is handed', () => {
    expect(formatValue('currency', 1234.5, undefined, { locale: 'zh-CN', currency: 'CNY' })).toBe('¥1,234.50');
  });

  it('throws without one, whatever the value, and never formats in USD', () => {
    expect(() => formatValue('currency', 1234.5, undefined, { locale: 'en-US' })).toThrow(RangeError);
    expect(() => formatValue('currency', 1234.5, undefined, { locale: 'en-US' })).toThrow(/localization\.currency/);
    expect(() => formatValue('currency', null, undefined)).toThrow(RangeError);
  });
});

describe('currencyDefaultRefusal', () => {
  it('is null for a tenant default in three capitals, and the sentence otherwise', () => {
    expect(currencyDefaultRefusal('{{ x | currency }}', 'CNY')).toBeNull();
    const refusal = currencyDefaultRefusal('{{ x | currency }}', undefined);
    expect(refusal).toContain('{{ x | currency }}');
    expect(refusal).toContain('Setup → Localization');
    expect(refusal).not.toContain('@');
  });

  it('names the marked-path form in the mail dialect only', () => {
    expect(currencyDefaultRefusal('{{ x | currency }}', 'EUR', 'mail')).toBeNull();
    expect(currencyDefaultRefusal('{{ x | currency }}', undefined, 'mail')).toContain('`currency:@currency_code`');
  });
});
