// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10463 — `buildFieldMeta` resolves a field's currency through the
 * shared `resolveFieldCurrency` (`@object-ui/i18n`), so a field that declares a
 * fixed currency in `currencyConfig` renders that code in both dashboard faces
 * that share the helper: the `ObjectDataTable` cell and the `RecordDetailDrawer`
 * value.
 *
 * `currencyConfig: { currencyMode: 'fixed', defaultCurrency }` is the spec's
 * one fixed-currency declaration (`FieldSchema` refuses a field key named
 * `currency`). The helper used to build the cell's code from two flat spellings
 * only, `currency` and `defaultCurrency`, so a spec-compliant fixed field never
 * reached the renderer and the value painted in the tenant currency.
 *
 * Every field below is produced by `FieldSchema.parse`, so each fixture is
 * exactly what a spec-compliant producer emits, defaulted keys included.
 *
 * ── Directions on the base tree (predicted before the first run) ─────────
 *   table:  fixed JPY field shows the yen            RED   (showed the tenant $)
 *   drawer: fixed JPY field shows the yen            RED   (showed the tenant $)
 *   table:  dynamic field shows the tenant $         GREEN (control)
 *   drawer: dynamic field shows the tenant $         GREEN (control)
 *   table:  a column `currency` beats the fixed code GREEN (control)
 *   table:  a symbol format beats the tenant $       GREEN (control)
 *
 * The dynamic rows are lit against the other way to get this wrong: a chain
 * that reads `currencyConfig.defaultCurrency` whatever the mode paints them in
 * euros. The symbol-format row is lit against resolving with the tenant default
 * while the meta is built, which would put the tenant ahead of the symbol the
 * render path infers from the column format.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FieldSchema } from '@objectstack/spec/data';
import { LocalizationProvider } from '@object-ui/i18n';
import type { ObjectDataTableSchema, TableColumn } from '@object-ui/types';

/** The slice of the `data-table` node the stand-in below reads. */
interface StandInTable {
  columns?: Array<{ accessorKey: string; cell?: (value: unknown, row: Record<string, unknown>) => React.ReactNode }>;
  data?: Array<Record<string, unknown>>;
}

// The underlying `data-table` renderer is replaced by a plain table that calls
// each column's `cell`, the same stand-in `ObjectDataTable.cells.test.tsx` uses:
// the assertion is about the cell `ObjectDataTable` builds, not the grid.
vi.mock('@object-ui/react', async () => {
  const actual = await vi.importActual<typeof import('@object-ui/react')>('@object-ui/react');
  return {
    ...actual,
    SchemaRenderer: ({ schema }: { schema: StandInTable }) => {
      const cols = schema.columns || [];
      const rows = schema.data || [];
      return (
        <table>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c.accessorKey} data-testid={`cell-${c.accessorKey}`}>
                    {typeof c.cell === 'function' ? c.cell(row[c.accessorKey], row) : String(row[c.accessorKey] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    },
    useDataScope: () => undefined,
  };
});

import { ObjectDataTable } from '../ObjectDataTable';
import { RecordDetailDrawer } from '../RecordDetailDrawer';

afterEach(cleanup);

/** A USD tenant: a field that names no currency of its own reads `$`. */
const TENANT = { currency: 'USD', locale: 'en' };

const VALUE = 1234;

/** A currency field as a spec-compliant producer emits it. */
function currencyField(extra: Record<string, unknown>): Record<string, unknown> {
  return FieldSchema.parse({ name: 'amount', label: 'Amount', type: 'currency', ...extra });
}

const FIXED_JPY = () => currencyField({ currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' } });
const DYNAMIC_EUR = () => currencyField({ currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'EUR' } });

/** Mount the table over one `amount` column and return its painted cell text. */
async function tableCell(
  field: Record<string, unknown>,
  column: Partial<Pick<TableColumn, 'currency' | 'format'>> = {},
): Promise<string> {
  const dataSource = {
    find: async () => ({ data: [{ amount: VALUE }] }),
    getObjectSchema: async () => ({ name: 'deal', fields: { amount: field } }),
  };
  const schema: ObjectDataTableSchema = {
    type: 'object-data-table',
    objectName: 'deal',
    columns: [{ header: 'Amount', accessorKey: 'amount', ...column }],
  };
  render(
    <LocalizationProvider value={TENANT}>
      <ObjectDataTable schema={schema} dataSource={dataSource} />
    </LocalizationProvider>,
  );
  const cell = await screen.findByTestId('cell-amount', {}, { timeout: 2000 });
  // The object schema lands after the rows; wait for the currency face.
  await waitFor(() => expect(cell.textContent).toMatch(/1,234/), { timeout: 2000 });
  return cell.textContent ?? '';
}

/** Open the drawer on one record carrying `amount` and return the painted value. */
function drawerValue(field: Record<string, unknown>): string {
  render(
    <LocalizationProvider value={TENANT}>
      <RecordDetailDrawer
        record={{ id: 'deal-1', amount: VALUE }}
        objectName="deal"
        objectSchema={{ fields: { amount: field } }}
        fields={['amount']}
        onClose={vi.fn()}
      />
    </LocalizationProvider>,
  );
  const value = screen.getByTestId('record-detail-body').querySelector('dd');
  return value?.textContent ?? '';
}

describe('a fixed-currency field renders its own code in the dashboard (objectui#10463)', () => {
  describe('the ObjectDataTable cell', () => {
    it("the card's probe: a fixed JPY field reads the yen under a USD tenant", async () => {
      expect(await tableCell(FIXED_JPY())).toBe('¥1,234');
    });

    // The two-digit currencies' `.00` below moved on purpose when
    // objectui#11444 retired the whole-amount trimming (triage comment
    // 5946462862); the yen rows have no minor unit and did not move.
    it('control: a dynamic field reads the tenant $, never its defaultCurrency', async () => {
      expect(await tableCell(DYNAMIC_EUR())).toBe('$1,234.00');
    });

    it('control: a column-level currency still wins over the fixed code', async () => {
      expect(await tableCell(FIXED_JPY(), { currency: 'GBP' })).toBe('£1,234.00');
    });

    it('control: a symbol format on a field with no code of its own beats the tenant $', async () => {
      const plain = FieldSchema.parse({ name: 'amount', label: 'Amount', type: 'number' });
      expect(await tableCell(plain, { format: '¥0,0' })).toBe('¥1,234');
    });
  });

  describe('the RecordDetailDrawer value', () => {
    it('a fixed JPY field reads the yen under a USD tenant', () => {
      expect(drawerValue(FIXED_JPY())).toBe('¥1,234');
    });

    it('control: a dynamic field reads the tenant $, never its defaultCurrency', () => {
      // The `.00` moved on purpose when objectui#11444 retired the whole-amount
      // trimming (triage comment 5946462862).
      expect(drawerValue(DYNAMIC_EUR())).toBe('$1,234.00');
    });
  });
});
