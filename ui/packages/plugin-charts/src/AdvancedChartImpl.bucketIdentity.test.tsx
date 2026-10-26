/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#4508 — the bucket IDENTITY reaches a drill handler, at the DOM.
 *
 * `chart-series.nullCategory.test.ts` pins the transform's two halves (writes
 * the identity, reads it back). Neither half is worth anything unless the
 * identity actually survives the trip through the chart library, and that trip
 * is exactly where a plausible-looking design fails silently: recharts hands a
 * PIE sector click a `payload` it built as `{...row, ...cellProps}` — a spread
 * copy — so a symbol key or a non-enumerable property would arrive as "this
 * bucket has no identity", the drill would fall back to the shared axis text,
 * and every assertion in the pure tests would still be green.
 *
 * So this file clicks a real sector and reads what the handler was given.
 *
 * A pie sector's `onClick` is an ordinary DOM handler on the `<path>`, which is
 * why a real click is simulated here where `AdvancedChartImpl.pivotNullBucket.
 * test.tsx` deliberately does not: the CARTESIAN click goes through recharts'
 * hit-test geometry on the container (jsdom/happy-dom report no layout, so it
 * would test the geometry rather than this seam). The cartesian arm's own
 * mechanism — reading the row out of `data` by `activeTooltipIndex` — is
 * asserted directly below instead, against the payload shape recharts
 * documents (`MouseHandlerDataParam`).
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { buildChartSeries, chartRowBucketId, NULL_CATEGORY_LABEL } from '@object-ui/core';

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
 * The collision, as a dataset: a record whose stored `status` literally spells
 * the null bucket's label, beside records that have no status at all. Two
 * groups, one axis text — the case the display string cannot name.
 */
const LITERAL_RAW = [
  { status: NULL_CATEGORY_LABEL, n: 1 },
  { status: null, n: 2 },
];

describe('AdvancedChartImpl — the clicked bucket identity reaches the handler (objectui#4508)', () => {
  it('hands a pie sector click the identity of the bucket that was clicked', () => {
    const { data, xAxisKey, series } = buildChartSeries(LITERAL_RAW, ['status'], ['n']);
    // Precondition, stated rather than assumed: both slices paint the same text.
    expect(data.map((row) => row[xAxisKey!])).toEqual([NULL_CATEGORY_LABEL, NULL_CATEGORY_LABEL]);

    const clicks: Array<{ category?: string; categoryId?: string }> = [];
    const { container } = render(
      <AdvancedChartImpl
        chartType="pie"
        data={data as any}
        xAxisKey={xAxisKey}
        series={series as any}
        isAnimationActive={false}
        onChartClick={(ev) => clicks.push(ev)}
      />,
    );

    const sectors = container.querySelectorAll('.recharts-sector');
    expect(sectors.length).toBe(2);

    fireEvent.click(sectors[1]);
    expect(clicks).toHaveLength(1);
    // The axis text alone would have named the FIRST bucket for either slice.
    expect(clicks[0].category).toBe(NULL_CATEGORY_LABEL);
    // This is the whole test: the identity survived recharts' spread copy.
    expect(clicks[0].categoryId).toBe('[null]');

    fireEvent.click(sectors[0]);
    expect(clicks[1].categoryId).toBe('["(None)"]');
  });

  it('omits the identity for a bucket whose axis text already names it', () => {
    const rows = [
      { status: 'Backlog', n: 5 },
      { status: 'Done', n: 24 },
    ];
    const { data, xAxisKey, series } = buildChartSeries(rows, ['status'], ['n']);
    const clicks: Array<{ category?: string; categoryId?: string }> = [];
    const { container } = render(
      <AdvancedChartImpl
        chartType="pie"
        data={data as any}
        xAxisKey={xAxisKey}
        series={series as any}
        isAnimationActive={false}
        onChartClick={(ev) => clicks.push(ev)}
      />,
    );
    fireEvent.click(container.querySelectorAll('.recharts-sector')[1]);
    expect(clicks[0].category).toBe('Done');
    // Nothing to disambiguate, so nothing is carried — and the lookup's display
    // match answers, exactly as it did before objectui#4508.
    expect(clicks[0].categoryId).toBeUndefined();
  });
});

/**
 * The CARTESIAN arm's mechanism, asserted where it can be asserted.
 *
 * recharts 3 hands a chart-level `onClick` a `MouseHandlerDataParam`:
 * `{ activeLabel, activeIndex, activeTooltipIndex, activeDataKey,
 * activeCoordinate, isTooltipActive }` — an INDEX into this chart's `data` and
 * no row of its own. That is why `handleCartesianClick` reads the clicked row
 * out of the `data` array it was given rather than out of the event.
 */
describe('AdvancedChartImpl — the cartesian arm reads its row by index (objectui#4508)', () => {
  it('resolves the identity of the bucket at the clicked index', () => {
    const { data, xAxisKey, series } = buildChartSeries(LITERAL_RAW, ['status'], ['n']);
    // What the component does, over the payload recharts documents. Clicking
    // the second bar reports index 1; both bars carry the same `activeLabel`.
    const rowAt = (payload: { activeTooltipIndex?: number; activeLabel?: string }) => {
      const idx = Number(payload.activeTooltipIndex);
      return Number.isInteger(idx) && idx >= 0 ? data[idx] : undefined;
    };
    expect(chartRowBucketId(rowAt({ activeTooltipIndex: 1, activeLabel: NULL_CATEGORY_LABEL })))
      .toBe('[null]');
    expect(chartRowBucketId(rowAt({ activeTooltipIndex: 0, activeLabel: NULL_CATEGORY_LABEL })))
      .toBe('["(None)"]');
    // No active tick (a click on empty plot area) resolves to no identity
    // rather than to bucket zero.
    expect(chartRowBucketId(rowAt({}))).toBeUndefined();
  });
});
