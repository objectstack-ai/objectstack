/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#8157 — the radar mark never consulted the series.
 *
 * Every cartesian arm of `AdvancedChartImpl` resolves its per-series
 * presentation through `seriesStyle`. The radar arm did not: it rendered
 * `<Radar stroke={color} fill={color} fillOpacity={0.6} />`, a literal that no
 * authored value could reach. Three things declared for every series were
 * therefore inert on `chartType: 'radar'` at once:
 *
 *   - `ChartSeries.opacity`   — read by `normalizeSeries`, then discarded;
 *   - `ChartSeries.dashArray` — the sharp one, because `Radar` is a STROKED
 *     mark (`stroke={color}` sat directly above the literal), so unlike a bar
 *     or a scatter this is a family where a dash actually paints;
 *   - `variant: 'comparison'` — declared and documented with no family
 *     restriction, yet a radar overlay got none of the muted treatment.
 *
 * The three `describe`s below are the three reds: each asserts that a radar
 * series carrying one of the keys draws DIFFERENTLY from one carrying none.
 * Before the fix all three drew identically, so all three failed.
 *
 * ⭐ The control is the fourth `describe`, and it is what keeps the repair from
 * widening into a relayout: a radar series authoring NONE of the three keys
 * still paints `fill-opacity="0.6"` and no stroke fade and no dash — exactly
 * what it painted before. The literal became the FALLBACK, it was not deleted.
 *
 * ⚠️ These assert on the rendered mark's attributes, never on `seriesStyle`'s
 * return value: the helper was not on this path at all, which was the entire
 * defect, so a unit test of the helper would have passed on the broken tree.
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
  { month: 'Mar', revenue: 100, revenue_prev: 120 },
];

/** `AdvancedChartImpl` is lazy — wait for the real plot, not the skeleton. */
const plot = async (c: HTMLElement) => {
  await waitFor(() => expect(c.querySelector('.recharts-surface')).toBeTruthy());
  return c;
};

/**
 * The three presentation attributes as the radar polygon actually painted
 * them. `null` (the DOM's answer for an absent attribute) is a real reading
 * here — it is what an undefined prop leaves behind, and the control below
 * asserts exactly that for two of the three.
 */
const paint = (el: Element | null) => ({
  fillOpacity: el?.getAttribute('fill-opacity') ?? null,
  strokeOpacity: el?.getAttribute('stroke-opacity') ?? null,
  strokeDasharray: el?.getAttribute('stroke-dasharray') ?? null,
});

const radarPolygon = (c: HTMLElement, i = 0) =>
  c.querySelectorAll('.recharts-radar')[i]?.querySelector('.recharts-polygon') ?? null;

const radar = (series: unknown[]) => (
  <ChartRenderer
    schema={{
      type: 'chart',
      chartType: 'radar',
      data: DATA,
      xAxis: { field: 'month' },
      isAnimationActive: false,
      series,
    } as any}
  />
);

/**
 * What a radar series carrying none of the three keys paints. Written once and
 * asserted from both sides: every red below compares against it, and the
 * control `describe` pins it as the literal face that must not move.
 */
const UNDECLARED = { fillOpacity: '0.6', strokeOpacity: null, strokeDasharray: null };

describe('objectui#8157 — an authored `opacity` reaches the radar mark', () => {
  it('paints the authored value on BOTH channels of the polygon, not the 0.6 literal', async () => {
    const { container } = render(radar([{ name: 'revenue', opacity: 0.25 }]));
    const painted = paint(radarPolygon(await plot(container)));
    expect(painted).toMatchObject({ fillOpacity: '0.25', strokeOpacity: '0.25' });
    // The red, stated as the card states it: it must differ from no-declaration.
    expect(painted).not.toEqual(UNDECLARED);
  });
});

describe('objectui#8157 — an authored `dashArray` reaches the radar mark', () => {
  it('dashes the polygon outline — the family where a dash actually paints', async () => {
    const { container } = render(radar([{ name: 'revenue', dashArray: '2 6' }]));
    const painted = paint(radarPolygon(await plot(container)));
    expect(painted).toMatchObject({ strokeDasharray: '2 6' });
    expect(painted).not.toEqual(UNDECLARED);
  });
});

describe('objectui#8157 — `variant: comparison` mutes a radar overlay', () => {
  it('draws the overlay differently from the primary beside it', async () => {
    const { container } = render(
      radar([{ name: 'revenue' }, { name: 'revenue_prev', variant: 'comparison' }]),
    );
    const c = await plot(container);
    const primary = paint(radarPolygon(c, 0));
    const overlay = paint(radarPolygon(c, 1));
    // Radar is the other mark this renderer both strokes and fills, so it takes
    // the AREA family's muted defaults — no new numbers were invented for it.
    expect(overlay).toMatchObject({
      fillOpacity: '0.2',
      strokeOpacity: '0.6',
      strokeDasharray: '4 4',
    });
    expect(overlay).not.toEqual(primary);
    expect(overlay).not.toEqual(UNDECLARED);
  });

  it('lets an authored `opacity` / `dashArray` override the comparison default, as every other family does', async () => {
    const { container } = render(
      radar([
        { name: 'revenue' },
        { name: 'revenue_prev', variant: 'comparison', opacity: 0.9, dashArray: '8 4' },
      ]),
    );
    expect(paint(radarPolygon(await plot(container), 1))).toMatchObject({
      fillOpacity: '0.9',
      strokeOpacity: '0.9',
      strokeDasharray: '8 4',
    });
  });
});

describe('objectui#8157 — the control: a radar series declaring NONE of the three does not move', () => {
  it('keeps the 0.6 fill and gains neither a stroke fade nor a dash', async () => {
    const { container } = render(radar([{ name: 'revenue' }]));
    expect(paint(radarPolygon(await plot(container)))).toEqual(UNDECLARED);
  });

  it('holds for the PRIMARY series of a chart whose other series is a comparison overlay', async () => {
    const { container } = render(
      radar([{ name: 'revenue' }, { name: 'revenue_prev', variant: 'comparison' }]),
    );
    expect(paint(radarPolygon(await plot(container), 0))).toEqual(UNDECLARED);
  });
});
