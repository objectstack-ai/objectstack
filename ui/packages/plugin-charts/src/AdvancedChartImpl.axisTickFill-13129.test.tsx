/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Regression (objectui#13129): the advanced chart passed no `tick` to any of
 * its axes, so recharts painted every tick label in the axis `stroke` default,
 * #666, which on a dark card reads at about 3:1. Every axis it draws now
 * paints its tick text in the theme's muted foreground, as `ChartImpl` does.
 *
 * The pin reads the `fill` on each drawn tick `<text>`, axis by axis, so an
 * axis left without the shared style fails on its own.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) =>
      React.cloneElement(children, { width: 480, height: 320 }),
  };
});

import AdvancedChartImpl, { type AdvancedChartImplProps } from './AdvancedChartImpl';

afterEach(cleanup);

const MUTED_FOREGROUND = 'hsl(var(--muted-foreground))';

const DATA = [
  { stage: 'Backlog', total: 5, rate: 2, cost: 10 },
  { stage: 'To Do', total: 8, rate: 3, cost: 20 },
  { stage: 'Done', total: 3, rate: 1, cost: 30 },
];

/**
 * Each drawn axis, with the tick `<text>` elements it painted. Recharts 3 draws
 * a cartesian axis's tick labels in their own z-index layer, outside the axis
 * group, as one `.recharts-cartesian-axis-tick-labels` group per axis; a polar
 * axis keeps its tick text inside the axis group.
 */
function axesWithTicks(container: HTMLElement) {
  const axes: Array<{ axis: string; fills: Array<string | null> }> = [];
  const read = (axisSel: string, tickSel: string) => {
    container.querySelectorAll(axisSel).forEach((axis, i) => {
      const texts = Array.from(axis.querySelectorAll(tickSel));
      axes.push({ axis: `${axis.getAttribute('class')}#${i}`, fills: texts.map((t) => t.getAttribute('fill')) });
    });
  };
  read('.recharts-cartesian-axis-tick-labels', '.recharts-cartesian-axis-tick-label text');
  read('.recharts-polar-angle-axis', '.recharts-polar-angle-axis-tick text');
  read('.recharts-polar-radius-axis', '.recharts-polar-radius-axis-tick text');
  return axes;
}

const CASES: Array<{ name: string; axes: number; props: Partial<AdvancedChartImplProps> }> = [
  { name: 'bar', axes: 2, props: { chartType: 'bar', series: [{ dataKey: 'total' }] } },
  { name: 'line', axes: 2, props: { chartType: 'line', series: [{ dataKey: 'total' }] } },
  { name: 'area', axes: 2, props: { chartType: 'area', series: [{ dataKey: 'total' }] } },
  {
    name: 'bar with two value axes',
    axes: 3,
    props: {
      chartType: 'bar',
      series: [{ dataKey: 'total' }, { dataKey: 'rate', yAxis: 'right' }],
      yAxes: [{ field: 'total' }, { field: 'rate', position: 'right' }],
    },
  },
  { name: 'horizontal-bar', axes: 2, props: { chartType: 'horizontal-bar', series: [{ dataKey: 'total' }] } },
  {
    name: 'horizontal-bar with two value axes',
    axes: 3,
    props: {
      chartType: 'horizontal-bar',
      series: [{ dataKey: 'total' }, { dataKey: 'rate', yAxis: 'right' }],
      yAxes: [{ field: 'total' }, { field: 'rate', position: 'right' }],
    },
  },
  {
    name: 'combo',
    axes: 3,
    props: { chartType: 'combo', series: [{ dataKey: 'total', chartType: 'bar' }, { dataKey: 'rate', chartType: 'line' }] },
  },
  { name: 'scatter', axes: 2, props: { chartType: 'scatter', xAxisKey: 'cost', series: [{ dataKey: 'total' }] } },
  { name: 'radar', axes: 2, props: { chartType: 'radar', series: [{ dataKey: 'total' }] } },
];

describe('AdvancedChartImpl — axis tick text uses the muted foreground (objectui#13129)', () => {
  it.each(CASES)('$name: every drawn axis paints its ticks in the muted foreground', ({ axes, props }) => {
    const { container } = render(<AdvancedChartImpl data={DATA} xAxisKey="stage" {...props} />);
    const drawn = axesWithTicks(container);
    expect(drawn).toHaveLength(axes);
    for (const { axis, fills } of drawn) {
      expect(fills.length, `${axis} drew no tick text`).toBeGreaterThan(0);
      for (const fill of fills) {
        expect(fill, `${axis} tick fill`).not.toBe('#666');
        expect(fill, `${axis} tick fill`).toBe(MUTED_FOREGROUND);
      }
    }
  });
});
