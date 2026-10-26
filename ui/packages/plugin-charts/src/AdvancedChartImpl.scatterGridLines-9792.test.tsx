/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#9792 — the scatter branch drew its grid from a hard-coded
 * `vertical={false}` literal instead of the derived `gridProps` every other
 * cartesian family spreads, so a spec `showGridLines` on EITHER axis of a
 * scatter was accepted by the schema, resolved by `normalizeChartSchema`, and
 * then dropped at render.
 *
 * The repair is inert until an author declares the key: with no axis
 * `showGridLines`, `gridProps` resolves to horizontal lines only, which is
 * what the literal drew. The first case below is that control — it holds on
 * the defect and on the fix alike; the other two are the ones the defect
 * failed.
 *
 * Geometry comes from the same `ResponsiveContainer` mock the objectui#9675
 * and objectui#7396 scatter files use: handed an explicit box, recharts lays
 * the grid out arithmetically, with no DOM measurement in the path.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 510, height: 350 }),
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';

afterEach(cleanup);

type Row = Record<string, unknown>;

const ROWS: Row[] = [
  { progress: 0, avg_estimate: 16.5 },
  { progress: 45, avg_estimate: 40 },
  { progress: 55, avg_estimate: 60 },
  { progress: 80, avg_estimate: 24 },
  { progress: 90, avg_estimate: 30 },
  { progress: 100, avg_estimate: 12 },
];

const CONFIG = { progress: { label: 'Progress' }, avg_estimate: { label: 'Avg Estimate' } };

const renderScatter = (props: Record<string, unknown> = {}) =>
  render(
    <AdvancedChartImpl
      chartType="scatter"
      xAxisKey="progress"
      series={[{ dataKey: 'avg_estimate', label: 'Avg Estimate' }] as any}
      config={CONFIG as any}
      data={ROWS as any}
      isAnimationActive={false}
      {...(props as any)}
    />,
  );

/** Line counts in each of the grid's two layers. The grid group must exist in
 *  every case, so a render that drew no grid at all cannot pass as "no lines". */
const gridLines = (c: HTMLElement) => {
  expect(c.querySelector('g.recharts-cartesian-grid'), 'the scatter drew no grid').not.toBeNull();
  return {
    horizontal: c.querySelectorAll('g.recharts-cartesian-grid-horizontal line').length,
    vertical: c.querySelectorAll('g.recharts-cartesian-grid-vertical line').length,
  };
};

describe('objectui#9792 — the scatter grid honours the spec ChartAxis showGridLines', () => {
  it('draws horizontal lines only when no axis declares showGridLines (unchanged default)', () => {
    const { container } = renderScatter();
    const lines = gridLines(container);
    expect(lines.horizontal, 'the default scatter lost its horizontal grid').toBeGreaterThan(0);
    expect(lines.vertical, 'the default scatter grew vertical grid lines').toBe(0);
  });

  it('removes the horizontal lines when the y axis declares showGridLines: false', () => {
    const { container } = renderScatter({
      yAxes: [{ field: 'avg_estimate', showGridLines: false }],
    });
    const lines = gridLines(container);
    expect(lines.horizontal, 'the y axis showGridLines: false was dropped').toBe(0);
    expect(lines.vertical).toBe(0);
  });

  it('adds vertical lines when the x axis declares showGridLines: true', () => {
    const { container } = renderScatter({ xAxis: { showGridLines: true } });
    const lines = gridLines(container);
    expect(lines.vertical, 'the x axis showGridLines: true was dropped').toBeGreaterThan(0);
    expect(lines.horizontal, 'opting into vertical lines removed the horizontal ones').toBeGreaterThan(0);
  });
});
