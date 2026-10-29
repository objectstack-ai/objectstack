/**
 * objectstack#27188 — a grouped answer over a `record`-mode amount marks its
 * measure column with `currencyField` (objectstack#27338), and each CELL takes
 * the currency of its own row (ADR-0144 D9). A column without the marker keeps
 * its declared `currency`, unchanged.
 */
import { describe, it, expect } from 'vitest';
import { formatMeasure, measureCellCurrency, type DatasetResultField } from '../dataset-format';

const RECORD_COLUMN = { name: 'amount_sum', type: 'number', currencyField: 'currency_code' } as unknown as DatasetResultField;
const FIXED_COLUMN = { name: 'amount_sum', type: 'number', currency: 'EUR' } as unknown as DatasetResultField;

describe('measureCellCurrency', () => {
  it('reads each row\'s code from the column `currencyField` names', () => {
    expect(measureCellCurrency(RECORD_COLUMN, { currency_code: 'USD', amount_sum: 10 })).toBe('USD');
    expect(measureCellCurrency(RECORD_COLUMN, { currency_code: 'JPY', amount_sum: 10 })).toBe('JPY');
  });

  it('gives no symbol to a row without a code, nor to a cell with no row of its own', () => {
    expect(measureCellCurrency(RECORD_COLUMN, { currency_code: null })).toBeUndefined();
    expect(measureCellCurrency(RECORD_COLUMN, { currency_code: '' })).toBeUndefined();
    expect(measureCellCurrency(RECORD_COLUMN)).toBeUndefined();
  });

  it('keeps a column\'s declared currency when it carries no currencyField', () => {
    expect(measureCellCurrency(FIXED_COLUMN, { currency_code: 'USD' })).toBe('EUR');
    expect(measureCellCurrency(undefined, { currency_code: 'USD' })).toBeUndefined();
  });

  it('formats two rows of one column in their two currencies', () => {
    const cell = (row: Record<string, unknown>) =>
      formatMeasure(row.amount_sum, '0.00', measureCellCurrency(RECORD_COLUMN, row), undefined, 'en-US');
    expect(cell({ currency_code: 'USD', amount_sum: 1234.5 })).toBe('$1,234.50');
    expect(cell({ currency_code: 'EUR', amount_sum: 1234.5 })).toBe('€1,234.50');
    expect(cell({ currency_code: null, amount_sum: 1234.5 })).toBe('1,234.50');
  });
});
