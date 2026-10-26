/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11026: a number field's authored `useGrouping` reaches the grid
 * cell on every configured-column path.
 *
 * `NumberCellRenderer` reads `field.useGrouping`, but the grid does not hand
 * the cell the field def: the three configured-column paths (ListColumn
 * objects, a string array, inline rows with a `fields` projection) each build
 * a `fieldMeta` bag key by key. A key left off that bag never reaches the
 * cell, which is how `scale` once went missing from the gallery
 * (objectui#9575). So each path is driven here, not the renderer alone.
 *
 * ── Directions with the cell's read in place and the grid's relay removed ──
 * (predicted before the first run; this is the ablation the file exists for)
 *   `useGrouping: false`, scale 1, each path      RED   (`12,345.5`)
 *   `useGrouping: true`, scale 0, each path       RED   (`2026`, the heuristic)
 *   the control field (no hint, scale 1)          GREEN (grouped either way)
 *   auto-generated columns (whole def, no bag)    GREEN (the reference face)
 */

import React from 'react';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});

afterEach(cleanup);

const OBJECT = 'os_11026_metric';

const FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text' },
  name: { type: 'text', label: 'Metric Name' },
  // The author's opt-out, on a scale the heuristic would group.
  code: { type: 'number', label: 'Plain Code', scale: 1, useGrouping: false },
  // The author's pin, on a scale the heuristic would leave ungrouped.
  headcount: { type: 'number', label: 'Headcount', scale: 0, useGrouping: true },
  // The control: no hint, so the heuristic's grouped answer is right.
  total: { type: 'number', label: 'Total', scale: 1 },
};

const ROW = { id: 'm1', name: 'Tower', code: 12345.5, headcount: 2026, total: 67890.5 };
const NUMBER_FIELDS = ['code', 'headcount', 'total'] as const;

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

/**
 * Render the grid and wait for the ENRICHED columns: the object schema arrives
 * from an async fetch, and the first paint builds the bag with no field def at
 * all. The header reads the def's label in the same pass that builds the bag,
 * so it is the signal.
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
  await waitFor(() => expect(screen.getAllByText('Plain Code').length).toBeGreaterThan(0));
  return utils;
}

function cellTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('tbody td')).map((td) => (td.textContent ?? '').trim());
}

/** The three configured-column paths that build a `fieldMeta` bag. */
const PATHS: Array<[string, Record<string, unknown>]> = [
  ['ListColumn objects', { columns: [{ field: 'name' }, ...NUMBER_FIELDS.map((field) => ({ field }))] }],
  ['string columns', { columns: ['name', ...NUMBER_FIELDS] }],
  ['inline rows + fields projection', { fields: ['name', ...NUMBER_FIELDS] }],
];

describe('a number field\'s authored useGrouping reaches the grid cell (objectui#11026)', () => {
  it.each(PATHS)('%s: useGrouping false renders ungrouped at scale 1', async (_path, schemaExtra) => {
    const { container } = await renderGrid(schemaExtra);
    const cells = cellTexts(container);
    expect(cells, `cells: ${JSON.stringify(cells)}`).toContain('12345.5');
    expect(cells).not.toContain('12,345.5');
  });

  it.each(PATHS)('%s: useGrouping true renders grouped at scale 0', async (_path, schemaExtra) => {
    const { container } = await renderGrid(schemaExtra);
    const cells = cellTexts(container);
    expect(cells, `cells: ${JSON.stringify(cells)}`).toContain('2,026');
    expect(cells).not.toContain('2026');
  });

  it.each(PATHS)('%s: control, a field with no hint keeps the heuristic', async (_path, schemaExtra) => {
    const { container } = await renderGrid(schemaExtra);
    expect(cellTexts(container)).toContain('67,890.5');
  });
});

describe('the reference the configured paths now match (objectui#11026)', () => {
  // The auto-generated columns hand the cell the WHOLE field def and build no
  // bag, so they read the hint on the base tree too: GREEN there by design.
  it('auto-generated columns: both hints render as declared', async () => {
    const { container } = await renderGrid({});
    const cells = cellTexts(container);
    expect(cells, `cells: ${JSON.stringify(cells)}`).toContain('12345.5');
    expect(cells).toContain('2,026');
    expect(cells).toContain('67,890.5');
  });
});
