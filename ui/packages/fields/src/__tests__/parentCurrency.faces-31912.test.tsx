/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0144 D2 and D6 as amended on the `@object-ui/fields` faces: a line
 * amount whose `currencyField` is `invoice.currency_code` follows its
 * invoice's currency on the form field (a bare id is read through the data
 * source, an expanded parent is read as it is), a roll-up `summary` that
 * declares its currency draws as money in both faces, and the inline grid
 * draws a column in the currency its host names.
 */

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { LocalizationProvider } from '@object-ui/i18n';
// Module scope: pulls in the form renderer's registration side effect.
import '@object-ui/components';
import { FormulaCellRenderer, withFollowedParentObject } from '../index';
import { CurrencyField } from '../widgets/CurrencyField';
import { SummaryField } from '../widgets/SummaryField';
import { GridField } from '../widgets/GridField';
import { TextField } from '../widgets/TextField';

afterEach(cleanup);

const TENANT = { locale: 'en-US', currency: 'USD' };
const text = (s: string | null | undefined) => (s ?? '').replace(/\u00a0/g, ' ');
const LINE_FIELDS = {
  invoice: { type: 'master_detail', reference: 'inv' },
  currency_code: { type: 'text', valueDomain: 'iso_4217_currency' },
};
const PATH_AMOUNT = withFollowedParentObject(
  { name: 'amount', type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'invoice.currency_code' } },
  LINE_FIELDS,
) as any;
const SIBLING_AMOUNT = { name: 'amount', type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } } as any;
const INV_EUR = { id: 'i1', currency_code: 'EUR' };

function field(def: any, values: Record<string, unknown>, opts: { readonly?: boolean; dataSource?: unknown } = {}) {
  return render(
    <LocalizationProvider value={TENANT}>
      <CurrencyField value={1234.5} onChange={() => {}} field={def} readonly={opts.readonly} dependentValues={values as any} dataSource={opts.dataSource as any} />
    </LocalizationProvider>,
  );
}

describe('form field: an amount that follows its parent (ADR-0144 D2 as amended)', () => {
  it('reads a bare parent id through the data source, the code field alone', async () => {
    const findOne = vi.fn(async () => INV_EUR);
    const { container } = field(PATH_AMOUNT, { invoice: 'i1' }, { readonly: true, dataSource: { findOne } });
    await waitFor(() => expect(text(container.textContent)).toContain('€1,234.50'));
    expect(findOne).toHaveBeenCalledWith('inv', 'i1', { $select: ['id', 'currency_code'] });
  });

  it('reads an expanded parent as it is, in edit and read mode', () => {
    for (const readonly of [false, true]) {
      const { container, unmount } = field(PATH_AMOUNT, { invoice: INV_EUR, currency_code: 'JPY' }, { readonly });
      expect(text(container.textContent)).toContain('€');
      expect(text(container.textContent)).not.toContain('¥');
      unmount();
    }
  });

  it('a parent with no code yet shows no symbol, never the tenant\'s', () => {
    const { container } = field(PATH_AMOUNT, { invoice: { id: 'i1', currency_code: '' } }, { readonly: true });
    expect(text(container.textContent)).not.toMatch(/[$€¥]/);
  });

  it('the sibling pointer still reads the record\'s own code', () => {
    const { container } = field(SIBLING_AMOUNT, { invoice: INV_EUR, currency_code: 'JPY' }, { readonly: true });
    expect(text(container.textContent)).toContain('¥1,235');
  });
});

describe('roll-up summary in the parent\'s currency (ADR-0144 D6 as amended)', () => {
  const SUMMARY = {
    name: 'total',
    type: 'summary',
    summaryOperations: { object: 'inv_line', field: 'amount', function: 'sum' },
    currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' },
  } as any;

  it('draws as money in the parent record\'s code, in the cell and on the form', () => {
    for (const [parent, expected] of [[INV_EUR, '€1,334.50'], [{ id: 'i2', currency_code: 'JPY' }, '¥1,335']] as const) {
      const cell = render(<LocalizationProvider value={TENANT}><FormulaCellRenderer value={1334.5} field={SUMMARY} dependentValues={parent as any} /></LocalizationProvider>);
      expect(text(cell.container.textContent)).toBe(expected);
      cell.unmount();
      const form = render(<LocalizationProvider value={TENANT}><SummaryField value={1334.5} onChange={() => {}} field={SUMMARY} dependentValues={parent as any} /></LocalizationProvider>);
      expect(text(form.container.textContent)).toBe(expected);
      form.unmount();
    }
  });

  it('a summary that declares no currency still reads as a number', () => {
    const plain = { ...SUMMARY, currencyConfig: undefined };
    const cell = render(<LocalizationProvider value={TENANT}><FormulaCellRenderer value={1334.5} field={plain} dependentValues={INV_EUR as any} /></LocalizationProvider>);
    expect(text(cell.container.textContent)).toBe('1,334.5');
  });
});

describe('inline grid: a column in the currency its host names (ADR-0144 D2 as amended)', () => {
  const COLUMNS = [
    { name: 'name', label: 'Line', type: 'text' },
    { name: 'amount', label: 'Amount', type: 'currency' },
  ];
  const grid = (columnCurrencies?: Record<string, string | undefined>) =>
    render(
      <LocalizationProvider value={TENANT}>
        <GridField value={[{ name: 'L1', amount: 1234.5 }, { name: 'L2', amount: 100 }]} onChange={() => {}}
          field={{ name: 'lines', type: 'grid', columns: COLUMNS } as any} readonly columnCurrencies={columnCurrencies} />
      </LocalizationProvider>,
    );

  it('draws both lines in the named currency, never the tenant\'s', () => {
    const t = text(grid({ amount: 'EUR' }).container.textContent);
    expect(t).toContain('€1,234.50');
    expect(t).toContain('€100.00');
    expect(t).not.toContain('$');
  });

  it('a column named with no currency yet shows no symbol', () => {
    expect(text(grid({ amount: undefined }).container.textContent)).not.toMatch(/[$€]/);
  });

  it('with no column named, the tenant currency still draws', () => {
    expect(text(grid().container.textContent)).toContain('$1,234.50');
  });
});

describe('the edit form hands a roll-up its record, so the subtotal reads the record\'s currency (ADR-0144 D6 as amended)', () => {
  // The real form renderer hosting the real widgets, registered raw (not
  // through `registerAllFields()`, whose lazy loaders put a module load inside
  // a bounded `findBy` window).
  beforeAll(() => {
    for (const [type, Component] of Object.entries({ text: TextField, currency: CurrencyField, summary: SummaryField })) {
      ComponentRegistry.register(type, Component as any, { namespace: 'field', skipFallback: true });
    }
  }, 30000);

  const CODE = { name: 'currency_code', label: 'Currency', type: 'text' };
  // The form's read-only roll-up, as the edit form generates it: disabled.
  const SUBTOTAL = {
    name: 'total',
    label: 'Subtotal',
    type: 'summary',
    disabled: true,
    summaryOperations: { object: 'inv_line', field: 'amount', function: 'sum' },
    currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' },
  };
  // The tax-inclusive total: a computed `currency` field of the same record.
  const TOTAL_INCL_TAX = {
    name: 'amount',
    label: 'Total incl. Tax',
    type: 'currency',
    readonly: true,
    currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' },
  };

  function editForm(record: Record<string, unknown>) {
    const Form = ComponentRegistry.get('form')!;
    return render(
      <LocalizationProvider value={TENANT}>
        <Form schema={{ type: 'form', mode: 'edit', showSubmit: false, showCancel: false, defaultValues: record, fields: [CODE, SUBTOTAL, TOTAL_INCL_TAX] }} />
      </LocalizationProvider>,
    );
  }
  const item = (name: string) => text(document.querySelector(`[data-field="${name}"]`)?.textContent);

  it('a EUR record: the subtotal reads EUR, as the record page and the total incl. tax do', () => {
    editForm({ currency_code: 'EUR', total: 230, amount: 276 });
    expect(item('total')).toContain('€230.00');
    expect(item('amount')).toContain('€276.00');
  });

  it('a record in the home currency keeps its format', () => {
    editForm({ currency_code: 'USD', total: 230, amount: 276 });
    expect(item('total')).toContain('$230.00');
    expect(item('amount')).toContain('$276.00');
  });
});
