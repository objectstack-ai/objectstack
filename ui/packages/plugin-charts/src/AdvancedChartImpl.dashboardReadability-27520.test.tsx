/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Dashboard chart readability (objectstack#27520 rows 15 and 18).
 *
 * - A month bucket key (`2025-10`) reads `Oct 2025` on the category axis.
 * - The legend draws a swatch for a bar series (whose mark fills from a
 *   gradient, so recharts hands the legend a `url(#…)` it cannot draw), and a
 *   comparison series' swatch is hollow, apart from the primary's solid one.
 * - A horizontal bar's category label is drawn in full on a phone, wrapped
 *   into the axis width, instead of cut to eight characters; a label that
 *   still has to be cut carries the full text as its tooltip.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 360, height: 320 }),
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';

const DESKTOP_WIDTH = window.innerWidth;

afterEach(() => {
  cleanup();
  (window as any).innerWidth = DESKTOP_WIDTH;
});

// The legend payload registers from a layout effect; read it after a tick.
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });

const swatches = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>('.recharts-legend-wrapper .rounded-\\[2px\\]'));

const categoryTicks = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<SVGTextElement>('.recharts-yAxis .recharts-cartesian-axis-tick-value, .recharts-cartesian-axis-tick-labels text'));

describe('month bucket keys on the category axis (row 15)', () => {
  it('reads `2025-10` as `Oct 2025`', () => {
    const { container } = render(
      <AdvancedChartImpl
        chartType="line"
        data={[{ month: '2025-10', n: 3 }, { month: '2025-11', n: 5 }, { month: '2025-12', n: 4 }]}
        xAxisKey="month"
        series={[{ dataKey: 'n', label: 'Count' }]}
        isAnimationActive={false}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Oct 2025');
    expect(text).toContain('Dec 2025');
    expect(text).not.toContain('2025-10');
  });

  it('CONTROL: a category that only looks partly like a date is drawn as written', () => {
    const { container } = render(
      <AdvancedChartImpl
        chartType="bar"
        data={[{ q: '2025-Q4', n: 3 }, { q: '2026-Q1', n: 5 }]}
        xAxisKey="q"
        series={[{ dataKey: 'n', label: 'Count' }]}
        isAnimationActive={false}
      />,
    );
    expect(container.textContent).toContain('2025-Q4');
  });
});

describe('legend swatches (row 15)', () => {
  const compared = [
    { dataKey: 'n', label: 'Count', variant: 'current' as const },
    { dataKey: 'n__compare', label: 'Count · vs last quarter', variant: 'comparison' as const },
  ];
  const rows = [{ stage: 'Prospecting', n: 3, n__compare: 2 }, { stage: 'Proposal', n: 5, n__compare: 4 }];

  it('a bar chart draws a colour on every swatch, never a gradient reference', async () => {
    const { container } = render(
      <AdvancedChartImpl chartType="bar" data={rows} xAxisKey="stage" series={compared} isAnimationActive={false} />,
    );
    await settle();
    const drawn = swatches(container);
    expect(drawn).toHaveLength(2);
    for (const swatch of drawn) {
      const color = swatch.style.getPropertyValue('--color-bg');
      expect(color).not.toBe('');
      expect(color).not.toMatch(/^url\(/);
    }
  });

  it.each(['bar', 'line', 'area'] as const)('%s: the comparison swatch is hollow and the primary one solid, in the same colour', async (chartType) => {
    const { container } = render(
      <AdvancedChartImpl chartType={chartType} data={rows} xAxisKey="stage" series={compared} isAnimationActive={false} />,
    );
    await settle();
    const [primary, comparison] = swatches(container);
    expect(primary.classList.contains('bg-(--color-bg)')).toBe(true);
    expect(primary.getAttribute('data-swatch')).toBeNull();
    expect(comparison.getAttribute('data-swatch')).toBe('comparison');
    expect(comparison.classList.contains('bg-transparent')).toBe(true);
    expect(comparison.classList.contains('border-(--color-bg)')).toBe(true);
    // The overlay mirrors its primary's colour; the swatch shape tells them apart.
    expect(comparison.style.getPropertyValue('--color-bg')).toBe(primary.style.getPropertyValue('--color-bg'));
  });
});

describe('horizontal bar category labels on a phone (row 18)', () => {
  const asPhone = () => {
    (window as any).innerWidth = 390;
    window.dispatchEvent(new Event('resize'));
  };
  const statuses = [
    { status: 'In Progress', n: 4 },
    { status: 'Backlog', n: 2 },
    { status: 'Waiting on the customer to confirm the delivery window', n: 1 },
  ];

  it('draws "In Progress" whole, not cut to "In Progr…"', () => {
    asPhone();
    const { container } = render(
      <AdvancedChartImpl chartType="horizontal-bar" data={statuses} xAxisKey="status" series={[{ dataKey: 'n', label: 'Tasks' }]} isAnimationActive={false} />,
    );
    const texts = categoryTicks(container).map((t) => Array.from(t.querySelectorAll('tspan')).map((s) => s.textContent).join(' '));
    expect(texts).toContain('In Progress');
    expect(container.textContent).not.toContain('In Progr…');
  });

  it('wraps a long label to at most two lines and carries the full label as its tooltip', () => {
    asPhone();
    const { container } = render(
      <AdvancedChartImpl chartType="horizontal-bar" data={statuses} xAxisKey="status" series={[{ dataKey: 'n', label: 'Tasks' }]} isAnimationActive={false} />,
    );
    const long = categoryTicks(container).find((t) => t.querySelector('title'));
    expect(long).toBeDefined();
    expect(long!.querySelector('title')!.textContent).toBe('Waiting on the customer to confirm the delivery window');
    const lines = Array.from(long!.querySelectorAll('tspan')).map((s) => s.textContent ?? '');
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
    // A label that fits carries no tooltip.
    const backlog = categoryTicks(container).find((t) => t.textContent === 'Backlog');
    expect(backlog?.querySelector('title')).toBeNull();
  });
});

describe('vertical bar category labels on a phone (row 18)', () => {
  const asPhone = () => {
    (window as any).innerWidth = 390;
    window.dispatchEvent(new Event('resize'));
  };
  const xTicks = (c: HTMLElement) =>
    Array.from(c.querySelectorAll<SVGTextElement>('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value'));

  it('a few buckets rotate and draw "In Progress" whole, where the phone cut drew "In Progr…"', () => {
    asPhone();
    const { container } = render(
      <AdvancedChartImpl
        chartType="bar"
        data={[{ s: 'Backlog', n: 2 }, { s: 'To Do', n: 2 }, { s: 'In Progress', n: 2 }, { s: 'In Review', n: 2 }, { s: 'Done', n: 2 }]}
        xAxisKey="s"
        series={[{ dataKey: 'n', label: 'Tasks' }]}
        isAnimationActive={false}
      />,
    );
    const labels = xTicks(container).map((t) => t.textContent);
    expect(labels).toContain('In Progress');
    expect(container.textContent).not.toContain('In Progr…');
  });

  it('a label still cut carries the full label as its tooltip; a whole one carries none', () => {
    const long = 'Waiting on the customer to confirm';
    const { container } = render(
      <AdvancedChartImpl
        chartType="bar"
        data={[{ s: long, n: 2 }, { s: 'Done', n: 3 }]}
        xAxisKey="s"
        series={[{ dataKey: 'n', label: 'Tasks' }]}
        isAnimationActive={false}
      />,
    );
    const ticks = Array.from(container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-label'));
    const cut = ticks.find((t) => (t.textContent ?? '').includes('…'));
    expect(cut, 'the long label was not cut, so this measures nothing').toBeDefined();
    expect(cut!.querySelector('title')?.textContent).toBe(long);
    const whole = ticks.find((t) => t.querySelector('.recharts-cartesian-axis-tick-value')?.textContent === 'Done');
    expect(whole?.querySelector('title')).toBeNull();
  });
});

describe('a lone bar series painted per category (row 15 control)', () => {
  it('draws its legend label with no swatch, since no one colour names it', async () => {
    const { container } = render(
      <AdvancedChartImpl
        chartType="bar"
        data={[{ h: 'green', n: 3 }, { h: 'red', n: 1 }]}
        xAxisKey="h"
        series={[{ dataKey: 'n', label: 'Projects' }]}
        config={{ n: { label: 'Projects' } }}
        categoryColors={{ green: '#22c55e', red: '#ef4444' }}
        isAnimationActive={false}
      />,
    );
    await settle();
    expect(container.querySelector('.recharts-legend-wrapper')?.textContent).toContain('Projects');
    expect(swatches(container)).toHaveLength(0);
  });
});

