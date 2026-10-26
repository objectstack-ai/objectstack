/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#7698 — a series-level `opacity` / `dashArray` is an UNCONDITIONAL
 * override, not a comparison-only one.
 *
 * `@objectstack/spec` declares `ChartSeries.opacity` as "Override series
 * opacity (0–1)" and `ChartSeries.dashArray` as "Override stroke dash
 * pattern" — neither carries a condition. `normalizeSeries` read both on every
 * series, and then `comparisonStyle` returned `null` for anything but a
 * `variant: 'comparison'` series, so on a primary series both values were read
 * and discarded. Narrowing the published declaration to match would have been
 * the renderer's tolerance dictating the contract (AGENTS.md #0.1), so the
 * renderer is what moves.
 *
 * The card's body located the whole defect at that `variant` guard. It is in
 * TWO places, and the second one is why `dashArray` needs its own pins here:
 * `comparisonStyle` already returned an AUTHORED `dashArray` for every family
 * (`s.dashArray ?? (line|area ? '4 4' : undefined)` takes the left side
 * whatever the kind), but the Bar and Scatter MARKS passed `fillOpacity` only
 * and dropped `strokeDasharray` / `strokeOpacity` on the floor. A fix aimed at
 * the guard alone would have left `dashArray` broken on bar and scatter even
 * on a comparison series — so the bar/scatter dash cases below are the ones
 * that fail for a *different* reason than the primary-series cases.
 *
 * These render through `ChartRenderer` (not `seriesStyle` directly) because the
 * defect was a value surviving normalization and then dying at the mark: only
 * the DOM says whether the mark applied it.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

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

import { ChartRenderer } from './ChartRenderer';
// `ChartRenderer` lazy-loads its implementation
// (`React.lazy(() => import('./AdvancedChartImpl'))`). Import it eagerly with
// the SAME specifier so the cost lands in the import phase rather than inside
// `waitFor`'s 1000ms budget (AGENTS.md §测试纪律).
import './AdvancedChartImpl';

afterEach(cleanup);

const DATA = [
  { month: 'Jan', revenue: 120, revenue_prev: 100 },
  { month: 'Feb', revenue: 80, revenue_prev: 140 },
];

const POINTS = [
  { x: 1, y: 10 },
  { x: 2, y: 20 },
];

/** `AdvancedChartImpl` is lazy — wait for the real plot, not the skeleton. */
const plot = async (c: HTMLElement) => {
  await waitFor(() => expect(c.querySelector('.recharts-surface')).toBeTruthy());
  return c;
};

/**
 * The three presentation attributes as the mark actually painted them.
 * `null` (the DOM's answer for an absent attribute) is a real reading here —
 * it is what an undefined prop leaves behind, and several pins below assert
 * exactly that.
 */
const paint = (el: Element | null) => ({
  fillOpacity: el?.getAttribute('fill-opacity') ?? null,
  strokeOpacity: el?.getAttribute('stroke-opacity') ?? null,
  strokeDasharray: el?.getAttribute('stroke-dasharray') ?? null,
});

const barRect = (c: HTMLElement, i = 0) =>
  c.querySelectorAll('.recharts-bar')[i]?.querySelector('.recharts-rectangle') ?? null;
const lineCurve = (c: HTMLElement, i = 0) =>
  c.querySelectorAll('.recharts-line')[i]?.querySelector('.recharts-line-curve') ?? null;
const areaFill = (c: HTMLElement, i = 0) =>
  c.querySelectorAll('.recharts-area')[i]?.querySelector('.recharts-area-area') ?? null;
const areaStroke = (c: HTMLElement, i = 0) =>
  c.querySelectorAll('.recharts-area')[i]?.querySelector('.recharts-area-curve') ?? null;
const scatterSymbol = (c: HTMLElement) =>
  c.querySelector('.recharts-scatter')?.querySelector('.recharts-symbols') ?? null;

const chart = (extra: Record<string, unknown>) => (
  <ChartRenderer
    schema={{
      type: 'chart',
      data: DATA,
      xAxis: { field: 'month' },
      isAnimationActive: false,
      ...extra,
    } as any}
  />
);

describe('objectui#7698 — an authored `opacity` / `dashArray` on a PRIMARY series', () => {
  it('reaches a bar mark (fill), where it used to be read and discarded', async () => {
    const { container } = render(
      chart({ chartType: 'bar', series: [{ name: 'revenue', opacity: 0.3 }] }),
    );
    expect(paint(barRect(await plot(container)))).toMatchObject({ fillOpacity: '0.3' });
  });

  it('reaches a line mark (stroke) together with its dash', async () => {
    const { container } = render(
      chart({ chartType: 'line', series: [{ name: 'revenue', opacity: 0.3, dashArray: '2 6' }] }),
    );
    expect(paint(lineCurve(await plot(container)))).toMatchObject({
      strokeOpacity: '0.3',
      strokeDasharray: '2 6',
    });
  });

  it('reaches BOTH channels of an area mark', async () => {
    const { container } = render(
      chart({ chartType: 'area', series: [{ name: 'revenue', opacity: 0.3, dashArray: '2 6' }] }),
    );
    const c = await plot(container);
    expect(paint(areaFill(c))).toMatchObject({ fillOpacity: '0.3' });
    expect(paint(areaStroke(c))).toMatchObject({ strokeOpacity: '0.3', strokeDasharray: '2 6' });
  });

  it('reaches a scatter mark', async () => {
    const { container } = render(
      <ChartRenderer
        schema={{
          type: 'chart',
          chartType: 'scatter',
          data: POINTS,
          xAxis: { field: 'x' },
          series: [{ name: 'y', opacity: 0.3, dashArray: '2 6' }],
          isAnimationActive: false,
        } as any}
      />,
    );
    expect(paint(scatterSymbol(await plot(container)))).toMatchObject({
      fillOpacity: '0.3',
      strokeOpacity: '0.3',
      strokeDasharray: '2 6',
    });
  });

  it('reaches a per-series `type` override inside a combo chart', async () => {
    const { container } = render(
      chart({
        chartType: 'bar',
        series: [
          { name: 'revenue', opacity: 0.3 },
          { name: 'revenue_prev', type: 'line', opacity: 0.25, dashArray: '1 3' },
        ],
      }),
    );
    const c = await plot(container);
    expect(paint(barRect(c))).toMatchObject({ fillOpacity: '0.3' });
    expect(paint(lineCurve(c))).toMatchObject({ strokeOpacity: '0.25', strokeDasharray: '1 3' });
  });
});

describe('objectui#7698 — `dashArray` on a mark that used to drop it entirely', () => {
  // These are the cases the card's body understates: `comparisonStyle` handed
  // the authored dash to every family, and the Bar / Scatter marks then never
  // passed it through. Broken for BOTH variants before this change — so a
  // comparison bar is pinned here too, not only a primary one.
  it('reaches a primary bar mark', async () => {
    const { container } = render(
      chart({ chartType: 'bar', series: [{ name: 'revenue', dashArray: '2 6' }] }),
    );
    expect(paint(barRect(await plot(container)))).toMatchObject({ strokeDasharray: '2 6' });
  });

  it('reaches a COMPARISON bar mark (a fix at the `variant` guard alone would not)', async () => {
    const { container } = render(
      chart({
        chartType: 'bar',
        series: [
          { name: 'revenue' },
          { name: 'revenue_prev', variant: 'comparison', dashArray: '8 4' },
        ],
      }),
    );
    expect(paint(barRect(await plot(container), 1))).toMatchObject({ strokeDasharray: '8 4' });
  });

  it('reaches a primary scatter mark', async () => {
    const { container } = render(
      <ChartRenderer
        schema={{
          type: 'chart',
          chartType: 'scatter',
          data: POINTS,
          xAxis: { field: 'x' },
          series: [{ name: 'y', dashArray: '2 6' }],
          isAnimationActive: false,
        } as any}
      />,
    );
    expect(paint(scatterSymbol(await plot(container)))).toMatchObject({ strokeDasharray: '2 6' });
  });
});

describe('objectui#7698 — the comparison DEFAULTS stay gated on `variant`', () => {
  it('keeps the muted line overlay for a comparison series carrying no keys', async () => {
    const { container } = render(
      chart({
        chartType: 'line',
        series: [{ name: 'revenue' }, { name: 'revenue_prev', variant: 'comparison' }],
      }),
    );
    const c = await plot(container);
    expect(paint(lineCurve(c, 1))).toMatchObject({ strokeOpacity: '0.5', strokeDasharray: '4 4' });
  });

  it('keeps the muted bar and area fills for a comparison series carrying no keys', async () => {
    const bar = render(
      chart({
        chartType: 'bar',
        series: [{ name: 'revenue' }, { name: 'revenue_prev', variant: 'comparison' }],
      }),
    );
    expect(paint(barRect(await plot(bar.container), 1))).toMatchObject({ fillOpacity: '0.4' });
    cleanup();

    const area = render(
      chart({
        chartType: 'area',
        series: [{ name: 'revenue' }, { name: 'revenue_prev', variant: 'comparison' }],
      }),
    );
    const c = await plot(area.container);
    expect(paint(areaFill(c, 1))).toMatchObject({ fillOpacity: '0.2' });
    expect(paint(areaStroke(c, 1))).toMatchObject({ strokeOpacity: '0.6', strokeDasharray: '4 4' });
  });

  it('gives a comparison bar NO dash and NO stroke fade — the defaults are per family, and the marks that just gained these props must not inherit one', async () => {
    const { container } = render(
      chart({
        chartType: 'bar',
        series: [{ name: 'revenue' }, { name: 'revenue_prev', variant: 'comparison' }],
      }),
    );
    expect(paint(barRect(await plot(container), 1))).toMatchObject({
      strokeOpacity: null,
      strokeDasharray: null,
    });
  });

  it('leaves a primary series carrying neither key completely unstyled', async () => {
    const { container } = render(
      chart({ chartType: 'line', series: [{ name: 'revenue' }] }),
    );
    expect(paint(lineCurve(await plot(container)))).toEqual({
      fillOpacity: null,
      strokeOpacity: null,
      strokeDasharray: null,
    });
  });

  it('lets an authored `opacity` override the comparison default, as it always did', async () => {
    const { container } = render(
      chart({
        chartType: 'line',
        series: [
          { name: 'revenue' },
          { name: 'revenue_prev', variant: 'comparison', opacity: 0.9, dashArray: '8 4' },
        ],
      }),
    );
    expect(paint(lineCurve(await plot(container), 1))).toMatchObject({
      strokeOpacity: '0.9',
      strokeDasharray: '8 4',
    });
  });
});
