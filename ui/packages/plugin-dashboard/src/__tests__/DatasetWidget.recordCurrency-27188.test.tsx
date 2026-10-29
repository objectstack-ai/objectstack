/**
 * objectstack#27188 — a dashboard `table` over a grouped `record`-mode answer
 * shows each row's amount in that row's own currency (ADR-0144 D9). The
 * measure column names the result column holding the code (`currencyField`,
 * objectstack#27338); the grand-total cell, which may add several currencies,
 * gets no symbol.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { DatasetWidget } from '../DatasetWidget';

vi.mock('../DrillDownDrawer', () => ({ DrillDownDrawer: () => null }));

/** Plain TEXT dimension field, no `options` — nothing here relabels. */
const OPPORTUNITY = { name: 'opportunity', fields: { currency_code: { type: 'text' } } };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const source = () => ({
  queryDataset: vi.fn(async () => ({
    rows: [
      { currency_code: 'USD', amount_sum: 1234.5 },
      { currency_code: 'EUR', amount_sum: 99 },
      { currency_code: null, amount_sum: 7 },
    ],
    fields: [
      { name: 'currency_code', type: 'text', label: 'Currency' },
      { name: 'amount_sum', type: 'number', label: 'Amount', format: '0.00', currencyField: 'currency_code' },
    ],
    totals: [{ dimensions: [] as string[], rows: [{ amount_sum: 1340.5 }] }],
  })),
});

const TABLE_WIDGET = { type: 'table', dataset: 'amount_by_currency', dimensions: ['currency_code'], values: ['amount_sum'] };

const amountColumn = () =>
  Array.from(document.querySelectorAll('tbody tr')).map((r) => r.querySelectorAll('td')[1]?.textContent?.trim() ?? '');

describe('DatasetWidget table — record-mode amounts (ADR-0144 D9)', () => {
  it('formats each row in its own currency, and a row without a code as a plain number', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ item: OPPORTUNITY }) })));
    render(<DatasetWidget widget={TABLE_WIDGET} dataSource={source()} />);
    await screen.findByText('Amount');
    await waitFor(() => expect(amountColumn()).toEqual(['$1,234.50', '€99.00', '7.00']));
  });

  it('gives the grand total no symbol', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ item: OPPORTUNITY }) })));
    render(<DatasetWidget widget={TABLE_WIDGET} dataSource={source()} />);
    const foot = await screen.findByTestId('dataset-table-total-row');
    expect(foot.querySelectorAll('td')[1]?.textContent?.trim()).toBe('1,340.50');
  });
});
