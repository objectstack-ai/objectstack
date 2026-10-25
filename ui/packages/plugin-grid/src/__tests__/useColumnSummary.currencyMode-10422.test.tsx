/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10422, the grid summary face: `useColumnSummary` hands the field's
 * `currencyConfig` to `resolveFieldCurrency` verbatim (objectui#10354), and the
 * resolver's truth table is pinned in `@object-ui/i18n` beside it.
 *
 * Under a USD tenant, a `dynamic` field, and an empty config as the spec parses
 * it, sum to exactly what a field with no `currencyConfig` sums to (the
 * tenant's `$`); a `fixed` field keeps its own code. The grid's configured
 * CELLS are held to the whole-def cell by `gridFixedCurrency-10354.test.tsx`,
 * and the whole-def cell to the tenant `$` by `@object-ui/fields`'
 * `currencyMode.faces-10422.test.tsx`.
 *
 * ── Directions on the base tree (predicted before the first run) ─────────
 *   dynamic sums in the tenant currency         RED   (summed in `€`)
 *   parsed-empty sums in the tenant currency    RED   (summed in `CN¥`)
 *   control: fixed JPY sums in `¥`              GREEN (untouched)
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as React from 'react';
import { renderHook, cleanup } from '@testing-library/react';
import { CurrencyConfigSchema } from '@objectstack/spec/data';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { useColumnSummary } from '../useColumnSummary';

afterEach(cleanup);

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ currency: 'USD', locale: 'en' }}>{children}</LocalizationProvider>
    </I18nProvider>
  );
}

// Typed against the hook's own parameter with no cast, so `type-check` reads
// each `currencyConfig` in the spec's shape.
const META: NonNullable<Parameters<typeof useColumnSummary>[2]> = {
  dyn: { type: 'currency', currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'EUR' } },
  // What the spec makes of an authored `currencyConfig: {}`: a dynamic CNY config.
  empty: { type: 'currency', currencyConfig: CurrencyConfigSchema.parse({}) },
  // The reference: no `currencyConfig`, so the tenant currency is right.
  plain: { type: 'currency' },
  fixed: { type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' } },
};

const ROW = { dyn: 3456, empty: 3456, plain: 3456, fixed: 1234 };

function footer(field: keyof typeof ROW): string | undefined {
  const columns: any[] = Object.keys(ROW).map((f) => ({ field: f, summary: 'sum' }));
  const { result } = renderHook(() => useColumnSummary(columns, [ROW], META), { wrapper: Providers });
  return result.current.summaries.get(field)?.label;
}

describe('the grid summary footer agrees with the resolver on currencyMode (objectui#10422)', () => {
  it('dynamic: sums to what a field with no currencyConfig sums to, the tenant $', () => {
    // The `.00` moved on purpose when objectui#11444 retired the whole-amount
    // trimming (triage comment 5946462862).
    expect(footer('plain')).toBe('Sum: $3,456.00');
    expect(footer('dyn')).toBe(footer('plain'));
  });

  it('parsed-empty: an empty config, as the spec parses it, sums in the tenant $, never CN¥', () => {
    expect(footer('empty')).not.toContain('CN¥');
    expect(footer('empty')).toBe(footer('plain'));
  });

  it('control: a fixed JPY field keeps its own ¥', () => {
    expect(footer('fixed')).toBe('Sum: ¥1,234');
  });
});
