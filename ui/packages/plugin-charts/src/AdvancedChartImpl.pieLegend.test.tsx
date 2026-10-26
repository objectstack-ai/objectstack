/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Pie/donut legend (#3135) — the legend must NAME each slice's category, and it
 * must obey `showLegend`.
 *
 * Two defects lived here. The legend resolved its label through the shadcn
 * config helper, which read the legend ITEM's own `type`/`color` props before
 * the data row — so a category dimension literally named `type` (a dashboard
 * staple: "按类型分布") resolved to the legend ICON shape ("rect"), missed the
 * config, and drew colour swatches with NO text: a pie of anonymous dots. And
 * the pie branch rendered its legend unconditionally, so `showLegend: false`
 * did nothing.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

// Recharts' ResponsiveContainer measures its parent via ResizeObserver, which
// reports 0×0 under the headless DOM — so the chart never paints. Replace it
// with a fixed-size passthrough so the pie (and its legend) actually render.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 320, height: 320 }),
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';

afterEach(cleanup);

// Recharts registers the pie's legend payload from a layout effect and the
// Legend re-renders off that store update, so read the legend after a tick.
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });

const legendText = (c: HTMLElement) =>
  c.querySelector('.recharts-legend-wrapper')?.textContent ?? '';

describe('AdvancedChartImpl — pie/donut legend', () => {
  // `type` is the exact dimension name from the reported dashboard, and it
  // collides with the recharts legend item's own `type` (icon shape) prop.
  it.each(['type', 'color', 'urgency'])('labels each slice for a dimension named `%s`', async (dim) => {
    const { container } = render(
      <AdvancedChartImpl
        chartType="pie"
        data={[{ [dim]: '设备', total_count: 3 }, { [dim]: '质量', total_count: 2 }]}
        xAxisKey={dim}
        series={[{ dataKey: 'total_count' }]}
        showLegend
        isAnimationActive={false}
      />,
    );
    await settle();
    expect(legendText(container)).toContain('设备');
    expect(legendText(container)).toContain('质量');
  });

  // Single-category data is the degenerate case the issue calls out: one full
  // circle in one colour is zero information without the category's name.
  it('donut: a single category is still named', async () => {
    const { container } = render(
      <AdvancedChartImpl
        chartType="donut"
        data={[{ type: '设备', total_count: 3 }]}
        xAxisKey="type"
        series={[{ dataKey: 'total_count' }]}
        showLegend
        isAnimationActive={false}
      />,
    );
    await settle();
    expect(legendText(container)).toContain('设备');
  });

  it('honors showLegend: false', async () => {
    const { container } = render(
      <AdvancedChartImpl
        chartType="pie"
        data={[{ type: '设备', total_count: 3 }, { type: '质量', total_count: 2 }]}
        xAxisKey="type"
        series={[{ dataKey: 'total_count' }]}
        showLegend={false}
        isAnimationActive={false}
      />,
    );
    await settle();
    expect(container.querySelectorAll('.recharts-legend-wrapper')).toHaveLength(0);
  });
});
