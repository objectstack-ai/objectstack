/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0144 D5, the live preview: while a `record`-mode amount declaring
 * `homeAmount` is edited, the line under it says what the save will store in
 * the home field. The arithmetic is `@objectstack/formula`'s (the engine's own
 * copy), so the parity cases below are the engine's test cases
 * (`packages/objectql/src/home-amount-projection.test.ts` and
 * `engine-home-amount-projection.test.ts`), inputs and stored numbers both.
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, renderHook, cleanup, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocalizationProvider } from '@object-ui/i18n';
import { CurrencyField } from '../widgets/CurrencyField';
import { useHomeAmountPreview } from '../widgets/homeAmountPreview';

afterEach(cleanup);

const HOME_AMOUNT = { field: 'amount_home', rateDate: 'invoice_date', rateField: 'amount_rate' };
const AMOUNT = { name: 'amount', type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code', homeAmount: HOME_AMOUNT } } as any;
const text = (s: string | null | undefined) => (s ?? '').replace(/\u00a0/g, ' ');

/** A data source answering rate rows like the engine's rate table, counting its reads. */
function rates(table: Record<string, Array<[string, unknown]>>, fail?: unknown) {
  const calls: Array<{ resource: string; params: any }> = [];
  const ds = {
    calls,
    async find(resource: string, params: any) {
      calls.push({ resource, params });
      if (fail) throw fail;
      const { currency, effective_date } = params.$filter;
      const rows = (table[currency] ?? [])
        .filter(([d]) => d <= effective_date.$lte)
        .sort(([a], [b]) => (a < b ? 1 : -1))
        .slice(0, 1)
        .map(([d, rate]) => ({ effective_date: d, rate }));
      return { data: rows };
    },
  };
  return ds;
}

function preview(record: Record<string, unknown>, ds: unknown, home = 'CNY', field = AMOUNT) {
  return render(
    <LocalizationProvider value={{ locale: 'en-US', currency: home }}>
      <CurrencyField value={record.amount as number} onChange={() => {}} field={field} dependentValues={record} dataSource={ds} />
    </LocalizationProvider>,
  );
}
const line = () => text(screen.queryByTestId('home-amount-preview')?.textContent);

describe('the live home-amount preview (ADR-0144 D5)', () => {
  it('the engine parity cases: the previewed number is the number the engine stores, digit for digit', async () => {
    const EUR = { EUR: [['2026-01-01', 0.0065], ['2026-01-02', 0.1289], ['2026-01-03', 3.0103]] as Array<[string, unknown]> };
    const USD = { USD: [['2026-01-01', 0.1389], ['2026-04-01', 0.15]] as Array<[string, unknown]> };
    const cases: Array<[string, Record<string, Array<[string, unknown]>>, Record<string, unknown>, number]> = [
      ['JPY', EUR, { amount: 100, currency_code: 'EUR', invoice_date: '2026-01-01' }, 15385], // JPY 0 digits
      ['CNY', EUR, { amount: 100, currency_code: 'EUR', invoice_date: '2026-01-02' }, 775.8], // 2 digits
      ['KWD', EUR, { amount: 100, currency_code: 'EUR', invoice_date: '2026-01-03' }, 33.219], // KWD 3 digits
      ['CNY', USD, { amount: 10000, currency_code: 'USD', invoice_date: '2026-03-15' }, 71994.24], // the card's two-minute check
      ['CNY', USD, { amount: 150, currency_code: 'USD', invoice_date: '2026-04-02' }, 1000],
    ];
    for (const [home, table, record, stored] of cases) {
      const ds = rates(table);
      const { result } = renderHook(() => useHomeAmountPreview(AMOUNT, record.amount, record, ds), {
        wrapper: ({ children }) => <LocalizationProvider value={{ locale: 'en-US', currency: home }}>{children}</LocalizationProvider>,
      });
      await waitFor(() => expect(result.current?.kind).toBe('converted'));
      const state = result.current as Extract<typeof result.current, { kind: 'converted' }>;
      expect(Number(state.amount), `${home} ${JSON.stringify(record)}`).toBe(stored);
    }
  });

  it('a foreign amount reads the rate in force once per currency and date, with the engine\'s query, and says it', async () => {
    const ds = rates({ USD: [['2026-01-01', 0.1389], ['2026-04-01', 0.15]] });
    const record = { amount: 10000, currency_code: 'USD', invoice_date: '2026-03-15' };
    const first = preview(record, ds);
    await waitFor(() => expect(line()).toBe('≈ CN¥71,994.24 at 0.1389 on Mar 15, 2026'));
    first.rerender(
      <LocalizationProvider value={{ locale: 'en-US', currency: 'CNY' }}>
        <CurrencyField value={20000} onChange={() => {}} field={AMOUNT} dependentValues={{ ...record, amount: 20000 }} dataSource={ds} />
      </LocalizationProvider>,
    );
    await waitFor(() => expect(line()).toBe('≈ CN¥143,988.48 at 0.1389 on Mar 15, 2026'));
    cleanup();
    preview(record, ds);
    await waitFor(() => expect(line()).toContain('CN¥71,994.24'));
    expect(ds.calls).toEqual([{
      resource: 'sys_exchange_rate',
      params: { $filter: { currency: 'USD', effective_date: { $lte: '2026-03-15' } }, $orderby: [{ field: 'effective_date', order: 'desc' }], $top: 1, $select: ['rate', 'effective_date'] },
    }]);
  });

  it('the home currency converts at 1 with no read, rounded half away from zero to the home digits', async () => {
    const ds = rates({});
    preview({ amount: 1.005, currency_code: 'CNY' }, ds);
    expect(line()).toBe('≈ CN¥1.01 (home currency)');
    expect(ds.calls).toHaveLength(0);
  });

  it('no rate on or before the document date is the awaiting-rate state, naming the currency and date', async () => {
    const ds = rates({ USD: [['2026-01-01', 0.1389]] });
    preview({ amount: 1, currency_code: 'USD', invoice_date: '2025-12-31' }, ds);
    await waitFor(() => expect(line()).toBe('No USD rate on or before Dec 31, 2025: saving is refused until one is added'));
  });

  it('a foreign amount with no document date asks for it, and reads nothing', () => {
    const ds = rates({ USD: [['2026-01-01', 0.1389]] });
    preview({ amount: 1, currency_code: 'USD', invoice_date: '' }, ds);
    expect(line()).toBe('Set the document date to see the home amount');
    expect(ds.calls).toHaveLength(0);
  });

  it('a refused read (403) says it converts on save: never awaiting rate, never an amount', async () => {
    const refused = Object.assign(new Error('Permission denied'), { httpStatus: 403, code: 'PERMISSION_DENIED' });
    const ds = rates({}, refused);
    preview({ amount: 10000, currency_code: 'USD', invoice_date: '2026-03-15' }, ds);
    await waitFor(() => expect(line()).toBe('Converted to the home currency when you save'));
    expect(screen.getByTestId('home-amount-preview')).toHaveAttribute('data-state', 'refused');
  });

  it('a failed read that is not a refusal draws nothing and is asked again next time', async () => {
    const ds = rates({}, Object.assign(new Error('offline'), { httpStatus: 503 }));
    preview({ amount: 10000, currency_code: 'USD', invoice_date: '2026-03-15' }, ds);
    await waitFor(() => expect(ds.calls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('home-amount-preview')).toBeNull();
    cleanup();
    preview({ amount: 10000, currency_code: 'USD', invoice_date: '2026-03-15' }, ds);
    await waitFor(() => expect(ds.calls).toHaveLength(2));
  });

  it('CONTROL: an amount with no homeAmount, a blank amount and a blank code preview nothing and read nothing', async () => {
    const ds = rates({ USD: [['2026-01-01', 0.1389]] });
    const plain = { ...AMOUNT, currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } };
    preview({ amount: 10000, currency_code: 'USD', invoice_date: '2026-03-15' }, ds, 'CNY', plain);
    preview({ amount: null, currency_code: 'USD', invoice_date: '2026-03-15' }, ds);
    preview({ amount: 10000, currency_code: '', invoice_date: '2026-03-15' }, ds);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryAllByTestId('home-amount-preview')).toHaveLength(0);
    expect(screen.getAllByRole('spinbutton')).toHaveLength(3);
    expect(ds.calls).toHaveLength(0);
  });
});
