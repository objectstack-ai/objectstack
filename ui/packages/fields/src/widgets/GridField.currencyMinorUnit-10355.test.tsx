/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10355 — a computed `currency` cell in the line-item grid is STORED
 * at its currency's ISO 4217 minor unit and SHOWN in that currency.
 *
 * `computeRow` rounded a computed currency column to `scale ?? 2`: it read the
 * `scale` that ruling B (objectstack-ai/objectstack#19629) retired from the
 * currency type, and it gave every currency on earth two decimals. So a yen
 * amount was stored with cents yen does not have, and a dinar amount lost its
 * third digit. The display faces fell back to a literal `¥` without resolving
 * any currency. A currency's decimal places are the currency's, not a setting
 * (ruling 乙 on objectstack-ai/objectstack#19910).
 *
 * The currency is the grid's resolved one (`resolveFieldCurrency`, which lands
 * on the tenant default here), so every pin below declares it the way a real
 * session does: through `LocalizationProvider`, or `computeRow`'s tenant
 * argument for the pure half.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import * as React from 'react';
import { LocalizationProvider } from '@object-ui/i18n';
import { GridField, computeRow, type GridColumn } from './GridField';

afterEach(() => cleanup());

/** `Intl` separates a code from its amount with a no-break space. */
const flat = (s: string | null | undefined): string => (s ?? '').replace(/\u00a0/g, ' ').trim();

/** The master-detail line: `amount = quantity * unit_price`. */
const amountColumn = (extra: Partial<GridColumn> = {}): GridColumn => ({
  name: 'amount',
  label: 'Amount',
  type: 'currency',
  computed: true,
  expr: 'record.quantity * record.unit_price',
  ...extra,
});

describe('computeRow stores a computed currency cell at its currency minor unit (objectui#10355)', () => {
  it('JPY: the stored amount is a whole number of yen', () => {
    const next = computeRow([amountColumn()], { quantity: 3, unit_price: 1234.5 }, 'JPY');
    expect(next.amount).toBe(3704);
    expect(Number.isInteger(next.amount)).toBe(true);
  });

  it('KWD: the stored amount keeps its third minor digit', () => {
    const next = computeRow([amountColumn()], { quantity: 3, unit_price: 1.2345 }, 'KWD');
    expect(next.amount).toBe(3.704);
  });

  it('USD control: the stored amount keeps two places', () => {
    const next = computeRow([amountColumn()], { quantity: 3, unit_price: 411.523 }, 'USD');
    expect(next.amount).toBe(1234.57);
  });

  // The row that stood here pinned an authored `scale` winning over the minor
  // unit on the stored value. objectui#10783 reversed it: `@objectstack/spec`
  // 17.5.0 refuses `scale` on a currency inline grid column, and the minor unit
  // decides. `GridField.currencyScaleNotRead-10783.test.tsx` pins the reversal.

  it('no currency resolved: stored as computed, never at an invented two places', () => {
    const next = computeRow([amountColumn()], { quantity: 3, unit_price: 1.2345 });
    expect(next.amount).toBe(3 * 1.2345);
  });

  it('number control: a computed number column with no `scale` stays unrounded', () => {
    const next = computeRow([amountColumn({ type: 'number' })], { quantity: 3, unit_price: 1.2345 }, 'JPY');
    expect(next.amount).toBe(3 * 1.2345);
  });
});

const lineColumns: GridColumn[] = [
  { name: 'quantity', label: 'Qty', type: 'number' },
  { name: 'unit_price', label: 'Unit Price', type: 'currency' },
  amountColumn(),
];

function lineGrid(currency: string | undefined, props: Partial<React.ComponentProps<typeof GridField>> = {}) {
  const onChange = vi.fn();
  render(
    <LocalizationProvider value={{ currency, locale: 'en' }}>
      <GridField value={[]} onChange={onChange} field={{ columns: lineColumns } as never} {...props} />
    </LocalizationProvider>,
  );
  return onChange;
}

describe('GridField shows a currency cell in its resolved currency (objectui#10355)', () => {
  it('JPY: an edit stores whole yen and the computed cell shows no decimals', () => {
    const onChange = lineGrid('JPY', {
      value: [{ quantity: 2, unit_price: 1234.5, amount: 2469 }],
    });
    fireEvent.change(screen.getAllByLabelText('Qty')[0], { target: { value: '3' } });
    const stored = (onChange.mock.calls.at(-1)![0] as Record<string, unknown>[])[0];
    expect(stored.amount).toBe(3704);
    cleanup();

    lineGrid('JPY', { value: [stored] });
    expect(flat(document.querySelector('[data-computed="amount"]')?.textContent)).toBe('¥3,704');
    cleanup();

    // A row stored with cents before this repair shows at the yen's width too.
    lineGrid('JPY', { value: [{ quantity: 3, unit_price: 1234.5, amount: 3703.5 }] });
    expect(flat(document.querySelector('[data-computed="amount"]')?.textContent)).toBe('¥3,704');
  });

  it('KWD: the computed cell shows three decimals in dinar', () => {
    lineGrid('KWD', { value: [{ quantity: 3, unit_price: 1.2345, amount: 3.704 }] });
    expect(flat(document.querySelector('[data-computed="amount"]')?.textContent)).toBe('KWD 3.704');
  });

  it('USD: the list face and the edit adornment say `$`, never a default `¥`', () => {
    lineGrid('USD', {
      value: [{ quantity: 3, unit_price: 411.523, amount: 1234.57 }],
      displayMode: 'list',
      onRowExpand: () => {},
    });
    const text = flat(document.body.textContent);
    expect(text).toContain('$1,234.57');
    expect(text).not.toContain('¥');
    cleanup();

    lineGrid('USD', { value: [{ quantity: 3, unit_price: 411.523, amount: 1234.57 }] });
    const input = screen.getAllByLabelText('Unit Price')[0];
    expect(flat(input.parentElement?.textContent)).toBe('$');
  });

  it('no currency resolved: no symbol at all, on either face', () => {
    lineGrid(undefined, { value: [{ quantity: 3, unit_price: 1.25, amount: 3.75 }] });
    expect(flat(document.querySelector('[data-computed="amount"]')?.textContent)).toBe('3.75');
    expect(flat(screen.getAllByLabelText('Unit Price')[0].parentElement?.textContent)).toBe('');
  });

  it('a stored amount with more places than the currency shows at the minor unit', () => {
    lineGrid('JPY', { value: [{ quantity: 3, unit_price: 411.523, amount: 1234.57 }] });
    expect(flat(document.querySelector('[data-computed="amount"]')?.textContent)).toBe('¥1,235');
  });

  // The second half of the row that stood here pinned an authored `scale`
  // deciding the display width (`¥1,234.57` under `scale: 2`). objectui#10783
  // reversed it with the stored half above; the reversal is pinned in
  // `GridField.currencyScaleNotRead-10783.test.tsx`.

  // The objectui#10071 row that stood here pinned the out-of-range clamp on
  // this display. The clamp retired at the objectui#9808 SUNSET (objectui#11073):
  // `@objectstack/spec` 17.5.0 refuses a `scale` above 100 at the declaration.

  it('an authored `prefix` replaces the symbol but not the width', () => {
    const onChange = vi.fn();
    render(
      <LocalizationProvider value={{ currency: 'KWD', locale: 'en' }}>
        <GridField
          value={[{ quantity: 3, unit_price: 1.2, amount: 3.6 }]}
          onChange={onChange}
          field={{ columns: [lineColumns[0], { ...lineColumns[1], prefix: 'KD ' }, amountColumn({ prefix: 'KD ' })] } as never}
        />
      </LocalizationProvider>,
    );
    // Three places: the dinar's width, padded, under the authored symbol.
    expect(flat(document.querySelector('[data-computed="amount"]')?.textContent)).toBe('KD 3.600');
    expect(flat(screen.getAllByLabelText('Unit Price')[0].parentElement?.textContent)).toBe('KD');
  });
});
