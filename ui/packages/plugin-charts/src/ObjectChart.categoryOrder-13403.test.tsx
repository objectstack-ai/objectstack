/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#13403 — a page-level `object-chart` bound to a `dataset` draws a
 * select dimension in the order its field DECLARES its options, the order the
 * dashboard's `DatasetWidget` already draws the same dataset in (objectui#11809).
 *
 * The dataset answers its buckets in GROUP BY order, the stored values'
 * alphabetical order, so the showcase command center's priority panel read
 * 高, 低, 中, 紧急 (`high, low, medium, urgent`) while the dashboards read
 * 低 → 中 → 高 → 紧急. Two halves are pinned, because the renderer reads them
 * on different chart families:
 *  - the rows handed to `ChartRenderer` are in declared order (a bar, line or
 *    pie draws its rows as handed);
 *  - the schema carries `categoryOrder` from core's `buildCategoryOrder`, the
 *    key `AdvancedChartImpl` orders a funnel by.
 *
 * Controls: a dimension whose field declares no options gets no
 * `categoryOrder` and keeps the dataset's answered order.
 */

import type { DataSource } from '@object-ui/types';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { buildCategoryOrder } from '@object-ui/core';

type CapturedSchema = {
  data?: Array<Record<string, unknown>>;
  xAxisKey?: string;
  series?: Array<{ dataKey: string; label?: string }>;
  categoryOrder?: string[];
};

let lastSchema: CapturedSchema | null = null;

vi.mock('./ChartRenderer', () => ({
  ChartRenderer: (props: { schema: CapturedSchema }) => {
    lastSchema = props.schema;
    return null;
  },
}));

import { ObjectChart } from './ObjectChart';

const PRIORITY_OPTIONS = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'urgent', label: '紧急' },
];

/** Answers only the documents it is given; anything else is an empty doc. */
function installMetaFetchDouble(routes: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      return { ok: true, json: async () => routes[url] ?? {} };
    }),
  );
}

function metaRoutes(dimensions: Array<{ name: string; field: string }>) {
  return {
    '/api/v1/meta/dataset/showcase_task_metrics': {
      item: { name: 'showcase_task_metrics', object: 'task', dimensions },
    },
    '/api/v1/meta/object/task': {
      item: {
        name: 'task',
        fields: {
          priority: { type: 'select', options: PRIORITY_OPTIONS },
          assignee: { type: 'text' },
        },
      },
    },
  };
}

/**
 * A partial data source carrying only `queryDataset`, the one member the
 * dataset path calls — crossed into the published contract explicitly
 * (objectui#7912), as the sibling ObjectChart suites do.
 */
function datasetSource(rows: Array<Record<string, unknown>>, fields: Array<{ name: string; label: string }>) {
  return { queryDataset: vi.fn().mockResolvedValue({ rows, fields }) } as unknown as DataSource;
}

const categoriesOf = (schema: CapturedSchema | null) =>
  (schema?.data ?? []).map((row) => row[schema!.xAxisKey!]);

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  lastSchema = null;
});

describe('ObjectChart — a dataset chart draws a select dimension in declared option order (objectui#13403)', () => {
  it('orders the categories 低 → 中 → 高 → 紧急 and hands the declared `categoryOrder`', async () => {
    installMetaFetchDouble(metaRoutes([{ name: 'priority', field: 'priority' }]));

    render(
      <ObjectChart
        schema={{
          type: 'object-chart' as const,
          chartType: 'bar' as const,
          dataset: 'showcase_task_metrics',
          dimensions: ['priority'],
          values: ['task_count'],
        }}
        // GROUP BY order: the stored values, alphabetically.
        dataSource={datasetSource(
          [
            { priority: 'high', task_count: 5 },
            { priority: 'low', task_count: 2 },
            { priority: 'medium', task_count: 7 },
            { priority: 'urgent', task_count: 1 },
          ],
          [
            { name: 'priority', label: 'Priority' },
            { name: 'task_count', label: 'Tasks' },
          ],
        )}
      />,
    );

    await waitFor(() => expect(lastSchema?.categoryOrder).toBeDefined());
    // Core's own reading of the field's options — reused, not re-derived.
    expect(lastSchema!.categoryOrder).toEqual(buildCategoryOrder(PRIORITY_OPTIONS));
    expect(lastSchema!.categoryOrder).toEqual(['low', '低', 'medium', '中', 'high', '高', 'urgent', '紧急']);
    expect(categoriesOf(lastSchema)).toEqual(['低', '中', '高', '紧急']);
    // The measure travels with its category.
    expect(lastSchema!.data!.map((row) => row.task_count)).toEqual([2, 7, 5, 1]);
  });

  it('puts a value the options do not declare after the declared ones, and the empty bucket last', async () => {
    installMetaFetchDouble(metaRoutes([{ name: 'priority', field: 'priority' }]));

    render(
      <ObjectChart
        schema={{
          type: 'object-chart' as const,
          chartType: 'bar' as const,
          dataset: 'showcase_task_metrics',
          dimensions: ['priority'],
          values: ['task_count'],
        }}
        dataSource={datasetSource(
          [
            { priority: null, task_count: 4 },
            { priority: 'blocked', task_count: 3 },
            { priority: 'high', task_count: 5 },
            { priority: 'low', task_count: 2 },
          ],
          [
            { name: 'priority', label: 'Priority' },
            { name: 'task_count', label: 'Tasks' },
          ],
        )}
      />,
    );

    await waitFor(() => expect(lastSchema?.categoryOrder).toBeDefined());
    expect(lastSchema!.data!.map((row) => row.task_count)).toEqual([2, 5, 3, 4]);
    expect(categoriesOf(lastSchema).slice(0, 3)).toEqual(['低', '高', 'blocked']);
  });

  it('control: a dimension whose field declares no options gets no `categoryOrder` and keeps the answered order', async () => {
    // The second dimension is the select one, so its relabel (高 in the series
    // labels) is the observable sign that the field metadata has landed — the
    // point after which a `categoryOrder` would have appeared.
    installMetaFetchDouble(
      metaRoutes([
        { name: 'assignee', field: 'assignee' },
        { name: 'priority', field: 'priority' },
      ]),
    );

    render(
      <ObjectChart
        schema={{
          type: 'object-chart' as const,
          chartType: 'bar' as const,
          dataset: 'showcase_task_metrics',
          dimensions: ['assignee', 'priority'],
          values: ['task_count'],
        }}
        dataSource={datasetSource(
          [
            { assignee: 'zoe', priority: 'high', task_count: 5 },
            { assignee: 'amy', priority: 'low', task_count: 2 },
          ],
          [
            { name: 'assignee', label: 'Assignee' },
            { name: 'priority', label: 'Priority' },
            { name: 'task_count', label: 'Tasks' },
          ],
        )}
      />,
    );

    await waitFor(() =>
      expect((lastSchema?.series ?? []).map((s) => s.label)).toContain('高'),
    );
    expect(lastSchema).not.toHaveProperty('categoryOrder');
    expect(categoriesOf(lastSchema)).toEqual(['zoe', 'amy']);
  });
});
