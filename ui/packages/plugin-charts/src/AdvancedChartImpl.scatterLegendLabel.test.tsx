/**
 * objectui#7248 — the scatter legend rendered a colour swatch with NO label,
 * and that anonymous dot read as a DATA POINT drawn outside the plot area.
 *
 * ## The card said "y domain", and the y domain was innocent
 *
 * The card reported the Chart Gallery scatter ("Estimate vs Progress") drawing
 * "a seventh point below the x-axis at x≈40, y≈-10" and asked for the y domain
 * to include every plotted value. Measured on the running showcase in real
 * Chromium (viewport 1440, widget svg 510x350) that diagnosis is FALSE and the
 * fix would have been in the wrong place:
 *
 *   - all SIX marks sat inside the plot area (y 5..295): cy 215.3, 101.7, 5,
 *     179, 150, 237. Nothing was outside it, at any viewport width swept from
 *     1440 down to 480.
 *   - the seventh "point" was the LEGEND swatch — an 8x8 `--chart-1` square,
 *     the same colour as the marks, at cx 255 / cy 341, with `innerText === ""`.
 *   - the arithmetic closes it: the plot bottom (y=0) is cy 295 and the scale
 *     is 4.835 px per unit, so cy 341 is y = -9.5 and cx 255 is x ≈ 45 —
 *     the card's "x≈40, y≈-10", to the pixel.
 *
 * The domain is therefore NOT touched, and the two fixtures that would expose a
 * real domain bug are pinned below instead: mixed-sign and all-negative data
 * both draw every mark, because recharts extends the domain to cover negatives.
 *
 * ## Why the label was empty
 *
 * `ChartLegendContent` resolves a label as `config[nameKey || item.dataKey ||
 * 'value']`. A `<Scatter>` carries NO `dataKey` — scatter's keys live on the
 * XAxis/YAxis, not on the mark — so the key collapsed to the literal string
 * `'value'` and missed a config keyed by measure name. Captured from recharts
 * 3.10.1 rather than assumed, the scatter's legend payload item is:
 *
 *     { color: '#3b82f6', type: 'circle', value: 'Avg Estimate',
 *       payload: { name: 'Avg Estimate', ... } }        // NO `dataKey`
 *
 * The name was right there in `value` the whole time; the legend just never
 * read it. Both halves of the fix are pinned here: the scatter now passes
 * `nameKey`, and `ChartLegendContent` falls back to `item.value` so that NO
 * family can render a nameless swatch again.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';

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

type Row = Record<string, unknown>;

/** The six aggregate rows the Chart Gallery scatter actually plots, read from
 *  the running showcase API: progress buckets x avg estimate_hours. */
const GALLERY: Row[] = [
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
      data={GALLERY as any}
      isAnimationActive={false}
      {...(props as any)}
    />,
  );

/**
 * One entry per legend item: does it paint a swatch, and what text sits beside
 * it. The swatch is the `h-2 w-2` div `ChartLegendContent` renders when the
 * config carries no icon — the exact element measured at cy 341 on screen.
 */
const legendEntries = (c: HTMLElement) => {
  const wrapper = c.querySelector('.recharts-legend-wrapper');
  const row = wrapper?.firstElementChild;
  return [...(row?.children ?? [])].map((el) => ({
    hasSwatch: !!el.querySelector('div.h-2.w-2'),
    text: (el.textContent ?? '').trim(),
  }));
};

const marksOf = (c: HTMLElement) => c.querySelectorAll('path.recharts-symbols').length;

describe('objectui#7248 — the scatter legend names its series', () => {
  it('renders the measure label beside the swatch, not a bare dot', () => {
    // The defect, stated as the reader sees it: a swatch with nothing next to
    // it is indistinguishable from a data point, and this one was painted
    // below the x-axis in the marks' own colour.
    const { container } = renderScatter();
    expect(legendEntries(container)).toEqual([{ hasSwatch: true, text: 'Avg Estimate' }]);
  });

  it('falls back to the series name when the config has no entry for the measure', () => {
    // `nameKey` alone would leave the hole open one config-miss away, which is
    // how this bug survived the pie fix that closed the same shape in #3135.
    //
    // The fallback lands on the RAW measure key, not a prose label, because
    // with no config entry the scatter's own `name` is `s.dataKey` — that is
    // the honest reading and it is still the point: `avg_estimate` identifies
    // the series, an unlabelled dot does not.
    const { container } = renderScatter({ config: { progress: { label: 'Progress' } } });
    expect(legendEntries(container)).toEqual([{ hasSwatch: true, text: 'avg_estimate' }]);
  });

  it('resolves the legend entry through the CONFIG, not just the series name', () => {
    // What `nameKey` buys, pinned separately because the `item.value` fallback
    // masks it on the label: with the key collapsed to `'value'` the config
    // lookup can never hit, so `itemConfig.icon` is dead for scatter and a
    // config-declared legend icon is silently ignored — while every other
    // family honours it. Measured via the icon because that is the one branch
    // the fallback cannot stand in for.
    const Icon = () => <svg data-testid="legend-icon" />;
    const { container } = renderScatter({
      config: { progress: { label: 'Progress' }, avg_estimate: { label: 'Avg Estimate', icon: Icon } },
    });
    expect(container.querySelector('[data-testid="legend-icon"]')).not.toBeNull();
    expect(legendEntries(container)).toEqual([{ hasSwatch: false, text: 'Avg Estimate' }]);
  });

  it('never paints a swatch with no text — the invariant, across families', () => {
    // The class this card belongs to, not just its one instance. A legend entry
    // that cannot be named is worse than no legend: it adds an anonymous mark
    // to a picture whose whole job is to be read.
    for (const chartType of ['scatter', 'bar', 'line', 'area'] as const) {
      const { container } = render(
        <AdvancedChartImpl
          chartType={chartType}
          xAxisKey="progress"
          series={[{ dataKey: 'avg_estimate', label: 'Avg Estimate' }] as any}
          config={{} as any}
          data={GALLERY as any}
          isAnimationActive={false}
        />,
      );
      const nameless = legendEntries(container).filter((e) => e.hasSwatch && e.text === '');
      expect(nameless, `${chartType} painted an unlabelled legend swatch`).toEqual([]);
      cleanup();
    }
  });
});

describe('objectui#7248 — the y domain was NOT the defect, and stays untouched', () => {
  it('draws every gallery row', () => {
    // The control. Six aggregate rows, six marks — measured in Chromium as six
    // marks all inside the plot area, so there is no missing/expelled point.
    expect(marksOf(renderScatter().container)).toBe(6);
  });

  it('draws every mark for mixed-sign and all-negative data', () => {
    // The two fixtures a real y-domain bug would fail. Recharts extends the
    // domain to cover negatives, so clamping it to `[0, 'auto']` here — the fix
    // the card asked for — would have CREATED the defect it described.
    const mixed = render(
      <AdvancedChartImpl chartType="scatter" xAxisKey="xm"
        series={[{ dataKey: 'ym', label: 'Y' }] as any} config={CONFIG as any}
        data={[{ xm: 10, ym: 40 }, { xm: 20, ym: -15 }, { xm: 30, ym: 25 }] as any}
        isAnimationActive={false} />,
    );
    expect(marksOf(mixed.container)).toBe(3);
    cleanup();

    const allNeg = render(
      <AdvancedChartImpl chartType="scatter" xAxisKey="xm"
        series={[{ dataKey: 'ym', label: 'Y' }] as any} config={CONFIG as any}
        data={[{ xm: 10, ym: -40 }, { xm: 20, ym: -15 }] as any}
        isAnimationActive={false} />,
    );
    expect(marksOf(allNeg.container)).toBe(2);
  });

  it('leaves the #7197 unplaceable-row notice alone', () => {
    // The card asked whether this was #7197's job. It is not: that notice
    // answers rows with NO number, and every gallery row has two.
    const { container } = renderScatter();
    expect(container.querySelector('[data-chart-note="unplotted-points"]')).toBeNull();
    expect(container.querySelector('[data-chart-error="no-plottable-points"]')).toBeNull();
  });
});
