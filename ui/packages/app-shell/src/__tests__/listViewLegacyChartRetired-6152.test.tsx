/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6152 round 15 — the legacy chart binding is retired: a `chart` list
 * view that names no `dataset` binds nothing, and the REAL `ObjectChart`
 * refuses it on screen.
 *
 * ## What retired
 *
 * `resolveListChartBinding` had a second, legacy shape: the pre-ADR-0021 inline
 * axes `xAxisField` / `categoryField` (category), `yAxisFields[0]` /
 * `valueField` (measure) and `aggregation`, read from `chart` or the
 * `options.chart` bag, and `case 'chart'` translated them into an object-bound
 * `aggregate`, floored at `'name'` / `'value'` when the block declared none.
 * Every door refuses the axes by name (the spec's `ListChartConfigSchema` is a
 * strict object of `chartType` / `dataset` / `dimensions` / `values`, and the
 * bag is its own partial), so the leg, the branch and its floors retired
 * together (census class D, report 6077447919 on objectui#6152).
 *
 * ## What renders instead — measured before the build (dispatch H2)
 *
 * The UNBOUND node: `{ type: 'object-chart', objectName, chartType, filter }`,
 * which names no category. `ObjectChart`'s objectui#8168 screen refuses it
 * (`chart-missing-category-axis`, `role="alert"`) instead of aggregating on a
 * name nobody wrote. The two other shapes measured were worse: a node naming
 * neither `objectName` nor `dataset` renders blank, and a branch that returns
 * nothing leaves the memo `undefined`, which the render site dereferences.
 *
 * Rendered through the REAL `ListView` and the REAL `ObjectChart` (registered
 * by importing `@object-ui/plugin-charts`), so the assertion is what a reader
 * sees, not the node shape alone. It lives in app-shell because app-shell is
 * the package that depends on both (`plugin-list` does not depend on
 * `plugin-charts`); the node each relay composes is pinned beside each relay
 * (`ListView.chart-capability-7544`, `ObjectView.chartConfigForward-7891`,
 * plugin-view's `ObjectView.legacyChartRetired-6152`). Each arm asserts both the refusal and that no aggregate
 * query ran, so a branch that grew a floor back would red on the second half
 * even if a refusal still drew somewhere.
 *
 * The CONTROL is the dataset block, which must NOT be refused: without it the
 * arms above would pass against a chart branch that refused everything.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) => React.cloneElement(children, { width: 480, height: 320 }),
  };
});

// Registers the real `object-chart` renderer. Imported at module scope, not in
// a hook, so the registration is not timed against a test's window (AGENTS.md,
// test discipline).
import '@object-ui/plugin-charts';
import { ListView } from '@object-ui/plugin-list';
import { SchemaRendererProvider } from '@object-ui/react';

const REFUSAL = 'chart-missing-category-axis';

const ROWS = [
  { _id: '1', name: 'A', status: 'open', hours: 3 },
  { _id: '2', name: 'B', status: 'done', hours: 5 },
];

const makeDataSource = () => ({
  find: vi.fn().mockResolvedValue(ROWS),
  aggregate: vi.fn().mockResolvedValue([{ status: 'open', hours: 3 }]),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'task',
    fields: { name: { type: 'text' }, status: { type: 'select' }, hours: { type: 'number' } },
  }),
});

function mountChartView(view: Record<string, unknown>) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource as never}>
      <ListView
        schema={{ type: 'list-view', objectName: 'task', columns: ['name'], viewType: 'chart', ...view } as never}
        dataSource={dataSource as never}
      />
    </SchemaRendererProvider>,
  );
  return dataSource;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('objectui#6152 round 15 — a chart list view that names no dataset is refused on screen, not drawn from invented names', () => {
  it.each([
    ['no chart block at all (the floors used to bind `name` / `value`)', {}],
    ['the retired top-level axes', { chart: { chartType: 'bar', xAxisField: 'status', yAxisFields: ['hours'], aggregation: 'sum' } }],
    ['the retired `categoryField` / `valueField` spelling', { chart: { categoryField: 'status', valueField: 'hours' } }],
    ['the retired axes in the `options.chart` bag', { options: { chart: { xAxisField: 'status', yAxisFields: ['hours'], aggregation: 'sum' } } }],
    ['a bag that declares only `chartType` (door-legal, binds nothing)', { options: { chart: { chartType: 'pie' } } }],
  ])('%s → the objectui#8168 refusal, and no aggregate query', async (_label, view) => {
    const dataSource = mountChartView(view as Record<string, unknown>);

    const box = await screen.findByTestId(REFUSAL);
    expect(box).toHaveAttribute('role', 'alert');
    expect(dataSource.aggregate).not.toHaveBeenCalled();
  });

  it('CONTROL: a dataset block is not refused', async () => {
    const dataSource = mountChartView({ chart: { dataset: 'task_ds', dimensions: ['status'], values: ['hours'] } });

    // Let the dataset path settle, then assert the refusal never drew. The
    // object-bound aggregate is not this shape's query either.
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId(REFUSAL)).toBeNull();
    expect(dataSource.aggregate).not.toHaveBeenCalled();
  });
});
