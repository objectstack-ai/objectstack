/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#4673 — the pivot's null SECOND-dimension group, at the DOM.
 *
 * The third sibling of `AdvancedChartImpl.nullCategoryBucket.test.tsx`
 * (objectui#4466, single dimension) and `AdvancedChartImpl.pivotNullBucket.
 * test.tsx` (objectui#4497, the pivot's FIRST dimension). All three render the
 * composition the two consumers actually perform — the shared
 * `buildChartSeries` transform feeding `AdvancedChartImpl` — and COUNT THE
 * MARKS, because none of these defects is visible in the transform's return
 * value alone.
 *
 * This one needs the DOM for a second reason the other two did not. The card's
 * constraint is that a series key is also a renderer `dataKey`, so the fix had
 * to choose keys a chart library will actually bind to — and the empty-string
 * group's key is `''`, which is falsy. Whether recharts binds `dataKey=""` at
 * all is a fact about recharts, not about our transform, and asserting it in a
 * pure test would be asserting our own belief. Measured here instead:
 * `getValueByDataKey` routes `''` through lodash `get`, which reads the `''`
 * property, and the bar draws at its true height.
 *
 * Measured on this file's own fixture, with `pivotSeriesBuckets` reverted to
 * the `gId !== ''` gate: 1 bar rectangle for the card's two-group pivot, the
 * null group's 40 hours in the emitted row and on no mark at all. Post-fix: 2.
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

const DIMS = ['status', 'priority'];
const VALS = ['est_hours'];

/** The card's measured repro: the 40 hours belong to a null-priority group. */
const CARD_RAW = [
  { status: 'Backlog', priority: 'High', est_hours: 5 },
  { status: 'Backlog', priority: null, est_hours: 40 },
];

/** Render a pivot result exactly as `DatasetWidget` / `ObjectChart` do. */
function renderPivot(rows: Array<Record<string, unknown>>) {
  const { data, xAxisKey, series } = buildChartSeries(rows, DIMS, VALS);
  const { container } = render(
    <AdvancedChartImpl
      chartType="bar"
      data={data as any}
      xAxisKey={xAxisKey}
      series={series as any}
      isAnimationActive={false}
    />,
  );
  return { container, data, series };
}

/** One drawn bar per series, in series order, with the height recharts gave it. */
function barHeights(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('.recharts-bar')).map((group) => {
    const rect = group.querySelector('.recharts-rectangle');
    return Number(rect?.getAttribute('height') ?? NaN);
  });
}

describe('AdvancedChartImpl — a null second-dimension group is drawn (objectui#4673)', () => {
  it('draws the card’s 40-hour bar instead of carrying the number invisibly', () => {
    const { container, series } = renderPivot(CARD_RAW);

    expect(series.map((s) => s.dataKey)).toEqual(['High', NULL_CATEGORY_LABEL]);
    // Pre-fix: 1. The 40 was in `data` under `''` and no series bound to it.
    expect(container.querySelectorAll('.recharts-rectangle')).toHaveLength(2);

    // …and it is drawn for its OWN value, not as a zero-height placeholder:
    // 40 is eight times 5, and so is its bar.
    const [high, none] = barHeights(container);
    expect(high).toBeGreaterThan(0);
    expect(none / high).toBeCloseTo(8, 5);
  });

  it('binds the empty-string group’s falsy dataKey — measured, not assumed', () => {
    // `''` is the key the empty-string group paints under (objectui#4508 ruled
    // it a different group from null), and a falsy `dataKey` is exactly the
    // kind of thing a chart library quietly ignores. It does not: the bar draws
    // and reads its own column.
    const { container, data, series } = renderPivot([
      { status: 'Backlog', priority: '', est_hours: 40 },
      { status: 'Backlog', priority: 'High', est_hours: 5 },
    ]);
    expect(series.map((s) => s.dataKey)).toEqual(['', 'High']);
    expect(data).toEqual([{ status: 'Backlog', '': 40, High: 5 }]);

    expect(container.querySelectorAll('.recharts-rectangle')).toHaveLength(2);
    const [empty, high] = barHeights(container);
    expect(empty / high).toBeCloseTo(8, 5);
  });

  it('draws BOTH the null and the empty-string group — two facts, two bars', () => {
    const { container, series } = renderPivot([
      { status: 'Backlog', priority: null, est_hours: 40 },
      { status: 'Backlog', priority: '', est_hours: 5 },
    ]);
    expect(series.map((s) => s.dataKey)).toEqual([NULL_CATEGORY_LABEL, '']);
    // Pre-fix: 0 bars for two real groups — both gated out of `seriesKeys`,
    // and both writing their measure to the same `''` column on the way out,
    // so one of the two numbers did not even survive the transform.
    expect(container.querySelectorAll('.recharts-rectangle')).toHaveLength(2);
    const [none, empty] = barHeights(container);
    expect(none / empty).toBeCloseTo(8, 5);
  });

  it('leaves an ordinary pivot drawing exactly what it drew before', () => {
    const { container, series } = renderPivot([
      { status: 'Backlog', priority: 'High', est_hours: 5 },
      { status: 'Done', priority: 'Low', est_hours: 3 },
    ]);
    expect(series.map((s) => s.dataKey)).toEqual(['High', 'Low']);
    // Two series over two x-buckets, each series drawing only where it has a
    // value: recharts renders a rect per (series, bucket) pair it can read.
    expect(container.querySelectorAll('.recharts-bar')).toHaveLength(2);
  });
});
