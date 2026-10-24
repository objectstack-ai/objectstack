/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11315 — the CONTROL for the dashboard retirement: on the react
 * `ObjectChart` tier an authored `series` still draws a combo.
 *
 * `@objectstack/spec` 17.5.0 retired `chartConfig.type` / `xAxis` / `yAxis` /
 * `series` on a dashboard widget (`DashboardWidgetChartConfigSchema`), and the
 * dashboard's `DatasetWidget` stopped reading them
 * (`plugin-dashboard`'s `DatasetWidget.comboPresentation.test.tsx` pins that
 * refusal). The retirement is per CARRIER: the base `ChartConfigSchema` keeps
 * all four, and the spec's tombstone text says they "stay authorable on the
 * react `<ObjectChart>` tier", whose chart is bound to inline `data` with no
 * dataset to derive them from.
 *
 * So this file renders a real `ObjectChart` (no `ChartRenderer` mock, no
 * dashboard) with inline rows and the spec's combo shape, and counts the marks
 * and axes recharts draws. If the dashboard change had reached this tier, the
 * line series would draw as a bar and the second value axis would vanish.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import type { ObjectChartSchema } from '@object-ui/types';

// Recharts' ResponsiveContainer measures via ResizeObserver, which reports 0×0
// under the headless DOM, so nothing paints. Fix its size.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 480, height: 320 }),
  };
});

// `ChartRenderer` renders its implementation behind
// `React.lazy(() => import('./AdvancedChartImpl'))`. Importing it here, with the
// SAME specifier, pays the recharts graph in the import phase, which no test
// timeout applies to (AGENTS.md §测试纪律).
import './AdvancedChartImpl';
import { ObjectChart } from './ObjectChart';

afterEach(cleanup);

const DATA = [
  { assignee: 'ann', task_count: 12, avg_progress: 64 },
  { assignee: 'bob', task_count: 7, avg_progress: 88 },
];

/** What recharts drew: marks per family, and the value axes. */
const drawn = async (c: HTMLElement) => {
  await waitFor(() => expect(c.querySelector('.recharts-surface')).toBeTruthy());
  return {
    bars: c.querySelectorAll('.recharts-bar').length,
    lines: c.querySelectorAll('.recharts-line').length,
    areas: c.querySelectorAll('.recharts-area').length,
    yAxes: c.querySelectorAll('.recharts-yAxis').length,
  };
};

const renderChart = (schema: Omit<ObjectChartSchema, 'type'>) =>
  render(<ObjectChart schema={{ type: 'object-chart', isAnimationActive: false, data: DATA, ...schema } as ObjectChartSchema} />);

describe('ObjectChart (react tier) — an authored `series` still draws a combo (objectui#11315 control)', () => {
  it('the control for the control: the same rows with no per-series mark draw two bars', async () => {
    // Without this the counts below could be satisfied by a renderer that
    // always draws one bar and one line.
    const { container } = renderChart({
      chartType: 'bar',
      xAxis: { field: 'assignee' },
      series: [{ name: 'task_count' }, { name: 'avg_progress' }],
    });
    expect(await drawn(container)).toMatchObject({ bars: 2, lines: 0 });
  });

  it('draws `series[].type` as the per-series mark and `series[].yAxis` on a second axis', async () => {
    // The shape a dashboard widget can no longer author (`series` + two
    // `yAxis` entries), on the tier where the spec keeps it.
    const { container } = renderChart({
      chartType: 'bar',
      xAxis: { field: 'assignee', title: 'Assignee' },
      series: [
        { name: 'task_count', type: 'bar', yAxis: 'left' },
        { name: 'avg_progress', type: 'line', yAxis: 'right' },
      ],
      // `field` is required on the spec's `ChartAxis`; with `series` authored it
      // binds nothing, so it changes no mark (objectui#11355).
      yAxis: [
        { field: 'task_count', title: 'Tasks' },
        { field: 'avg_progress', title: 'Avg progress', position: 'right', min: 0, max: 100 },
      ],
    });
    expect(await drawn(container)).toEqual({ bars: 1, lines: 1, areas: 0, yAxes: 2 });
    // The authored axis presentation is drawn too, on the axis it names.
    expect(container.textContent).toContain('Avg progress');
  });

  it('honours an explicit react-tier `combo` family with authored marks', async () => {
    // `<ObjectChart type="combo">` reaches this node as `specType` (the
    // node's own `type` is its registry discriminator). The marks are chosen
    // so the authored answer differs from the combo's positional default (a
    // bar, then lines): an area and a line, no bar. A renderer that ignored
    // `series[].type` here would still draw a combo, with a bar in it.
    const { container } = renderChart({
      specType: 'combo',
      xAxis: { field: 'assignee' },
      series: [
        { name: 'task_count', type: 'area' },
        { name: 'avg_progress', type: 'line', yAxis: 'right' },
      ],
      yAxis: [{ field: 'task_count', title: 'Tasks' }, { field: 'avg_progress', title: 'Avg progress', position: 'right' }],
    });
    expect(await drawn(container)).toEqual({ bars: 0, lines: 1, areas: 1, yAxes: 2 });
  });
});
