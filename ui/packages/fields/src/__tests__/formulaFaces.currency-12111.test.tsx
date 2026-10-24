/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12111 — a formula declared `returnType: 'currency'` renders as
 * money, in the table cell (`FormulaCellRenderer`) and in the read-only form /
 * detail face (`FormulaField`).
 *
 * `@objectstack/spec` declares the `currency` return type as "an amount of
 * money, in the currency the formula's own `currencyConfig` declares, as a
 * currency field declares it (no `currencyConfig`: dynamic, the tenant default
 * currency)". So each formula face is held to the matching CURRENCY field face
 * handed the same `currencyConfig`: the formula draws through that renderer,
 * not through a formatter of its own.
 *
 * ── Directions on the base tree (predicted before the first run) ─────────
 *   fixed CNY reads CN¥                      RED   (read the bare text 3456)
 *   absent config reads the tenant currency  RED   (same)
 *   CONTROL: returnType 'number' reads 3,456  GREEN (untouched)
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { CurrencyCellRenderer, getCellRenderer } from '../index';
import { CurrencyField } from '../widgets/CurrencyField';
import { FormulaField } from '../widgets/FormulaField';

afterEach(() => cleanup());

const noop = () => {};

/** ICU puts U+00A0 between a currency CODE and the amount; keep rows readable. */
const norm = (s: string | null) => (s ?? '').replace(/\u00a0/g, ' ');

type Tenant = { locale: string; currency: string };
const USD_TENANT: Tenant = { locale: 'en-US', currency: 'USD' };
const EUR_TENANT: Tenant = { locale: 'en-US', currency: 'EUR' };

function textOf(tenant: Tenant, node: React.ReactElement): string {
  const { container } = render(<LocalizationProvider value={tenant}>{node}</LocalizationProvider>);
  const text = norm(container.textContent);
  cleanup();
  return text;
}

type Extra = Record<string, unknown>;
const Cell = getCellRenderer('formula');

const formulaCell = (value: unknown, extra: Extra) => (
  <Cell value={value} field={{ type: 'formula', name: 'computed', ...extra } as never} />
);
const formulaForm = (value: unknown, extra: Extra) => (
  <FormulaField value={value} onChange={noop} field={{ type: 'formula', name: 'computed', ...extra } as never} readonly />
);
const currencyCell = (value: number, extra: Extra) => (
  <CurrencyCellRenderer value={value} field={{ type: 'currency', name: 'amount', ...extra } as never} />
);
const currencyForm = (value: number, extra: Extra) => (
  <CurrencyField value={value} onChange={noop} field={{ type: 'currency', name: 'amount', ...extra } as never} readonly />
);

/** Each formula face beside the currency field face it must equal. */
const FACES = [
  ['cell', formulaCell, currencyCell],
  ['form', formulaForm, currencyForm],
] as const;

const FIXED_CNY = { currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'CNY' } };

describe("a returnType 'currency' formula renders as money (objectui#12111)", () => {
  it.each(FACES)('%s — a fixed CNY currencyConfig reads CN¥, as a CNY currency field does', (_face, formula, currency) => {
    const text = textOf(USD_TENANT, formula(3456, { returnType: 'currency', ...FIXED_CNY }));
    expect(text).toBe('CN¥3,456.00');
    expect(text).toBe(textOf(USD_TENANT, currency(3456, FIXED_CNY)));
  });

  it.each(FACES)('%s — no currencyConfig follows the dynamic path: the tenant default currency', (_face, formula, currency) => {
    expect(textOf(USD_TENANT, formula(3456, { returnType: 'currency' }))).toBe('$3,456.00');
    expect(textOf(EUR_TENANT, formula(3456, { returnType: 'currency' }))).toBe('€3,456.00');
    // The very text a currency field with no currencyConfig reads in the same tenant.
    expect(textOf(EUR_TENANT, formula(3456, { returnType: 'currency' }))).toBe(textOf(EUR_TENANT, currency(3456, {})));
  });

  it.each(FACES)('%s — a dynamic currencyConfig reads the tenant currency, not its defaultCurrency', (_face, formula) => {
    const dynamic = { currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'JPY' } };
    expect(textOf(USD_TENANT, formula(3456, { returnType: 'currency', ...dynamic }))).toBe('$3,456.00');
  });

  it.each(FACES)('%s — a numeric string is read as the declared amount', (_face, formula) => {
    expect(textOf(USD_TENANT, formula('3456', { returnType: 'currency', ...FIXED_CNY }))).toBe('CN¥3,456.00');
  });

  it.each(FACES)('%s — whitespace is empty, not a fabricated 0', (_face, formula) => {
    const { container } = render(
      <LocalizationProvider value={USD_TENANT}>{formula('   ', { returnType: 'currency' })}</LocalizationProvider>,
    );
    expect(container.querySelector('[data-slot="empty-value"]')).not.toBeNull();
    expect(container.textContent).not.toContain('0');
  });

  it("the cell and the form face read the same text", () => {
    const extra = { returnType: 'currency', ...FIXED_CNY };
    expect(textOf(USD_TENANT, formulaCell(1234.5, extra))).toBe(textOf(USD_TENANT, formulaForm(1234.5, extra)));
  });
});

describe("CONTROL: a returnType 'number' formula renders as it did (objectui#12111)", () => {
  it.each(FACES)('%s — a number, grouped, with no currency symbol', (_face, formula) => {
    const text = textOf(USD_TENANT, formula(3456, { returnType: 'number', ...FIXED_CNY }));
    expect(text).toBe('3,456');
  });
});
