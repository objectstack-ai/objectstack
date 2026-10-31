/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28255: a percent field's authored `percentDisplay` reaches the
 * grid cell on every configured-column path.
 *
 * `PercentCellRenderer` reads `field.percentDisplay`, but the three
 * configured-column paths (ListColumn objects, a string array, inline rows
 * with a `fields` projection) each build a `fieldMeta` bag key by key, the
 * way `useGrouping` rides (objectui#11026). So each path is driven here.
 *
 * ── Directions with the cell's read in place and the grid's relay removed ──
 *   `plain` probability, each configured path   RED   (two bars per row)
 *   the control field (no key)                  GREEN (one bar either way)
 *   auto-generated columns (whole def, no bag)  GREEN (the reference face)
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

const OBJECT = 'os_28255_deal';

const FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text' },
  name: { type: 'text', label: 'Deal Name' },
  // A probability, not progress: the author asks for the plain face.
  probability: { type: 'percent', label: 'Win Chance', percentDisplay: 'plain' },
  // The control: no key, so the bar stays.
  completion: { type: 'percent', label: 'Completion' },
};

const ROW = { id: 'd1', name: 'Tower', probability: 0.25, completion: 0.6 };
const PERCENT_FIELDS = ['probability', 'completion'] as const;

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
 * Render the grid and wait for the ENRICHED columns: until the object schema
 * arrives a column with no type is drawn withheld (masked). The def's label,
 * which differs from the humanized field name, arrives in the same pass.
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
  await waitFor(() => expect(screen.getAllByText('Win Chance').length).toBeGreaterThan(0));
  return utils;
}

/** Each body cell's text and whether it draws a progress bar. */
function cells(container: HTMLElement): Array<{ text: string; bar: boolean }> {
  return Array.from(container.querySelectorAll('tbody td')).map((td) => ({
    text: (td.textContent ?? '').trim(),
    bar: td.querySelector('[role="progressbar"]') !== null,
  }));
}

function expectDeclaredFaces(container: HTMLElement) {
  const all = cells(container);
  const probability = all.find((c) => c.text === '25%');
  const completion = all.find((c) => c.text === '60%');
  expect(probability, `cells: ${JSON.stringify(all)}`).toBeDefined();
  expect(completion, `cells: ${JSON.stringify(all)}`).toBeDefined();
  expect(probability!.bar, '`plain` draws no bar').toBe(false);
  expect(completion!.bar, 'CONTROL: no key keeps the bar').toBe(true);
}

/** The three configured-column paths that build a `fieldMeta` bag. */
const PATHS: Array<[string, Record<string, unknown>]> = [
  ['ListColumn objects', { columns: [{ field: 'name' }, ...PERCENT_FIELDS.map((field) => ({ field }))] }],
  ['string columns', { columns: ['name', ...PERCENT_FIELDS] }],
  ['inline rows + fields projection', { fields: ['name', ...PERCENT_FIELDS] }],
];

describe('a percent field\'s authored percentDisplay reaches the grid cell (objectstack#28255)', () => {
  it.each(PATHS)('%s: `plain` prints the percentage with no bar', async (_path, schemaExtra) => {
    const { container } = await renderGrid(schemaExtra);
    expectDeclaredFaces(container);
  });

  it('auto-generated columns (the whole def, no bag): the reference face', async () => {
    const { container } = await renderGrid({});
    expectDeclaredFaces(container);
  });
});
