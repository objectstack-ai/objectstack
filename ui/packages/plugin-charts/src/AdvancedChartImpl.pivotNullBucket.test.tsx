/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#4497 — the MULTI-DIMENSION PIVOT branch's null bucket, at the DOM.
 *
 * The sibling of `AdvancedChartImpl.nullCategoryBucket.test.tsx` (objectui#4466),
 * which pins the same property for the single-dimension branch. Both render the
 * composition the two consumers actually perform — the shared `buildChartSeries`
 * transform feeding `AdvancedChartImpl` — and count the marks recharts draws,
 * because the defect was never visible in the transform's return value alone: a
 * `{status: null, Low: 3}` row looks like data right up until recharts is asked
 * to place it on a category axis and draws nothing.
 *
 * Measured on this file's own fixture, with the fix reverted: 1 bar rectangle
 * for a two-group pivot, the null-keyed group's bar missing while its series
 * still occupied the legend. Post-fix: 2, the second labelled with the bucket.
 *
 * The drill half is pinned here too, at the seam where a dead click would come
 * from: the axis label a user sees IS what recharts hands back as `activeLabel`
 * (see `handleCartesianClick`), so the string read off the DOM below is fed to
 * `findChartSeriesRow` exactly as `DatasetWidget.handleChartDrill` feeds the
 * click event to it. A real SVG segment click is deliberately not simulated —
 * in jsdom that tests recharts' hit-test geometry rather than this branch, the
 * same reason `ObjectChart.drillNavigate.test.tsx` mocks its click surface.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { buildChartSeries, findChartSeriesRow, NULL_CATEGORY_LABEL } from '@object-ui/core';

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

/**
 * A pivot-shaped result: 2 dimensions + 1 measure, one group's first-dimension
 * value NULL. The dataset shape behind it is ordinary — any `GROUP BY status,
 * priority` over records whose `status` was never set.
 */
const PIVOT_RAW = [
  { status: 'Backlog', priority: 'High', est_hours: 5 },
  { status: null, priority: 'Low', est_hours: 3 },
];

const DIMS = ['status', 'priority'];
const VALS = ['est_hours'];

/** Render exactly what a dataset-bound pivot chart renders. */
const renderPivot = (
  rows: Array<Record<string, unknown>>,
  options?: { nullCategoryLabel?: string },
) => {
  const { data, xAxisKey, series } = buildChartSeries(rows, DIMS, VALS, null, options);
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
 * recharts 3 draws tick labels in their own z-index layer rather than inside the
 * axis group, so that selector reports `[]` for a chart with a perfectly good
 * axis (the same workaround `AdvancedChartImpl.nullCategoryBucket.test.tsx` and
 * `AdvancedChartImpl.specConfig.test.tsx` use).
 */
const chartTexts = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('text')).map((t) => t.textContent ?? '');

describe('AdvancedChartImpl — the pivot null bucket renders (objectui#4497)', () => {
  it('draws BOTH pivot groups, the null-keyed one labelled', () => {
    const { container } = renderPivot(PIVOT_RAW);
    // Pre-fix this was 1: the null group's bar never drew, because its emitted
    // row carried the RAW null into the category axis.
    expect(barCount(container)).toBe(2);
    expect(chartTexts(container)).toContain(NULL_CATEGORY_LABEL);
    expect(chartTexts(container)).toContain('Backlog');
  });

  it('renders the caller-supplied localized label on the pivot axis', () => {
    const { container } = renderPivot(PIVOT_RAW, { nullCategoryLabel: '(未指定)' });
    expect(barCount(container)).toBe(2);
    expect(chartTexts(container)).toContain('(未指定)');
    expect(chartTexts(container)).not.toContain(NULL_CATEGORY_LABEL);
  });

  it('draws the all-null pivot instead of an axis with no marks', () => {
    const { container } = renderPivot([
      { status: null, priority: 'Low', est_hours: 3 },
      { status: null, priority: 'High', est_hours: 8 },
    ]);
    // One bucket, one bar per series — pre-fix: zero marks under a drawn axis.
    expect(barCount(container)).toBe(2);
    expect(chartTexts(container)).toContain(NULL_CATEGORY_LABEL);
  });
});

describe('AdvancedChartImpl — the pivot bucket bar keeps its drill (objectui#4497)', () => {
  it('resolves the label AS RENDERED back to the raw row it was drawn from', () => {
    const { container } = renderPivot(PIVOT_RAW);

    // Read the bucket's category off the DOM rather than asserting a constant:
    // the string the user sees is the one recharts reports as `activeLabel`,
    // and a drill is dead precisely when those two drift apart.
    const rendered = chartTexts(container).find((t) => t === NULL_CATEGORY_LABEL);
    expect(rendered).toBeDefined();

    // The pivot AGGREGATES, so the emitted rows are not index-aligned with the
    // raw ones; `DatasetWidget` drills by searching the raw rows with exactly
    // this call and indexing `drillRawRows` with the result.
    const idx = findChartSeriesRow(PIVOT_RAW, DIMS, VALS, rendered, 'Low');
    expect(idx).toBe(1);
    expect(PIVOT_RAW[idx]).toEqual({ status: null, priority: 'Low', est_hours: 3 });
  });

  it('resolves a localized bucket label the same way, when both halves get it', () => {
    const { container } = renderPivot(PIVOT_RAW, { nullCategoryLabel: '(未指定)' });
    const rendered = chartTexts(container).find((t) => t === '(未指定)');
    expect(rendered).toBeDefined();
    expect(
      findChartSeriesRow(PIVOT_RAW, DIMS, VALS, rendered, 'Low', { nullCategoryLabel: '(未指定)' }),
    ).toBe(1);
  });

  it('still drills the non-null pivot group exactly as before', () => {
    const { container } = renderPivot(PIVOT_RAW);
    const rendered = chartTexts(container).find((t) => t === 'Backlog');
    expect(rendered).toBeDefined();
    expect(findChartSeriesRow(PIVOT_RAW, DIMS, VALS, rendered, 'High')).toBe(0);
  });
});

describe('AdvancedChartImpl — pivot must-not-change (objectui#4497)', () => {
  it('draws non-null pivot groups exactly as before', () => {
    const { container } = renderPivot([
      { status: 'Backlog', priority: 'High', est_hours: 5 },
      { status: 'Done', priority: 'High', est_hours: 24 },
    ]);
    expect(barCount(container)).toBe(2);
    expect(chartTexts(container)).toEqual(expect.arrayContaining(['Backlog', 'Done']));
    expect(chartTexts(container)).not.toContain(NULL_CATEGORY_LABEL);
  });

  it('keeps a genuinely empty pivot result empty — no phantom bucket bar', () => {
    const { container } = renderPivot([]);
    expect(barCount(container)).toBe(0);
    expect(chartTexts(container)).not.toContain(NULL_CATEGORY_LABEL);
  });
});
