/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11681 — a value axis over counts draws whole-number ticks.
 *
 * The dashboards measured on the card ("Projects by Health", "Tasks by
 * Status", "Invoices by Month") plot a `count` measure over a small domain,
 * and recharts' default tick picker lays 0.75 / 0.5 steps over it, which the
 * compact formatter prints as 0.8 / 1.5 / 2.3. The chart now learns the
 * measure's aggregate from the dataset answer (`fields[].aggregate`, carried
 * onto the internal series by `buildChartSeries`) and a value axis whose
 * series ALL plot `count` / `count_distinct` takes `allowDecimals: false`.
 *
 * The control half is the card's second pin: the same rows plotted as a `sum`
 * (a currency total) keep their decimal ticks, and so does a series with no
 * aggregate at all. Every case is drawn on the same rows, so the only variable
 * is the series' `aggregate`.
 *
 * Radar is not here on purpose: recharts 3.10.1's `PolarRadiusAxis` already
 * defaults `allowDecimals` to `false`, so its radius axis never drew fractional
 * ticks and this change leaves it alone.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

// Recharts' ResponsiveContainer measures via ResizeObserver, which reports 0x0
// under the headless DOM, so nothing paints. Hand it a fixed box.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) =>
      React.cloneElement(children, { width: 510, height: 350 }),
  };
});

import { ChartRenderer } from './ChartRenderer';
// `ChartRenderer` lazy-loads `./AdvancedChartImpl`; importing it with the SAME
// specifier moves that cost into the import phase (AGENTS.md "测试纪律").
import './AdvancedChartImpl';

afterEach(cleanup);

/** A small count domain: the measured shape (0 … 3). */
const ROWS = [
  { status: 'Open', a: 1, b: 3 },
  { status: 'Done', a: 3, b: 2 },
  { status: 'Late', a: 2, b: 1 },
];
const CATEGORIES = new Set(ROWS.map((r) => r.status));

type Side = 'left' | 'right' | 'top' | 'bottom';

async function draw(schema: Record<string, unknown>) {
  const { container } = render(
    <ChartRenderer
      schema={{ type: 'chart', data: ROWS, xAxisKey: 'status', isAnimationActive: false, ...schema } as never}
    />,
  );
  await waitFor(() => expect(container.querySelector('.recharts-surface')).toBeTruthy());
  return container;
}

/** The value tick labels drawn on one side, in order. */
const valueTicks = (c: HTMLElement, side: Side) =>
  [...c.querySelectorAll('text.recharts-cartesian-axis-tick-value')]
    .filter((t) => !CATEGORIES.has((t.textContent ?? '').trim()) && t.getAttribute('orientation') === side)
    .map((t) => (t.textContent ?? '').trim());

const isWhole = (tick: string) => /^-?\d+$/.test(tick);

/** Every tick a whole number — and at least two drawn, so an empty axis cannot pass. */
function expectWhole(ticks: string[], what: string) {
  expect(ticks.length, `${what}: no value ticks were drawn`).toBeGreaterThan(1);
  expect(ticks.filter((t) => !isWhole(t)), `${what}: fractional ticks ${JSON.stringify(ticks)}`).toEqual([]);
}

/** At least one fractional tick — the recharts default this fix must leave alone. */
function expectDecimals(ticks: string[], what: string) {
  expect(ticks.length, `${what}: no value ticks were drawn`).toBeGreaterThan(1);
  expect(ticks.some((t) => !isWhole(t)), `${what}: lost its decimal ticks ${JSON.stringify(ticks)}`).toBe(true);
}

const series = (aggregate?: string, extra: Record<string, unknown> = {}) => ({
  dataKey: 'a',
  label: 'Tasks',
  ...(aggregate ? { aggregate } : {}),
  ...extra,
});

describe('objectui#11681 — a value axis over counts draws whole-number ticks', () => {
  it.each(['bar', 'line', 'area'])('%s: a count measure gets integer ticks', async (chartType) => {
    const c = await draw({ chartType, series: [series('count')] });
    expectWhole(valueTicks(c, 'left'), `${chartType} over a count`);
  });

  it('bar: count_distinct is an integer aggregate too', async () => {
    const c = await draw({ chartType: 'bar', series: [series('count_distinct')] });
    expectWhole(valueTicks(c, 'left'), 'bar over a count_distinct');
  });

  it('horizontal-bar: the value axis runs across the plot, and it gets integer ticks too', async () => {
    const c = await draw({ chartType: 'horizontal-bar', series: [series('count')] });
    expectWhole(valueTicks(c, 'bottom'), 'horizontal-bar over a count');
  });

  it('dual axis: each side decides for itself — counts on the left, a currency sum on the right', async () => {
    const c = await draw({
      chartType: 'bar',
      yAxis: [{ field: 'a' }, { field: 'b', position: 'right' }],
      series: [
        series('count', { yAxis: 'left' }),
        { dataKey: 'b', label: 'Revenue', aggregate: 'sum', yAxis: 'right' },
      ],
    });
    expectWhole(valueTicks(c, 'left'), 'the count side');
    expectDecimals(valueTicks(c, 'right'), 'the sum side');
  });
});

describe('objectui#11681 — non-integer measures are unchanged (controls)', () => {
  it.each(['bar', 'horizontal-bar'])('%s: a sum over currency keeps its decimals', async (chartType) => {
    const c = await draw({ chartType, series: [series('sum')] });
    expectDecimals(valueTicks(c, chartType === 'horizontal-bar' ? 'bottom' : 'left'), `${chartType} over a sum`);
  });

  it('bar: a series with no aggregate keeps recharts\' default — the measured fractional ticks', async () => {
    const c = await draw({ chartType: 'bar', series: [series()] });
    expectDecimals(valueTicks(c, 'left'), 'bar with no aggregate');
  });

  it('bar: one sum beside a count on the SAME axis keeps the default', async () => {
    const c = await draw({
      chartType: 'bar',
      series: [series('count'), { dataKey: 'b', label: 'Revenue', aggregate: 'sum' }],
    });
    expectDecimals(valueTicks(c, 'left'), 'a shared axis with a sum on it');
  });
});
