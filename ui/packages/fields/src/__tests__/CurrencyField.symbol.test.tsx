/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4414 — the edit-mode currency adornment has ONE channel.
 *
 * Before this card `CurrencyField.tsx` carried the same one-entry fact twice: a
 * `CURRENCY_SYMBOLS` map that nothing read, and, two lines below it, the live
 * `currency === 'USD' ? '$' : currency` ternary. The PM ruling (issue #4414,
 * claim comment) says one channel survives, and that `Intl` — which already
 * carries this knowledge — is the candidate to MEASURE first.
 *
 * Measured, and it fits: `Intl.NumberFormat(locale, { style: 'currency',
 * currency }).formatToParts()` has a `currency` part, and that part is exactly
 * the string the widget's OWN readonly branch already renders, because the
 * readonly branch formats through `formatDisplayNumber(value, { locale,
 * currency })` — the same `Intl` call. So the adornment was the last hand copy,
 * and the widget disagreed with itself: at `en`, readonly JPY rendered
 * `¥1,235` while the edit adornment beside it said `JPY`.
 *
 * The one place this helper deliberately DIVERGES from its sibling
 * `currencyFractionDigits()`: the digit count is locale-independent (measured
 * across eight locales in `currency.ts`), so that probe drops the locale. The
 * SYMBOL is not — measured on node 22 / full-ICU:
 *
 *     USD -> "$" (en, en-US, de-DE, ja-JP) | "US$" (en-GB, zh-CN) | "$US" (fr-FR)
 *     JPY -> "¥" (en, de-DE) | "￥" (ja-JP) | "JP¥" (en-GB, zh-CN) | "JPY" (fr-FR)
 *
 * so `currencySymbol()` takes the display locale as a parameter and caches on
 * the PAIR. Keying the cache on the code alone would let whichever locale asked
 * first answer for every locale after it — pinned below, because that is a
 * silent wrong-answer bug and not a hypothetical.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocalizationProvider } from '@object-ui/i18n';
import { CurrencyField } from '../widgets/CurrencyField';
import { currencySymbol } from '../currency';

/**
 * ICU separates a currency CODE from the amount with U+00A0 and sets a SYMBOL
 * flush against it; normalizing keeps the readonly-agreement pins about the
 * SYMBOL rather than about ICU's spacing. Written as an escape, never a pasted
 * byte.
 */
const normalizeNbsp = (s: string | null) => (s ?? '').replace(/\u00a0/g, ' ');

const renderField = (
  field: Record<string, unknown>,
  opts: { readonly?: boolean; locale?: string; tenantCurrency?: string } = {},
) =>
  render(
    <LocalizationProvider value={{ locale: opts.locale ?? 'en', currency: opts.tenantCurrency }}>
      <CurrencyField
        value={1234.5}
        onChange={vi.fn()}
        field={{ type: 'currency', ...field } as any}
        readonly={opts.readonly}
      />
    </LocalizationProvider>,
  );

/** The edit-mode prefix adornment: the only `span` inside the wrapper. */
const adornment = (container: HTMLElement) =>
  container.querySelector('div.relative > span')?.textContent ?? null;

describe('CurrencyField adornment — USD is byte-identical at the display-locale default (objectui#4414)', () => {
  it("`en` — useDisplayLocale()'s own last resort — still renders exactly `$`", () => {
    const { container } = renderField({ currency: 'USD' });
    expect(adornment(container)).toBe('$');
  });

  it('`en-US` still renders exactly `$`', () => {
    const { container } = renderField({ currency: 'USD' }, { locale: 'en-US' });
    expect(adornment(container)).toBe('$');
  });

  it('the tenant default currency reaches the adornment too (ADR-0053)', () => {
    const { container } = renderField({}, { tenantCurrency: 'USD' });
    expect(adornment(container)).toBe('$');
  });

  it('a field with NO currency still renders no adornment and no left padding', () => {
    const { container } = renderField({});
    expect(adornment(container)).toBeNull();
    expect(container.querySelector('input')).not.toHaveClass('pl-8');
  });

  it('a field WITH a currency still gets the left padding that clears the adornment', () => {
    const { container } = renderField({ currency: 'USD' });
    expect(container.querySelector('input')).toHaveClass('pl-8');
  });
});

describe('CurrencyField adornment — the DOCUMENTED non-USD change: a real symbol replaces the bare code', () => {
  // Before #4414 every one of these rendered the three-letter ISO code, because
  // the ternary had exactly one entry. This is the deliberate improvement the
  // ruling allowed for, not a side effect — and it is what the widget's own
  // readonly branch has been rendering all along.
  it.each([
    ['EUR', '€'],
    ['JPY', '¥'],
    ['GBP', '£'],
    ['INR', '₹'],
    ['KRW', '₩'],
  ])('%s now renders %s instead of the code', (currency, symbol) => {
    const { container } = renderField({ currency });
    expect(adornment(container)).toBe(symbol);
  });
});

describe('CurrencyField adornment — currencies CLDR has no symbol for keep the code, byte-identical', () => {
  // ICU answers with the code itself for these, which is exactly what the
  // ternary produced. Nothing changes, and that is worth pinning: it is the
  // half of the ruling's "symbol-vs-code nuance" that survives the change.
  it.each(['KWD', 'BHD', 'CHF', 'ISK', 'CLP'])('%s still renders its bare code', (currency) => {
    const { container } = renderField({ currency });
    expect(adornment(container)).toBe(currency);
  });
});

describe('CurrencyField adornment — it agrees with the SAME widget\'s readonly rendering', () => {
  // The real invariant behind this card. The readonly branch already formats
  // through the display locale, so before #4414 the widget contradicted itself
  // for every currency with a symbol.
  it.each([
    ['en', 'JPY'],
    ['en', 'EUR'],
    ['en-GB', 'USD'],
    ['fr-FR', 'USD'],
    ['ja-JP', 'JPY'],
    ['de-DE', 'USD'],
    ['en', 'KWD'],
  ])('%s / %s — the readonly text contains the adornment string', (locale, currency) => {
    const edit = renderField({ currency }, { locale });
    const symbol = adornment(edit.container);
    expect(symbol).toBeTruthy();
    const view = renderField({ currency }, { locale, readonly: true });
    expect(normalizeNbsp(view.container.textContent)).toContain(symbol as string);
  });
});

describe('currencySymbol() — the symbol is locale-dependent, so the locale is a parameter', () => {
  it('USD is not one string across locales', () => {
    expect(currencySymbol('USD', 'en')).toBe('$');
    expect(currencySymbol('USD', 'fr-FR')).toBe('$US');
    expect(currencySymbol('USD', 'en-GB')).toBe('US$');
  });

  it('JPY at ja-JP is the FULLWIDTH yen sign, a different codepoint from `en`', () => {
    // U+FFE5 vs U+00A5 — visually near-identical, so written as escapes.
    expect(currencySymbol('JPY', 'en')).toBe('\u00a5');
    expect(currencySymbol('JPY', 'ja-JP')).toBe('\uffe5');
    expect(currencySymbol('JPY', 'ja-JP')).not.toBe(currencySymbol('JPY', 'en'));
  });

  it('the cache is keyed on the PAIR — the first locale to ask must not answer for the rest', () => {
    // The bug this pin exists for: copying `currencyFractionDigits`' code-only
    // cache key would make these two calls return the same string, whichever
    // ran first, for the rest of the process.
    const first = currencySymbol('GBP', 'en-GB');
    const second = currencySymbol('GBP', 'ar-KW');
    expect(first).toBe('£');
    expect(second).toBe('UK£');
    // …and re-asking returns the cached value, not the other locale's.
    expect(currencySymbol('GBP', 'en-GB')).toBe('£');
  });
});

describe('currencySymbol() — neither a bad code nor a bad locale may escape as a throw', () => {
  it('an invalid currency code falls back to the code as given', () => {
    // `Intl` throws `RangeError: Invalid currency code` for these. The fallback
    // is the code itself, which is both what the ternary produced and what
    // `formatCurrency`'s own bad-code branch renders beside it.
    expect(currencySymbol('not-a-code', 'en')).toBe('not-a-code');
    expect(currencySymbol('USDD', 'en')).toBe('USDD');
  });

  it('a malformed locale tag falls back to the code rather than crashing the widget', () => {
    // `Intl` throws `RangeError: Incorrect locale information provided` for
    // `en_US` (underscore) — the failure mode `currencyFractionDigits` dodged
    // by dropping the locale entirely, which this helper cannot do.
    expect(currencySymbol('USD', 'en_US')).toBe('USD');
  });

  it('the widget renders the code instead of throwing when the code is junk', () => {
    const { container } = renderField({ currency: 'not-a-code' });
    expect(adornment(container)).toBe('not-a-code');
  });
});
