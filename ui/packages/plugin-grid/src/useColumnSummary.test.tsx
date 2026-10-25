import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { LocalizationProvider } from '@object-ui/i18n';
import { useColumnSummary } from './useColumnSummary';

/**
 * Grid footer summaries (useColumnSummary) must agree with the cells above
 * them: a `currency` column that declares no explicit code now resolves the
 * tenant default (localization.currency, ADR-0053) through the shared
 * resolveFieldCurrency, instead of degrading to a bare number.
 */
const COLUMNS: any[] = [{ field: 'amount', summary: 'sum', type: 'currency' }];
const DATA = [{ amount: 1000 }, { amount: 234 }];

function wrapper(currency?: string) {
  return ({ children }: { children: React.ReactNode }) => (
    <LocalizationProvider value={{ currency }}>{children}</LocalizationProvider>
  );
}

describe('useColumnSummary tenant-default currency', () => {
  it('formats a currency column with the tenant default when the column omits a code', () => {
    const { result } = renderHook(() => useColumnSummary(COLUMNS, DATA), {
      wrapper: wrapper('CNY'),
    });
    const label = result.current.summaries.get('amount')?.label ?? '';
    // 1234 in CNY → a yen/yuan symbol, never a bare number.
    expect(label).toMatch(/Sum:/);
    expect(label).toMatch(/[¥]|CN¥|CNY/);
    expect(label).toMatch(/1,234/);
  });

  it('falls back to a plain number when no tenant currency is configured', () => {
    const { result } = renderHook(() => useColumnSummary(COLUMNS, DATA), {
      wrapper: wrapper(undefined),
    });
    const label = result.current.summaries.get('amount')?.label ?? '';
    expect(label).toMatch(/Sum: /);
    expect(label).not.toMatch(/[¥$€£]/);
    expect(label).toMatch(/1,234/);
  });

  // objectui#11588 moved the explicit code from the column onto the field:
  // `ListColumnSchema` declares no `currency`, and the footer reads it off the
  // field only.
  it('still prefers an explicit field currency over the tenant default', () => {
    const cols: any[] = [{ field: 'amount', summary: 'sum', type: 'currency' }];
    const { result } = renderHook(() => useColumnSummary(cols, DATA, { amount: { currency: 'USD' } }), {
      wrapper: wrapper('CNY'),
    });
    const label = result.current.summaries.get('amount')?.label ?? '';
    expect(label).toMatch(/\$|US\$/);
  });

  // Regression (#2134): `precision` is the total digit count of a decimal(p, s)
  // column, NOT the decimal places. It must not drive fraction digits, or a
  // decimal(10, 0) sum renders as "…0000000000".
  it('does not pad a currency sum using precision (total digits)', () => {
    // The hints sit on the field (objectui#11588): a column-level one is not read.
    const cols: any[] = [{ field: 'amount', summary: 'sum', type: 'currency' }];
    const meta = { amount: { currency: 'USD', precision: 10, scale: 0 } };
    const { result } = renderHook(() => useColumnSummary(cols, [{ amount: 1000 }, { amount: 234 }], meta), {
      wrapper: wrapper('USD'),
    });
    const label = result.current.summaries.get('amount')?.label ?? '';
    expect(label).not.toMatch(/\.0{3,}/);
    expect(label).toMatch(/1,234/);
  });

  // Rewritten for objectui#10221. This case used to be "honours a currency
  // column scale for fraction digits" and asserted that `scale: 2` rendered a
  // whole total as `1,234.00`. `scale` is retired from the currency type
  // (ruling B on objectstack-ai/objectstack#19629) and a currency's decimal
  // places are the currency's (ruling 乙 on objectstack-ai/objectstack#19910),
  // so the claim moves from "the declared scale" to "the currency's own minor
  // unit, the way the cell renders it" — the same claim about WHERE the width
  // comes from, answered by the ruled member. The full agreement table is
  // `__tests__/useColumnSummary.currencyMinorUnit-10221.test.tsx`.
  it('takes a currency column\'s fraction digits from the currency, not from scale', () => {
    // A stale `scale: 0` is ignored: USD keeps its cents on a fractional total …
    // The hints sit on the field (objectui#11588): a column-level one is not read.
    const cols: any[] = [{ field: 'amount', summary: 'sum', type: 'currency' }];
    const meta = { amount: { currency: 'USD', precision: 12, scale: 0 } };
    const fractional = renderHook(() => useColumnSummary(cols, [{ amount: 1000 }, { amount: 234.5 }], meta), {
      wrapper: wrapper('USD'),
    });
    expect(fractional.result.current.summaries.get('amount')?.label).toMatch(/1,234\.50/);
    // … and a whole total keeps its cents too, as the cell above it does: the
    // currency's width, never the stale `scale: 0`. Moved on purpose from
    // "drops the fraction" when objectui#11444 retired the whole-amount
    // trimming (triage comment 5946462862).
    const whole = renderHook(() => useColumnSummary(cols, [{ amount: 1000 }, { amount: 234 }], meta), {
      wrapper: wrapper('USD'),
    });
    const label = whole.result.current.summaries.get('amount')?.label ?? '';
    expect(label).toMatch(/1,234\.00/);
  });
});

/**
 * A column's currency/percent formatting describes values *in that column's
 * unit*. The count family produces cardinalities and the percent family
 * produces percentages, so neither may inherit it — "3 distinct customers" is
 * not "$3.00", and "75% filled" is not "75% of a percent column".
 */
describe('useColumnSummary formatting stays with the numeric family', () => {
  const CURRENCY_DATA = [{ amount: 1000 }, { amount: 234 }, { amount: 1000 }];
  // The code sits on the field (objectui#11588): a column-level one is not read.
  const USD_FIELD = { amount: { currency: 'USD' } };

  it('does not apply currency formatting to a count on a currency column', () => {
    const cols: any[] = [{ field: 'amount', summary: 'count_unique', type: 'currency' }];
    const { result } = renderHook(() => useColumnSummary(cols, CURRENCY_DATA, USD_FIELD), {
      wrapper: wrapper('USD'),
    });
    const label = result.current.summaries.get('amount')?.label ?? '';
    expect(label).toBe('Unique: 2');
    expect(label).not.toMatch(/[¥$€£]/);
  });

  it('does not apply currency formatting to a percent aggregation', () => {
    const cols: any[] = [{ field: 'amount', summary: 'percent_filled', type: 'currency' }];
    const { result } = renderHook(() => useColumnSummary(cols, CURRENCY_DATA, USD_FIELD), {
      wrapper: wrapper('USD'),
    });
    const label = result.current.summaries.get('amount')?.label ?? '';
    expect(label).toBe('Filled: 100%');
    expect(label).not.toMatch(/[¥$€£]/);
  });

  it('does not route a count through the percent column formatter', () => {
    // The percent-column branch scales a fraction to 0-100; a count of 2 must
    // not be reinterpreted as a ratio.
    const cols: any[] = [{ field: 'rate', summary: 'count_unique', type: 'percent' }];
    const { result } = renderHook(() => useColumnSummary(cols, [{ rate: 0.5 }, { rate: 0.25 }]), {
      wrapper: wrapper('USD'),
    });
    expect(result.current.summaries.get('rate')?.label).toBe('Unique: 2');
  });

  it('still applies currency formatting to the numeric family', () => {
    // Guard against over-correcting: sum/avg/min/max keep column formatting.
    const cols: any[] = [{ field: 'amount', summary: 'sum', type: 'currency' }];
    const { result } = renderHook(() => useColumnSummary(cols, CURRENCY_DATA, USD_FIELD), {
      wrapper: wrapper('USD'),
    });
    expect(result.current.summaries.get('amount')?.label).toMatch(/\$|US\$/);
  });
});
