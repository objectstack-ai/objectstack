/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10516 — the seam half: a scatter's authored `xAxis` scale reaches
 * the drawn x axis when the axis object carries no `title`, `format` or
 * `showGridLines`.
 *
 * Each side of the seam was already pinned on its own, and both stayed green
 * while the chart drew the wrong scale:
 *
 *   - `AdvancedChartImpl.scatterSpecAxes-9675.test.tsx` hands the renderer an
 *     already-normalized `xAxis` and proves it honours `min` / `max` /
 *     `stepSize`;
 *   - `normalizeChartSchema.specAxisKeys-7690.test.ts` proves the normalizer
 *     reads every spec axis key — through the y-axis list.
 *
 * Between the two sat the x-axis gate in `normalizeChartSchema`, which kept
 * the object only when it carried one of three hand-named keys. So these go
 * through `ChartRenderer`, the component `type: 'chart'` resolves to, with the
 * axis written in the spec's shape: the normalizer and the renderer run as one
 * path, and the tick labels on the bottom axis are the reading.
 *
 * The `title`-carrying twin is the lit control: it passed the old gate, so it
 * draws the authored ticks before the fix and after it. A reading that cannot
 * see the authored scale at all fails the control, not just the fix case.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

// Recharts' ResponsiveContainer measures via ResizeObserver, which reports 0x0
// under the headless DOM, so nothing paints. Hand it the box the
// objectui#9675 scatter file uses, so the two read the same geometry.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) =>
      React.cloneElement(children, { width: 510, height: 350 }),
  };
});

import { ChartRenderer } from './ChartRenderer';
// `ChartRenderer` lazy-loads `./AdvancedChartImpl`. Importing it here with the
// SAME specifier moves that cost into the import phase, which no test timeout
// applies to (AGENTS.md "测试纪律").
import './AdvancedChartImpl';

afterEach(cleanup);

/** The data spans x 0..100, so an authored 0..200 domain is visibly not the fitted one. */
const ROWS = [
  { progress: 0, avg_estimate: 16.5 },
  { progress: 45, avg_estimate: 40 },
  { progress: 55, avg_estimate: 60 },
  { progress: 80, avg_estimate: 24 },
  { progress: 100, avg_estimate: 12 },
];

const AUTHORED_TICKS = ['0', '50', '100', '150', '200'];

/** Tick label texts on the bottom (x) axis. */
const bottomTicks = (c: HTMLElement) =>
  [...c.querySelectorAll('text.recharts-cartesian-axis-tick-value[orientation="bottom"]')].map((t) =>
    (t.textContent ?? '').trim(),
  );

async function renderScatter(xAxis: Record<string, unknown>) {
  const { container } = render(
    <ChartRenderer
      schema={{
        type: 'chart',
        chartType: 'scatter',
        data: ROWS,
        xAxis,
        yAxis: [{ field: 'avg_estimate' }],
        isAnimationActive: false,
      }}
    />,
  );
  await waitFor(() => expect(container.querySelector('.recharts-surface')).toBeTruthy());
  return container;
}

describe('objectui#10516 — a scatter x axis draws its authored scale through ChartRenderer', () => {
  it('min / max / stepSize with no title set the bottom axis ticks', async () => {
    const container = await renderScatter({ field: 'progress', min: 0, max: 200, stepSize: 50 });
    expect(bottomTicks(container), 'the authored x scale was dropped before it reached the axis').toEqual(
      AUTHORED_TICKS,
    );
  });

  it('(control) the same axis with a title draws the same ticks', async () => {
    const container = await renderScatter({ field: 'progress', title: 'Progress', min: 0, max: 200, stepSize: 50 });
    expect(bottomTicks(container)).toEqual(AUTHORED_TICKS);
  });
});
