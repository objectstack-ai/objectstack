/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#4672's ruled half — the clicked MARK identifies the series.
 *
 * The sibling file `AdvancedChartImpl.cartesianClickPayload.test.tsx` pins what
 * the chart-level (AXIS) click can answer, and measured the wall this file
 * exists to get past: recharts 3 dispatches an axis interaction with
 * `activeDataKey` hard-coded `undefined`, because the shared cursor spans every
 * series at that tick. So a PIVOTED chart — two dimensions, one measure, the
 * shape ADR-0021 introduced — could not resolve the series its drill lookup
 * requires, and every segment of every such dashboard chart was a dead click.
 *
 * The answer is the mark itself: this component renders the `Bar` / `Line` /
 * `Area`, so an item-level handler closes over the very `dataKey` it drew.
 *
 * WHAT THIS FILE ASSERTS, and why each case is here rather than in the sibling:
 *
 *  1. the headline harm, end to end — a real DOM click on a real segment of a
 *     real pivoted chart resolves through `findChartSeriesRow` to THAT group's
 *     row. Not the click event alone: the card's harm is a dead drill, so the
 *     lookup is part of the assertion;
 *  2. ONE CLICK, ONE EVENT — both handlers fire for one gesture, so the count
 *     is the contract, not an implementation detail;
 *  3. ADDITIVE — a click that lands on no mark keeps the objectui#4680 axis
 *     contract exactly, and nothing that resolved before stops resolving;
 *  4. the series key is forwarded EXACTLY, `''` included (objectui#4673's
 *     empty-string group);
 *  5. the label rides along for the drill title (objectui#4682).
 *
 * Real DOM clicks throughout, with the sibling's rAF idiom: recharts throttles
 * pointer moves through `requestAnimationFrame` and the click reads the tooltip
 * state that move left behind.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import {
  buildChartSeries,
  findChartSeriesRow,
  NULL_CATEGORY_LABEL,
  type ChartSegmentClickEvent,
} from '@object-ui/core';

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

const flushFrame = async () => {
  await act(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => setTimeout(r, 0));
  });
};

/** A real pointer gesture: the move recharts throttles, then the click. */
const clickAt = async (el: Element, clientX: number, clientY: number) => {
  fireEvent.mouseMove(el, { clientX, clientY });
  await flushFrame();
  fireEvent.click(el, { clientX, clientY });
  await flushFrame();
};

/** Click the middle of an SVG rect, addressed as the DOM element it is. */
const clickRect = async (rect: Element) => {
  const x = Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2;
  const y = Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')) / 2;
  await clickAt(rect, x, y);
};

/**
 * The rectangle series `si` drew over bucket `bi`. recharts groups marks per
 * series (`.recharts-bar`), so this addresses a segment the way a user does:
 * "the Low bar of the Done column".
 */
const segment = (container: HTMLElement, si: number, bi: number): Element => {
  const group = container.querySelectorAll('.recharts-bar')[si];
  expect(group, `series group ${si}`).toBeTruthy();
  const rect = group.querySelectorAll('.recharts-rectangle')[bi];
  expect(rect, `bucket ${bi} of series ${si}`).toBeTruthy();
  return rect;
};

/** The pivot the card reports dead: 2 dimensions, 1 measure. */
const PIVOT_RAW = [
  { status: 'Open', priority: 'High', est_hours: 3 },
  { status: 'Open', priority: 'Low', est_hours: 5 },
  { status: 'Done', priority: 'High', est_hours: 7 },
  { status: 'Done', priority: 'Low', est_hours: 11 },
];
const DIMS = ['status', 'priority'];
const VALS = ['est_hours'];

function renderChart(
  raw: Array<Record<string, unknown>>,
  onChartClick: (ev: ChartSegmentClickEvent) => void,
  chartType: 'bar' | 'line' | 'area' = 'bar',
) {
  const { data, xAxisKey, series } = buildChartSeries(raw, DIMS, VALS);
  const { container } = render(
    <AdvancedChartImpl
      chartType={chartType}
      data={data as any}
      xAxisKey={xAxisKey}
      series={series as any}
      isAnimationActive={false}
      onChartClick={onChartClick}
    />,
  );
  return { container, data, series };
}

describe('AdvancedChartImpl — a clicked MARK identifies its series (objectui#4672)', () => {
  it('resolves the pivoted drill end to end — the card’s dead click, alive', async () => {
    const clicks: ChartSegmentClickEvent[] = [];
    const { container, series } = renderChart(PIVOT_RAW, (ev) => clicks.push(ev));
    // Stated, not assumed: the second dimension became the series axis.
    expect(series.map((s) => s.dataKey)).toEqual(['High', 'Low']);

    // The Low segment of the Done column — 11 hours.
    await clickRect(segment(container, 1, 1));

    expect(clicks).toHaveLength(1);
    expect(clicks[0].category).toBe('Done');
    // Pre-fix this was `undefined` for EVERY multi-series cartesian click: the
    // shared cursor names no series, so the payload could not answer.
    expect(clicks[0].series).toBe('Low');
    expect(clicks[0].value).toBe(11);

    // The harm the card actually reports is the DRILL, so the lookup is part
    // of the assertion. Pre-fix this returned -1 and the drawer never opened.
    const idx = findChartSeriesRow(
      PIVOT_RAW,
      DIMS,
      VALS,
      clicks[0].category,
      clicks[0].series,
      { bucketId: clicks[0].categoryId },
    );
    expect(idx).toBe(3);
    expect(PIVOT_RAW[idx]).toEqual({ status: 'Done', priority: 'Low', est_hours: 11 });
  });

  it('resolves each segment to ITS OWN group, not to a shared answer', async () => {
    // Four segments, four different rows. A fix that guessed (series[0], say)
    // would pass the case above and fail here — which is the point of it.
    const clicks: ChartSegmentClickEvent[] = [];
    const { container } = renderChart(PIVOT_RAW, (ev) => clicks.push(ev));

    for (const [si, bi] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      await clickRect(segment(container, si, bi));
    }

    expect(clicks.map((c) => [c.category, c.series, c.value])).toEqual([
      ['Open', 'High', 3],
      ['Open', 'Low', 5],
      ['Done', 'High', 7],
      ['Done', 'Low', 11],
    ]);
    expect(
      clicks.map((c) => findChartSeriesRow(PIVOT_RAW, DIMS, VALS, c.category, c.series, { bucketId: c.categoryId })),
    ).toEqual([0, 1, 2, 3]);
  });

  it('emits exactly ONE event for one gesture — the item does not double-fire', async () => {
    // Both handlers run for a mark click (measured: item first, chart second),
    // so "one click, one drill event" is a contract this pins rather than an
    // incidental property. A second event here would open the drawer twice, or
    // open it on the series-less axis answer that arrives after the good one.
    const clicks: ChartSegmentClickEvent[] = [];
    const { container } = renderChart(PIVOT_RAW, (ev) => clicks.push(ev));

    await clickRect(segment(container, 1, 1));

    expect(clicks).toHaveLength(1);
  });

  it('carries the series through a line chart’s dot={false} stroke', async () => {
    // Premise C, measured: these lines render no dots, so the stroke is the
    // only mark there is. Clicking it now names the series exactly — a gain
    // over the axis answer, which for a multi-series line named none.
    const clicks: ChartSegmentClickEvent[] = [];
    const { container } = renderChart(PIVOT_RAW, (ev) => clicks.push(ev), 'line');

    const curves = container.querySelectorAll('.recharts-line-curve');
    expect(curves).toHaveLength(2);
    await clickAt(curves[1], 300, 120);

    expect(clicks).toHaveLength(1);
    expect(clicks[0].series).toBe('Low');
  });

  it('carries the series through an area chart’s filled mark', async () => {
    const clicks: ChartSegmentClickEvent[] = [];
    const { container } = renderChart(PIVOT_RAW, (ev) => clicks.push(ev), 'area');

    const areas = container.querySelectorAll('.recharts-area-area');
    expect(areas).toHaveLength(2);
    await clickAt(areas[1], 300, 200);

    expect(clicks).toHaveLength(1);
    expect(clicks[0].series).toBe('Low');
  });
});

describe('AdvancedChartImpl — the mark handler is ADDITIVE (objectui#4672, sub-decision 2/3)', () => {
  it('leaves a click on NO mark at objectui#4680’s contract — series unresolved', async () => {
    // The empty plot area, addressed as the DOM does it: the event's target is
    // the plot surface, not a mark, so no item handler runs. objectui#4680's
    // ruling is kept VERBATIM here — category-only, series open, and no
    // "drill the whole category" semantics invented.
    const clicks: ChartSegmentClickEvent[] = [];
    const { container } = renderChart(PIVOT_RAW, (ev) => clicks.push(ev));
    const surface = container.querySelector('.recharts-surface')!;

    await clickAt(surface, 200, 30);

    expect(clicks).toHaveLength(1);
    expect(clicks[0].series).toBeUndefined();
    expect(clicks[0].seriesLabel).toBeUndefined();
  });

  it('does not let a mark’s answer leak into the NEXT click', async () => {
    // The staleness question a flag-and-timeout mechanism gets wrong: the two
    // handlers are paired by the DOM event object they share, so a record left
    // by one gesture can never be adopted by another. Click a segment, then
    // click empty space — the second click must resolve nothing.
    const clicks: ChartSegmentClickEvent[] = [];
    const { container } = renderChart(PIVOT_RAW, (ev) => clicks.push(ev));

    await clickRect(segment(container, 1, 1));
    await clickAt(container.querySelector('.recharts-surface')!, 200, 30);

    expect(clicks).toHaveLength(2);
    expect(clicks[0].series).toBe('Low');
    expect(clicks[1].series).toBeUndefined();
  });

  it('keeps the single-series chart resolving from the axis, mark or no mark', async () => {
    // objectui#4680's other arm: one plotted series, so the clicked column can
    // belong to nothing else. It must keep answering for clicks that reach no
    // mark at all — "nothing that resolves today stops resolving".
    const clicks: ChartSegmentClickEvent[] = [];
    const { data, xAxisKey, series } = buildChartSeries(
      [
        { status: 'Open', est_hours: 10 },
        { status: 'Done', est_hours: 30 },
      ],
      ['status'],
      ['est_hours'],
    );
    expect(series.map((s) => s.dataKey)).toEqual(['est_hours']);
    const { container } = render(
      <AdvancedChartImpl
        chartType="bar"
        data={data as any}
        xAxisKey={xAxisKey}
        series={series as any}
        isAnimationActive={false}
        onChartClick={(ev) => clicks.push(ev)}
      />,
    );

    await clickAt(container.querySelector('.recharts-surface')!, 380, 40);

    expect(clicks).toHaveLength(1);
    expect(clicks[0].series).toBe('est_hours');
  });
});

describe('AdvancedChartImpl — the series key is forwarded exactly (objectui#4673)', () => {
  it('sends the empty-string group’s own key, not an absent one', async () => {
    // `''` is a real group with a real bar since objectui#4673, and it is
    // FALSY. A truthiness test on the way out would send `series: undefined`
    // and leave this bar's drill standing on the reader's coercion rather than
    // on what was clicked. Forwarded as itself, it resolves by design.
    const raw = [
      { status: 'Backlog', priority: '', est_hours: 40 },
      { status: 'Backlog', priority: 'High', est_hours: 5 },
    ];
    const clicks: ChartSegmentClickEvent[] = [];
    const { container, series } = renderChart(raw, (ev) => clicks.push(ev));
    expect(series.map((s) => s.dataKey)).toEqual(['', 'High']);

    await clickRect(segment(container, 0, 0));

    expect(clicks).toHaveLength(1);
    expect(clicks[0].series).toBe('');
    expect(clicks[0].value).toBe(40);
    // …and it lands on the empty-string group's OWN row.
    expect(
      findChartSeriesRow(raw, DIMS, VALS, clicks[0].category, clicks[0].series, {
        bucketId: clicks[0].categoryId,
      }),
    ).toBe(0);
  });
});

describe('AdvancedChartImpl — the clicked series carries its LABEL (objectui#4682)', () => {
  it('sends the identity KEY for the lookup and the readable LABEL beside it', async () => {
    // objectui#4508's collision on the series axis: a stored value spelling the
    // null bucket's label, beside a genuine null. Neither group's label can
    // name it, so both key by identity — and the key is exactly what must NOT
    // be shown to a user.
    const raw = [
      { status: 'Backlog', priority: NULL_CATEGORY_LABEL, est_hours: 1 },
      { status: 'Backlog', priority: null, est_hours: 2 },
    ];
    const clicks: ChartSegmentClickEvent[] = [];
    const { container, series } = renderChart(raw, (ev) => clicks.push(ev));
    expect(series).toEqual([
      { dataKey: '["(None)"]', label: NULL_CATEGORY_LABEL },
      { dataKey: '[null]', label: NULL_CATEGORY_LABEL },
    ]);

    await clickRect(segment(container, 1, 0));

    expect(clicks).toHaveLength(1);
    // The KEY stays the lookup's answer — it is what resolves the right rows…
    expect(clicks[0].series).toBe('[null]');
    expect(
      findChartSeriesRow(raw, DIMS, VALS, clicks[0].category, clicks[0].series, {
        bucketId: clicks[0].categoryId,
      }),
    ).toBe(1);
    // …and the LABEL travels beside it, which is all a title may read.
    expect(clicks[0].seriesLabel).toBe(NULL_CATEGORY_LABEL);
  });

  it('mirrors the key for an ordinary group, so ordinary titles are unchanged', async () => {
    const clicks: ChartSegmentClickEvent[] = [];
    const { container } = renderChart(PIVOT_RAW, (ev) => clicks.push(ev));

    await clickRect(segment(container, 1, 1));

    expect(clicks[0].series).toBe('Low');
    expect(clicks[0].seriesLabel).toBe('Low');
  });
});
