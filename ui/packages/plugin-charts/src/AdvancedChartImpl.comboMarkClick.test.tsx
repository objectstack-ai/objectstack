/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#4692's ruled half — a combo chart drills AT ITS MARKS, AND ONLY
 * THERE.
 *
 * This file was `AdvancedChartImpl.comboClickNoop.test.tsx`: it pinned the
 * state that card measured, where `ComposedChart` received no click props at
 * all and every combo click was silent. The maintainer ruled Option B, so the
 * pin is inverted here on purpose rather than deleted — a pin whose subject
 * changes is the one place a behaviour change has to be argued explicitly.
 *
 * What is pinned now, in three layers:
 *
 *  1. **Marks emit.** A `Bar` / `Line` mark on a combo emits
 *     `{ category, categoryId, series, value }` with the same semantics the
 *     plain cartesian branch gives, reusing objectui#4672's item-level
 *     series-identity machinery. Covered for BOTH shapes the branch is
 *     reachable in — an explicitly authored `chartType: 'combo'`, and one
 *     DERIVED by `effectiveChartFamily` from series whose families disagree.
 *     The derived shape is the card's actual harm: an author who adds
 *     `type: 'line'` to one series of a drillable chart never wrote the word
 *     `combo`, and used to lose drill on the whole chart for it.
 *  2. **The surface stays silent** (guard 1 of the ruling). A combo plots
 *     several measures on one plot, so an axis/surface click has no single
 *     series to report and the plain branch's axis fallback would have to
 *     invent one. Its own control sits beside it: the identically-shaped
 *     surface click on a plain bar chart DOES fire, so the silence below is a
 *     fact about the combo branch and not about a surface click this harness
 *     cannot deliver.
 *  3. **The positive control from the no-op era is kept** — an identically
 *     shaped mark click on a plain (non-combo) bar chart still fires, so a
 *     regression that killed clicks everywhere reads as a broad failure here
 *     rather than as a combo-shaped one.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import {
  buildChartSeries,
  findChartSeriesRow,
  type ChartSegmentClickEvent,
} from '@object-ui/core';

// Recharts' ResponsiveContainer measures via ResizeObserver, which reports
// 0x0 under the headless DOM, so nothing paints. Fix its size.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 480, height: 320 }),
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';

afterEach(cleanup);

/**
 * recharts throttles pointer moves through `requestAnimationFrame`, and a
 * click reads the tooltip state that move left behind — the same idiom the
 * sibling click-payload test files use.
 */
const flushFrame = async () => {
  await act(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => setTimeout(r, 0));
  });
};

const clickAt = async (el: Element, clientX: number, clientY: number) => {
  fireEvent.mouseMove(el, { clientX, clientY });
  await flushFrame();
  fireEvent.click(el, { clientX, clientY });
  await flushFrame();
};

const clickRect = async (rect: Element) => {
  const x = Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2;
  const y = Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')) / 2;
  await clickAt(rect, x, y);
};

/**
 * A click on the plot SURFACE, above the marks — the axis-level gesture guard 1
 * rules silent on a combo. The y is kept in the header band so it cannot land
 * on a bar by accident; the x is a real tick's, so a wired chart resolves a
 * category from it (which the control below relies on).
 */
const clickSurface = async (container: HTMLElement) => {
  const surface = container.querySelector('.recharts-surface');
  expect(surface, 'the plot surface must exist for this click to mean anything').toBeTruthy();
  await clickAt(surface!, 200, 30);
};

const DATA = [
  { month: 'Jan', revenue: 120, margin: 0.4 },
  { month: 'Feb', revenue: 80, margin: 0.9 },
];

/** An EXPLICITLY authored combo — `chartType: 'combo'`, marks named per series. */
const renderExplicitCombo = (onChartClick: (ev: ChartSegmentClickEvent) => void) =>
  render(
    <AdvancedChartImpl
      chartType="combo"
      data={DATA as any}
      xAxisKey="month"
      series={[{ dataKey: 'revenue', chartType: 'bar' }, { dataKey: 'margin', chartType: 'line' }] as any}
      isAnimationActive={false}
      onChartClick={onChartClick}
    />,
  );

/**
 * A DERIVED combo, built the way the card's trap is sprung: an ordinary
 * two-dimension pivot (the shape ADR-0021 introduced, whose rows carry the
 * bucket identity a drill lookup needs), with ONE series given a different
 * mark. Nothing here says `combo`; `effectiveChartFamily` derives it.
 */
const PIVOT_RAW = [
  { status: 'Open', priority: 'High', est_hours: 3 },
  { status: 'Open', priority: 'Low', est_hours: 5 },
  { status: 'Done', priority: 'High', est_hours: 7 },
  { status: 'Done', priority: 'Low', est_hours: 11 },
];
const DIMS = ['status', 'priority'];
const VALS = ['est_hours'];

function renderDerivedCombo(onChartClick: (ev: ChartSegmentClickEvent) => void) {
  const { data, xAxisKey, series } = buildChartSeries(PIVOT_RAW, DIMS, VALS);
  // The whole edit an author makes: one series' mark, on a chart authored
  // `bar`. `series[0]` stays un-annotated, exactly as `buildChartSeries` left
  // it — the disagreement is what derives the family.
  const mixed = series.map((s: any, i: number) => (i === 1 ? { ...s, chartType: 'line' } : s));
  const { container } = render(
    <AdvancedChartImpl
      chartType="bar"
      data={data as any}
      xAxisKey={xAxisKey}
      series={mixed as any}
      isAnimationActive={false}
      onChartClick={onChartClick}
    />,
  );
  return { container, series: mixed };
}

describe('AdvancedChartImpl — an EXPLICIT combo drills at its marks (objectui#4692)', () => {
  it('a bar mark emits { category, series, value } — was silent before the ruling', async () => {
    const clicks: ChartSegmentClickEvent[] = [];
    const { container } = renderExplicitCombo((ev) => clicks.push(ev));

    const bar = container.querySelector('.recharts-bar .recharts-rectangle');
    expect(bar, 'a bar mark must actually render for this click to mean anything').toBeTruthy();
    await clickRect(bar!);

    expect(clicks).toHaveLength(1);
    expect(clicks[0].category).toBe('Jan');
    expect(clicks[0].series).toBe('revenue');
    expect(clicks[0].value).toBe(120);
  });

  it('a line mark emits ITS OWN series, not the bar it shares the plot with', async () => {
    // The discriminating case for a combo specifically: two marks of different
    // families over one tick. An implementation that emitted the axis answer
    // would name `revenue` (or nothing) for this click.
    const clicks: ChartSegmentClickEvent[] = [];
    const { container } = renderExplicitCombo((ev) => clicks.push(ev));

    const line = container.querySelector('.recharts-line-curve');
    expect(line, 'a line mark must actually render for this click to mean anything').toBeTruthy();
    await clickAt(line!, 300, 120);

    expect(clicks).toHaveLength(1);
    expect(clicks[0].series).toBe('margin');
    // The category and the value are read from different places — the tick from
    // the chart-level payload, the cell from the row it selects — so pinning
    // that they agree is worth more than pinning either alone.
    const row = DATA.find((d) => d.month === clicks[0].category);
    expect(row, `category ${String(clicks[0].category)} must be a real tick`).toBeTruthy();
    expect(clicks[0].value).toBe(row!.margin);
  });

  it('emits exactly ONE event per gesture — item records, chart emits', async () => {
    // Both handlers fire for one mark click (item first, chart second —
    // measured on recharts 3.10.1). Wiring combo the naive way (emitting from
    // the item handler as well) would double every drill.
    const clicks: ChartSegmentClickEvent[] = [];
    const { container } = renderExplicitCombo((ev) => clicks.push(ev));

    await clickRect(container.querySelector('.recharts-bar .recharts-rectangle')!);

    expect(clicks).toHaveLength(1);
  });

  it('NEGATIVE PIN (guard 1): a click on the surface / axis stays silent', async () => {
    // Ruled, not incidental: a combo plots several measures on one plot, so the
    // axis-level fallback the plain branch keeps has no single series to name
    // here. See the control at the bottom of this file — the same gesture on a
    // plain bar chart DOES fire, so this zero is combo's rule, not the
    // harness's limit.
    const clicks: ChartSegmentClickEvent[] = [];
    const { container } = renderExplicitCombo((ev) => clicks.push(ev));

    await clickSurface(container);

    expect(clicks).toHaveLength(0);
  });
});

describe('AdvancedChartImpl — a DERIVED combo drills too (objectui#4692, the card’s trap)', () => {
  it('resolves the drill end to end after ONE series changed its mark', async () => {
    const clicks: ChartSegmentClickEvent[] = [];
    const { container, series } = renderDerivedCombo((ev) => clicks.push(ev));

    // Stated, not assumed: the second dimension became the series axis, and the
    // mixed families really did derive a combo — one bar group and one line
    // group, where a non-derived read would have drawn two bars.
    expect(series.map((s: any) => s.dataKey)).toEqual(['High', 'Low']);
    expect(container.querySelectorAll('.recharts-bar')).toHaveLength(1);
    expect(container.querySelectorAll('.recharts-line')).toHaveLength(1);

    // The High segment of the Done column — 7 hours.
    const bars = container.querySelectorAll('.recharts-bar .recharts-rectangle');
    expect(bars).toHaveLength(2);
    await clickRect(bars[1]);

    expect(clicks).toHaveLength(1);
    expect(clicks[0].category).toBe('Done');
    expect(clicks[0].series).toBe('High');
    expect(clicks[0].value).toBe(7);

    // The harm the card reports is a dead DRILL, so the lookup is part of the
    // assertion — the same end-to-end check objectui#4672's file makes for the
    // plain branch. Before this change there was no event to look anything up
    // with.
    const idx = findChartSeriesRow(
      PIVOT_RAW,
      DIMS,
      VALS,
      clicks[0].category,
      clicks[0].series,
      { bucketId: clicks[0].categoryId },
    );
    expect(idx).toBe(2);
    expect(PIVOT_RAW[idx]).toEqual({ status: 'Done', priority: 'High', est_hours: 7 });
  });

  it('the line series that DERIVED the combo is itself drillable', async () => {
    // The series the author retyped is the one most likely to be clicked next,
    // and it is the one whose mark family changed under it.
    const clicks: ChartSegmentClickEvent[] = [];
    const { container } = renderDerivedCombo((ev) => clicks.push(ev));

    const line = container.querySelector('.recharts-line-curve');
    expect(line).toBeTruthy();
    await clickAt(line!, 300, 120);

    expect(clicks).toHaveLength(1);
    expect(clicks[0].series).toBe('Low');
  });

  it('NEGATIVE PIN (guard 1): the derived combo’s surface is silent too', async () => {
    const clicks: ChartSegmentClickEvent[] = [];
    const { container } = renderDerivedCombo((ev) => clicks.push(ev));

    await clickSurface(container);

    expect(clicks).toHaveLength(0);
  });
});

describe('AdvancedChartImpl — combo click controls (both directions)', () => {
  it('POSITIVE CONTROL: a mark click on a plain (non-combo) bar chart fires', async () => {
    // Kept from the no-op era of this file. If this failed alongside the combo
    // cases above, those would be measuring a broken harness rather than the
    // combo branch.
    const clicks: ChartSegmentClickEvent[] = [];
    const { container } = render(
      <AdvancedChartImpl
        chartType="bar"
        data={DATA as any}
        xAxisKey="month"
        series={[{ dataKey: 'revenue' }] as any}
        isAnimationActive={false}
        onChartClick={(ev) => clicks.push(ev)}
      />,
    );

    const bar = container.querySelector('.recharts-bar .recharts-rectangle');
    expect(bar).toBeTruthy();
    await clickRect(bar!);

    expect(clicks).toHaveLength(1);
    expect(clicks[0].category).toBe('Jan');
    expect(clicks[0].series).toBe('revenue');
  });

  it('CONTROL for the negative pins: the SAME surface click DOES fire on a plain bar chart', async () => {
    // Without this, the two `toHaveLength(0)` pins above would pass for the
    // empty reason — a surface click that reaches nothing on ANY chart. The
    // plain branch answers it with the axis-level event (category + identity),
    // which is exactly the answer guard 1 withholds from a multi-measure combo.
    const clicks: ChartSegmentClickEvent[] = [];
    const { container } = render(
      <AdvancedChartImpl
        chartType="bar"
        data={DATA as any}
        xAxisKey="month"
        series={[{ dataKey: 'revenue' }] as any}
        isAnimationActive={false}
        onChartClick={(ev) => clicks.push(ev)}
      />,
    );

    await clickSurface(container);

    expect(clicks).toHaveLength(1);
    expect(clicks[0].category).toBe('Jan');
  });
});
