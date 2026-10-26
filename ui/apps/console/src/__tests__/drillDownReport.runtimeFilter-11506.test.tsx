/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11506 — the drill-down drawer writes the drill's filter into a
 * dataset-bound report as `runtimeFilter`, the key `ReportSchema` declares and
 * `DatasetReportRenderer` applies.
 *
 * It used to write `filter`, which the spec refuses and the renderer does not
 * apply since objectui#5137 (it only warns in dev), so a drill from a filtered
 * widget into a dataset report queried the whole dataset. Each case mounts the
 * REAL `DrillDownDrawer` and the REAL `report` registration of
 * `@object-ui/plugin-report` (the pairing a drill runs in, which is why this
 * lives in the console, the package that depends on both), and reads the
 * selection `queryDataset` receives.
 *
 * - A dataset-bound report: the selection carries the clicked filter as
 *   `runtimeFilter`, joined once with the report's own; the unfiltered drill is
 *   the control. A summary report, which has no `columns`, is drawn as a report
 *   too: the drawer used to recognise a dataset report only by a `columns` array,
 *   which only a matrix carries, and listed the records instead.
 * - The pre-9.0 object-bound form (`objectName` plus column objects) is retired:
 *   it had no producer, and through the drawer it drew an empty presentation and
 *   issued no query. It is no longer drawn as a report; the drawer lists the
 *   records, as for a drill with no report. The declaration's refusal is pinned in
 *   `packages/types/src/__tests__/drill-down-report-dataset-bound-11506.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
import { DrillDownDrawer } from '@object-ui/plugin-dashboard';
// Registers `report`, the type the drawer's report arm renders (objectui#11440).
import '@object-ui/plugin-report';

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // The report's dimension-label probe is best-effort; answer it empty.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ item: { fields: {} } }) })));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

const MATRIX = {
  name: 'deals_by_stage_and_owner',
  label: 'Deals by Stage and Owner',
  type: 'matrix',
  dataset: 'deals_ds',
  rows: ['stage'],
  columns: ['owner'],
  values: ['amount_sum'],
};

/** Mount the drawer open and settle the report's first query. */
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

/** The selection of the `n`-th `queryDataset` call (1-based). */
const selectionOf = (ds: Awaited<ReturnType<typeof drill>>, n = 1) => ds.queryDataset.mock.calls[n - 1]?.[1];

const filterWarnings = () =>
  warn.mock.calls.map((call: unknown[]) => String(call[0])).filter((message: string) => message.includes('carries `filter`'));

describe('the drill-down drawer scopes a dataset-bound report by `runtimeFilter` (objectui#11506)', () => {
  it('a filtered drill puts the clicked filter in the selection as `runtimeFilter`', async () => {
    const ds = await drill(MATRIX, { stage: 'Won' });
    expect(ds.queryDataset).toHaveBeenCalledTimes(1);
    expect(ds.queryDataset.mock.calls[0]?.[0]).toBe('deals_ds');
    expect(selectionOf(ds)?.runtimeFilter, 'the drilled report queried the whole dataset').toEqual({ stage: 'Won' });
    expect(filterWarnings(), 'the drawer wrote a `filter` the renderer refuses').toEqual([]);
    expect(ds.find, 'the drawer listed records instead of drawing the report').not.toHaveBeenCalled();
  });

  it('control: an unfiltered drill sends no `runtimeFilter`', async () => {
    const ds = await drill(MATRIX);
    expect(ds.queryDataset).toHaveBeenCalledTimes(1);
    expect(selectionOf(ds)).not.toHaveProperty('runtimeFilter');
  });

  it('joins the clicked filter to the report\'s own `runtimeFilter` once, with `$and`', async () => {
    const ds = await drill({ ...MATRIX, runtimeFilter: { region: 'emea' } }, { stage: 'Won' });
    expect(selectionOf(ds)?.runtimeFilter).toEqual({ $and: [{ region: 'emea' }, { stage: 'Won' }] });
  });

  it('a summary report, which carries no `columns`, is drawn as a report and scoped too', async () => {
    const { columns: _across, ...summary } = { ...MATRIX, type: 'summary' };
    const ds = await drill(summary, { stage: 'Won' });
    expect(ds.find, 'the drawer listed records instead of drawing the report').not.toHaveBeenCalled();
    expect(ds.queryDataset).toHaveBeenCalledTimes(1);
    expect(selectionOf(ds)?.runtimeFilter).toEqual({ stage: 'Won' });
  });

  it('a `filter` a stored report still carries is not read as a scope: only the clicked filter reaches the query', async () => {
    const ds = await drill({ ...MATRIX, filter: { owner: 'Ada' } }, { stage: 'Won' });
    expect(selectionOf(ds)?.runtimeFilter).toEqual({ stage: 'Won' });
    // Not removed either: the renderer still says in dev that it was not applied.
    expect(filterWarnings()).toHaveLength(1);
  });
});

describe('the pre-9.0 object-bound drill report is retired (objectui#11506)', () => {
  it('is not drawn as a report: the drawer lists the records, scoped by the clicked filter', async () => {
    const ds = await drill({ name: 'pipeline', objectName: 'deal', type: 'summary', columns: [{ field: 'amount' }] }, { stage: 'Won' });
    expect(ds.queryDataset).not.toHaveBeenCalled();
    expect(ds.find).toHaveBeenCalled();
    expect(ds.find.mock.calls[0]?.[0]).toBe('deal');
    expect(JSON.stringify(ds.find.mock.calls[0]?.[1])).toContain('Won');
    expect(document.querySelector('[data-testid="report-presentation-bridge"]')).toBeNull();
  });
});
