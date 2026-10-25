/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10354: a fixed-currency field reads its OWN currency on the grid
 * cell and on the summary footer, not the tenant's.
 *
 * `@objectstack/spec` refuses a field key `currency` by name, so a fixed
 * currency can only be declared as
 * `currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' }`, and
 * `resolveFieldCurrency` reads it. The grid never handed it that key:
 *
 *  - the three configured-column paths (ListColumn objects, a string array,
 *    inline rows with a `fields` projection) built the cell's `fieldMeta` bag
 *    from `currency` / `precision` / `scale` only;
 *  - `useColumnSummary`'s column hints carried no `currencyConfig`.
 *
 * So with a USD tenant, a JPY-fixed `1234` read `$1,234` in the cell and in
 * the footer, while the metric tile and every whole-def cell read `¥1,234`.
 *
 * ── Two kinds of assertion ──────────────────────────────────────────────
 * Absolute bytes (`¥1,234`, `$5,678`) name the ruled output, so a joint move
 * of cell and footer to a wrong currency cannot pass. The agreement table
 * compares the grid against the REAL `CurrencyCellRenderer` handed the WHOLE
 * field def under the same providers, so it restates no resolution rule and
 * holds whatever `resolveFieldCurrency` decides a `currencyMode` means. The
 * `dynamic` row is there for that reason, not as a ruling on dynamic mode.
 *
 * ── Directions on the base tree (predicted before the first run) ─────────
 *   JPY-fixed cell, each of the three paths     RED   (tenant `$`)
 *   JPY-fixed footer, grid and hook             RED   (tenant `$`)
 *   agreement, cells and footers                RED   (the `currencyConfig` rows)
 *   the control field (no `currencyConfig`)     GREEN (tenant `$` is right)
 *   auto-generated columns (whole def, no bag)  GREEN (the reference face)
 * The controls are GREEN on the base tree by design: they fail only if the
 * repair overshoots and stops falling back to the tenant currency.
 */

import React from 'react';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, renderHook, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { CurrencyCellRenderer, registerAllFields } from '@object-ui/fields';
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

/** A USD tenant: every field that names no currency of its own reads `$`. */
const TENANT = { currency: 'USD', locale: 'en' };

const OBJECT = 'os_10354_deal';

const FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text' },
  name: { type: 'text', label: 'Deal Name' },
  // The card's fixture: the spec's one fixed-currency spelling.
  amount: {
    type: 'currency',
    label: 'Yen Amount',
    currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' },
  },
  // Agreement only: whatever the resolver makes of dynamic mode, the grid
  // must make the same of it.
  dyn: {
    type: 'currency',
    label: 'Dynamic Amount',
    currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'EUR' },
  },
  // The control: no `currencyConfig`, so the tenant currency is right.
  plain: { type: 'currency', label: 'Plain Amount' },
};

const ROW = { id: 'd1', name: 'Tower', amount: 1234, dyn: 3456, plain: 5678 };
const CURRENCY_FIELDS = ['amount', 'dyn', 'plain'] as const;

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={TENANT}>{children}</LocalizationProvider>
    </I18nProvider>
  );
}

/** What the list cell renders for `value` when handed the WHOLE field def. */
function wholeDefCell(field: string): string {
  const { container, unmount } = render(
    <Providers>
      <CurrencyCellRenderer value={ROW[field as keyof typeof ROW]} field={{ name: field, ...FIELDS[field] } as any} />
    </Providers>,
  );
  const text = container.textContent ?? '';
  unmount();
  return text;
}

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [ROW], total: 1, hasMore: false, pageSize: 50 })),
    getObjectSchema: async (name: string) => ({ name, fields: structuredClone(FIELDS) }),
  } as never;
}

/**
 * Render the grid and wait for the ENRICHED columns. The object schema arrives
 * from an async fetch, so the first paint builds the cell bag with no field
 * def at all, and a `$` read then would pass for the wrong reason. The header
 * reads the def's label (`Yen Amount`) in the same memo pass that builds the
 * bag, on all three paths, so it is the signal, and it is not under test.
 */
async function renderGrid(schemaExtra: Record<string, unknown>) {
  const ds = makeDataSource();
  const utils = render(
    <Providers>
      <ActionProvider>
        <SchemaRendererProvider dataSource={ds}>
          <ObjectGrid
            schema={{
              type: 'object-grid',
              objectName: OBJECT,
              data: { provider: 'value', items: [ROW] },
              pagination: { pageSize: 50 },
              ...schemaExtra,
            } as never}
            dataSource={ds}
          />
        </SchemaRendererProvider>
      </ActionProvider>
    </Providers>,
  );
  await waitFor(() => expect(screen.getAllByText('Yen Amount').length).toBeGreaterThan(0));
  return utils;
}

function cellTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('tbody td')).map((td) => (td.textContent ?? '').trim());
}

/**
 * The three configured-column paths that build a `fieldMeta` bag, reached by
 * the three shapes the column builder branches on (the same three
 * `relationalMetaCopySet-6711.test.tsx` drives).
 */
const PATHS: Array<[string, Record<string, unknown>]> = [
  [
    'ListColumn objects',
    { columns: [{ field: 'name' }, ...CURRENCY_FIELDS.map((field) => ({ field, summary: 'sum' }))] },
  ],
  ['string columns', { columns: ['name', ...CURRENCY_FIELDS] }],
  ['inline rows + fields projection', { fields: ['name', ...CURRENCY_FIELDS] }],
];

describe('a JPY-fixed field reads `¥` on the grid cell under a USD tenant (objectui#10354)', () => {
  it.each(PATHS)('%s: the JPY-fixed field reads ¥', async (_path, schemaExtra) => {
    const { container } = await renderGrid(schemaExtra);
    const cells = cellTexts(container);
    expect(cells, `cells: ${JSON.stringify(cells)}`).toContain('¥1,234');
    expect(cells).not.toContain('$1,234');
  });

  it.each(PATHS)('%s: control, a field with no currencyConfig reads the tenant $', async (_path, schemaExtra) => {
    const { container } = await renderGrid(schemaExtra);
    // The `.00` moved on purpose when objectui#11444 retired the whole-amount
    // trimming (triage comment 5946462862).
    expect(cellTexts(container)).toContain('$5,678.00');
  });

  it.each(PATHS)('%s: every currency cell reads what the whole-def cell reads', async (_path, schemaExtra) => {
    const { container } = await renderGrid(schemaExtra);
    const cells = cellTexts(container);
    cleanup();
    for (const field of CURRENCY_FIELDS) {
      const expected = wholeDefCell(field);
      expect(cells, `${field}: whole-def cell reads ${expected}; grid cells ${JSON.stringify(cells)}`).toContain(expected);
    }
  });
});

describe('the reference the configured paths now match (objectui#10354)', () => {
  // The auto-generated columns (no `columns`, no `fields`) hand the cell the
  // WHOLE field def and build no bag, so they already read the field's own
  // currency on the base tree. GREEN there by design: it names the face the
  // three configured paths used to disagree with.
  it('auto-generated columns: every currency cell reads what the whole-def cell reads', async () => {
    const { container } = await renderGrid({});
    const cells = cellTexts(container);
    cleanup();
    expect(cells).toContain('¥1,234');
    for (const field of CURRENCY_FIELDS) {
      expect(cells).toContain(wholeDefCell(field));
    }
  });
});

describe('the summary footer resolves the same currency as the cell above it (objectui#10354)', () => {
  it('through ObjectGrid: the JPY-fixed footer reads ¥', async () => {
    await renderGrid(PATHS[0][1]);
    expect(screen.getByTestId('summary-amount').textContent).toBe('Yen Amount: Sum: ¥1,234');
  });

  it('through ObjectGrid: control, a footer with no currencyConfig reads the tenant $', async () => {
    await renderGrid(PATHS[0][1]);
    // The `.00` moved on purpose when objectui#11444 retired the whole-amount
    // trimming (triage comment 5946462862).
    expect(screen.getByTestId('summary-plain').textContent).toBe('Plain Amount: Sum: $5,678.00');
  });

  it('through ObjectGrid: every currency footer reads `Sum: ` plus the whole-def cell', async () => {
    await renderGrid(PATHS[0][1]);
    const footers = Object.fromEntries(
      CURRENCY_FIELDS.map((field) => [field, screen.getByTestId(`summary-${field}`).textContent ?? '']),
    );
    cleanup();
    for (const field of CURRENCY_FIELDS) {
      expect(footers[field]).toBe(`${FIELDS[field].label}: Sum: ${wholeDefCell(field)}`);
    }
  });

  // Typed against the hook's own parameter with no cast, so `type-check` reads
  // the `currencyConfig` member in the spec's shape, `currencyMode` included.
  const META: NonNullable<Parameters<typeof useColumnSummary>[2]> = {
    amount: { type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' } },
    plain: { type: 'currency' },
  };

  function hookLabel(field: string): string | undefined {
    const columns: any[] = ['amount', 'plain'].map((f) => ({ field: f, summary: 'sum' }));
    const { result } = renderHook(() => useColumnSummary(columns, [ROW], META), { wrapper: Providers });
    return result.current.summaries.get(field)?.label;
  }

  it('through the public hook: `fieldMetadata` carrying `currencyConfig` reaches the resolver', () => {
    expect(hookLabel('amount')).toBe('Sum: ¥1,234');
  });

  it('through the public hook: control, a field with no currencyConfig reads the tenant $', () => {
    // The `.00` moved on purpose when objectui#11444 retired the whole-amount
    // trimming (triage comment 5946462862).
    expect(hookLabel('plain')).toBe('Sum: $5,678.00');
  });
});
