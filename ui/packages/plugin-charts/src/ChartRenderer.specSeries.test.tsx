/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * #2945 — a chart authored in the spec's `series` shape actually plots.
 *
 * `series` is the one binding the spec shape and the renderer's internal shape
 * spell with the same key. `ChartRenderer` applied the blanket "internal props
 * win" rule to it, so a spec author's `[{ name }]` shadowed the normalized
 * `[{ dataKey }]` and reached a renderer that reads `dataKey` — the chart drew
 * NOTHING. Every other spec binding has a distinct name (`xAxis` vs `xAxisKey`),
 * which is why only this one broke, and why the isolated
 * `normalizeChartSchema` unit tests could all pass while this path was dead.
 *
 * These go through `ChartRenderer` on purpose: the translation was already
 * covered, the handoff was not.
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
// (`React.lazy(() => import('./AdvancedChartImpl'))`); every assertion in
// this file waits for the real plot to appear PAST that boundary. Import it
// eagerly, with the SAME specifier, so its cost lands in the import phase
// rather than inside `waitFor`'s 1000ms budget — under full-suite parallel
// load the dynamic import alone can exceed that budget, which read as this
// file's OWN tests flaking rather than a race with the module loader
// (AGENTS.md "测试纪律(flaky 测试:先找竞态,别调超时)").
import './AdvancedChartImpl';

afterEach(cleanup);

const DATA = [
  { month: 'Jan', revenue: 120, margin: 40 },
  { month: 'Feb', revenue: 80, margin: 90 },
];

const marks = (c: HTMLElement) => ({
  bars: c.querySelectorAll('.recharts-bar').length,
  lines: c.querySelectorAll('.recharts-line').length,
});

/** `AdvancedChartImpl` is lazy — wait for the real plot, not the skeleton. */
const plotted = async (c: HTMLElement) => {
  await waitFor(() => expect(c.querySelector('.recharts-surface')).toBeTruthy());
  return marks(c);
};

describe('ChartRenderer — the spec `series` shape', () => {
  it('plots a spec-shape series (it used to render nothing at all)', async () => {
    const { container } = render(
      <ChartRenderer
        schema={{
          type: 'chart',
          chartType: 'bar',
          data: DATA,
          xAxis: { field: 'month' },
          series: [{ name: 'revenue' }, { name: 'margin' }],
          isAnimationActive: false,
        }}
      />,
    );
    expect(await plotted(container)).toEqual({ bars: 2, lines: 0 });
  });

  it('honours a spec `series[].type` override end to end', async () => {
    // The two bugs compound: the override was dropped at this handoff, and
    // would have been ignored by the renderer even if it had survived.
    const { container } = render(
      <ChartRenderer
        schema={{
          type: 'chart',
          chartType: 'bar',
          data: DATA,
          xAxis: { field: 'month' },
          series: [{ name: 'revenue' }, { name: 'margin', type: 'line' }],
          isAnimationActive: false,
        }}
      />,
    );
    expect(await plotted(container)).toEqual({ bars: 1, lines: 1 });
  });

  it('leaves an internal-shape series untouched', async () => {
    const { container } = render(
      <ChartRenderer
        schema={{
          type: 'chart',
          chartType: 'bar',
          data: DATA,
          xAxisKey: 'month',
          series: [{ dataKey: 'revenue' }, { dataKey: 'margin', chartType: 'line' }],
          isAnimationActive: false,
        }}
      />,
    );
    expect(await plotted(container)).toEqual({ bars: 1, lines: 1 });
  });

  it('honours `series[].type` on an internal-shape (`dataKey`) entry too (objectui#7681)', async () => {
    // #7681: the `isInternalShaped` fast path took the raw array whenever
    // every entry already carried `dataKey`, bypassing `normalizeSeries` —
    // the only place `type` is translated to the renderer-internal
    // `chartType`. An author who wrote the documented `dataKey` binding AND
    // the documented `type` override together (both valid independently on
    // `ChartDataSeriesSchema`) got neither: predicted/observed 2 bars / 0
    // lines before the fix. The `dataKey` arm of `ChartRendererProps.series`
    // declares `type` too (objectui#8086), so this literal is written with no
    // cast; the arm-level pin is `ChartRenderer.seriesTypeArm-8086.test.ts`.
    const { container } = render(
      <ChartRenderer
        schema={{
          type: 'chart',
          chartType: 'bar',
          data: DATA,
          xAxisKey: 'month',
          series: [{ dataKey: 'revenue' }, { dataKey: 'margin', type: 'line' }],
          isAnimationActive: false,
        }}
      />,
    );
    expect(await plotted(container)).toEqual({ bars: 1, lines: 1 });
  });

  it('plots a mixed array, where neither shape alone would do', async () => {
    const { container } = render(
      <ChartRenderer
        schema={{
          type: 'chart',
          chartType: 'bar',
          data: DATA,
          xAxisKey: 'month',
          series: [{ dataKey: 'revenue' }, { name: 'margin' }],
          isAnimationActive: false,
        }}
      />,
    );
    expect(await plotted(container)).toEqual({ bars: 2, lines: 0 });
  });

  it('still plots the `categories` series list', async () => {
    // `categories` is a declared member of the published `ChartSchema` and its
    // zod mirror, ruled LIVE by objectui#6896 — not a foreign spelling. This
    // case used to prove `ChartRenderer`'s OWN `(schema as any).categories`
    // branch; objectui#8650 removed that second read and the key still plots,
    // because `normalizeChartSchema` — the one translation point — has always
    // consumed it. The axis is written in the canonical `xAxisKey`: the
    // Tremor-ish `index` alias that stood here is retired, and its pin lives in
    // `ChartRenderer.foreignDialectRetired-8650.test.tsx`. The `as any` below
    // is for `categories`, which `ChartRendererProps.schema` does not declare;
    // it is not a `series` escape (objectui#8086 widened only the `series` arm).
    const { container } = render(
      <ChartRenderer
        schema={{
          type: 'chart',
          chartType: 'bar',
          data: DATA,
          xAxisKey: 'month',
          categories: ['revenue', 'margin'],
          isAnimationActive: false,
        } as any}
      />,
    );
    expect(await plotted(container)).toEqual({ bars: 2, lines: 0 });
  });
});
