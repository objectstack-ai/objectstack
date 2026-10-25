/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8266, the RENDER half — what a `dataKey` naming a column the rows do
 * not carry actually draws.
 *
 * `plugin-dashboard/src/__tests__/DashboardChart.countSeriesKey-8266.test.tsx`
 * pins which column the two dashboard relays name. That is necessary and not
 * sufficient: a seam assertion cannot tell a honoured binding from an ignored
 * one, and the whole claim of that card is that the mismatch is SILENT. So this
 * file renders the real chain — `ChartRenderer` → `normalizeChartSchema` →
 * `AdvancedChartImpl` — over the rows a fieldless count actually returns, once
 * under each key, and reads the DOM.
 *
 * It lives here because `recharts` resolves inside `plugin-charts` alone, so
 * this is the only package that can mock `ResponsiveContainer` to a measured
 * box and count marks at all (the same reason
 * `plugin-dashboard/src/__tests__/DatasetWidget.chartConfig.dom.test.tsx`
 * states for its own split).
 *
 * ## Measured on `origin/main` `0fa7a9c83`, before any fix
 *
 *   dataKey 'value' (what the relays composed): surface drawn, x ticks
 *     ["open","paid"], 0 `.recharts-bar`, 0 `.recharts-rectangle`, NO
 *     `[data-chart-error]`, NO `chart-empty-state`.
 *   dataKey 'count' (the column the rows carry): 1 `.recharts-bar`,
 *     2 `.recharts-rectangle`, y ticks 0..8.
 *
 * Same rows, same harness — which is what makes the zero a statement about the
 * binding rather than about the harness. The zero arm is kept as a pin
 * deliberately: it is the reason the seam file's assertions are worth making,
 * and if a future guard DOES start refusing this shape loudly, this is the test
 * that must be re-decided rather than a silent behaviour change nobody notices.
 *
 * ## Re-decided on purpose by objectui#10396 — the zero arm now REFUSES
 *
 * That guard arrived. objectui#10396 (triage option B) gives a series key NO
 * row carries its own refusal, `missing-series-key`, naming the column — the
 * series half of `missing-category-key`. So the `'value'` arm below changed on
 * purpose, not by accident: it still draws 0 marks and still no
 * `chart-empty-state`, but the frame with the categories on it is gone and the
 * tile now says "no row has a `value` field". What the pin still guards is
 * the reason it was kept: the binding the relays compose must be `count`,
 * because `value` draws nothing — now loudly instead of silently.
 *
 * ⚠️ Mark counts are harness-bound (`ResponsiveContainer` is fixed at 480x320
 * here); they are re-derived in this file and never carried in from another.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

// Recharts measures via ResizeObserver, which reports 0x0 under the headless
// DOM, so nothing paints. Fix its size — the shim every render test in this
// package uses.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 480, height: 320 }),
  };
});

import { ChartRenderer } from './ChartRenderer';
import { aggregateRecords } from './ObjectChart';

afterEach(cleanup);

/**
 * Not transcribed — produced by the very builder the row projection uses, so a
 * change to the projected column name lands in this fixture instead of leaving
 * the pin asserting against a shape the product stopped emitting.
 */
const COUNT_ROWS = aggregateRecords(
  [
    { status: 'open' }, { status: 'open' },
    { status: 'paid' }, { status: 'paid' }, { status: 'paid' }, { status: 'paid' }, { status: 'paid' },
  ],
  { function: 'count', groupBy: 'status' },
);

const drawWith = async (dataKey: string) => {
  const { container } = render(
    <ChartRenderer
      schema={{
        chartType: 'bar',
        data: COUNT_ROWS,
        xAxisKey: 'status',
        series: [{ dataKey }],
        isAnimationActive: false,
      } as any}
    />,
  );
  // `AdvancedChartImpl` is lazy — wait for the real outcome, not the skeleton.
  // Either terminal state satisfies this, so a refusal is never mistaken for a
  // timeout and a timeout is never read as "it drew nothing".
  await waitFor(() => {
    if (!container.querySelector('.recharts-surface') && !container.querySelector('[data-chart-error]')) {
      throw new Error('neither a plot nor a refusal');
    }
  }, { timeout: 5000 });
  return {
    marks: container.querySelectorAll('.recharts-rectangle').length,
    series: container.querySelectorAll('.recharts-bar').length,
    refusal: container.querySelector('[data-chart-error]')?.getAttribute('data-chart-error') ?? null,
    refusalText: container.querySelector('[data-chart-error]')?.textContent ?? null,
    emptyState: !!screen.queryByTestId('chart-empty-state'),
    ticks: Array.from(container.querySelectorAll('.recharts-cartesian-axis-tick-value')).map((n) => n.textContent),
  };
};

describe('a fieldless count projects its value under "count" (objectui#8266)', () => {
  it('is the shape the row builder emits — the premise the rest of the file rests on', () => {
    expect(COUNT_ROWS).toEqual([
      { status: 'open', count: 2 },
      { status: 'paid', count: 5 },
    ]);
  });

  it('draws its marks when the series names that column', async () => {
    const drawn = await drawWith('count');
    expect(drawn.refusal).toBeNull();
    expect(drawn.series).toBe(1);
    expect(drawn.marks).toBe(2);
    // The values really reached an axis, so "it drew" is not just a container.
    expect(drawn.ticks).toEqual(expect.arrayContaining(['open', 'paid', '0', '2', '4']));
  });

  it('draws NOTHING when the series names "value" instead — and, since objectui#10396, SAYS so', async () => {
    const drawn = await drawWith('value');
    // The failure this card is about: not one mark…
    expect(drawn.marks).toBe(0);
    expect(drawn.series).toBe(0);
    // …which used to be SILENT, a plot frame with the categories on it and no
    // refusal (`hasNoCategoryKey` is satisfied — the rows DO have `status` —
    // and `hasNoPlottableSeries` keys on `series: []`, which this is not).
    // objectui#10396 re-decided it: the tile now names the missing column
    // instead of drawing that frame.
    expect(drawn.refusal).toBe('missing-series-key');
    expect(drawn.refusalText).toContain('no row has a value field');
    expect(drawn.ticks).toEqual([]);
    expect(drawn.emptyState).toBe(false);
  });
});
