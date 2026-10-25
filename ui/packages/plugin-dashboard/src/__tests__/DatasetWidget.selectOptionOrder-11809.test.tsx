/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11809 — a dataset chart over a select dimension draws its
 * categories, and the legend that lists them, in the field's DECLARED option
 * order.
 *
 * The showcase's Delivery Operations dashboard binds `Tasks by Status` (bar)
 * and `Priority Mix` (donut) to `showcase_task_metrics`. Both reach this
 * widget, which charts the rows in the order the dataset answered them — the
 * `GROUP BY` order, i.e. the stored values' alphabetical order — so the axis
 * read Backlog, Done, In Progress, In Review, To Do and the legend High, Low,
 * Medium, Urgent. The renderer draws a bar or a slice in row order; nothing
 * between the dataset and the mark put them in the order the field declares.
 *
 * The rows the dataset answers below are in that alphabetical order on
 * purpose: it is the input that showed the defect.
 *
 * Pinned beside the order itself:
 *   - an undeclared value and the empty bucket come after the declared options;
 *   - labels the SERVER already resolved are ordered the same way;
 *   - a pivoted second select dimension lists its series in declared order;
 *   - the drill still opens the records of the bar that was clicked, since only
 *     the charted copy of the rows is reordered;
 *   - CONTROL: an explicit `options.sortBy` keeps the dataset's order, and a
 *     dimension with no options keeps the order the dataset answered.
 *
 * A stub `chart` component captures what the widget hands the renderer
 * (jsdom lays out no SVG); the widget, `SchemaRenderer` and the dimension
 * metadata read are real.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { ComponentRegistry, NULL_CATEGORY_LABEL, chartRowBucketId, type ChartSegmentClickEvent } from '@object-ui/core';
import { DatasetWidget } from '../DatasetWidget';

/** What the widget hands the chart renderer, as far as these pins read it. */
interface CapturedChartProps {
  schema?: {
    data?: Array<Record<string, unknown>>;
    xAxisKey?: string;
    series?: Array<{ dataKey: string; label?: string }>;
  };
  onSegmentClick?: (event: ChartSegmentClickEvent) => void;
}

let capturedChartProps: CapturedChartProps | null = null;
beforeAll(() => {
  ComponentRegistry.register('chart', (props: CapturedChartProps) => {
    capturedChartProps = props;
    return null;
  });
});

/** Observe the drill drawer's filter: which records a click opened. */
const drawerFilters: Array<Record<string, unknown>> = [];
vi.mock('../DrillDownDrawer', () => ({
  DrillDownDrawer: ({ filter }: { filter: Record<string, unknown> }) => {
    drawerFilters.push(filter);
    return null;
  },
}));

afterEach(() => {
  cleanup();
  capturedChartProps = null;
  drawerFilters.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** `showcase_task`'s two picklists, options in their declared order, and a text field. */
const TASK = {
  name: 'showcase_task',
  fields: {
    status: {
      type: 'select',
      options: [
        { value: 'backlog', label: 'Backlog' },
        { value: 'todo', label: 'To Do' },
        { value: 'in_progress', label: 'In Progress' },
        { value: 'in_review', label: 'In Review' },
        { value: 'done', label: 'Done' },
      ],
    },
    priority: {
      type: 'select',
      options: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
        { value: 'urgent', label: 'Urgent' },
      ],
    },
    area: { type: 'text' },
  },
};

const DECLARED_STATUS = ['Backlog', 'To Do', 'In Progress', 'In Review', 'Done'];
const DECLARED_PRIORITY = ['Low', 'Medium', 'High', 'Urgent'];

function installMetaRouter() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ item: TASK }) })),
  );
}

const FIELDS = [
  { name: 'status', type: 'string', label: 'Status' },
  { name: 'priority', type: 'string', label: 'Priority' },
  { name: 'area', type: 'string', label: 'Area' },
  { name: 'task_count', type: 'number', label: 'Tasks' },
];

const datasetOf = (rows: Array<Record<string, unknown>>) => ({
  queryDataset: vi.fn(async () => ({
    rows,
    fields: FIELDS,
    object: 'showcase_task',
    dimensionFields: { status: 'status', priority: 'priority', area: 'area' },
    drillRawRows: rows,
  })),
});

/** `Tasks by Status`, answered in the stored values' alphabetical order. */
const STATUS_ROWS = [
  { status: null, task_count: 1 },
  { status: 'backlog', task_count: 4 },
  { status: 'done', task_count: 9 },
  { status: 'in_progress', task_count: 3 },
  { status: 'in_review', task_count: 2 },
  { status: 'legacy', task_count: 1 },
  { status: 'todo', task_count: 5 },
];

/** `Priority Mix`, the same way. */
const PRIORITY_ROWS = [
  { priority: 'high', task_count: 6 },
  { priority: 'low', task_count: 7 },
  { priority: 'medium', task_count: 8 },
  { priority: 'urgent', task_count: 2 },
];

function renderWidget(widget: Record<string, unknown>, dataSource: { queryDataset: unknown }) {
  return render(
    <DatasetWidget
      widget={{ dataset: 'showcase_task_metrics', values: ['task_count'], drillDown: { enabled: true }, ...widget }}
      dataSource={dataSource}
    />,
  );
}

const chartRows = (): Array<Record<string, unknown>> => capturedChartProps?.schema?.data ?? [];
const categories = (): unknown[] => {
  const xAxisKey = capturedChartProps?.schema?.xAxisKey ?? '';
  return chartRows().map((r) => r[xAxisKey]);
};
const seriesLabels = (): unknown[] => (capturedChartProps?.schema?.series ?? []).map((s) => s.label);

describe('dataset charts follow a select dimension\'s declared option order (objectui#11809)', () => {
  it('Tasks by Status (bar) reads Backlog → To Do → In Progress → In Review → Done, then undeclared, then empty', async () => {
    installMetaRouter();
    renderWidget({ type: 'bar', dimensions: ['status'] }, datasetOf(STATUS_ROWS));
    await waitFor(() =>
      expect(categories()).toEqual([...DECLARED_STATUS, 'legacy', NULL_CATEGORY_LABEL]),
    );
    // Each count stays on its own category.
    const byCategory = Object.fromEntries(chartRows().map((r) => [r.status, r.task_count]));
    expect(byCategory).toEqual({ Backlog: 4, 'To Do': 5, 'In Progress': 3, 'In Review': 2, Done: 9, legacy: 1, [NULL_CATEGORY_LABEL]: 1 });
  });

  it('Priority Mix (donut) lists its legend Low → Medium → High → Urgent', async () => {
    installMetaRouter();
    renderWidget({ type: 'donut', dimensions: ['priority'] }, datasetOf(PRIORITY_ROWS));
    await waitFor(() => expect(categories()).toEqual(DECLARED_PRIORITY));
  });

  it('orders labels the server already resolved the same way', async () => {
    installMetaRouter();
    renderWidget(
      { type: 'column', dimensions: ['priority'] },
      datasetOf([
        { priority: 'High', task_count: 6 },
        { priority: 'Low', task_count: 7 },
        { priority: 'Medium', task_count: 8 },
        { priority: 'Urgent', task_count: 2 },
      ]),
    );
    await waitFor(() => expect(categories()).toEqual(DECLARED_PRIORITY));
  });

  it('a pivoted second select dimension lists its series in declared order', async () => {
    installMetaRouter();
    renderWidget(
      { type: 'bar', dimensions: ['status', 'priority'] },
      datasetOf([
        { status: 'done', priority: 'high', task_count: 2 },
        { status: 'todo', priority: 'urgent', task_count: 1 },
        { status: 'todo', priority: 'low', task_count: 3 },
        { status: 'backlog', priority: 'medium', task_count: 4 },
      ]),
    );
    await waitFor(() => expect(categories()).toEqual(['Backlog', 'To Do', 'Done']));
    await waitFor(() => expect(seriesLabels()).toEqual(DECLARED_PRIORITY));
  });

  it('a click on a moved bar still drills into that bar\'s records', async () => {
    installMetaRouter();
    renderWidget({ type: 'bar', dimensions: ['status'] }, datasetOf(STATUS_ROWS));
    await waitFor(() =>
      expect(categories()).toEqual([...DECLARED_STATUS, 'legacy', NULL_CATEGORY_LABEL]),
    );
    // `To Do` is charted second but answered last.
    const row = chartRows()[1];
    const ev: ChartSegmentClickEvent = {
      category: String(row.status),
      categoryId: chartRowBucketId(row),
      series: 'task_count',
      value: row.task_count as number,
    };
    capturedChartProps?.onSegmentClick?.(ev);
    await waitFor(() => expect(drawerFilters.length).toBeGreaterThan(0));
    expect(drawerFilters[drawerFilters.length - 1]).toEqual({ status: 'todo' });
  });

  it('CONTROL — an explicit options.sortBy keeps the order the dataset answered', async () => {
    installMetaRouter();
    const byCount = [...PRIORITY_ROWS].sort((a, b) => b.task_count - a.task_count);
    renderWidget(
      { type: 'bar', dimensions: ['priority'], options: { sortBy: 'task_count', sortOrder: 'desc' } },
      datasetOf(byCount),
    );
    // Labels, so the dimension metadata (and with it the declared order) landed.
    await waitFor(() => expect(categories()).toEqual(['Medium', 'Low', 'High', 'Urgent']));
  });

  it('CONTROL — a dimension with no options keeps the order the dataset answered', async () => {
    installMetaRouter();
    renderWidget(
      { type: 'bar', dimensions: ['area'] },
      datasetOf([
        { area: 'platform', task_count: 1 },
        { area: 'billing', task_count: 2 },
        { area: 'console', task_count: 3 },
      ]),
    );
    // Let the dimension metadata read answer first, so the order read below is
    // the one drawn after it, not a race won by the first paint.
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/v1/meta/object/showcase_task', expect.anything()));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(categories()).toEqual(['platform', 'billing', 'console']);
  });
});
