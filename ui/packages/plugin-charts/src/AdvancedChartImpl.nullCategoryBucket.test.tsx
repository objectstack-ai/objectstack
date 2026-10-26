/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#4466 — a NULL-keyed group renders as an explicit bucket, at the DOM.
 *
 * The defect was proven at two levels, so it is pinned at two levels. The unit
 * half lives in `packages/core/src/utils/chart-series.nullCategory.test.ts`;
 * this half renders the SAME composition both consumers perform — the shared
 * `buildChartSeries` transform feeding `AdvancedChartImpl` — and counts the
 * marks recharts actually draws.
 *
 * Measured on the shipped first-boot state of the built-in System Overview
 * board ("Events by User", every seeded `sys_audit_log` row written with
 * `user_id = NULL`): `.recharts-bar` = 1, `.recharts-bar-rectangle` = 0 — axes,
 * gridlines and the axis label with no marks and no empty state. The partial
 * case is sharper still: two groups in, ONE bar out, the dominant (null-keyed)
 * group silently dropped while the y-axis scale still accommodated it.
 *
 * The framework#4033 guard's half of the division is pinned here too: rows that
 * lack the category key entirely still reach the explanatory placeholder. Key
 * absent → that path; key present with a null value → this bucket.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
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

afterEach(cleanup);

/** The card's case 3 — the sharpest: the dropped group is the DOMINANT one. */
const PARTIAL = [
  { user_id: null, event_count: 51 },
  { user_id: 'Dev Admin', event_count: 2 },
];

/** The card's case 1/2 — the organic first-boot seed state. */
const ALL_NULL = [{ user_id: null, event_count: 50 }];

/** Render exactly what a dataset-bound chart renders: the shared transform's output. */
const renderDataset = (rows: Array<Record<string, unknown>>) => {
  const { data, xAxisKey, series } = buildChartSeries(rows, ['user_id'], ['event_count']);
  return render(
    <AdvancedChartImpl
      chartType="bar"
      data={data as any}
      xAxisKey={xAxisKey}
      series={series as any}
      isAnimationActive={false}
    />,
  );
};

const barCount = (container: HTMLElement) =>
  container.querySelectorAll('.recharts-bar-rectangle').length;

/**
 * Every string recharts painted. Deliberately NOT `.recharts-xAxis text`:
 * recharts 3 draws tick labels in their own z-index layer rather than inside
 * the axis group, so that selector reports `[]` for a chart with a perfectly
 * good axis (measured — it is what `AdvancedChartImpl.specConfig.test.tsx`
 * works around too).
 */
const chartTexts = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('text')).map((t) => t.textContent ?? '');

describe('AdvancedChartImpl — null-keyed group renders as a bucket (objectui#4466)', () => {
  it('draws BOTH bars for the partial case, the null one labelled and counted', () => {
    const { container } = renderDataset(PARTIAL);
    // Pre-fix this was 1: the 51-event group vanished while the axis kept its
    // scale, so the chart understated its own data without saying so.
    expect(barCount(container)).toBe(2);
    expect(chartTexts(container)).toContain(NULL_CATEGORY_LABEL);
    expect(chartTexts(container)).toContain('Dev Admin');
  });

  it('draws one labelled bar for the all-null result instead of an empty axis', () => {
    const { container } = renderDataset(ALL_NULL);
    // Pre-fix: axes and gridlines with ZERO bar rectangles and no empty state.
    expect(barCount(container)).toBe(1);
    expect(chartTexts(container)).toContain(NULL_CATEGORY_LABEL);
  });

  it('renders the caller-supplied localized label on the axis', () => {
    const { data, xAxisKey, series } = buildChartSeries(ALL_NULL, ['user_id'], ['event_count'], null, {
      nullCategoryLabel: '(未指定)',
    });
    const { container } = render(
      <AdvancedChartImpl chartType="bar" data={data as any} xAxisKey={xAxisKey} series={series as any} isAnimationActive={false} />,
    );
    expect(chartTexts(container)).toContain('(未指定)');
  });
});

describe('AdvancedChartImpl — must-not-change (objectui#4466)', () => {
  it('draws non-null groups exactly as before', () => {
    const { container } = renderDataset([
      { user_id: 'Dev Admin', event_count: 2 },
      { user_id: 'Ops', event_count: 3 },
    ]);
    expect(barCount(container)).toBe(2);
    expect(chartTexts(container)).toEqual(expect.arrayContaining(['Dev Admin', 'Ops']));
    expect(chartTexts(container)).not.toContain(NULL_CATEGORY_LABEL);
  });

  it('leaves the key-absent shape to the #4033 placeholder — not to the bucket', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { data, xAxisKey, series } = buildChartSeries([{ count: 2 }, { count: 8 }], ['issued'], ['count']);
    const { container } = render(
      <AdvancedChartImpl chartType="bar" data={data as any} xAxisKey={xAxisKey} series={series as any} isAnimationActive={false} />,
    );
    expect(container.querySelector('[data-chart-error="missing-category-key"]')).not.toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    warn.mockRestore();
  });

  it('keeps a genuinely empty result set empty — no phantom bucket bar', () => {
    const { container } = renderDataset([]);
    expect(barCount(container)).toBe(0);
    expect(chartTexts(container)).not.toContain(NULL_CATEGORY_LABEL);
  });
});
