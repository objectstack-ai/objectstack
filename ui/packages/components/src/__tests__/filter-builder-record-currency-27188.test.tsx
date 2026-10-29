/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27188 — a filter on a `record`-mode amount compares within one
 * currency (ADR-0144 D6): the row draws a required currency picker, defaulting
 * to the organization currency, and the builder emits `amount op X AND
 * code = C` as the amount row plus its companion code row.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocalizationProvider } from '@object-ui/i18n';
import { FilterBuilder, type FilterBuilderRowGroup } from '../custom/filter-builder';
import {
  CURRENCY_COMPANION_SUFFIX,
  syncRecordCurrencyRows,
} from '../custom/filterRecordCurrency';

afterEach(() => cleanup());

const FIELDS = [
  { value: 'amount', label: 'Amount', type: 'currency', currencyField: 'currency_code' },
  { value: 'budget', label: 'Budget', type: 'currency' },
  { value: 'stage', label: 'Stage', type: 'text' },
];

const comparesValue = (op: string) => !['is_null', 'is_not_null', 'is_empty', 'is_not_empty', 'exists', 'notExists'].includes(op);

function group(conditions: FilterBuilderRowGroup['conditions'], logic: 'and' | 'or' = 'and'): FilterBuilderRowGroup {
  return { id: 'root', logic, conditions };
}

describe('syncRecordCurrencyRows', () => {
  it('follows a value-comparing amount row with its code row, on the home currency', () => {
    const out = syncRecordCurrencyRows(
      group([{ id: 'a', field: 'amount', operator: 'greater_than', value: 100 }]),
      FIELDS,
      'CNY',
      comparesValue,
    );
    expect(out.conditions).toEqual([
      { id: 'a', field: 'amount', operator: 'greater_than', value: 100 },
      { id: `a${CURRENCY_COMPANION_SUFFIX}`, field: 'currency_code', operator: 'equals', value: 'CNY' },
    ]);
  });

  it('keeps a code the row already holds', () => {
    const out = syncRecordCurrencyRows(
      group([
        { id: 'a', field: 'amount', operator: 'greater_than', value: 100 },
        { id: 'a::currency', field: 'currency_code', operator: 'equals', value: 'EUR' },
      ]),
      FIELDS,
      'CNY',
      comparesValue,
    );
    expect(out.conditions[1].value).toBe('EUR');
  });

  it('returns the same group when every pair is settled', () => {
    const settled = group([
      { id: 'a', field: 'amount', operator: 'greater_than', value: 100 },
      { id: 'a::currency', field: 'currency_code', operator: 'equals', value: 'EUR' },
    ]);
    expect(syncRecordCurrencyRows(settled, FIELDS, 'CNY', comparesValue)).toBe(settled);
  });

  it('pairs nothing for a presence check, a fixed/dynamic amount, or another field', () => {
    const out = syncRecordCurrencyRows(
      group([
        { id: 'a', field: 'amount', operator: 'is_null' },
        { id: 'b', field: 'budget', operator: 'greater_than', value: 5 },
        { id: 'c', field: 'stage', operator: 'equals', value: 'won' },
      ]),
      FIELDS,
      'CNY',
      comparesValue,
    );
    expect(out.conditions.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops a companion whose amount row is gone or no longer pairs', () => {
    const out = syncRecordCurrencyRows(
      group([
        { id: 'x::currency', field: 'currency_code', operator: 'equals', value: 'USD' },
        { id: 'a', field: 'budget', operator: 'greater_than', value: 1 },
        { id: 'a::currency', field: 'currency_code', operator: 'equals', value: 'USD' },
      ]),
      FIELDS,
      'CNY',
      comparesValue,
    );
    expect(out.conditions.map((c) => c.id)).toEqual(['a']);
  });

  it('leaves the code blank when the organization currency is unset', () => {
    const out = syncRecordCurrencyRows(
      group([{ id: 'a', field: 'amount', operator: 'equals', value: 1 }]),
      FIELDS,
      undefined,
      comparesValue,
    );
    expect(out.conditions[1].value).toBe('');
  });
});

function renderBuilder(value: FilterBuilderRowGroup, currency = 'CNY') {
  const onChange = vi.fn();
  const utils = render(
    <LocalizationProvider value={{ currency }}>
      <FilterBuilder fields={FIELDS as any} value={value} onChange={onChange} />
    </LocalizationProvider>,
  );
  return { ...utils, onChange };
}

describe('FilterBuilder — a record-mode amount row', () => {
  it('draws one currency picker per paired row and no row for the companion', () => {
    const value = group([
      { id: 'a', field: 'amount', operator: 'greater_than', value: 100 },
      { id: 'a::currency', field: 'currency_code', operator: 'equals', value: 'EUR' },
    ]);
    renderBuilder(value);
    const pickers = screen.getAllByTestId('filter-currency-picker');
    expect(pickers).toHaveLength(1);
    expect(pickers[0]).toHaveTextContent('EUR');
    // One visible row: one remove button.
    expect(screen.getAllByText('Remove condition')).toHaveLength(1);
  });

  it('a new amount row emits its code condition on the organization currency', () => {
    const value = group([]);
    const { onChange } = renderBuilder(value);
    fireEvent.click(screen.getByText('Add filter'));
    const emitted: FilterBuilderRowGroup = onChange.mock.calls.at(-1)![0];
    expect(emitted.logic).toBe('and');
    expect(emitted.conditions).toHaveLength(2);
    expect(emitted.conditions[0]).toMatchObject({ field: 'amount', operator: 'equals' });
    expect(emitted.conditions[1]).toEqual({
      id: `${emitted.conditions[0].id}${CURRENCY_COMPANION_SUFFIX}`,
      field: 'currency_code',
      operator: 'equals',
      value: 'CNY',
    });
  });

  it('removing the amount row removes its code condition', () => {
    const value = group([
      { id: 'a', field: 'amount', operator: 'greater_than', value: 100 },
      { id: 'a::currency', field: 'currency_code', operator: 'equals', value: 'EUR' },
      { id: 's', field: 'stage', operator: 'equals', value: 'won' },
    ]);
    const { onChange } = renderBuilder(value);
    fireEvent.click(screen.getAllByText('Remove condition')[0].closest('button')!);
    const emitted: FilterBuilderRowGroup = onChange.mock.calls.at(-1)![0];
    expect(emitted.conditions.map((c) => c.id)).toEqual(['s']);
  });

  it('a stored amount row without a code shows a blank, invalid picker and emits nothing on read', () => {
    const value = group([{ id: 'a', field: 'amount', operator: 'greater_than', value: 100 }]);
    const { onChange } = renderBuilder(value);
    const picker = screen.getByTestId('filter-currency-picker');
    expect(picker).toHaveTextContent('Currency');
    expect(picker).toHaveAttribute('aria-invalid', 'true');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a paired group cannot switch to OR, and a stored OR group says why', () => {
    const paired = group([
      { id: 'a', field: 'amount', operator: 'greater_than', value: 100 },
      { id: 'a::currency', field: 'currency_code', operator: 'equals', value: 'EUR' },
      { id: 's', field: 'stage', operator: 'equals', value: 'won' },
    ]);
    const { unmount } = renderBuilder(paired);
    expect(screen.getByTestId('filter-logic-toggle')).toBeDisabled();
    expect(screen.queryByTestId('filter-currency-needs-and')).toBeNull();
    unmount();

    renderBuilder({ ...paired, logic: 'or' });
    expect(screen.getByTestId('filter-logic-toggle')).not.toBeDisabled();
    expect(screen.getByTestId('filter-currency-needs-and')).toBeInTheDocument();
  });

  it('draws no picker on a dynamic/fixed amount', () => {
    renderBuilder(group([{ id: 'b', field: 'budget', operator: 'greater_than', value: 1 }]));
    expect(screen.queryByTestId('filter-currency-picker')).toBeNull();
  });
});
