/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#13390 — a line or area chart cut its last x-axis label at the
 * chart's right edge: "2026-10" was painted as "2026".
 *
 * recharts lays a line or area chart's categorical x axis out as a POINT
 * scale, so the first and last categories sit ON the plot edges and each label
 * is centred on its point. With no value axis on the right, only recharts' 5px
 * chart margin lies between the last point and the end of the chart surface,
 * and the right half of the label falls outside it. A bar chart's BAND scale
 * centres each category in its band, so it never had this.
 *
 * happy-dom paints no text, so nothing here measures a glyph. Given a fixed
 * box, recharts computes the plot rect and every tick position arithmetically
 * (`AdvancedChartImpl.scatterEdgeClipping-7396.test.tsx` relies on the same
 * property), and a label's width is charged at the upper estimate the chart
 * itself sizes labels with: 0.65em per glyph at the 12px tick font. So these
 * pins read the layout, not a browser's paint.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

/** The widget's box on the showcase Chart Gallery. */
const WIDTH = 510;
const HEIGHT = 350;

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width: number; height: number }> }) =>
      React.cloneElement(children, { width: WIDTH, height: HEIGHT }),
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';

/**
 * Reports `WIDTH` for the chart's SVG surface, as a browser does once it is
 * painted, so the chart decides from a measured width whether its labels fit
 * unrotated (objectui#13241). Unrotated is the case the card reports.
 */
class SurfaceResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    if (!(target instanceof SVGElement)) return;
    this.callback(
      [{ target, contentRect: { width: WIDTH, height: HEIGHT } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The Chart Gallery's "Tasks Created (monthly)" shape: month buckets, one count. */
const MONTHS = [
  { month: '2026-08', tasks: 12 },
  { month: '2026-09', tasks: 18 },
  { month: '2026-10', tasks: 9 },
];

/** Upper estimate of half a tick label's painted width at the 12px tick font. */
const halfLabelPx = (label: string) => ([...label].length * 0.65 * 12) / 2;

type Family = NonNullable<React.ComponentProps<typeof AdvancedChartImpl>['chartType']>;

function draw(chartType: Family, extra: Record<string, unknown> = {}) {
  vi.stubGlobal('ResizeObserver', SurfaceResizeObserver);
  const { container } = render(
    <AdvancedChartImpl
      chartType={chartType}
      data={MONTHS}
      xAxisKey="month"
      series={[{ dataKey: 'tasks', label: 'Tasks' }]}
      showLegend={false}
      isAnimationActive={false}
      {...extra}
    />,
  );
  return container;
}

/** The plot area: recharts emits the chart offset rect as the plot's clip path. */
function plotOf(container: HTMLElement) {
  const rect = container.querySelector('defs clipPath rect');
  expect(rect, 'recharts drew no plot-area clip rect').not.toBeNull();
  const x = Number(rect!.getAttribute('x'));
  const width = Number(rect!.getAttribute('width'));
  expect(Number.isFinite(x) && width > 0, 'plot rect is not numeric').toBe(true);
  return { left: x, right: x + width, width };
}

/** Each x-axis tick label: its text, the x it is centred on, and whether it is rotated. */
function xTicksOf(container: HTMLElement) {
  const ticks = [...container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')];
  expect(ticks.map((t) => (t.textContent ?? '').trim()), 'the x axis did not draw every month').toEqual(
    MONTHS.map((r) => r.month),
  );
  return ticks.map((t) => ({
    label: (t.textContent ?? '').trim(),
    x: Number(t.getAttribute('x')),
    rotated: /rotate\(/.test(t.getAttribute('transform') ?? ''),
    anchor: t.getAttribute('text-anchor'),
  }));
}

describe('objectui#13390 — a line or area chart keeps its edge x labels on the chart surface', () => {
  for (const chartType of ['line', 'area'] as const) {
    it(`draws the last month whole on a ${chartType} chart`, () => {
      const container = draw(chartType);
      const ticks = xTicksOf(container);
      const last = ticks[ticks.length - 1];
      // The case the card reports: a centred, unrotated label. A rotated one
      // hangs left of its point and could not reach the right edge at all.
      expect(last.rotated, 'the labels are rotated, so this measures nothing').toBe(false);
      expect(last.anchor).toBe('middle');
      expect(WIDTH - last.x, `"${last.label}" runs past the chart's right edge`).toBeGreaterThanOrEqual(
        halfLabelPx(last.label),
      );
    });

    it(`draws the first month whole on a ${chartType} chart whose only value axis is on the right`, () => {
      // No value axis on the left, so the first point has only the chart margin
      // before the surface ends: the same defect, mirrored.
      const container = draw(chartType, { yAxes: [{ field: 'tasks', position: 'right' }] });
      const first = xTicksOf(container)[0];
      expect(first.rotated, 'the labels are rotated, so this measures nothing').toBe(false);
      expect(first.x, `"${first.label}" runs past the chart's left edge`).toBeGreaterThanOrEqual(
        halfLabelPx(first.label),
      );
    });

    it(`keeps the inset when the ${chartType} chart's x axis is placed at the top (objectui#10587)`, () => {
      const container = draw(chartType, { xAxis: { position: 'top' } });
      const ticks = xTicksOf(container);
      const last = ticks[ticks.length - 1];
      expect(
        container.querySelector('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')?.getAttribute('orientation'),
        'the declared side was not applied',
      ).toBe('top');
      expect(WIDTH - last.x, `"${last.label}" runs past the chart's right edge`).toBeGreaterThanOrEqual(
        halfLabelPx(last.label),
      );
    });
  }

  it('leaves a bar chart\'s band axis as it was: every label centred in its band, no inset', () => {
    // The control. A band scale already centres the edge categories, so an inset
    // would only squeeze the bars.
    const container = draw('bar');
    const plot = plotOf(container);
    const ticks = xTicksOf(container);
    const band = plot.width / ticks.length;
    ticks.forEach((t, i) => {
      expect(t.x, `"${t.label}" is not centred in its band`).toBeCloseTo(plot.left + band * (i + 0.5), 6);
    });
  });
});
