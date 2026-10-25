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
// paints. Replace it with a fixed-size passthrough so Pie sectors actually
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

// A select dimension whose categories arrive as their display labels (the
// server resolves dataset select dimensions value→label, e.g. project health).
const HEALTH = [
  { health: 'Green', value: 5 },
  { health: 'Red', value: 1 },
  { health: 'Yellow', value: 2 },
];

// A deliberately non-semantic brand palette, so a slice taking its colour from
// the palette (the OLD behaviour) is unmistakably distinct from one taking the
// field's option colour (the fix).
const PALETTE = ['#111111', '#222222', '#333333'];

// Option colours resolved by ObjectChart, keyed by BOTH value and label since
// the row category may be either.
const CATEGORY_COLORS = {
  green: '#10B981', Green: '#10B981',
  red: '#EF4444', Red: '#EF4444',
  yellow: '#F59E0B', Yellow: '#F59E0B',
};

const sectorFills = (container: HTMLElement): (string | null)[] =>
  Array.from(container.querySelectorAll('path.recharts-sector')).map((p) =>
    p.getAttribute('fill'),
  );

describe('AdvancedChartImpl — semantic per-category colours', () => {
  it('donut: each slice uses its option colour, not the positional palette', () => {
    const { container } = render(
      <AdvancedChartImpl
        chartType="donut"
        data={HEALTH}
        xAxisKey="health"
        series={[{ dataKey: 'value' }]}
        colors={PALETTE}
        categoryColors={CATEGORY_COLORS}
        isAnimationActive={false}
      />,
    );
    // Slices draw in data order: Green / Red / Yellow.
    expect(sectorFills(container)).toEqual(['#10B981', '#EF4444', '#F59E0B']);
  });

  it('donut: an explicit palette no longer suppresses the option colours', () => {
    const { container } = render(
      <AdvancedChartImpl
        chartType="donut"
        data={HEALTH}
        xAxisKey="health"
        series={[{ dataKey: 'value' }]}
        colors={PALETTE}
        categoryColors={CATEGORY_COLORS}
        isAnimationActive={false}
      />,
    );
    // None of the brand-palette colours leaked into the slices.
    const fills = sectorFills(container);
    PALETTE.forEach((c) => expect(fills).not.toContain(c));
  });

  it('donut: a category absent from the map falls back to the palette slot', () => {
    const { container } = render(
      <AdvancedChartImpl
        chartType="donut"
        data={[...HEALTH, { health: 'Unknown', value: 1 }]}
        xAxisKey="health"
        series={[{ dataKey: 'value' }]}
        colors={PALETTE}
        categoryColors={CATEGORY_COLORS}
        isAnimationActive={false}
      />,
    );
    const fills = sectorFills(container);
    expect(fills.slice(0, 3)).toEqual(['#10B981', '#EF4444', '#F59E0B']);
    // 'Unknown' has no option colour → palette[3 % 3] = palette[0].
    expect(fills[3]).toBe('#111111');
  });

  it('donut: with no categoryColors it keeps the positional palette (no regression)', () => {
    const { container } = render(
      <AdvancedChartImpl
        chartType="donut"
        data={HEALTH}
        xAxisKey="health"
        series={[{ dataKey: 'value' }]}
        colors={PALETTE}
        isAnimationActive={false}
      />,
    );
    expect(sectorFills(container)).toEqual(['#111111', '#222222', '#333333']);
  });
});
