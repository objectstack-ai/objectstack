/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10327 — the toolbar offers no filter control on a `chart` view bound
 * to a semantic `dataset` (ruling 5825582592, letter A: a dataset chart takes
 * its scope from the dataset).
 *
 * THE DEFECT. The dataset shape of `case 'chart'` builds an `object-chart` node
 * with NO `filter` — `ObjectChart` hands `queryDataset` the dimensions and the
 * measures and nothing else. The toolbar still offered the Filter builder and
 * the `UserFilters` chips there, and both feed the same effective filter,
 * whose only reader on this view is `ListView`'s own fetch of the list
 * object's rows. So each control changed a query nothing on screen draws.
 *
 * WHAT IS PINNED. The Filter builder AND the chips are absent on a dataset
 * chart, in both spellings of the block (`chart` and the legacy
 * `options.chart` bag), and absent only while the chart is ON SCREEN: a grid
 * view that can switch to the same chart offers them on the grid. The CONTROL
 * is the `'unbound'` chart, whose node carries the effective filter
 * (objectui#10250) and which keeps both controls. (It was the object-bound
 * `'legacy'` chart until objectui#6152 round 15 retired the legacy axes; a
 * `chart` view that names no `dataset` is what that population became.)
 *
 * Each dataset case first waits for the chart stand-in, so a mount that never
 * reached `case 'chart'` reads as a broken harness, never as a pass.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

let chartNodes: Array<Record<string, unknown>> = [];

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
    estimate: { name: 'estimate', type: 'number', label: 'Estimate' },
  },
};

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [{ id: '1', subject: 'Task 1', status: 'open', priority: 'high', estimate: 3 }], total: 1 })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => objectDef),
  } as never;
}

const DATASET_BLOCK = { chartType: 'bar', dataset: 'task_ds', dimensions: ['status'], values: ['total_estimate'] };
/** A `UserFilters` toggle chip — rendered under `data-testid="user-filters"`. */
const TOGGLE_CHIP = { element: 'toggle', fields: [{ field: 'priority' }] };

function mount(view: Record<string, unknown>) {
  const dataSource = makeDataSource();
  const schema = { type: 'list-view', objectName: 'duly_task', columns: ['subject'], userFilters: TOGGLE_CHIP, ...view };
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={{ ...WIDE_TOOLBAR, ...schema } as never} dataSource={dataSource} showViewSwitcher />
    </SchemaRendererProvider>,
  );
  return dataSource;
}

const filterButton = () => screen.queryByRole('button', { name: /filter/i });
const chips = () => screen.queryByTestId('user-filters');
const chartOnScreen = () => waitFor(() => expect(screen.getByTestId('chart-standin')).toBeInTheDocument());

beforeEach(() => {
  chartNodes = [];
});
afterEach(cleanup);

describe('objectui#10327 — no filter control on a dataset-bound chart view', () => {
  it('CONTROL: a chart that names no dataset offers the Filter builder and the chips', async () => {
    mount({ viewType: 'chart' });
    await chartOnScreen();
    expect(filterButton()).toBeInTheDocument();
    expect(chips()).toBeInTheDocument();
  });

  it('withholds the Filter builder and the chips on a `chart` block bound to a dataset', async () => {
    mount({ viewType: 'chart', chart: DATASET_BLOCK });
    await chartOnScreen();
    expect(chartNodes.at(-1)).toMatchObject({ type: 'object-chart', dataset: 'task_ds' });
    expect(filterButton()).not.toBeInTheDocument();
    expect(chips()).not.toBeInTheDocument();
  });

  it('withholds them on the legacy `options.chart` bag bound to a dataset — the same resolver', async () => {
    mount({ viewType: 'chart', options: { chart: DATASET_BLOCK } });
    await chartOnScreen();
    expect(chartNodes.at(-1)).toMatchObject({ type: 'object-chart', dataset: 'task_ds' });
    expect(filterButton()).not.toBeInTheDocument();
    expect(chips()).not.toBeInTheDocument();
  });

  it('keys on the view ON SCREEN: a grid that switches to the dataset chart loses them, and gets them back', async () => {
    mount({ viewType: 'grid', chart: DATASET_BLOCK, appearance: { allowedVisualizations: ['grid', 'chart'] } });
    await waitFor(() => expect(filterButton()).toBeInTheDocument());
    expect(chips()).toBeInTheDocument();

    const pick = (name: string) => {
      const trigger = screen.queryByTestId('view-switcher-dropdown');
      if (trigger) fireEvent.click(trigger);
      fireEvent.click(screen.queryByRole('tab', { name }) ?? screen.getByRole('button', { name }));
    };

    pick('Chart');
    await chartOnScreen();
    expect(filterButton()).not.toBeInTheDocument();
    expect(chips()).not.toBeInTheDocument();

    pick('Grid');
    await waitFor(() => expect(filterButton()).toBeInTheDocument());
    expect(chips()).toBeInTheDocument();
  });

  it('`userActions.filter: false` still hides the builder on a chart that names no dataset — the opt-out is unchanged', async () => {
    mount({ viewType: 'chart', userActions: { filter: false } });
    await chartOnScreen();
    expect(filterButton()).not.toBeInTheDocument();
    expect(chips()).toBeInTheDocument();
  });
});
