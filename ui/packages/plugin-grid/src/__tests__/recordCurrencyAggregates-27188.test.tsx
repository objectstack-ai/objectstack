/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0144 D6 on the grid: a money aggregate over a `record`-mode amount
 * stands only inside one currency — a group bucketed by the amount's code
 * field. The footer spans every row, so it draws no sum for such a column; the
 * counts stand, and a `dynamic` (home) amount sums as it always did.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as React from 'react';
import { renderHook, cleanup } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { useColumnSummary, offeredColumnSummaries } from '../useColumnSummary';
import { honestGroupAggregations, requiredAggregateGrouping } from '../recordCurrencyAggregates';

afterEach(cleanup);

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ currency: 'CNY', locale: 'en' }}>{children}</LocalizationProvider>
    </I18nProvider>
  );
}

const META: NonNullable<Parameters<typeof useColumnSummary>[2]> = {
  amount: { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
  amount_home: { type: 'currency', currencyConfig: { currencyMode: 'dynamic' } },
};
const ROWS = [
  { amount: 100, amount_home: 720, currency_code: 'USD' },
  { amount: 100, amount_home: 780, currency_code: 'EUR' },
];

function footer(field: string, summary: string): string | undefined {
  const columns: any[] = [{ field, summary }];
  const { result } = renderHook(() => useColumnSummary(columns, ROWS, META), { wrapper: Providers });
  return result.current.summaries.get(field)?.label;
}

describe('grid footer over a record-mode amount', () => {
  it('draws no sum / avg / min / max — they would add USD to EUR', () => {
    for (const s of ['sum', 'avg', 'min', 'max']) expect(footer('amount', s)).toBeUndefined();
  });

  it('a count still stands', () => {
    expect(footer('amount', 'count')).toBe('Count: 2');
  });

  it('the home field sums as before', () => {
    expect(footer('amount_home', 'sum')).toBe('Sum: CN¥1,500.00');
  });
});

describe('group-header aggregations over a record-mode amount', () => {
  const AGGS = [
    { field: 'amount', type: 'sum' as const },
    { field: 'amount', type: 'count' as const },
    { field: 'amount_home', type: 'sum' as const },
  ];

  it('stand when the grid is grouped by the amount\'s code field', () => {
    expect(honestGroupAggregations(AGGS, META, ['currency_code'])).toBe(AGGS);
    expect(honestGroupAggregations(AGGS, META, ['region', 'currency_code'])).toBe(AGGS);
  });

  it('drop the money aggregate when grouped by anything else', () => {
    expect(honestGroupAggregations(AGGS, META, ['region'])).toEqual([AGGS[1], AGGS[2]]);
  });

  it('only a money aggregate over a record-mode amount needs the code grouping', () => {
    expect(requiredAggregateGrouping('amount', 'sum', META)).toBe('currency_code');
    expect(requiredAggregateGrouping('amount', 'count_distinct', META)).toBeUndefined();
    expect(requiredAggregateGrouping('amount_home', 'sum', META)).toBeUndefined();
  });
});

/**
 * ADR-0158 U7 R1, the same rule over a quantity: a `number` declaring
 * `unitConfig: { unitMode: 'record', unitField }` holds a quantity in each
 * row's own unit, so a sum / avg / min / max over it stands only inside one
 * unit. The engine refuses one unless grouped by `unitField`; a `fixed`-mode
 * quantity and a number with no `unitConfig` total as before.
 */
describe('a record-mode quantity: footer and group headers (ADR-0158 U7 R1)', () => {
  const UNIT_META: NonNullable<Parameters<typeof useColumnSummary>[2]> = {
    qty: { type: 'number', unitConfig: { unitMode: 'record', unitField: 'unit_code' } },
    qty_kg: { type: 'number', unitConfig: { unitMode: 'fixed', unit: 'KGM' } },
    weight: { type: 'number' },
    unit_code: { type: 'text' },
  };
  const UNIT_ROWS = [
    { qty: 10, qty_kg: 10, weight: 3, unit_code: 'KGM' },
    { qty: 10, qty_kg: 5, weight: 4, unit_code: 'LBR' },
  ];
  const unitFooter = (field: string, summary: string): string | undefined => {
    const columns: any[] = [{ field, summary }];
    const { result } = renderHook(() => useColumnSummary(columns, UNIT_ROWS, UNIT_META), { wrapper: Providers });
    return result.current.summaries.get(field)?.label;
  };

  it('the footer draws no sum / avg / min / max — 10 KGM and 10 LBR are not 20; a count stands', () => {
    for (const s of ['sum', 'avg', 'min', 'max']) expect(unitFooter('qty', s)).toBeUndefined();
    expect(unitFooter('qty', 'count')).toBe('Count: 2');
  });

  it('CONTROL: a fixed-mode quantity and a plain number sum as before', () => {
    expect(unitFooter('qty_kg', 'sum')).toBe('Sum: 15');
    expect(unitFooter('weight', 'sum')).toBe('Sum: 7');
  });

  it('the footer menu offers the count family only, as for a record-mode amount', () => {
    const offered = offeredColumnSummaries(UNIT_META.qty);
    for (const s of ['sum', 'avg', 'min', 'max'] as const) expect(offered).not.toContain(s);
    expect(offered).toContain('count_filled');
    expect(offeredColumnSummaries(UNIT_META.qty_kg)).toContain('sum');
  });

  const UNIT_AGGS = [
    { field: 'qty', type: 'sum' as const },
    { field: 'qty', type: 'count' as const },
    { field: 'weight', type: 'sum' as const },
    { field: 'qty_kg', type: 'max' as const },
  ];

  it('a group-header aggregate over it stands when the grid is grouped by its unit field', () => {
    expect(honestGroupAggregations(UNIT_AGGS, UNIT_META, ['unit_code'])).toBe(UNIT_AGGS);
  });

  it('it is dropped when grouped by anything else; the counts, the fixed-mode and the plain aggregates stand', () => {
    expect(honestGroupAggregations(UNIT_AGGS, UNIT_META, ['region'])).toEqual([UNIT_AGGS[1], UNIT_AGGS[2], UNIT_AGGS[3]]);
  });

  it('the unit field is read as the engine reads it: a `number` in record mode with a non-empty unitField', () => {
    expect(requiredAggregateGrouping('qty', 'avg', UNIT_META)).toBe('unit_code');
    expect(requiredAggregateGrouping('qty', 'count_distinct', UNIT_META)).toBeUndefined();
    expect(requiredAggregateGrouping('qty_kg', 'sum', UNIT_META)).toBeUndefined();
    expect(requiredAggregateGrouping('weight', 'sum', UNIT_META)).toBeUndefined();
    expect(requiredAggregateGrouping('q', 'sum', { q: { type: 'number', unitConfig: { unitMode: 'record', unitField: '' } } })).toBeUndefined();
    expect(requiredAggregateGrouping('q', 'sum', { q: { type: 'text', unitConfig: { unitMode: 'record', unitField: 'unit_code' } } })).toBeUndefined();
  });
});
