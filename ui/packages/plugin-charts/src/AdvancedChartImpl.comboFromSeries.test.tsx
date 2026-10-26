/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * #2945 — a series that overrides its family actually draws that family.
 *
 * `ChartSeries.type` is the spec's own per-series family override; its field
 * comment reads "Series type override (combo charts)". It was parsed by
 * `normalizeChartSchema` and carried on `series[].chartType` — a unit test even
 * asserted the carry — and then dropped, because only the renderer's
 * `chartType === 'combo'` branch read it. So an author writing the protocol got
 * their line series drawn as a bar, with nothing wrong at any layer but the last.
 *
 * These assert the MARKS in the DOM rather than the derived family, because the
 * carry was already covered and the drawing is what was broken.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

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

import AdvancedChartImpl from './AdvancedChartImpl';

afterEach(cleanup);

const DATA = [
  { month: 'Jan', revenue: 120, margin: 0.4 },
  { month: 'Feb', revenue: 80, margin: 0.9 },
];

const base = {
  data: DATA,
  xAxisKey: 'month',
  isAnimationActive: false,
};

const lines = (c: HTMLElement) => c.querySelectorAll('.recharts-line').length;
const bars = (c: HTMLElement) => c.querySelectorAll('.recharts-bar').length;
const areas = (c: HTMLElement) => c.querySelectorAll('.recharts-area').length;

describe('AdvancedChartImpl — a combo derived from the series', () => {
  it('draws a `type: line` series as a line on an otherwise-bar chart', () => {
    // The regression: `margin` used to render as a second bar.
    const { container } = render(
      <AdvancedChartImpl
        {...base}
        chartType="bar"
        series={[{ dataKey: 'revenue' }, { dataKey: 'margin', chartType: 'line' }]}
      />,
    );
    expect(lines(container)).toBe(1);
    expect(bars(container)).toBe(1);
  });

  it('draws a `type: bar` series as a bar on an otherwise-area chart', () => {
    const { container } = render(
      <AdvancedChartImpl
        {...base}
        chartType="area"
        series={[{ dataKey: 'revenue' }, { dataKey: 'margin', chartType: 'bar' }]}
      />,
    );
    expect(bars(container)).toBe(1);
    // The un-annotated series takes the chart's own family, not `bar` — which
    // is why the base has to come from the chart rather than a hardcoded guess.
    expect(areas(container)).toBe(1);
  });

  it('leaves a chart whose series all agree as a plain bar chart', () => {
    const { container } = render(
      <AdvancedChartImpl
        {...base}
        chartType="bar"
        series={[{ dataKey: 'revenue' }, { dataKey: 'margin' }]}
      />,
    );
    expect(bars(container)).toBe(2);
    expect(lines(container)).toBe(0);
  });

  it('binds a derived combo to one axis unless the series asks for two', () => {
    // `ChartSeries.yAxis` defaults to 'left' in the spec, so widening a bar
    // chart into a combo changes the series' MARK and nothing else. Two y-axes
    // are always rendered by the combo branch; what matters is that the line
    // is not silently moved onto the right one, which would rescale it.
    const { container } = render(
      <AdvancedChartImpl
        {...base}
        chartType="bar"
        series={[{ dataKey: 'revenue' }, { dataKey: 'margin', chartType: 'line' }]}
      />,
    );
    const line = container.querySelector('.recharts-line');
    expect(line).toBeTruthy();
    // Recharts places right-axis marks in the second y-axis' scale; the
    // rendered path is the observable proxy, so assert the explicit opt-in
    // changes it and the default does not.
    const defaultPath = container.querySelector('.recharts-line-curve')?.getAttribute('d');

    cleanup();
    const { container: right } = render(
      <AdvancedChartImpl
        {...base}
        chartType="bar"
        series={[{ dataKey: 'revenue' }, { dataKey: 'margin', chartType: 'line', yAxis: 'right' }]}
      />,
    );
    const rightPath = right.querySelector('.recharts-line-curve')?.getAttribute('d');
    expect(defaultPath).toBeTruthy();
    expect(rightPath).toBeTruthy();
    expect(rightPath).not.toBe(defaultPath);
  });

  it('draws an `area` series in a combo at all (it used to draw nothing)', () => {
    // Found while widening this: the combo branch had an `area` arm, but its
    // container was `BarChart`, under which a Recharts `<Area>` child renders
    // nothing. The arm was unreachable and the series came out blank — silently.
    // `ComposedChart` is the container built for mixed marks.
    const { container } = render(
      <AdvancedChartImpl
        {...base}
        chartType="combo"
        series={[{ dataKey: 'revenue', chartType: 'bar' }, { dataKey: 'margin', chartType: 'area' }]}
      />,
    );
    expect(areas(container)).toBe(1);
    expect(bars(container)).toBe(1);
  });

  it('still honours an explicitly authored `combo`', () => {
    // `DatasetPreview` passes this directly for mixed-scale datasets, with
    // series that declare nothing. The legacy index/family default applies:
    // first series bar, the rest lines.
    const { container } = render(
      <AdvancedChartImpl
        {...base}
        chartType="combo"
        series={[{ dataKey: 'revenue' }, { dataKey: 'margin' }]}
      />,
    );
    expect(bars(container)).toBe(1);
    expect(lines(container)).toBe(1);
  });
});
