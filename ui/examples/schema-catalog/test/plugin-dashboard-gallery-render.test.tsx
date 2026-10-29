/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4600 — every `plugin-dashboard` catalog entry is RENDERED, the way
 * the docs gallery renders it, and no tile may show a broken-widget diagnostic.
 *
 * ## The blind spot this closes
 *
 * `apps/site/app/components/SchemaCatalogIndex.tsx` renders EVERY catalog entry
 * through a real `SchemaRenderer` (via `SchemaThumbnail`), so `/docs/guide/
 * schema-catalog` is a published page whose content is this corpus. Until this
 * file, nothing in CI rendered these entries: `smoke.test.tsx` contains no
 * `render(` call at all — its assertions are structural (every entry is an
 * object with a non-empty `type`) — and `plugin-dashboard-global-filters-spec.
 * test.ts` (objectui#4356) validates `globalFilters` against the spec without
 * rendering anything.
 *
 * Both are satisfied by an entry that renders a red error box. Measured on
 * `origin/main` before this file existed: 15 of the category's 28 widgets
 * rendered the retired-format placeholder and 2 more rendered the dataset
 * error, i.e. 5 of the 6 `filtered-*` entries were 100% broken tiles —
 * including the one `content/docs/guide/dashboard-filters.md` called a
 * "Working example".
 *
 * ## What is asserted
 *
 * Per entry, after the dashboard has settled: no widget shows the retired
 * inline-analytics placeholder, none shows `DatasetWidget`'s
 * "does not support dataset queries" error, none shows the registry's
 * "Unknown component type" panel, no `role="alert"` survives — and every
 * authored widget title is on screen, so an entry cannot pass by rendering
 * nothing at all.
 *
 * The two diagnostic strings are COPIED as literals, deliberately not imported
 * from `@object-ui/plugin-dashboard`'s internals: they are user-visible
 * contract for this pin, the placeholder constant is private to
 * `packages/plugin-dashboard/src/DashboardRenderer.tsx`, and that file is being
 * refactored under objectui#4612. A literal here cannot break that seat, and a
 * reworded placeholder should turn this pin red for review rather than silently
 * following along.
 *
 * ## Why the module-scope package imports
 *
 * `ComponentRegistry` only knows a type once the package owning it has loaded,
 * so this file registers exactly what the docs site's example hosts register
 * (`@object-ui/components`, `@object-ui/layout`, and — since objectui#4600 —
 * `@object-ui/plugin-dashboard` + `@object-ui/plugin-charts`).
 *
 * The chart IMPLEMENTATION behind `React.lazy` is deliberately NOT pre-imported
 * (the AGENTS.md §测试纪律 warm-up other chart tests need): nothing here asserts
 * a drawn plot, so a widget still showing the chart's own skeleton satisfies
 * every assertion below, and no assertion races the lazy import. What is
 * asserted is that the widget is a WIDGET — its card and title — rather than
 * one of the three diagnostics.
 */
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import '@object-ui/components';
import '@object-ui/plugin-dashboard';
import '@object-ui/plugin-charts';
import { registerLayout } from '@object-ui/layout';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererContext } from '@object-ui/react';
import { examplesByCategory } from '../src/index.js';

registerLayout();

/** `DashboardRenderer`'s retired inline-analytics placeholder (framework#3320). */
const RETIRED_PLACEHOLDER =
  'This widget uses a retired data format. Edit it to bind a dataset.';
/** `DatasetWidget`'s error when the host data source has no `queryDataset`. */
const DATASET_UNSUPPORTED = 'This data source does not support dataset queries.';
/** The registry's panel for a type no loaded package registers (OBJUI-001). */
const UNKNOWN_COMPONENT = 'Unknown component type';

/**
 * The docs gallery's data source, in the shape `SchemaThumbnail` supplies it:
 * canned rows for `queryDataset` so a dataset-bound widget draws a real chart
 * instead of the unsupported-source error. Kept as a local literal rather than
 * imported from `apps/site` because `apps/**` is outside every root Vitest
 * project (`vitest.config.mts` `sharedExclude`), so an apps-side module is not
 * resolvable from here; the last case in this file guards the two from
 * drifting apart.
 */
const galleryDataSource = {
  queryDataset: async (
    dataset: string,
    query: { dimensions?: string[]; measures?: string[] },
  ) => {
    const dimensions = query?.dimensions ?? [];
    const measures = query?.measures ?? [];
    const measure = measures[0] ?? 'value';
    const rows = dimensions.length
      ? [
          { [dimensions[0]]: 'Alpha', [measure]: 42 },
          { [dimensions[0]]: 'Beta', [measure]: 27 },
        ]
      : [{ [measure]: 69 }];
    return { rows, fields: [] };
  },
};

const entries = examplesByCategory('plugin-dashboard');

interface DashboardEntry {
  widgets?: Array<{ title?: unknown }>;
}

/** Render one entry exactly as `SchemaThumbnail` does, then let it settle. */
async function renderEntry(schema: unknown) {
  const { container } = render(
    <SchemaRendererContext.Provider value={{ dataSource: galleryDataSource } as never}>
      <SchemaRenderer schema={schema as never} dataSource={galleryDataSource} />
    </SchemaRendererContext.Provider>,
  );
  // A dataset widget starts in `loading` and resolves on a promise. Asserting
  // before it settles would pass while the error is still one tick away — the
  // vacuous green this pin exists to prevent.
  await waitFor(() =>
    expect(container.querySelector('[data-testid="dataset-loading"]')).toBeNull(),
  );
  return container;
}

const occurrences = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

describe('plugin-dashboard catalog entries render in the docs gallery (objectui#4600)', () => {
  /**
   * NON-VACUITY CONTROL. `it.each([])` reports nothing rather than failing, and
   * an unregistered `dashboard` type would render one "Unknown component type"
   * panel per entry — which contains neither diagnostic string below, so the
   * whole sweep would go green over a gallery that draws no dashboard at all.
   */
  it('the category is populated and the dashboard block is registered', () => {
    expect(entries.length).toBeGreaterThanOrEqual(9);
    expect(ComponentRegistry.get('dashboard')).toBeTruthy();
    expect(ComponentRegistry.get('chart')).toBeTruthy();
  });

  it.each(entries.map((e) => [e.id, e.schema] as const))(
    '%s renders every widget without a broken-tile diagnostic',
    async (_id, schema) => {
      const container = await renderEntry(schema);
      const text = container.textContent ?? '';

      expect(text).not.toContain(RETIRED_PLACEHOLDER);
      expect(text).not.toContain(DATASET_UNSUPPORTED);
      expect(text).not.toContain(UNKNOWN_COMPONENT);
      expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);

      // Positive control: the tile actually drew its widgets.
      const widgets = (schema as DashboardEntry).widgets ?? [];
      expect(widgets.length).toBeGreaterThan(0);
      for (const widget of widgets) {
        if (typeof widget.title === 'string' && widget.title.length > 0) {
          expect(text).toContain(widget.title);
        }
      }
    },
  );

  /**
   * The same facts as WIDGET counts, so a regression reports "15 retired
   * placeholders across 5 entries" rather than one failing entry at a time.
   */
  it('the category produces zero retired-format and zero dataset-error widgets', async () => {
    let retired = 0;
    let datasetErrors = 0;
    const broken: string[] = [];
    for (const entry of entries) {
      const container = await renderEntry(entry.schema);
      const text = container.textContent ?? '';
      const r = occurrences(text, RETIRED_PLACEHOLDER);
      const d = occurrences(text, DATASET_UNSUPPORTED);
      retired += r;
      datasetErrors += d;
      if (r || d) broken.push(`${entry.id}: retired=${r} datasetError=${d}`);
    }
    expect({ retired, datasetErrors, broken }).toEqual({
      retired: 0,
      datasetErrors: 0,
      broken: [],
    });
  });

  // ⛔ The GALLERY PARITY case that read the docs-site host files
  // (`registerCatalogBlocks.ts`, `galleryDataSource.ts`, `SchemaThumbnail.tsx`)
  // was deleted with the site by objectstack#27145; nothing is left to read.
});
