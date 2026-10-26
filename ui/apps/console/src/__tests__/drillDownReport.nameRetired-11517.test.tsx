/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11517 — with `DrillDownConfig.report`'s `{ name }` reference arm
 * retired, the dataset-bound inline report still validates AND still draws
 * through the real drill-down drawer, and the drawer draws the same thing for a
 * stored `{ name }` value as it did before.
 *
 * Each case takes ONE `object-pivot` document, validates it on the strict
 * authoring face (`StrictAnyComponentSchema`, which `objectui validate` runs)
 * and on the tolerant one (`safeValidateSchema`), then mounts the REAL
 * `DrillDownDrawer` with that document's `drillDown.report` over the REAL
 * `report` registration of `@object-ui/plugin-report` (the pairing a drill runs
 * in, which is why this lives in the console, the package that depends on
 * both), and reads which query the drawer issues: a report runs
 * `queryDataset`, and the record list runs `find`.
 *
 * The refusals on every face are pinned in
 * `packages/types/src/__tests__/drill-down-report-name-retired-11517.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
import { DrillDownDrawer } from '@object-ui/plugin-dashboard';
import { StrictAnyComponentSchema, safeValidateSchema } from '@object-ui/types/zod';
// Registers `report`, the type the drawer's report arm renders (objectui#11440).
import '@object-ui/plugin-report';

beforeEach(() => {
  // The report's dimension-label probe is best-effort; answer it empty.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ item: { fields: {} } }) })));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

/** A dataset-bound summary report, the one form `report` declares. */
const SUMMARY = {
  name: 'deals_by_stage',
  label: 'Deals by Stage',
  type: 'summary',
  dataset: 'deals_ds',
  rows: ['stage'],
  values: ['amount_sum'],
};

/** The `object-pivot` document a drill report is authored in. */
const pivot = (report: Record<string, unknown>) => ({
  type: 'object-pivot',
  properties: {
    objectName: 'deal',
    rowField: 'stage',
    columnField: 'owner',
    valueField: 'amount',
    aggregation: 'sum',
    drillDown: { enabled: true, report },
  },
});

/** Mount the drawer open on `report` and settle its first query. */
async function drill(report: Record<string, unknown>, filter?: Record<string, unknown>) {
  // Typed with the parameters the adapter is called with, so `mock.calls[i]`
  // is a typed tuple: `find(resource, params)` and `queryDataset(dataset, selection)`.
  const ds = {
    find: vi.fn(async (_resource: string, _params?: Record<string, unknown>) => ({ data: [], total: 0 })),
    queryDataset: vi.fn(
      async (_dataset: string | Record<string, unknown>, _selection: Record<string, unknown>) =>
        ({ rows: [], fields: [], object: 'deal' }),
    ),
  };
  render(
    // A two-method fake, not a whole `DataSource`; the console's fake-adapter spelling.
    <SchemaRendererProvider dataSource={ds as never}>
      <DrillDownDrawer open onClose={() => {}} title="Deals" objectName="deal" filter={filter} report={report} />
    </SchemaRendererProvider>,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return ds;
}

describe('the dataset-bound drill report still validates and still draws (objectui#11517)', () => {
  it('one document: valid on both faces, and drawn by the real drawer as a report scoped by the click', async () => {
    const doc = pivot(SUMMARY);
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success, JSON.stringify(strict.error?.issues)).toBe(true);
    const tolerant = safeValidateSchema(doc);
    expect(tolerant.success, JSON.stringify(tolerant.error?.issues)).toBe(true);

    const ds = await drill(doc.properties.drillDown.report, { stage: 'Won' });
    expect(ds.queryDataset).toHaveBeenCalledTimes(1);
    expect(ds.queryDataset.mock.calls[0]?.[0]).toBe('deals_ds');
    expect(ds.queryDataset.mock.calls[0]?.[1]?.runtimeFilter).toEqual({ stage: 'Won' });
    expect(ds.find, 'the drawer listed records instead of drawing the report').not.toHaveBeenCalled();
  });
});

describe('a stored `{ name }` drill report: refused at authoring, drawn as before (objectui#11517)', () => {
  it('is refused on both faces, and the real drawer lists the records for it, as it did before the retirement', async () => {
    const reference = { name: 'deals_by_stage' };
    expect(StrictAnyComponentSchema.safeParse(pivot(reference)).success).toBe(false);
    expect(safeValidateSchema(pivot(reference)).success).toBe(false);

    // A value that never went through a validator still reaches the drawer, which
    // draws no report for it and lists the records scoped by the click.
    const ds = await drill(reference, { stage: 'Won' });
    expect(ds.queryDataset).not.toHaveBeenCalled();
    expect(ds.find).toHaveBeenCalled();
    expect(ds.find.mock.calls[0]?.[0]).toBe('deal');
    expect(JSON.stringify(ds.find.mock.calls[0]?.[1])).toContain('Won');
  });
});
