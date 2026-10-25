/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10512 — while a dataset-bound `chart` is on screen, a user filter
 * that is already held does not narrow `ListView`'s own fetch.
 *
 * THE DEFECT. objectui#10327 withholds the toolbar Filter builder and the
 * `UserFilters` chips on a dataset-bound chart (`datasetChartOnScreen`): the
 * chart takes its scope from the dataset, and neither control reaches it. It
 * withheld only the CONTROLS. A Filter group the host restores at mount
 * (`initialFilters`, which app-shell's `ObjectView` reads back from per-view
 * storage), or one set on a grid before switching, still reached this
 * component's own fetch of the list object's rows. That fetch still runs on
 * the chart and feeds the record-count bar, which still draws there. So the
 * count was narrowed by a filter nothing on screen showed or could clear.
 *
 * objectui#10326 closed the same shape for Search (`searchTerm` is derived
 * empty beside the held `searchInput`); this is the Filter half.
 *
 * WHAT IS PINNED.
 *
 *   - On a dataset-bound chart the fetch runs and the count bar draws, and a
 *     restored Filter group narrows neither: the data source receives no
 *     `$filter`, and the bar counts the unnarrowed rows.
 *   - The view's own `filter` is not the user's. On the same chart it stays in
 *     the query, alone.
 *   - The held state is KEPT, not cleared: a switch back to the grid applies
 *     the same group again, the builder shows it, and the host is never told
 *     to drop it. Chips toggled on the grid are withheld on the chart too.
 *   - CONTROLS: on a grid, and on a chart that names no dataset (whose node
 *     carries the effective filter, objectui#10250), the restored group still
 *     narrows the fetch. (That second control was a chart bound to the list
 *     object through the legacy inline axes until objectui#6152 round 15
 *     retired them; a `chart` view naming no `dataset` is what it became.)
 *   - With nothing held, the withholding does not reopen objectui#7394. With a
 *     `pageSize` declared, the switch into the dataset chart re-issues no
 *     query. With none declared, it re-issues exactly one, and only because
 *     the window moves: the paged grid's `$top` is the spec display default
 *     and the chart's is the list's fetch batch (objectui#9853, structure B;
 *     the cost the maintainer accepted in ruling record 5909000462).
 *
 * Each case first waits for the view's stand-in, so a mount that never reached
 * the view's render branch reads as a broken harness, never as a pass.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { PaginationConfigSchema } from '@objectstack/spec/ui';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView, DEFAULT_LIST_FETCH_BATCH_SIZE } from '../ListView';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

/** The protocol's display default, read the way the renderer reads it. */
const SPEC_DISPLAY_DEFAULT: number = PaginationConfigSchema.parse({}).pageSize;

let chartNodes: Array<Record<string, unknown>> = [];

ComponentRegistry.register(
  'object-grid',
  () => <div data-testid="grid-standin" />,
  { namespace: 'test', label: 'object-grid stand-in', category: 'view' },
);
ComponentRegistry.register(
  'object-chart',
  ({ schema }: { schema: Record<string, unknown> }) => {
    chartNodes.push(schema);
    return <div data-testid="chart-standin" />;
  },
  { namespace: 'test', label: 'object-chart stand-in', category: 'view' },
);

const objectDef = {
  name: 'duly_task',
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text', label: 'Subject' },
    status: { name: 'status', type: 'text', label: 'Status' },
    priority: { name: 'priority', type: 'text', label: 'Priority' },
    owner: { name: 'owner', type: 'text', label: 'Owner' },
    estimate: { name: 'estimate', type: 'number', label: 'Estimate' },
  },
};

const ROWS = [
  { id: '1', subject: 'Task 1', status: 'open', priority: 'high', owner: 'ada', estimate: 3 },
  { id: '2', subject: 'Task 2', status: 'done', priority: 'low', owner: 'ada', estimate: 5 },
  { id: '3', subject: 'Task 3', status: 'done', priority: null, owner: 'bob', estimate: 8 },
];

/**
 * Answers each query from the fields its `$filter` names, so the record-count
 * bar reads a different number for a narrowed query than for an unnarrowed one.
 */
function makeDataSource() {
  return {
    find: vi.fn(async (_object: string, params?: Record<string, unknown>) => {
      const named = JSON.stringify(params?.$filter ?? null);
      let out = ROWS;
      if (named.includes('"status"')) out = out.filter((r) => r.status === 'open');
      if (named.includes('"priority"')) out = out.filter((r) => r.priority != null);
      if (named.includes('"owner"')) out = out.filter((r) => r.owner === 'ada');
      return { data: out, total: out.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => objectDef),
  } as never as { find: ReturnType<typeof vi.fn> };
}

const DATASET_BLOCK = { chartType: 'bar', dataset: 'task_ds', dimensions: ['status'], values: ['total_estimate'] };
/** A `UserFilters` toggle chip, OFF at mount; clicking it adds `priority != null`. */
const TOGGLE_CHIP = { element: 'toggle', fields: [{ field: 'priority' }] };
/** The view's own `filter` — authored, or merged in by the host (URL filters). */
const BASE_FILTER = [['owner', '=', 'ada']];

/** The toolbar Filter builder's group, as the host restores it at mount. */
const RESTORED_FILTERS = {
  id: 'root',
  logic: 'and' as const,
  conditions: [{ id: 'c1', field: 'status', operator: 'equals', value: 'open' }],
};

function mount(view: Record<string, unknown>, listProps: Record<string, unknown> = {}) {
  const dataSource = makeDataSource();
  const schema = { type: 'list-view', objectName: 'duly_task', columns: ['subject'], ...view };
  render(
    <SchemaRendererProvider dataSource={dataSource as never}>
      <ListView schema={{ ...WIDE_TOOLBAR, ...schema } as never} dataSource={dataSource as never} {...listProps} />
    </SchemaRendererProvider>,
  );
  return dataSource;
}

const onScreen = (testId: string) => waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument());
/** The `$filter` of every host (`ListView`) fetch, in order. */
const hostFilters = (dataSource: { find: ReturnType<typeof vi.fn> }) =>
  dataSource.find.mock.calls.map((c: unknown[]) => (c[1] as Record<string, unknown> | undefined)?.$filter);
const names = (filter: unknown, field: string) => JSON.stringify(filter ?? null).includes(`"${field}"`);
const countBar = () => screen.getByTestId('record-count-bar');
const filterButton = () => screen.queryByRole('button', { name: /filter/i });
const settle = () => new Promise((r) => setTimeout(r, 50));

const pick = (name: string) => {
  const trigger = screen.queryByTestId('view-switcher-dropdown');
  if (trigger) fireEvent.click(trigger);
  fireEvent.click(screen.queryByRole('tab', { name }) ?? screen.getByRole('button', { name }));
};

beforeEach(() => {
  chartNodes = [];
});
afterEach(cleanup);

describe('objectui#10512 — a held user filter does not narrow ListView\'s fetch while a dataset-bound chart is on screen', () => {
  it('CONTROL: on a grid, a restored Filter group narrows the fetch, and the count bar counts the narrowed rows', async () => {
    const dataSource = mount({ viewType: 'grid' }, { initialFilters: RESTORED_FILTERS });
    await onScreen('grid-standin');
    await waitFor(() => expect(names(hostFilters(dataSource).at(-1), 'status')).toBe(true));
    await waitFor(() => expect(countBar()).toHaveTextContent('1 record'));
  });

  it('CONTROL: on a chart that names no dataset, a restored Filter group still narrows the fetch', async () => {
    const dataSource = mount({ viewType: 'chart' }, { initialFilters: RESTORED_FILTERS });
    await onScreen('chart-standin');
    expect(chartNodes.at(-1)).toMatchObject({ type: 'object-chart', objectName: 'duly_task' });
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    await settle();
    expect(names(hostFilters(dataSource).at(-1), 'status')).toBe(true);
  });

  it('on a dataset-bound chart the fetch runs and the count bar draws, and a restored Filter group narrows neither', async () => {
    const onFilterChange = vi.fn();
    const dataSource = mount({ viewType: 'chart', chart: DATASET_BLOCK }, { initialFilters: RESTORED_FILTERS, onFilterChange });
    await onScreen('chart-standin');
    expect(chartNodes.at(-1)).toMatchObject({ type: 'object-chart', dataset: 'task_ds' });
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    await settle();
    expect(hostFilters(dataSource).every((f) => f === undefined)).toBe(true);
    expect(countBar()).toHaveTextContent('3 records');
    expect(onFilterChange).not.toHaveBeenCalled();
  });

  it('the view\'s own `filter` is not the user\'s: on the dataset chart it stays in the query, alone', async () => {
    const dataSource = mount(
      { viewType: 'chart', chart: DATASET_BLOCK, filter: BASE_FILTER },
      { initialFilters: RESTORED_FILTERS },
    );
    await onScreen('chart-standin');
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    await settle();
    expect(hostFilters(dataSource).every((f) => JSON.stringify(f) === JSON.stringify(BASE_FILTER))).toBe(true);
    expect(countBar()).toHaveTextContent('2 records');
  });

  it('a filter held on a grid stops narrowing the fetch on a switch to the dataset chart, and applies again back on the grid', async () => {
    const onFilterChange = vi.fn();
    const dataSource = mount(
      {
        viewType: 'grid',
        chart: DATASET_BLOCK,
        userFilters: TOGGLE_CHIP,
        appearance: { allowedVisualizations: ['grid', 'chart'] },
      },
      { showViewSwitcher: true, initialFilters: RESTORED_FILTERS, onFilterChange },
    );
    await onScreen('grid-standin');
    await waitFor(() => expect(names(hostFilters(dataSource).at(-1), 'status')).toBe(true));

    // A chip toggled on the grid joins the held state.
    fireEvent.click(await screen.findByRole('button', { name: /priority/i }));
    await waitFor(() => expect(names(hostFilters(dataSource).at(-1), 'priority')).toBe(true));

    pick('Chart');
    await onScreen('chart-standin');
    await waitFor(() => expect(hostFilters(dataSource).at(-1)).toBeUndefined());
    await waitFor(() => expect(countBar()).toHaveTextContent('3 records'));

    pick('Grid');
    await onScreen('grid-standin');
    await waitFor(() => expect(names(hostFilters(dataSource).at(-1), 'status')).toBe(true));
    // Kept, not cleared: the builder still shows the group, and the host was
    // never told to drop it. ⛔ The chip's own return is not asserted here: its
    // on/off state lives inside `UserFilters`, which is not mounted while the
    // dataset chart is on screen, so what it draws on the way back is that
    // component's answer, not this derivation's.
    expect(filterButton()).toHaveTextContent('1');
    expect(onFilterChange).not.toHaveBeenCalled();
  });

  it('with nothing held and no pageSize declared, the switch to the dataset chart re-issues exactly one query, whose $top moves from the spec display default to the fetch batch', async () => {
    // [objectui#9853] Ruling record 5909000462: the maintainer accepted this
    // one further query as structure B's cost. A paged view's undeclared window
    // is the spec display default and an unpaged view's is the fetch batch, so
    // the switch changes `$top` and the list asks again. This row pinned "no
    // query" before that ruling; the no-query half now lives in the DECLARED
    // control below.
    //
    // The row discriminates only while the two numbers differ.
    expect(SPEC_DISPLAY_DEFAULT).not.toBe(DEFAULT_LIST_FETCH_BATCH_SIZE);
    const dataSource = mount(
      { viewType: 'grid', chart: DATASET_BLOCK, appearance: { allowedVisualizations: ['grid', 'chart'] } },
      { showViewSwitcher: true },
    );
    await onScreen('grid-standin');
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    await settle();
    const calls = () => dataSource.find.mock.calls.map((c: unknown[]) => c[1] as Record<string, unknown>);
    const before = calls().length;
    expect(calls()[0].$top).toBe(SPEC_DISPLAY_DEFAULT);

    pick('Chart');
    await onScreen('chart-standin');
    const topsAfter = () => calls().slice(before).map((p) => p.$top);
    await waitFor(() => expect(topsAfter()).toEqual([DEFAULT_LIST_FETCH_BATCH_SIZE]));
    // Exactly one: no second copy lands once the first has.
    await settle();
    expect(topsAfter()).toEqual([DEFAULT_LIST_FETCH_BATCH_SIZE]);
    // Only the window moved: the further query is the one already on screen
    // with the chart's `$top`, so nothing the chart withholds reached it.
    expect(calls()[before]).toEqual({ ...calls()[before - 1], $top: DEFAULT_LIST_FETCH_BATCH_SIZE });
  });

  it('CONTROL (objectui#7394 §1): with nothing held and a pageSize declared, the switch to the dataset chart re-issues no query', async () => {
    // A declared size is one window for every kind, so the switch moves
    // nothing and the withholding alone must not re-issue the fetch. §1 of
    // `ListView.viewSwitchRefetch-7394.test.tsx` pins the same for grid to
    // kanban; this row pins it for the dataset chart.
    const DECLARED_PAGE_SIZE = 7;
    const dataSource = mount(
      {
        viewType: 'grid',
        chart: DATASET_BLOCK,
        pagination: { pageSize: DECLARED_PAGE_SIZE },
        appearance: { allowedVisualizations: ['grid', 'chart'] },
      },
      { showViewSwitcher: true },
    );
    await onScreen('grid-standin');
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    await settle();
    const before = dataSource.find.mock.calls.length;
    expect((dataSource.find.mock.calls[0][1] as Record<string, unknown>).$top).toBe(DECLARED_PAGE_SIZE);

    pick('Chart');
    await onScreen('chart-standin');
    await settle();
    expect(dataSource.find.mock.calls.length).toBe(before);
  });
});
