/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11598, N1 — the dashboard's static-data `chart` node is built as
 * `DashboardChartRenderSchema` (`../chartRenderHandoff`): `ChartSchema` plus
 * the two render keys the producers compose, `colors` and `isAnimationActive`.
 *
 * ## What is pinned
 *
 *   1. TYPE LEVEL: the hand-off is a `ChartSchema`, so the node the producers
 *      build is a declared `chart` node; and both of its extra keys are read by
 *      `ChartRenderer` with the types the hand-off gives them, so the consumer
 *      side takes the node with no cast either.
 *   2. RUNTIME: the `chart` node each surface hands the renderer for a series
 *      widget bound to inline rows carries the palette and
 *      `isAnimationActive: false`, as it did before the hand-off (#2756).
 *   3. WHY THE HAND-OFF IS NOT PUBLIC: the strict authoring face refuses either
 *      key on an authored `chart` node, so no type an author reads may name
 *      them (the objectui#6356 reason the ruling reuses).
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import '@object-ui/components';
// Registers the real `chart` entry this file then overrides, so the override
// is measured against the production registration order.
import '@object-ui/plugin-charts';
import type { ChartRenderer } from '@object-ui/plugin-charts';
import '../index';
import { DashboardRenderer } from '../DashboardRenderer';
import { DashboardGridLayout } from '../DashboardGridLayout';
import type { DashboardChartRenderSchema } from '../chartRenderHandoff';
import type { ChartSchema, DataSource } from '@object-ui/types';
import { StrictAnyComponentSchema } from '@object-ui/types/zod';

/** The schema `ChartRenderer` reads, off its own props type. */
type ChartRendererSchema = React.ComponentProps<typeof ChartRenderer>['schema'];

/* ── 1. type level ───────────────────────────────────────────────────────── */

describe('objectui#11598 N1 — the chart hand-off\'s declared types', () => {
  it('is a `ChartSchema`, and `ChartRenderer` reads both extra keys with the types it gives them', () => {
    const isChart: DashboardChartRenderSchema extends ChartSchema ? true : false = true;
    const colors: DashboardChartRenderSchema['colors'] extends ChartRendererSchema['colors'] ? true : false = true;
    const animation: DashboardChartRenderSchema['isAnimationActive'] extends ChartRendererSchema['isAnimationActive']
      ? true
      : false = true;
    expect([isChart, colors, animation]).toEqual([true, true, true]);
  });
});

/* ── 2. runtime: the node each surface hands the renderer ────────────────── */

/** Every `chart` node a surface handed the renderer, in order. */
const composed: Array<Record<string, unknown>> = [];
const recorder = (props: { schema?: Record<string, unknown> }) => {
  if (props.schema) composed.push(props.schema);
  return null;
};
ComponentRegistry.register('chart', recorder as never, {
  namespace: 'test',
  label: 'recorder',
  category: 'plugin',
} as never);

afterEach(cleanup);

/**
 * A partial stub carrying no member the inline path calls: the static-data
 * branch issues no query (the same crossing `DashboardChart.chartConfig-4044`
 * marks with `as unknown as DataSource`).
 */
const dataSource = {} as unknown as DataSource;

/** A series widget bound to inline rows: the branch that builds a `chart` node. */
const INLINE_BAR = {
  id: 'w1',
  type: 'bar',
  options: { xField: 'status', yField: 'total', data: [{ status: 'open', total: 3 }] },
} as const;

const composeVia = async (surface: 'grid' | 'renderer') => {
  composed.length = 0;
  // Stored metadata is what a renderer receives; the inline binding is not an
  // authoring shape the declared widget type models, hence the crossing.
  const schema = { type: 'dashboard', widgets: [INLINE_BAR] } as never;
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      {surface === 'grid' ? <DashboardGridLayout schema={schema} /> : <DashboardRenderer schema={schema} />}
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(composed.length).toBeGreaterThan(0));
  return composed[composed.length - 1];
};

describe('objectui#11598 N1 — each surface hands the chart renderer both render keys', () => {
  it.each(['renderer', 'grid'] as const)('%s', async (surface) => {
    const node = await composeVia(surface);
    expect(node.type).toBe('chart');
    expect(node.chartType).toBe('bar');
    expect(Array.isArray(node.colors) && (node.colors as unknown[]).length).toBeGreaterThan(0);
    expect(node.isAnimationActive).toBe(false);
  });
});

/* ── 3. why the hand-off stays off every public type ─────────────────────── */

describe('objectui#11598 N1 — the strict authoring face refuses both keys on an authored `chart` node', () => {
  const authored = {
    type: 'chart',
    chartType: 'bar',
    data: [{ status: 'open', total: 3 }],
    xAxisKey: 'status',
    series: [{ dataKey: 'total' }],
  };

  it('CONTROL — the same node without them parses', () => {
    expect(StrictAnyComponentSchema.safeParse(authored).success).toBe(true);
  });

  it.each([
    ['colors', ['#111111']],
    ['isAnimationActive', false],
  ] as const)('`%s`', (key, value) => {
    const result = StrictAnyComponentSchema.safeParse({ ...authored, [key]: value });
    expect(result.success).toBe(false);
    // Refused as an undeclared key on the node itself, naming exactly this key.
    expect(result.error?.issues.map((issue) => ({ code: issue.code, path: issue.path, keys: (issue as { keys?: string[] }).keys }))).toEqual([
      { code: 'unrecognized_keys', path: [], keys: [key] },
    ]);
  });
});
