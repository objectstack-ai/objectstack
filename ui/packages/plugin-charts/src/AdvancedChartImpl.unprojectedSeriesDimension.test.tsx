/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#4683 — the ANNOUNCING half of "cannot know refuses loudly", on the
 * SERIES axis.
 *
 * `AdvancedChartImpl.missingCategoryKey.test.tsx` pins that answer for the FIRST
 * dimension (framework#4033): rows that never carried the category key get a
 * named refusal instead of an axis frame with no marks. A pivot has a SECOND
 * dimension and had no such answer — an unprojected group key produced
 * `series: []`, so the chart drew axes, grid, tooltip and legend around ZERO
 * marks and said nothing. Measured on this file's own fixture with the guard
 * reverted: an `<svg>`, `0` `.recharts-rectangle` elements, no warning, no text.
 *
 * The three-way distinction objectui#4673 landed is what these tests hold still,
 * one `describe` per arm:
 *
 *   - null / `''` group values DRAW — real groups, real buckets, real bars;
 *   - an unprojected group key REFUSES — nothing exists to draw or to label;
 *   - an ordinary (and a PARTIALLY projected) pivot renders unchanged.
 *
 * objectui#4695 extends the refusal to the neighbouring shape — NO series
 * binding at all (`series === undefined`) — with its own sentence; the last
 * `describe` pins that arm, its family boundary and its reverse control.
 *
 * Every #4683 fixture goes through `buildChartSeries` rather than hand-writing the
 * props, because the defect lives in the composition the two consumers perform
 * (`ObjectChart`, `DatasetWidget`) and not in either half alone.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render as rtlRender, cleanup, type RenderOptions } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { buildChartSeries, NULL_CATEGORY_LABEL } from '@object-ui/core';

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

import AdvancedChartImpl from './AdvancedChartImpl';

/**
 * Every case mounts under an `I18nProvider`, as the console always does.
 * `AdvancedChartImpl` reads the display locale (`useDisplayLocale`,
 * objectui#9909), and a PROVIDER-LESS first `useTranslation()` prints
 * react-i18next's once-per-module `NO_I18NEXT_INSTANCE` notice — which the
 * `console.warn` spies below, written to read the chart's OWN diagnostics,
 * would otherwise count.
 */
function EnSession({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      {children}
    </I18nProvider>
  );
}
const render = ((ui: React.ReactElement, options?: RenderOptions) =>
  rtlRender(ui, { wrapper: EnSession, ...options })) as typeof rtlRender;

afterEach(cleanup);

const DIMS = ['status', 'priority'];
const VALS = ['est_hours'];

/**
 * The card's repro: `dimensions: ['status','priority']`, `values:
 * ['est_hours']`, and result rows that carry `status` and `est_hours` but no
 * `priority` KEY AT ALL — grouped by a dimension the query never projected.
 */
const UNPROJECTED = [
  { status: 'Backlog', est_hours: 12 },
  { status: 'Done', est_hours: 30 },
];

/** The same pivot, projected. The ordinary case that must not change. */
const PROJECTED = [
  { status: 'Backlog', priority: 'High', est_hours: 12 },
  { status: 'Done', priority: 'Low', est_hours: 30 },
];

/** Render a pivot result exactly as `DatasetWidget` / `ObjectChart` do. */
function renderPivot(
  rows: Array<Record<string, unknown>>,
  props: Record<string, unknown> = {},
) {
  const { data, xAxisKey, series } = buildChartSeries(rows, DIMS, VALS, null, {
    nullCategoryLabel: NULL_CATEGORY_LABEL,
  });
  const { container } = render(
    <AdvancedChartImpl
      chartType="bar"
      data={data as any}
      xAxisKey={xAxisKey}
      series={series as any}
      isAnimationActive={false}
      {...(props as any)}
    />,
  );
  return { container, data, series };
}

const refusal = (container: HTMLElement) =>
  container.querySelector('[data-chart-error="no-plottable-series"]');

describe('AdvancedChartImpl — an unprojected SECOND dimension refuses (objectui#4683)', () => {
  it('names the failure instead of drawing a frame with no marks', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container, series } = renderPivot(UNPROJECTED);

    // Premise A, re-derived post-#4681 rather than taken from the card: no row
    // carries `priority`, so no group has a bucket and no series exists.
    expect(series).toEqual([]);

    const placeholder = refusal(container);
    expect(placeholder, 'renders the explanatory placeholder').not.toBeNull();
    // The axis it DID plot is named, as the first dimension's guard names its
    // own key — that plus the warning's row keys is the author's diagnosis.
    expect(placeholder?.textContent).toContain('status');
    // The old behaviour: axes, grid, tooltip and legend around zero marks.
    // Anything that still paints a plot here is the silence this replaces.
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelectorAll('.recharts-rectangle')).toHaveLength(0);
    warn.mockRestore();
  });

  it('warns once, naming the axis key and the keys the rows actually carry', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderPivot(UNPROJECTED);

    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0]?.[0] ?? '');
    expect(msg).toContain('status');
    // The bucket rows carry the category and NOTHING else — the tell that the
    // group column was never written. `est_hours` is absent from them because
    // no group owned it, which is exactly what the author needs to see.
    expect(msg).toContain('Row keys: ["status"]');
    expect(msg).toContain('objectui#4683');
    warn.mockRestore();
  });

  it('fires on every family whose marks come only from `series`', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const chartType of ['bar', 'horizontal-bar', 'line', 'area', 'combo', 'column']) {
      const { container } = renderPivot(UNPROJECTED, { chartType });
      expect(refusal(container), `${chartType} refuses`).not.toBeNull();
      cleanup();
    }
    warn.mockRestore();
  });

  it('scatter handed a CATEGORY column refuses under objectui#7171, never under this guard', () => {
    // The seam, pinned from this side too. Before objectui#7171 this dataset
    // drew an axis frame with no marks and said nothing — six such datasets
    // shared one image. It is still not a `no-plottable-series` failure: the
    // `value` fallback works exactly as this file says it does, and what is
    // missing is a plottable X, which is a different sentence.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(
      <AdvancedChartImpl
        chartType="scatter"
        data={[{ name: 'Backlog', value: 12 }, { name: 'Done', value: 30 }]}
        xAxisKey="name"
        series={[]}
        isAnimationActive={false}
      />,
    );
    expect(refusal(container), 'not this guard').toBeNull();
    expect(
      container.querySelector('[data-chart-error="no-plottable-points"]'),
      'objectui#7171 answers it instead',
    ).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('stays out of the way of families that draw from a `value` column', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // pie / donut / funnel / radar / scatter / treemap / sankey all fall back to
    // `series[0]?.dataKey || 'value'`, so no series is not no chart there — a
    // refusal would blank a working one.
    for (const chartType of ['pie', 'donut', 'funnel', 'radar']) {
      const { container } = render(
        <AdvancedChartImpl
          chartType={chartType as any}
          data={[{ name: 'Backlog', value: 12 }, { name: 'Done', value: 30 }]}
          xAxisKey="name"
          series={[]}
          isAnimationActive={false}
        />,
      );
      expect(refusal(container), `${chartType} draws`).toBeNull();
      expect(container.querySelector('svg'), `${chartType} paints`).not.toBeNull();
      cleanup();
    }

    // SCATTER holds the same property, but only a dataset it can actually plot
    // shows it. Its axes are BOTH `type="number"`, so the category column this
    // loop hands the others is not a scatter dataset at all — it was measured
    // drawing zero marks (objectui#7171), which is why the assertion below uses
    // a two-measure fixture. `series: []` still falls back to `value`, and that
    // fallback is what this test is about.
    const { container: scatter } = render(
      <AdvancedChartImpl
        chartType="scatter"
        data={[{ x: 12, value: 30 }, { x: 20, value: 45 }]}
        xAxisKey="x"
        series={[]}
        isAnimationActive={false}
      />,
    );
    expect(refusal(scatter), 'scatter draws').toBeNull();
    expect(scatter.querySelector('svg'), 'scatter paints').not.toBeNull();
    cleanup();

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('refuses a caller that computed NO series binding at all, in its own sentence (objectui#4695)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // `series === undefined` is "no binding was ever computed", not "a binding
    // came out empty". This used to draw the same silent frame of zero marks;
    // maintainer ruling A on objectui#4695 refuses it too, through the SAME
    // placeholder and code, with a sentence that says which of the two it is.
    const { container } = render(
      <AdvancedChartImpl
        chartType="bar"
        data={[{ status: 'Backlog', est_hours: 12 }]}
        xAxisKey="status"
        isAnimationActive={false}
      />,
    );
    const undeclared = refusal(container);
    expect(undeclared, 'renders the explanatory placeholder').not.toBeNull();
    expect(undeclared?.getAttribute('role')).toBe('status');
    expect(undeclared?.textContent).toContain('status');
    expect(container.querySelector('svg')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0] ?? '')).toContain('objectui#4695');
    const undeclaredText = undeclared?.textContent;
    cleanup();

    // Told apart from the computed-and-empty refusal: same code, different
    // sentence — the fix differs (declare a series vs project / select one).
    const { container: empty } = render(
      <AdvancedChartImpl
        chartType="bar"
        data={[{ status: 'Backlog', est_hours: 12 }]}
        xAxisKey="status"
        series={[]}
        isAnimationActive={false}
      />,
    );
    const computedEmpty = refusal(empty);
    expect(computedEmpty).not.toBeNull();
    expect(computedEmpty?.textContent).not.toBe(undeclaredText);
    expect(String(warn.mock.calls[1]?.[0] ?? '')).toContain('objectui#4683');
    warn.mockRestore();
  });

  it('yields to the category-axis refusal when both apply — one cause, one diagnosis', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(
      <AdvancedChartImpl
        chartType="bar"
        data={[{ est_hours: 12 }, { est_hours: 30 }]}
        xAxisKey="status"
        series={[]}
        isAnimationActive={false}
      />,
    );

    expect(container.querySelector('[data-chart-error="missing-category-key"]')).not.toBeNull();
    expect(refusal(container)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0] ?? '')).toContain('no row has the category key');
    warn.mockRestore();
  });
});

describe('AdvancedChartImpl — what the refusal must NOT swallow (objectui#4683)', () => {
  it('draws a null / empty-string second-dimension group (objectui#4673 intact)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container, series } = renderPivot([
      { status: 'Backlog', priority: null, est_hours: 12 },
      { status: 'Done', priority: '', est_hours: 30 },
    ]);

    // Known to be empty DRAWS: both are real groups with real buckets.
    expect(series.map((s) => s.dataKey)).toEqual([NULL_CATEGORY_LABEL, '']);
    expect(refusal(container), 'a known-empty group is not a missing one').toBeNull();
    expect(container.querySelectorAll('.recharts-rectangle')).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('renders an ordinary projected pivot unchanged', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container, series } = renderPivot(PROJECTED);

    expect(series.map((s) => s.dataKey)).toEqual(['High', 'Low']);
    expect(refusal(container)).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('draws what projects when the group key is only PARTIALLY projected', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container, series, data } = renderPivot([
      { status: 'Backlog', priority: 'High', est_hours: 12 },
      { status: 'Done', est_hours: 30 },
    ]);

    // Premise C, decided by MIRRORING the first dimension rather than by taste:
    // `hasNoCategoryKey` refuses only when NOT ONE row carries the key
    // (`!rows.some(…)`), so a partially projected axis draws what projects. The
    // series axis inherits that line exactly — one row carries `priority`, so
    // that group has a bucket, `series` is non-empty and nothing refuses.
    expect(series.map((s) => s.dataKey)).toEqual(['High']);
    // The unprojected row still contributes its CATEGORY and no measure — the
    // objectui#4673 rule this card does not touch.
    expect(data).toEqual([{ status: 'Backlog', High: 12 }, { status: 'Done' }]);
    expect(refusal(container)).toBeNull();
    expect(container.querySelectorAll('.recharts-rectangle')).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('never fires on a single-dimension chart, which has a measure series', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { data, xAxisKey, series } = buildChartSeries(
      [{ status: 'Backlog', est_hours: 12 }, { status: 'Done', est_hours: 30 }],
      ['status'],
      ['est_hours'],
    );
    const { container } = render(
      <AdvancedChartImpl
        chartType="bar"
        data={data as any}
        xAxisKey={xAxisKey}
        series={series as any}
        isAnimationActive={false}
      />,
    );

    expect(series.map((s) => s.dataKey)).toEqual(['est_hours']);
    expect(refusal(container)).toBeNull();
    expect(container.querySelectorAll('.recharts-rectangle')).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('says nothing about a chart with no rows to plot at all', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Empty is not unreadable — an empty result set is a legitimate answer and
    // the chart's own empty state owns it. Same rows.length > 0 precondition
    // the framework#4033 guard carries.
    const { container } = render(
      <AdvancedChartImpl chartType="bar" data={[]} xAxisKey="status" series={[]} isAnimationActive={false} />,
    );
    expect(refusal(container)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('AdvancedChartImpl — a chart that declared NO series binding at all (objectui#4695)', () => {
  const ROWS = [{ status: 'Backlog', est_hours: 12 }, { status: 'Done', est_hours: 30 }];

  it('refuses on every family whose marks come only from `series`', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const chartType of ['bar', 'horizontal-bar', 'line', 'area', 'combo', 'column']) {
      const { container } = render(
        <AdvancedChartImpl chartType={chartType as any} data={ROWS} xAxisKey="status" isAnimationActive={false} />,
      );
      expect(refusal(container), `${chartType} refuses`).not.toBeNull();
      expect(container.querySelector('svg'), `${chartType} draws no empty frame`).toBeNull();
      cleanup();
    }
    warn.mockRestore();
  });

  it('keeps drawing the families that fall back to a `value` column', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const chartType of ['pie', 'donut', 'funnel', 'radar']) {
      const { container } = render(
        <AdvancedChartImpl
          chartType={chartType as any}
          data={[{ name: 'Backlog', value: 12 }, { name: 'Done', value: 30 }]}
          xAxisKey="name"
          isAnimationActive={false}
        />,
      );
      expect(refusal(container), `${chartType} draws`).toBeNull();
      expect(container.querySelector('svg'), `${chartType} paints`).not.toBeNull();
      cleanup();
    }
    const { container: scatter } = render(
      <AdvancedChartImpl
        chartType="scatter"
        data={[{ x: 12, value: 30 }, { x: 20, value: 45 }]}
        xAxisKey="x"
        isAnimationActive={false}
      />,
    );
    expect(refusal(scatter), 'scatter draws').toBeNull();
    expect(scatter.querySelector('svg'), 'scatter paints').not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reverse control: a bar chart that DECLARES its series renders normally', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(
      <AdvancedChartImpl
        chartType="bar"
        data={ROWS}
        xAxisKey="status"
        series={[{ dataKey: 'est_hours' }]}
        isAnimationActive={false}
      />,
    );
    expect(refusal(container)).toBeNull();
    expect(container.querySelector('[data-chart-error]')).toBeNull();
    expect(container.querySelectorAll('.recharts-rectangle')).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('says nothing about an undeclared chart with no rows to plot at all', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Same rows.length > 0 precondition as the computed-and-empty arm: the empty
    // RESULT is the chart's own empty state, not an authoring mistake.
    const { container } = render(
      <AdvancedChartImpl chartType="bar" data={[]} xAxisKey="status" isAnimationActive={false} />,
    );
    expect(refusal(container)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
