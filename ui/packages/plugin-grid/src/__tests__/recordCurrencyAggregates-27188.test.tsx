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
import { useColumnSummary } from '../useColumnSummary';
import { honestGroupAggregations, requiredCurrencyGrouping } from '../recordCurrencyAggregates';

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
    expect(requiredCurrencyGrouping('amount', 'sum', META)).toBe('currency_code');
    expect(requiredCurrencyGrouping('amount', 'count_distinct', META)).toBeUndefined();
    expect(requiredCurrencyGrouping('amount_home', 'sum', META)).toBeUndefined();
  });
});
