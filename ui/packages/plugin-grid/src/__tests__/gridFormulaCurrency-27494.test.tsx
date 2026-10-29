/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27494: a formula declaring `returnType: 'currency'` reads as
 * money on the grid cell, the same face as the currency field beside it.
 *
 * The formula cell (`FormulaCellRenderer`) picks its face from the declared
 * `returnType`, and a `currency` one draws through `CurrencyCellRenderer` with
 * the formula's own `currencyConfig`. The three configured-column paths built
 * the cell's `fieldMeta` bag from a picked key list that carried
 * `currencyConfig` and `scale` but not `returnType`, so the cell saw an
 * undeclared formula holding a JS number and drew the number face: the
 * showcase's Budget Remaining read `90,000.00` beside Budget's `$150,000.00`.
 *
 * The tenant is EUR on purpose: the formula's `$` can then only come from its
 * own `fixed` `currencyConfig`, never from a tenant fallback.
 *
 * ── Directions on the base tree (predicted before the first run) ─────────
 *   currency formula, each of the three paths    RED   (`90,000.00`)
 *   agreement with the whole-def formula cell    RED   (the currency row)
 *   number formula / undeclared formula          GREEN (the number face is right)
 *   auto-generated columns (whole def, no bag)   GREEN (the reference face)
 */

import React from 'react';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { FormulaCellRenderer, registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});

afterEach(cleanup);

/** A EUR tenant: a `$` in a cell is the field's own fixed currency. */
const TENANT = { currency: 'EUR', locale: 'en' };

const OBJECT = 'os_27494_project';

const USD_FIXED = { currencyMode: 'fixed', defaultCurrency: 'USD' };

const FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text' },
  name: { type: 'text', label: 'Project Name' },
  budget: { type: 'currency', label: 'Budget', currencyConfig: USD_FIXED },
  // The showcase's Budget Remaining, as `project.object.ts` declares it.
  remaining: {
    type: 'formula',
    label: 'Budget Remaining',
    returnType: 'currency',
    currencyConfig: USD_FIXED,
    scale: 2,
  },
  // Controls: a declared number, and a formula declaring nothing.
  ratio: { type: 'formula', label: 'Burn Ratio', returnType: 'number', scale: 2 },
  bare: { type: 'formula', label: 'Bare Result' },
};

const ROW = { id: 'p1', name: 'Tower', budget: 150000, remaining: 90000, ratio: 1234.5, bare: 4321 };
const FORMULA_FIELDS = ['remaining', 'ratio', 'bare'] as const;
const SHOWN = ['budget', ...FORMULA_FIELDS] as const;

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={TENANT}>{children}</LocalizationProvider>
    </I18nProvider>
  );
}

/** What the formula cell renders for `field` when handed the WHOLE def. */
function wholeDefCell(field: string): string {
  const { container, unmount } = render(
    <Providers>
      <FormulaCellRenderer value={ROW[field as keyof typeof ROW]} field={{ name: field, ...FIELDS[field] } as any} />
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
 * Render the grid and wait for the ENRICHED columns: the header reads the
 * def's label in the same memo pass that builds the cell bag, so it is the
 * signal that the bag was built from the object schema.
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
  await waitFor(() => expect(screen.getAllByText('Budget Remaining').length).toBeGreaterThan(0));
  return utils;
}

function cellTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('tbody td')).map((td) => (td.textContent ?? '').trim());
}

/** The three configured-column paths that build a `fieldMeta` bag. */
const PATHS: Array<[string, Record<string, unknown>]> = [
  ['ListColumn objects', { columns: [{ field: 'name' }, ...SHOWN.map((field) => ({ field }))] }],
  ['string columns', { columns: ['name', ...SHOWN] }],
  ['inline rows + fields projection', { fields: ['name', ...SHOWN] }],
];

describe('a returnType currency formula reads as money on the grid cell (objectstack#27494)', () => {
  it.each(PATHS)('%s: the currency formula reads $90,000.00 beside the currency field', async (_path, schemaExtra) => {
    const { container } = await renderGrid(schemaExtra);
    const cells = cellTexts(container);
    expect(cells, `cells: ${JSON.stringify(cells)}`).toContain('$150,000.00');
    expect(cells).toContain('$90,000.00');
    expect(cells).not.toContain('90,000.00');
  });

  it.each(PATHS)('%s: control, a number formula and an undeclared one keep the bare number', async (_path, schemaExtra) => {
    const { container } = await renderGrid(schemaExtra);
    const cells = cellTexts(container);
    expect(cells, `cells: ${JSON.stringify(cells)}`).toContain('1,234.50');
    expect(cells).toContain('4,321');
  });

  it.each(PATHS)('%s: every formula cell reads what the whole-def formula cell reads', async (_path, schemaExtra) => {
    const { container } = await renderGrid(schemaExtra);
    const cells = cellTexts(container);
    cleanup();
    for (const field of FORMULA_FIELDS) {
      const expected = wholeDefCell(field);
      expect(cells, `${field}: whole-def cell reads ${expected}; grid cells ${JSON.stringify(cells)}`).toContain(expected);
    }
  });
});

describe('the reference the configured paths now match (objectstack#27494)', () => {
  // The auto-generated columns hand the cell the WHOLE field def and build no
  // bag, so they read the declared face on the base tree. GREEN there by
  // design: it names the face the three configured paths disagreed with.
  it('auto-generated columns: the currency formula reads $90,000.00', async () => {
    const { container } = await renderGrid({});
    const cells = cellTexts(container);
    expect(cells).toContain('$90,000.00');
    expect(cells).toContain('1,234.50');
  });
});
