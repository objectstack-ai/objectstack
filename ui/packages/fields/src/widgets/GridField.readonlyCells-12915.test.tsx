/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12915 — the read-only table's cells read through `displayText`.
 *
 * The `readonly` surface (a read-only record page, a print page) sent only
 * `file` and temporal cells through `displayText` and printed every other cell
 * with `String(value)`: a select showed its stored value (`open`, not `Open`)
 * and an amount showed the raw number (`1234.5`), ungrouped and in no locale.
 * Since objectui#12854 a `record:line_items` column listed by `name` takes its
 * `select` / `currency` / `number` type from the child field, so a read-only
 * invoice's line items reached exactly those cells.
 *
 * The session is `de-DE` with `EUR`, where the grouping and the decimal mark
 * are the reverse of `String(value)`'s, so a stored number cannot pass for a
 * formatted one. The `lookup`, `file` and `date` cells are the control: they
 * render as they did before the change.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import * as React from 'react';
import { LocalizationProvider } from '@object-ui/i18n';
import { GridField, type GridColumn } from './GridField';
import { LookupField } from './LookupField';

afterEach(() => cleanup());

/** `Intl` separates a currency symbol from its amount with a no-break space. */
const flat = (s: string | null | undefined): string => (s ?? '').replace(/\u00a0/g, ' ').trim();

const columns: GridColumn[] = [
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { label: 'Open', value: 'open' },
      { label: 'Shipped', value: 'shipped' },
    ],
  },
  { name: 'quantity', label: 'Quantity', type: 'number' },
  { name: 'amount', label: 'Amount', type: 'currency' },
  { name: 'account', label: 'Account', type: 'lookup', reference: 'account' },
  { name: 'spec', label: 'Spec', type: 'file' },
  { name: 'due', label: 'Due', type: 'date' },
];

const rows = [
  {
    status: 'open',
    quantity: 1234.5,
    amount: 98765.25,
    account: 'acc-1',
    spec: { name: 'spec.pdf' },
    due: '2024-06-17',
  },
];

/** The text of each body cell of the first data row, keyed by column name. */
function readonlyCells(): Record<string, string> {
  render(
    <LocalizationProvider value={{ locale: 'de-DE', currency: 'EUR' }}>
      <GridField value={rows} onChange={() => {}} field={{ columns } as never} readonly />
    </LocalizationProvider>,
  );
  const [, firstRow] = screen.getAllByRole('row');
  // The first cell is the row number; the rest follow `columns`.
  const cells = within(firstRow).getAllByRole('cell').slice(1);
  return Object.fromEntries(columns.map((c, i) => [c.name, flat(cells[i]?.textContent)]));
}

describe('the read-only GridField table reads every non-lookup cell through displayText (objectui#12915)', () => {
  it('a select cell shows its option label, not the stored value', () => {
    expect(readonlyCells().status).toBe('Open');
  });

  it('a number cell is grouped and decimal-marked in the declared locale', () => {
    expect(readonlyCells().quantity).toBe('1.234,5');
  });

  it('a currency cell is formatted in the declared locale and currency', () => {
    expect(readonlyCells().amount).toBe('98.765,25 €');
  });

  it('CONTROL — the lookup, file and date cells render as before', () => {
    const cells = readonlyCells();
    cleanup();
    // The lookup cell is still `LookupField`'s read-only face, not a string of
    // the stored id: the same props rendered on their own read the same.
    render(
      <LocalizationProvider value={{ locale: 'de-DE', currency: 'EUR' }}>
        <LookupField value="acc-1" onChange={() => {}} readonly field={{ reference: 'account' } as never} />
      </LocalizationProvider>,
    );
    expect(cells.account).toBe(flat(document.body.textContent));
    expect(cells.account).not.toBe('acc-1');
    expect(cells.spec).toBe('spec.pdf');
    expect(cells.due).toBe('17. Juni 2024');
  });
});
