/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#4672 — the CARTESIAN click event, pinned against the payload
 * recharts 3 actually sends.
 *
 * The handler used to read `payload.activePayload[0]` for both the clicked
 * series and its value. That is a recharts 2 field: recharts 3 hands a
 * chart-level `onClick` a `MouseHandlerDataParam`, which is exactly
 * `{ activeCoordinate, activeDataKey, activeIndex, activeLabel,
 * activeTooltipIndex, isTooltipActive }` — no payload array, no row, no value.
 * So the read was `undefined` on every click, silently: the call site types the
 * payload `any`, so nothing went red, and every cartesian drill event carried
 * `series: undefined, value: undefined`.
 *
 * Nothing covered that seam. The existing drill tests either call the pure
 * lookup (`findChartSeriesRow`) directly or assert the transform, so all of
 * them stayed green while the one thing between them — what the chart library
 * hands the handler — was wrong. This file works from that payload only:
 * through a real click on a real recharts chart where the DOM can carry one,
 * and through the handler the component hands recharts where it cannot.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import {
  buildChartSeries,
  CHART_BUCKET_ID_KEY,
  NULL_CATEGORY_LABEL,
  type ChartSegmentClickEvent,
} from '@object-ui/core';

// The handler AdvancedChartImpl hands the recharts chart element, captured as
// the component passes it. Feeding it a payload is not a re-derivation of the
// component's logic (which is what a hand-rolled `rowAt()` helper would be) —
// it is the component's own callback, invoked the way recharts invokes it.
const seam = vi.hoisted(() => ({ onClick: undefined as undefined | ((p: any) => void) }));

vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 480, height: 320 }),
    BarChart: (props: any) => {
      seam.onClick = props.onClick;
      return React.createElement(actual.BarChart, props);
    },
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';

afterEach(() => {
  cleanup();
  seam.onClick = undefined;
});

/**
 * recharts throttles pointer moves through `requestAnimationFrame`
 * (`eventSettingsSlice`: `throttleDelay: 'raf'`), and the click reads the
 * tooltip state that move left behind. Without flushing the frame the chart
 * reports `activeTooltipIndex: null` for every click — a real browser never
 * sees that because the move lands a frame before the click.
 */
const flushFrame = async () => {
  await act(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => setTimeout(r, 0));
  });
};

const clickChartAt = async (el: Element, clientX: number, clientY: number) => {
  fireEvent.mouseMove(el, { clientX, clientY });
  await flushFrame();
  fireEvent.click(el, { clientX, clientY });
  await flushFrame();
};

const ROWS = [
  { status: 'Open', est_hours: 10 },
  { status: 'Done', est_hours: 30 },
];

describe('AdvancedChartImpl — a cartesian click reports the clicked series and value (objectui#4672)', () => {
  it('carries the series and the measure value through a REAL click on a real recharts 3 bar', async () => {
    const { data, xAxisKey, series } = buildChartSeries(ROWS, ['status'], ['est_hours']);
    // Stated rather than assumed: one measure, so one plotted series.
    expect(series.map((s: any) => s.dataKey)).toEqual(['est_hours']);

    const clicks: ChartSegmentClickEvent[] = [];
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

    const bars = container.querySelectorAll('.recharts-rectangle');
    expect(bars.length).toBe(2);
    const second = bars[1] as SVGElement;
    const x = Number(second.getAttribute('x')) + Number(second.getAttribute('width')) / 2;
    const y = Number(second.getAttribute('y')) + Number(second.getAttribute('height')) / 2;

    await clickChartAt(second, x, y);

    expect(clicks).toHaveLength(1);
    expect(clicks[0].category).toBe('Done');
    // Both of these were `undefined` for every cartesian click before this fix.
    expect(clicks[0].series).toBe('est_hours');
    expect(clicks[0].value).toBe(30);
  });

  it('reads the value off the row the index names, not off the event', async () => {
    // The same click on the FIRST bucket — the value must follow the bucket,
    // which is the whole reason it is read out of `data[activeTooltipIndex]`.
    const { data, xAxisKey, series } = buildChartSeries(ROWS, ['status'], ['est_hours']);
    const clicks: ChartSegmentClickEvent[] = [];
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
    const first = container.querySelectorAll('.recharts-rectangle')[0] as SVGElement;
    const x = Number(first.getAttribute('x')) + Number(first.getAttribute('width')) / 2;
    const y = Number(first.getAttribute('y')) + Number(first.getAttribute('height')) / 2;

    await clickChartAt(first, x, y);

    expect(clicks[0].category).toBe('Open');
    expect(clicks[0].value).toBe(10);
  });
});

/**
 * The payload arms, fed the shapes recharts 3 was MEASURED to send (recharts
 * 3.10.1, `state/externalEventsMiddleware.js` assembling the object from the
 * tooltip selectors). The per-series-cursor payload below is a verbatim capture
 * of a real click on a `Tooltip shared={false}` bar chart; the shared-cursor
 * one is a verbatim capture of the same click with the default cursor.
 */
describe('AdvancedChartImpl — the cartesian handler over the recharts 3 payload arms', () => {
  const renderPivoted = (onChartClick: (ev: ChartSegmentClickEvent) => void) => {
    // 2 dimensions, 1 measure — the pivot that ADR-0021 introduced and the
    // shape objectui#4672 reports dead: the second dimension becomes the
    // series, so the drill lookup REQUIRES the series to find its row.
    const raw = [
      { status: 'Open', priority: 'High', est_hours: 3 },
      { status: 'Open', priority: 'Low', est_hours: 5 },
      { status: 'Done', priority: 'High', est_hours: 7 },
      { status: 'Done', priority: 'Low', est_hours: 11 },
    ];
    const { data, xAxisKey, series } = buildChartSeries(raw, ['status', 'priority'], ['est_hours']);
    expect(series.map((s: any) => s.dataKey)).toEqual(['High', 'Low']);
    render(
      <AdvancedChartImpl
        chartType="bar"
        data={data as any}
        xAxisKey={xAxisKey}
        series={series as any}
        isAnimationActive={false}
        onChartClick={onChartClick}
      />,
    );
    return series;
  };

  it('takes the series from `activeDataKey` when the payload carries one', () => {
    const clicks: ChartSegmentClickEvent[] = [];
    renderPivoted((ev) => clicks.push(ev));
    expect(seam.onClick).toBeTypeOf('function');

    // Captured from a real per-series-cursor click on recharts 3.10.1. Note
    // the index arrives as a STRING — recharts dispatches `String(index)`.
    seam.onClick!({
      activeCoordinate: { x: 414.5, y: 145 },
      activeDataKey: 'Low',
      activeIndex: '1',
      activeLabel: 'Done',
      activeTooltipIndex: '1',
      isTooltipActive: true,
    });

    expect(clicks).toHaveLength(1);
    expect(clicks[0].category).toBe('Done');
    expect(clicks[0].series).toBe('Low');
    // The measure value of THAT series in THAT bucket — read off the row.
    expect(clicks[0].value).toBe(11);
  });

  /**
   * RESTATED, not relaxed, by objectui#4672's ruled half.
   *
   * This assertion was written when NO cartesian click could resolve a series
   * under the shared cursor, and it pinned the non-guessing contract for all of
   * them. The mark-level handler has since answered the case it was standing in
   * for: a click that lands ON a segment now resolves its series exactly
   * (`AdvancedChartImpl.itemSeriesClick.test.tsx`).
   *
   * What it pins is therefore NARROWER now, and still load-bearing — it is
   * objectui#4672's sub-decision 3 verbatim. Re-measured rather than assumed:
   * this case drives the chart-level handler DIRECTLY, which is precisely the
   * shape of a click that reached no mark (empty plot area, an axis label, a
   * gap between bars), so the assertion holds unchanged and now says the thing
   * the ruling requires — such a click stays category-only, and "drill the
   * whole category" was rejected as a different product question.
   *
   * The end-to-end form of the same contract, through a real DOM click on the
   * plot surface, is in the sibling file; both are kept because they fail for
   * different reasons — that one if a mark handler ever fires for a non-mark
   * target, this one if the handler itself starts guessing.
   */
  it('leaves the series unresolved when a click reached no mark — it does not guess one', () => {
    const clicks: ChartSegmentClickEvent[] = [];
    renderPivoted((ev) => clicks.push(ev));

    // The DEFAULT (shared/axis) cursor these charts render: recharts dispatches
    // axis interactions with `activeDataKey` hard-coded `undefined`, so the
    // payload names no series at all — and no mark claimed this gesture.
    seam.onClick!({
      activeCoordinate: { x: 372.5, y: 200 },
      activeDataKey: undefined,
      activeIndex: '1',
      activeLabel: 'Done',
      activeTooltipIndex: '1',
      isTooltipActive: true,
    });

    expect(clicks).toHaveLength(1);
    // What IS known is still reported...
    expect(clicks[0].category).toBe('Done');
    // ...and the series is left open rather than filled with series[0], which
    // would drill to another group's records — a WRONG drill, worse than the
    // dead one.
    expect(clicks[0].series).toBeUndefined();
    expect(clicks[0].seriesLabel).toBeUndefined();
    expect(clicks[0].value).toBeUndefined();
  });

  it('resolves no row at all when no tick is active, rather than bucket zero', () => {
    // The fixture is the objectui#4508 collision — a stored value that spells
    // the null bucket's label, beside a genuine null — because those are the
    // buckets that carry an IDENTITY. That is what makes this assertion able to
    // fail: over ordinary buckets, "bucket zero" and "no bucket" both report no
    // identity, so a wrong row would pass unnoticed.
    const { data, xAxisKey, series } = buildChartSeries(
      [
        { status: NULL_CATEGORY_LABEL, est_hours: 1 },
        { status: null, est_hours: 2 },
      ],
      ['status'],
      ['est_hours'],
    );
    expect((data[0] as any)[CHART_BUCKET_ID_KEY]).toBe('["(None)"]');

    const clicks: ChartSegmentClickEvent[] = [];
    render(
      <AdvancedChartImpl
        chartType="bar"
        data={data as any}
        xAxisKey={xAxisKey}
        series={series as any}
        isAnimationActive={false}
        onChartClick={(ev) => clicks.push(ev)}
      />,
    );

    // A click on the plot margins / an axis label. recharts reports a NULL
    // index here, not an absent one — and `Number(null)` is 0, so a bare
    // `Number()` read resolves this to the FIRST bucket and drills records the
    // user never clicked.
    seam.onClick!({
      activeCoordinate: undefined,
      activeDataKey: undefined,
      activeIndex: null,
      activeLabel: undefined,
      activeTooltipIndex: null,
      isTooltipActive: false,
    });

    expect(clicks).toHaveLength(1);
    expect(clicks[0].category).toBeUndefined();
    expect(clicks[0].categoryId).toBeUndefined();
    expect(clicks[0].value).toBeUndefined();
  });
});

/**
 * The measurement the open half rests on, kept executable.
 *
 * This one drives recharts DIRECTLY — no ObjectUI component in the way — so it
 * pins a fact about the library rather than about our handler: under the
 * shared (axis) cursor, a multi-series cartesian click reports an index and a
 * label but NO `activeDataKey`. That is why the pivoted drill cannot be
 * resolved from this payload, and it is the premise to re-measure when recharts
 * is upgraded.
 *
 * Still true and still the reason the mark-level handler exists
 * (objectui#4672's ruled Option A): the series is resolved from the mark that
 * was clicked, never from this payload. If a future recharts starts populating
 * `activeDataKey` for axis interactions, this test goes red and the fallback
 * arm above becomes reachable again — which is the outcome to notice, not to
 * paper over.
 */
describe('recharts 3 — what a shared-cursor cartesian click actually reports', () => {
  it('reports an index and a label, and no series key', async () => {
    const payloads: any[] = [];
    const { container } = render(
      <BarChart
        width={480}
        height={320}
        data={[
          { name: 'Open', a: 10, b: 20 },
          { name: 'Done', a: 30, b: 40 },
        ]}
        onClick={(p: any) => payloads.push(p)}
      >
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip />
        <Bar dataKey="a" isAnimationActive={false} />
        <Bar dataKey="b" isAnimationActive={false} />
      </BarChart>,
    );
    // The last rectangle is series `b` of the second category — a click landing
    // squarely on one series' mark, not on shared empty space.
    const rects = container.querySelectorAll('.recharts-rectangle');
    const target = rects[rects.length - 1] as SVGElement;
    const x = Number(target.getAttribute('x')) + Number(target.getAttribute('width')) / 2;
    await clickChartAt(target, x, 200);

    expect(payloads).toHaveLength(1);
    expect(payloads[0].activeLabel).toBe('Done');
    expect(String(payloads[0].activeTooltipIndex)).toBe('1');
    // Even though the click landed on series `b`'s bar.
    expect(payloads[0].activeDataKey).toBeUndefined();
    // And the recharts 2 field the handler used to read is gone entirely.
    expect(payloads[0].activePayload).toBeUndefined();
  });
});
