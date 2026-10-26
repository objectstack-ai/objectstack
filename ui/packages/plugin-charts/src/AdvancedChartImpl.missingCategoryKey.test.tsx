/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Unreadable-data guard (framework#4033).
 *
 * Rows that carry the measures but NOT the category key used to render an axis
 * frame with ZERO marks: no throw, no console warning, no legend. Measured, not
 * assumed — `data: [{count:2},{count:8}]` with `xAxisKey="issued"` produced an
 * `<svg>` containing only the Y tick text `"02468"` and `0` bar rectangles.
 *
 * That is indistinguishable from "the query matched nothing", and it is the
 * wrong conclusion: framework#4033's analytics bucket was grouped by but never
 * projected, so trend widgets drew nothing while the numbers were right the
 * whole time. framework#3701 was the same shape one layer over (a fieldless
 * count keyed its value `undefined` and "the chart plotted nothing"). Twice is
 * a pattern; the chart now says so instead of failing silently a third time.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render as rtlRender, cleanup, type RenderOptions } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

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

/** The #4033 shape: measures present, category key never projected. */
const UNREADABLE = [{ count: 2 }, { count: 8 }];
const READABLE = [
  { issued: '2026-01', count: 2 },
  { issued: '2026-02', count: 8 },
];
const SERIES = [{ dataKey: 'count', label: 'Count' }];

const renderChart = (props: Record<string, unknown>) =>
  render(<AdvancedChartImpl series={SERIES as any} {...(props as any)} />);

describe('AdvancedChartImpl — unreadable-data guard (framework#4033)', () => {
  it('explains itself instead of drawing an empty axis', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = renderChart({
      chartType: 'bar', data: UNREADABLE, xAxisKey: 'issued',
    });

    const placeholder = container.querySelector('[data-chart-error="missing-category-key"]');
    expect(placeholder, 'renders the explanatory placeholder').not.toBeNull();
    expect(placeholder?.textContent).toContain('issued');
    // The old behaviour: an <svg> axis frame with no marks. Anything that still
    // paints a plot here would be the silent failure this guard replaces.
    expect(container.querySelector('svg')).toBeNull();
    warn.mockRestore();
  });

  it('warns once, naming both the expected key and the keys actually present', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderChart({ chartType: 'bar', data: UNREADABLE, xAxisKey: 'issued' });

    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0]?.[0] ?? '');
    // Both halves of the mismatch — without the pair the author is left diffing
    // a dataset against a chart spec by hand.
    expect(msg).toContain('issued');
    expect(msg).toContain('count');
    warn.mockRestore();
  });

  it('stays out of the way when the category key IS present', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = renderChart({
      chartType: 'bar', data: READABLE, xAxisKey: 'issued',
    });

    expect(container.querySelector('[data-chart-error="missing-category-key"]')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.textContent).toContain('2026-01');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('treats a present-but-NULL bucket as real data, not as breakage', () => {
    // A grouped query legitimately buckets rows whose dimension is empty. The
    // key is projected, the value is null — testing `== null` instead of
    // `key in row` would have condemned a working chart.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = renderChart({
      chartType: 'bar',
      data: [{ issued: null, count: 3 }, { issued: '2026-02', count: 8 }],
      xAxisKey: 'issued',
    });

    expect(container.querySelector('[data-chart-error="missing-category-key"]')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('says nothing about an empty result set — that is a legitimate answer', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = renderChart({ chartType: 'bar', data: [], xAxisKey: 'issued' });

    expect(container.querySelector('[data-chart-error="missing-category-key"]')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('leaves scatter/treemap/sankey alone — they do not read a category axis', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const chartType of ['scatter', 'treemap', 'sankey'] as const) {
      const { container } = renderChart({ chartType, data: UNREADABLE, xAxisKey: 'issued' });
      expect(
        container.querySelector('[data-chart-error="missing-category-key"]'),
        `${chartType} must not be flagged`,
      ).toBeNull();
      cleanup();
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('guards every category-axis chart type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const chartType of ['bar', 'column', 'horizontal-bar', 'line', 'area', 'pie', 'donut', 'radar', 'funnel', 'combo'] as const) {
      const { container } = renderChart({ chartType, data: UNREADABLE, xAxisKey: 'issued' });
      expect(
        container.querySelector('[data-chart-error="missing-category-key"]'),
        `${chartType} must be flagged`,
      ).not.toBeNull();
      cleanup();
    }
    warn.mockRestore();
  });
});
