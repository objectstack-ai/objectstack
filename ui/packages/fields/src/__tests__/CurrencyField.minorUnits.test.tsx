/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `CurrencyField`'s fraction-digit width — two cards, one rule.
 *
 * objectui#4361, second path: `formatAmount` passes the widget's width to
 * BOTH `Intl` bounds, and the widget defaulted that width to a literal `2`. So
 * a JPY field rendered `¥1,234.50` for the same reason `formatCurrency` did,
 * one layer up. That card made the width derive from the currency's own
 * ISO 4217 minor-unit count — pinned below, unchanged.
 *
 * objectui#10276: that card ALSO let an authored field-level `precision` win
 * over the currency. `@objectstack/spec` declares that key as "Total digits
 * (non-negative integer)" — the `p` of a decimal(p, s) column, so a
 * DECIMAL(18,2) amount is `precision: 18, scale: 2` — and the widget passed it
 * to both `Intl` bounds as decimal places, rendering eighteen of them. The
 * maintainer ruling recorded on objectstack-ai/objectstack#19910 (batch #218
 * item 2) names that reading as wrong: a currency's decimal places are the
 * currency's, not a setting. The pins that used to say "an authored
 * `precision` wins" are REWRITTEN below to the ruled rule, not deleted: the
 * same inputs, now asserting that `precision` moves nothing.
 *
 * `scale` is not a currency width either — the ruling on
 * objectstack-ai/objectstack#19629 (letter B) takes it off the `currency` type,
 * and `CurrencyFieldMetadata` in `@object-ui/types` does not declare it — so a
 * declared `scale` is pinned as inert too.
 *
 * The width is the widget's ONE width, so it reaches the edit affordances too
 * (`step`, and the blur rounding) — pinned below. Leaving those at 2 would
 * produce a JPY field that displays whole yen but offers a 0.01 spinner step
 * and rounds typed input to 1234.56 yen; reading `precision` there would give
 * a DECIMAL(18,2) amount a `1e-18` step.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocalizationProvider } from '@object-ui/i18n';
import { CurrencyField } from '../widgets/CurrencyField';

/**
 * ICU separates a currency CODE from the amount with U+00A0 (`KWD` + NBSP +
 * `1.500`), while a SYMBOL is flush against it (`¥1,235`). `textContent` is
 * raw, so normalizing keeps these pins about the DIGIT COUNT this card is
 * about rather than about ICU's spacing. Written as an escape, never a pasted
 * byte — a raw NBSP in source is invisible to readers and unfindable by grep.
 */
const normalizeNbsp = (s: string | null) => (s ?? '').replace(/\u00a0/g, ' ');

const renderField = (
  value: number | null,
  field: Record<string, unknown>,
  opts: { readonly?: boolean; locale?: string; tenantCurrency?: string; onChange?: (v: any) => void } = {},
) =>
  render(
    <LocalizationProvider value={{ locale: opts.locale ?? 'en-US', currency: opts.tenantCurrency }}>
      <CurrencyField
        value={value as any}
        onChange={opts.onChange ?? vi.fn()}
        field={{ type: 'currency', ...field } as any}
        readonly={opts.readonly}
      />
    </LocalizationProvider>,
  );

describe('CurrencyField — fraction digits derive from the currency (objectui#4361)', () => {
  it('a JPY field shows no cents', () => {
    const { container } = renderField(1234.5, { currency: 'JPY' }, { readonly: true });
    expect(normalizeNbsp(container.textContent)).toBe('¥1,235');
  });

  it('a KWD field shows all three digits', () => {
    const { container } = renderField(1.5, { currency: 'KWD' }, { readonly: true });
    expect(normalizeNbsp(container.textContent)).toBe('KWD 1.500');
  });

  it('the tenant default currency reaches the derivation too (ADR-0053)', () => {
    const { container } = renderField(1234.5, {}, { readonly: true, tenantCurrency: 'JPY' });
    expect(normalizeNbsp(container.textContent)).toBe('¥1,235');
  });

  it('a fixed `currencyConfig.defaultCurrency` reaches it as well', () => {
    // `fixed` mode, the spec's one fixed-currency declaration: a dynamic or
    // mode-less config reads the tenant default instead (objectui#10422).
    const { container } = renderField(
      1.5,
      { currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'KWD' } },
      { readonly: true },
    );
    expect(normalizeNbsp(container.textContent)).toBe('KWD 1.500');
  });

  it('a zero-digit currency keeps its grouping separators', () => {
    // Zero fraction digits is a WIDTH, not the ordinal reading
    // `formatDisplayNumber` gives `scale: 0` (objectui#4033): an amount keeps
    // its thousands separators.
    const { container } = renderField(1234567, { currency: 'JPY' }, { readonly: true });
    expect(normalizeNbsp(container.textContent)).toBe('¥1,234,567');
  });
});

describe('CurrencyField — the field-level `precision` is a TOTAL-digit count and sets no fraction digits (objectui#10276)', () => {
  it('a DECIMAL(18,2) amount — `precision: 18, scale: 2` — shows two decimals, not eighteen', () => {
    const { container } = renderField(
      1234.5,
      { currency: 'USD', precision: 18, scale: 2 },
      { readonly: true },
    );
    expect(normalizeNbsp(container.textContent)).toBe('$1,234.50');
  });

  it('`precision: 18` alone falls to the currency\'s own digits — USD', () => {
    const { container } = renderField(1234.5, { currency: 'USD', precision: 18 }, { readonly: true });
    expect(normalizeNbsp(container.textContent)).toBe('$1,234.50');
  });

  it('`precision: 18` alone falls to the currency\'s own digits — CNY', () => {
    const { container } = renderField(1234.5, { currency: 'CNY', precision: 18 }, { readonly: true });
    expect(normalizeNbsp(container.textContent)).toBe('CN¥1,234.50');
  });

  // The three pins below are the objectui#4361 "an authored `precision` wins"
  // pins, REWRITTEN to the ruled rule on the same inputs: each used to assert
  // the authored count and now asserts the currency's.
  it('a JPY field declaring `precision: 2` shows whole yen', () => {
    // Was `¥1,234.50`.
    const { container } = renderField(1234.5, { currency: 'JPY', precision: 2 }, { readonly: true });
    expect(normalizeNbsp(container.textContent)).toBe('¥1,235');
  });

  it('a `precision: 0` on a 2-digit currency keeps its cents', () => {
    // Was `$1,235`. The other direction, so the pin cannot be satisfied by
    // "`precision` is ignored only when it asks for MORE digits".
    const { container } = renderField(1234.5, { currency: 'USD', precision: 0 }, { readonly: true });
    expect(normalizeNbsp(container.textContent)).toBe('$1,234.50');
  });

  it('a `precision: 3` on JPY shows whole yen', () => {
    // Was `¥1,234.500`.
    const { container } = renderField(1234.5, { currency: 'JPY', precision: 3 }, { readonly: true });
    expect(normalizeNbsp(container.textContent)).toBe('¥1,235');
  });
});

describe('CurrencyField — a declared `scale` sets no fraction digits either', () => {
  // The ruling on objectstack-ai/objectstack#19629 (letter B) takes `scale`
  // off the `currency` type and `CurrencyFieldMetadata` does not declare it,
  // so the widget does not read it: the currency's own digits hold.
  it('`scale: 0` on a USD field keeps its cents', () => {
    const { container } = renderField(1234.5, { currency: 'USD', scale: 0 }, { readonly: true });
    expect(normalizeNbsp(container.textContent)).toBe('$1,234.50');
  });

  it('`scale: 2` on a JPY field shows whole yen', () => {
    const { container } = renderField(1234.5, { currency: 'JPY', scale: 2 }, { readonly: true });
    expect(normalizeNbsp(container.textContent)).toBe('¥1,235');
  });
});

describe('CurrencyField — CONTROL: the 2-digit and no-currency cases are unchanged', () => {
  it('a USD field with no declared precision renders exactly as before', () => {
    // Derivation and the old literal agree at 2, which is the whole point of
    // "byte-identical for USD".
    const { container } = renderField(1234.5, { currency: 'USD' }, { readonly: true });
    expect(normalizeNbsp(container.textContent)).toBe('$1,234.50');
  });

  it('a USD field declaring `precision: 2` renders exactly as before', () => {
    const { container } = renderField(1234.56, { currency: 'USD', precision: 2 }, { readonly: true });
    expect(normalizeNbsp(container.textContent)).toBe('$1,234.56');
  });

  it('a field with NO currency keeps the literal 2 — nothing to derive from', () => {
    const { container } = renderField(1234.5, {}, { readonly: true });
    expect(normalizeNbsp(container.textContent)).toBe('1,234.50');
  });

  it('a field with NO currency ignores `precision` too', () => {
    const { container } = renderField(1234.5, { precision: 18 }, { readonly: true });
    expect(normalizeNbsp(container.textContent)).toBe('1,234.50');
  });

  it('a null value is still the empty marker, not a formatted zero', () => {
    const { container } = renderField(null, { currency: 'JPY' }, { readonly: true });
    expect(container.textContent).not.toContain('¥');
  });
});

describe('CurrencyField — the derived width is the widget\'s ONE width', () => {
  it('a JPY field offers a whole-unit spinner step', () => {
    renderField(1234, { currency: 'JPY' });
    expect(screen.getByRole('spinbutton')).toHaveAttribute('step', '1');
  });

  it('a KWD field offers a three-digit step', () => {
    renderField(1, { currency: 'KWD' });
    expect(screen.getByRole('spinbutton')).toHaveAttribute('step', '0.001');
  });

  it('the step follows the currency whatever `precision` declares', () => {
    // Rewritten from "USD is still 0.01, authored or derived", whose second
    // half pinned `precision: 2` on JPY to a 0.01 step.
    const { unmount } = renderField(1, { currency: 'USD', precision: 18 });
    expect(screen.getByRole('spinbutton')).toHaveAttribute('step', '0.01');
    unmount();
    renderField(1, { currency: 'JPY', precision: 2 });
    expect(screen.getByRole('spinbutton')).toHaveAttribute('step', '1');
  });

  it('blur rounds a typed amount to the currency\'s own unit', () => {
    const onChange = vi.fn();
    renderField(null, { currency: 'JPY' }, { onChange });
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '1234.56' } });
    fireEvent.blur(input, { target: { value: '1234.56' } });
    // Before objectui#4361: 1234.56 yen — a sub-unit amount the currency cannot express.
    expect(onChange).toHaveBeenLastCalledWith(1235);
  });

  it('blur on a `precision: 18` USD field rounds to cents', () => {
    const onChange = vi.fn();
    renderField(null, { currency: 'USD', precision: 18 }, { onChange });
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '1234.567' } });
    fireEvent.blur(input, { target: { value: '1234.567' } });
    expect(onChange).toHaveBeenLastCalledWith(1234.57);
  });

  it('CONTROL: blur on a USD field still rounds to cents', () => {
    const onChange = vi.fn();
    renderField(null, { currency: 'USD' }, { onChange });
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '1234.567' } });
    fireEvent.blur(input, { target: { value: '1234.567' } });
    expect(onChange).toHaveBeenLastCalledWith(1234.57);
  });
});
