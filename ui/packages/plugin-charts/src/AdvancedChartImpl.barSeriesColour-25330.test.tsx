/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// Recharts' ResponsiveContainer measures its parent via ResizeObserver, which
// reports 0×0 under the headless DOM (no layout engine) — so the chart never
// paints. Replace it with a fixed-size passthrough so the bars actually
// render and we can read their `fill`.
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

// objectstack#25330 — one series is drawn in one colour. The System Overview
// "Events by User" bar chart (one measure, a lookup dimension with no option
// colours) painted every bar a different palette hue, so the colour named
// nothing.

// The shape of that widget: one measure over a dimension with no option
// colours, the null bucket included.
const EVENTS_BY_USER = [
  { user: '(None)', value: 740 },
  { user: 'Ada', value: 120 },
  { user: 'Grace', value: 64 },
  { user: 'Linus', value: 12 },
];

const PALETTE = ['#111111', '#222222', '#333333'];

// Bars fill from the gradient keyed by their resolved colour.
const SERIES_FILL = 'url(#bg-g111111)';

const barFills = (container: HTMLElement): (string | null)[] =>
  Array.from(container.querySelectorAll('path.recharts-rectangle')).map((p) =>
    p.getAttribute('fill'),
  );

describe('AdvancedChartImpl — a single-series bar chart draws one colour (objectstack#25330)', () => {
  it.each(['bar', 'horizontal-bar'] as const)('%s: every bar takes the series colour', (chartType) => {
    const { container } = render(
      <AdvancedChartImpl
        chartType={chartType}
        data={EVENTS_BY_USER}
        xAxisKey="user"
        series={[{ dataKey: 'value' }]}
        colors={PALETTE}
        isAnimationActive={false}
      />,
    );
    const fills = barFills(container);
    expect(fills).toHaveLength(EVENTS_BY_USER.length);
    expect(new Set(fills)).toEqual(new Set([SERIES_FILL]));
  });

  it('a semantic option colour still paints its own bar; a category without one takes the series colour', () => {
    const { container } = render(
      <AdvancedChartImpl
        chartType="bar"
        data={[
          { health: 'Green', value: 5 },
          { health: 'Red', value: 1 },
          { health: 'Unknown', value: 2 },
        ]}
        xAxisKey="health"
        series={[{ dataKey: 'value' }]}
        colors={PALETTE}
        categoryColors={{ Green: '#10B981', Red: '#EF4444' }}
        isAnimationActive={false}
      />,
    );
    // 'Unknown' has no option colour: the series colour, not palette[2].
    expect(barFills(container)).toEqual(['url(#bg-g10B981)', 'url(#bg-gEF4444)', SERIES_FILL]);
  });

  it('two series keep one colour each', () => {
    const { container } = render(
      <AdvancedChartImpl
        chartType="bar"
        data={[
          { user: 'Ada', created: 3, updated: 4 },
          { user: 'Grace', created: 5, updated: 6 },
        ]}
        xAxisKey="user"
        series={[{ dataKey: 'created' }, { dataKey: 'updated' }]}
        colors={PALETTE}
        isAnimationActive={false}
      />,
    );
    expect(barFills(container)).toEqual([SERIES_FILL, SERIES_FILL, 'url(#bg-g222222)', 'url(#bg-g222222)']);
  });
});
