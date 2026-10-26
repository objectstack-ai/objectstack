/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11475 — the grid's percent faces read the storage the FIELD
 * declares (the spec's `percentScaleOf`: a fraction unless the field declares a
 * `max` above 1), never a storage guessed from the value.
 *
 * Three faces, one field definition each:
 *
 * - the desktop cell. The three configured-column paths build their own
 *   `fieldMeta` bag for the cell; each one must carry `max`, or a whole-stored
 *   field (`max: 100`, as every shipped percent field declares) reads `50` as
 *   `5000%` once the cell reads the declaration. The auto-generated path hands
 *   over the whole def and is the reference.
 * - the column-summary footer, an AGGREGATE: a `sum` / `avg` of a percent
 *   column is stored the way its field stores, over a fraction-stored field and
 *   a whole-stored one.
 */

import React from 'react';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, renderHook } from '@testing-library/react';
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

const OBJECT = 'os_11475_deal';

const FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text' },
  name: { type: 'text', label: 'Deal Name' },
  // Fraction-stored (no `max`): a stored `1` is 100%.
  won_share: { type: 'percent', label: 'Won Share' },
  // Whole-stored, as CRM `probability` declares it: a stored `50` is 50%.
  probability: { type: 'percent', label: 'Win Probability', min: 0, max: 100 },
};

const ROW = { id: 'd1', name: 'Tower', won_share: 1, probability: 50 };
const PERCENT_FIELDS = ['won_share', 'probability'] as const;

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: 'en-US' }}>{children}</LocalizationProvider>
    </I18nProvider>
  );
}

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [ROW], total: 1, hasMore: false, pageSize: 50 })),
    getObjectSchema: async (name: string) => ({ name, fields: structuredClone(FIELDS) }),
  } as never;
}

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
  // The schema's label, not the humanized key, so the wait ends only once the
  // object's field types have arrived (until then the cells are withheld).
  await waitFor(() => expect(screen.getAllByText('Win Probability').length).toBeGreaterThan(0));
  return utils;
}

function cellTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('tbody td')).map((td) => (td.textContent ?? '').trim());
}

/** The three configured-column paths that build a `fieldMeta` bag. */
const PATHS: Array<[string, Record<string, unknown>]> = [
  ['ListColumn objects', { columns: [{ field: 'name' }, ...PERCENT_FIELDS.map((field) => ({ field }))] }],
  ['string columns', { columns: ['name', ...PERCENT_FIELDS] }],
  ['inline rows + fields projection', { fields: ['name', ...PERCENT_FIELDS] }],
];

describe("the grid cell reads a percent field's declared storage on every column path (objectui#11475)", () => {
  it.each(PATHS)('%s: a fraction-stored 1 reads 100% and a whole-stored 50 reads 50%', async (_path, schemaExtra) => {
    const { container } = await renderGrid(schemaExtra);
    const cells = cellTexts(container);
    expect(cells, `cells: ${JSON.stringify(cells)}`).toContain('100%');
    expect(cells).toContain('50%');
    expect(cells).not.toContain('1%');
    expect(cells).not.toContain('5000%');
  });

  it('reference: the auto-generated columns hand over the whole def and read the same', async () => {
    const { container } = await renderGrid({});
    const cells = cellTexts(container);
    expect(cells, `cells: ${JSON.stringify(cells)}`).toContain('100%');
    expect(cells).toContain('50%');
  });
});

describe("the column-summary footer aggregates at the field's storage (objectui#11475)", () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => <Providers>{children}</Providers>;

  it('a fraction-stored column summing to 1 reads 100%, as its cells read', () => {
    const cols: any[] = [{ field: 'won_share', summary: 'sum' }];
    const data = [{ won_share: 0.25 }, { won_share: 0.75 }];
    const { result } = renderHook(() => useColumnSummary(cols, data, FIELDS as never), { wrapper });
    expect(result.current.summaries.get('won_share')?.label).toBe('Sum: 100%');
  });

  it('a whole-stored column (max: 100) averaging 50 reads 50%, not 5000%', () => {
    const cols: any[] = [{ field: 'probability', summary: 'avg' }];
    const data = [{ probability: 25 }, { probability: 75 }];
    const { result } = renderHook(() => useColumnSummary(cols, data, FIELDS as never), { wrapper });
    expect(result.current.summaries.get('probability')?.label).toBe('Avg: 50%');
  });

  it('a whole-stored column summing to 1 reads 1%: the storage, not the magnitude, decides', () => {
    const cols: any[] = [{ field: 'probability', summary: 'sum' }];
    const data = [{ probability: 0.5 }, { probability: 0.5 }];
    const { result } = renderHook(() => useColumnSummary(cols, data, FIELDS as never), { wrapper });
    expect(result.current.summaries.get('probability')?.label).toBe('Sum: 1%');
  });
});
