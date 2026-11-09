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

/**
 * objectstack#30126 row 11 — a count axis tops out at the largest count.
 *
 * The sighting: a chart with one bar of value 1 drew its axis to 4, so the bar
 * reached a quarter of the plot. A whole-number axis whose counts stay below
 * recharts' five default ticks now takes one tick per whole number up to its
 * largest count. Controls: a larger count keeps the default ticks, a sum over
 * the same row keeps its decimals, and an author's `max` keeps its domain.
 */
describe('objectstack#30126 — a count axis fits a small count', () => {
  const ONE = [{ status: 'Paused', a: 1 }];

  async function drawRows(rows: Record<string, unknown>[], schema: Record<string, unknown>) {
    const { container } = render(
      <ChartRenderer
        schema={{ type: 'chart', data: rows, xAxisKey: 'status', isAnimationActive: false, ...schema } as never}
      />,
    );
    await waitFor(() => expect(container.querySelector('.recharts-surface')).toBeTruthy());
    return container;
  }

  const ticksOf = (c: HTMLElement, side: Side, categories: Set<string>) =>
    [...c.querySelectorAll('text.recharts-cartesian-axis-tick-value')]
      .filter((t) => !categories.has((t.textContent ?? '').trim()) && t.getAttribute('orientation') === side)
      .map((t) => (t.textContent ?? '').trim());

  it.each([
    ['bar', 'left'],
    ['horizontal-bar', 'bottom'],
  ] as const)('%s: a single count of 1 draws the axis 0 to 1', async (chartType, side) => {
    const c = await drawRows(ONE, { chartType, series: [series('count')] });
    expect(ticksOf(c, side, new Set(['Paused']))).toEqual(['0', '1']);
  });

  it('bar: counts topping out at 2 draw 0, 1, 2', async () => {
    const rows = [{ status: 'Open', a: 2 }, { status: 'Done', a: 1 }];
    const c = await drawRows(rows, { chartType: 'bar', series: [series('count')] });
    expect(ticksOf(c, 'left', new Set(['Open', 'Done']))).toEqual(['0', '1', '2']);
  });

  it('control: a count of 8 keeps recharts\' default five ticks', async () => {
    const c = await drawRows([{ status: 'Paused', a: 8 }], { chartType: 'bar', series: [series('count')] });
    expect(ticksOf(c, 'left', new Set(['Paused']))).toHaveLength(5);
  });

  it('control: a sum over the same row keeps the default ticks', async () => {
    const c = await drawRows(ONE, { chartType: 'bar', series: [series('sum')] });
    expect(ticksOf(c, 'left', new Set(['Paused'])).length).toBeGreaterThan(2);
  });

  it('control: an author\'s max is not fitted to the data', async () => {
    const c = await drawRows(ONE, { chartType: 'bar', yAxis: [{ field: 'a', max: 4 }], series: [series('count')] });
    const ticks = ticksOf(c, 'left', new Set(['Paused']));
    expect(ticks).toContain('4');
    expect(ticks.length).toBeGreaterThan(2);
  });
});
