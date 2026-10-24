/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#9675 — the scatter branch's two numeric axes ignored the spec
 * `ChartAxis` the rest of this file honours, so `min` / `max` / `stepSize` /
 * `logarithmic` / `title` written by an author were accepted by the schema,
 * resolved by `normalizeChartSchema`, and then dropped at render.
 *
 * ## Why this is the dangerous kind of drop
 *
 * Nothing refuses and nothing looks broken: the chart still draws, at a scale
 * the author overrode. An author who pins `min: 0` to stop a truncated-baseline
 * reading gets the truncated baseline back, and only a reader who already knew
 * the intended domain could tell.
 *
 * ## Why a headless DOM can measure this
 *
 * The usual objection — happy-dom reports `clientWidth` 0, so `ResponsiveContainer`
 * measures nothing — is removed by the mock below: handed an explicit width and
 * height, recharts computes the plot rect, the tick values and every `cx`/`cy`
 * ARITHMETICALLY, with no DOM measurement in the path. The sibling file for
 * objectui#7396 states the same and checks its numbers against a real-Chromium
 * run of the same chart.
 *
 * ## Composition with objectui#7396, which landed first on these same axes
 *
 * objectui#7396 reserves an edge margin on both scatter axes so an extreme mark
 * is drawn wholly inside the plot box. It deliberately spends recharts' axis
 * `padding` — which insets the pixel RANGE — rather than `domain`, so that the
 * `domain` this card writes stays free; its own docblock says so and names this
 * card. The two therefore compose instead of shadowing each other, and
 * `keeps objectui#7396's edge margin while honouring a pinned domain` below is
 * the pin that keeps it that way.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, screen } from '@testing-library/react';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    // The widget's real box on the showcase Chart Gallery, matching the
    // objectui#7396 sibling file so the two read the same geometry.
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 510, height: 350 }),
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';

afterEach(cleanup);

type Row = Record<string, unknown>;

/** The six aggregate rows the Chart Gallery scatter plots. Its own extremes are
 *  x 0..100 and y 12..60, so every pinned domain below is visibly not the one
 *  recharts would fit to the data. */
const GALLERY: Row[] = [
  { progress: 0, avg_estimate: 16.5 },
  { progress: 45, avg_estimate: 40 },
  { progress: 55, avg_estimate: 60 },
  { progress: 80, avg_estimate: 24 },
  { progress: 90, avg_estimate: 30 },
  { progress: 100, avg_estimate: 12 },
];

/** Four rows in GEOMETRIC progression on y. A log scale maps them to four
 *  EQUALLY spaced pixel rows; a linear scale does not, and the gap between the
 *  two readings is the whole assertion — no coordinate is pinned. */
const DECADES: Row[] = [
  { progress: 1, avg_estimate: 1 },
  { progress: 2, avg_estimate: 10 },
  { progress: 3, avg_estimate: 100 },
  { progress: 4, avg_estimate: 1000 },
];

const CONFIG = { progress: { label: 'Progress' }, avg_estimate: { label: 'Avg Estimate' } };

const renderScatter = (props: Record<string, unknown> = {}, data: Row[] = GALLERY) =>
  render(
    <AdvancedChartImpl
      chartType="scatter"
      xAxisKey="progress"
      series={[{ dataKey: 'avg_estimate', label: 'Avg Estimate' }] as any}
      config={CONFIG as any}
      data={data as any}
      isAnimationActive={false}
      {...(props as any)}
    />,
  );

/** Tick label texts for one axis. Recharts 3 draws them in their own layer
 *  rather than inside the axis group, so they are read by orientation. */
const ticks = (c: HTMLElement, orientation: 'bottom' | 'left') =>
  [...c.querySelectorAll(`text.recharts-cartesian-axis-tick-value[orientation="${orientation}"]`)]
    .map((t) => (t.textContent ?? '').trim());

/** Each mark's painted centre and radius, straight off the symbol path — the
 *  same reader the objectui#7396 file uses. */
const marksOf = (c: HTMLElement) =>
  [...c.querySelectorAll('path.recharts-symbols')].map((p) => {
    const cx = Number(p.getAttribute('cx'));
    const cy = Number(p.getAttribute('cy'));
    const r = Number(p.getAttribute('width')) / 2;
    expect([cx, cy, r].every(Number.isFinite), 'symbol carries no geometry').toBe(true);
    return { cx, cy, r };
  });

/** The plot area, exactly: recharts emits the chart offset rect as the clip
 *  path every cartesian layer is drawn through. */
const plotAreaOf = (c: HTMLElement) => {
  const rect = c.querySelector('defs clipPath rect');
  expect(rect, 'recharts drew no plot-area clip rect').not.toBeNull();
  const num = (a: string) => Number(rect!.getAttribute(a));
  const x = num('x');
  const y = num('y');
  return { left: x, right: x + num('width'), top: y, bottom: y + num('height') };
};

describe('objectui#9675 — the scatter y-axis honours its spec ChartAxis', () => {
  it('pins the domain to an authored min/max instead of fitting the data', () => {
    // The data tops out at 60. An author who asked for 0..100 is asking for
    // headroom, and the auto domain silently refuses it.
    const { container } = renderScatter({
      yAxes: [{ field: 'avg_estimate', min: 0, max: 100 }],
    });
    const labels = ticks(container, 'left');
    expect(labels.at(0), 'the y domain does not start at the authored min').toBe('0');
    expect(labels.at(-1), 'the y domain does not reach the authored max').toBe('100');
  });

  it('lays y ticks at the authored stepSize', () => {
    const { container } = renderScatter({
      yAxes: [{ field: 'avg_estimate', min: 0, max: 60, stepSize: 20 }],
    });
    expect(ticks(container, 'left')).toEqual(['0', '20', '40', '60']);
  });

  it('switches the y scale to log when the axis declares it', () => {
    // Stated as an invariant rather than a coordinate: values in geometric
    // progression are equally spaced on a log scale and are not on a linear
    // one. On the defect the four rows land at 100%, 10% and 1% of the range,
    // which no tolerance can mistake for equal steps.
    const { container } = renderScatter(
      { yAxes: [{ field: 'avg_estimate', logarithmic: true }] },
      DECADES,
    );
    const rows = marksOf(container)
      .map((m) => m.cy)
      .sort((a, b) => a - b);
    expect(rows.length, 'the four decade rows were not all drawn').toBe(4);
    const gaps = rows.slice(1).map((cy, i) => cy - rows[i]);
    const widest = Math.max(...gaps);
    const narrowest = Math.min(...gaps);
    expect(narrowest, 'two decades collapsed onto one pixel row').toBeGreaterThan(0);
    expect(
      widest / narrowest,
      'the decades are not equally spaced, so the y scale is still linear',
    ).toBeLessThan(1.05);
  });

  it('labels the y axis with the authored title', () => {
    renderScatter({ yAxes: [{ field: 'avg_estimate', title: 'Avg Estimate (h)' }] });
    expect(screen.getByText('Avg Estimate (h)')).toBeTruthy();
  });

  it('formats y ticks with the authored format instead of the compact default', () => {
    const { container } = renderScatter({
      yAxes: [{ field: 'avg_estimate', format: '$0,0.00' }],
    });
    expect(
      ticks(container, 'left').some((t) => t.includes('$')),
      'the compact default formatter is still on the y axis',
    ).toBe(true);
  });
});

describe('objectui#9675 — the scatter x-axis honours its spec ChartAxis', () => {
  // Scatter is this file's only family whose x is a numeric MEASURE rather than
  // a category band, so it is the only one where these keys mean anything on x.
  it('pins the domain to an authored min/max instead of fitting the data', () => {
    const { container } = renderScatter({ xAxis: { field: 'progress', min: 0, max: 200 } });
    const labels = ticks(container, 'bottom');
    expect(labels.at(0), 'the x domain does not start at the authored min').toBe('0');
    expect(labels.at(-1), 'the x domain does not reach the authored max').toBe('200');
  });

  it('lays x ticks at the authored stepSize', () => {
    const { container } = renderScatter({
      xAxis: { field: 'progress', min: 0, max: 100, stepSize: 50 },
    });
    expect(ticks(container, 'bottom')).toEqual(['0', '50', '100']);
  });

  it('labels the x axis with the authored title', () => {
    renderScatter({ xAxis: { field: 'progress', title: 'Progress (%)' } });
    expect(screen.getByText('Progress (%)')).toBeTruthy();
  });

  it('formats x ticks with the authored format', () => {
    const { container } = renderScatter({ xAxis: { field: 'progress', format: '$0,0.00' } });
    expect(
      ticks(container, 'bottom').some((t) => t.includes('$')),
      'the x axis is still printing raw numbers',
    ).toBe(true);
  });

  it('leaves the x tick text alone when no format is declared', () => {
    // The x axis has no numeric default formatter to fall back to, so the
    // wiring is conditional; this is the pin that keeps it conditional. The
    // CATEGORY formatter the other families use resolves `config[value].label`,
    // which on a measure would print a row's label in place of its number.
    const { container } = renderScatter();
    expect(ticks(container, 'bottom')).toEqual(['0', '25', '50', '75', '100']);
  });
});

describe('objectui#9675 — the repair composes rather than shadows', () => {
  it("keeps objectui#7396's edge margin while honouring a pinned domain", () => {
    // The collision the card warned about: a spec-derived domain and an edge
    // margin would be the same recharts prop if objectui#7396 had spent
    // `domain`. It spent `padding`, so both hold at once — the domain is the
    // author's AND no mark is half-painted outside the plot box.
    //
    // The y floor is 12, not 0, so this witnesses rather than agreeing with
    // the auto domain by luck: recharts anchors an all-positive y at 0, so a
    // dropped derivation reads '0' here. Both domains still end ON a row, so
    // all four plot edges are occupied and the margin is what keeps them in.
    const { container } = renderScatter({
      xAxis: { field: 'progress', min: 0, max: 100 },
      yAxes: [{ field: 'avg_estimate', min: 12, max: 60 }],
    });
    const plot = plotAreaOf(container);
    const marks = marksOf(container);
    expect(marks.length, 'no marks were drawn').toBeGreaterThan(0);
    for (const m of marks) {
      expect(m.cx - m.r, `mark at cx ${m.cx} pokes past the left edge`).toBeGreaterThan(plot.left);
      expect(m.cx + m.r, `mark at cx ${m.cx} pokes past the right edge`).toBeLessThan(plot.right);
      expect(m.cy - m.r, `mark at cy ${m.cy} pokes past the top edge`).toBeGreaterThan(plot.top);
      expect(m.cy + m.r, `mark at cy ${m.cy} pokes past the bottom edge`).toBeLessThan(plot.bottom);
    }
    expect(ticks(container, 'bottom').at(-1), 'the authored x max was not honoured').toBe('100');
    expect(ticks(container, 'left').at(0), 'the authored y min was not honoured').toBe('12');
    expect(ticks(container, 'left').at(-1), 'the authored y max was not honoured').toBe('60');
  });

  it('changes nothing when the author declares no axis config', () => {
    // The control, and the reason the pins above are readable at all: with no
    // spec axis the derivation contributes no prop, so the default render is
    // the one objectui#7396 measured in real Chromium.
    const { container } = renderScatter();
    expect(ticks(container, 'bottom')).toEqual(['0', '25', '50', '75', '100']);
    expect(ticks(container, 'left')).toEqual(['0', '15', '30', '45', '60']);
  });
});
