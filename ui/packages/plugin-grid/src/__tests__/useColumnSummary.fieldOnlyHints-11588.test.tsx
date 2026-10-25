/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11588 — the summary footer takes `currency`, `defaultCurrency`,
 * `precision` and `scale` from the FIELD only, as it already takes
 * `currencyConfig` (objectui#10354) and `max` (objectui#11475).
 *
 * `ListColumnSchema` (`@objectstack/spec/ui`) is a strict object that declares
 * none of the four keys, so a list view authoring one on a column is refused
 * with `unrecognized_keys`. `useColumnSummary` read them anyway, as
 * `col.KEY ?? meta.KEY`, so a column carrying one outranked the field. The
 * triage ruling on the card retired that read rather than widening the column
 * schema. These cases pin the ruling's two halves:
 *
 * - a column carrying any of the four keys no longer changes the footer;
 * - the field's own hints still apply, and so does the column's `type`, which
 *   `ListColumnSchema` does declare.
 *
 * ── Directions on the base tree (predicted before the first run) ─────────
 *   column `currency` / `defaultCurrency` / `scale`     RED   (the column won)
 *   column `precision`                                  GREEN (no arm reads it)
 *   field-level hints, column `type`                    GREEN (controls)
 * `precision` is GREEN on the base tree because no arm of the footer's
 * formatter reads it: the currency arm takes the currency's minor unit
 * (objectui#10221), and the percent and number arms take `scale` through
 * `resolveFieldScale` (objectui#9295, objectui#9843). Its case is kept so the
 * pin covers all four keys the ruling names.
 */

import React from 'react';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, renderHook, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';
import { useColumnSummary } from '../useColumnSummary';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});

afterEach(cleanup);

/** A USD tenant: a currency field that names no code of its own reads `$`. */
const TENANT = { currency: 'USD', locale: 'en' };

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={TENANT}>{children}</LocalizationProvider>
    </I18nProvider>
  );
}

type FieldMetadata = NonNullable<Parameters<typeof useColumnSummary>[2]>;

/**
 * The footer label for one `sum` column over `field`, with `columnExtra` on
 * the column. The column is built as a plain record: the four keys are not
 * `ListColumn` members, which is the point of the card.
 */
function footer(
  columnExtra: Record<string, unknown>,
  fieldDef: FieldMetadata[string] | undefined,
  value: number,
): string | undefined {
  const columns = [{ field: 'f', summary: 'sum', ...columnExtra }];
  const meta: FieldMetadata | undefined = fieldDef ? { f: fieldDef } : undefined;
  const { result } = renderHook(() => useColumnSummary(columns as never, [{ f: value }], meta), {
    wrapper: Providers,
  });
  return result.current.summaries.get('f')?.label;
}

describe('a column carrying a retired hint no longer changes the footer (objectui#11588)', () => {
  it('column `currency`: a code-less currency field reads the tenant $, not the column EUR', () => {
    expect(footer({ currency: 'EUR' }, { type: 'currency' }, 1234.5)).toBe('Sum: $1,234.50');
  });

  it('column `defaultCurrency`: a code-less currency field reads the tenant $, not the column EUR', () => {
    expect(footer({ defaultCurrency: 'EUR' }, { type: 'currency' }, 1234.5)).toBe('Sum: $1,234.50');
  });

  it("column `scale`: a number field keeps its own two decimals, not the column's four", () => {
    expect(footer({ scale: 4 }, { type: 'number', scale: 2 }, 1.5)).toBe('Sum: 1.50');
  });

  it("column `scale`: a percent field keeps its own width, not the column's three decimals", () => {
    expect(footer({ scale: 3 }, { type: 'percent', scale: 1 }, 0.25)).toBe('Sum: 25.0%');
  });

  it("column `precision`: a number field's footer is unchanged", () => {
    expect(footer({ precision: 4 }, { type: 'number', precision: 10, scale: 2 }, 1.5)).toBe('Sum: 1.50');
  });
});

describe("the field's own hints and the column's declared `type` still apply (objectui#11588)", () => {
  it('field `currency` decides the code', () => {
    expect(footer({}, { type: 'currency', currency: 'EUR' }, 1234.5)).toBe('Sum: €1,234.50');
  });

  it('field `defaultCurrency` decides the code', () => {
    expect(footer({}, { type: 'currency', defaultCurrency: 'EUR' }, 1234.5)).toBe('Sum: €1,234.50');
  });

  it('field `scale` decides a number width', () => {
    expect(footer({}, { type: 'number', scale: 4 }, 1.5)).toBe('Sum: 1.5000');
  });

  it("column `type`, a declared `ListColumn` member, still formats a field the footer has no def for", () => {
    expect(footer({ type: 'currency' }, undefined, 1234.5)).toBe('Sum: $1,234.50');
  });
});

describe('through ObjectGrid, the real caller (objectui#11588)', () => {
  const OBJECT = 'os_11588_deal';
  const FIELDS: Record<string, Record<string, unknown>> = {
    id: { type: 'text' },
    name: { type: 'text', label: 'Deal Name' },
    amount: { type: 'currency', label: 'Deal Amount' },
    qty: { type: 'number', label: 'Quantity', scale: 2 },
  };
  const ROW = { id: 'd1', name: 'Tower', amount: 1234.5, qty: 1.5 };

  async function renderGrid(columns: Array<Record<string, unknown>>) {
    const ds = {
      find: vi.fn(async () => ({ data: [ROW], total: 1, hasMore: false, pageSize: 50 })),
      getObjectSchema: async (name: string) => ({ name, fields: structuredClone(FIELDS) }),
    } as never;
    render(
      <Providers>
        <ActionProvider>
          <SchemaRendererProvider dataSource={ds}>
            <ObjectGrid
              schema={{
                type: 'object-grid',
                objectName: OBJECT,
                data: { provider: 'value', items: [ROW] },
                pagination: { pageSize: 50 },
                columns,
              } as never}
              dataSource={ds}
            />
          </SchemaRendererProvider>
        </ActionProvider>
      </Providers>,
    );
    // The field def's label, so the wait ends only once the object schema has
    // arrived and the footer has the field's hints to read.
    await waitFor(() => expect(screen.getAllByText('Deal Amount').length).toBeGreaterThan(0));
  }

  it('columns carrying `currency`, `defaultCurrency`, `precision` and `scale` read the field', async () => {
    await renderGrid([
      { field: 'name' },
      { field: 'amount', summary: 'sum', currency: 'EUR', defaultCurrency: 'GBP' },
      { field: 'qty', summary: 'sum', precision: 4, scale: 4 },
    ]);
    expect(screen.getByTestId('summary-amount').textContent).toBe('Deal Amount: Sum: $1,234.50');
    expect(screen.getByTestId('summary-qty').textContent).toBe('Quantity: Sum: 1.50');
  });

  it('control: the same columns without the keys read the same footer', async () => {
    await renderGrid([
      { field: 'name' },
      { field: 'amount', summary: 'sum' },
      { field: 'qty', summary: 'sum' },
    ]);
    expect(screen.getByTestId('summary-amount').textContent).toBe('Deal Amount: Sum: $1,234.50');
    expect(screen.getByTestId('summary-qty').textContent).toBe('Quantity: Sum: 1.50');
  });
});
