/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8269, the RENDER half — what a category binding naming a column the
 * rows do not carry actually draws, and what the fixed binding draws instead.
 *
 * `plugin-dashboard/src/__tests__/DashboardChart.categoryAxisKey-8269.test.tsx`
 * pins which column the two dashboard relays name. That is necessary and not
 * sufficient: the card's own bar is that "a widget that renders a refusal today
 * would start drawing, so it needs a render measurement, not only a seam
 * assertion". So this file renders the real chain — `ChartRenderer` →
 * `normalizeChartSchema` → `AdvancedChartImpl` — over the rows a fieldless
 * count actually returns, and reads the DOM.
 *
 * It lives here for the reason the objectui#8266 twin states: `recharts`
 * resolves inside `plugin-charts` alone, so this is the only package that can
 * mock `ResponsiveContainer` to a measured box and count marks at all.
 * (Re-verified rather than inherited: `require.resolve('recharts')` from
 * `packages/plugin-dashboard` is MODULE_NOT_FOUND.)
 *
 * ## The baseline this reproduces, measured on `origin/main` `3c6394cb2`
 *
 * Rows `[{status:'open',count:2},{status:'paid',count:5}]`, `ChartRenderer` at
 * 480x320:
 *
 *   xAxisKey 'status' + dataKey 'value' -> surface, ticks open/paid, 0 marks,
 *     no refusal                                        (that is objectui#8266)
 *   xAxisKey 'status' + dataKey 'count' -> 2 marks, y ticks 0..8
 *                                                 (objectui#8266, after PR 8272)
 *   xAxisKey 'name'   + dataKey 'value' -> refusal `missing-category-key`
 *   xAxisKey 'name'   + dataKey 'count' -> refusal `missing-category-key`
 *
 * The LAST row is this card: the binding both relays composed for a
 * `groupBy`-only widget, AFTER objectui#8266's fix had already corrected the
 * measure. It is the one the second block below shows changing.
 *
 * ## Re-decided on purpose by objectui#10396 — the FIRST row now refuses
 *
 * The table above is the baseline as measured then, kept as history. Since
 * objectui#10396 (triage option B), `status` + `value` no longer draws a silent
 * frame: a series key NO row carries gets its own refusal,
 * `missing-series-key`, naming the column. The `status/value` case below was
 * rewritten for that, on purpose. The `name/value` case did NOT change, and
 * that is now a precedence pin as well: with BOTH keys missing,
 * `missing-category-key` wins, because a chart with no category axis is the
 * more fundamental failure.
 *
 * ⚠️ Mark counts are harness-bound (`ResponsiveContainer` is fixed at 480x320
 * here); they are re-derived in this file and never carried in from another.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// `ChartRenderer` reaches the component under test through
// `React.lazy(() => import('./AdvancedChartImpl'))`. Importing the SAME
// specifier at module scope puts that load in the import phase, where no test
// or hook timeout applies (AGENTS.md, the flaky-test rule): under a saturated
// transform pipeline a first dynamic import can spend most of a `waitFor`
// budget, and this file's assertions would then be racing the module loader.
import './AdvancedChartImpl';
import { ChartRenderer } from './ChartRenderer';
import { ObjectChart, aggregateRecords } from './ObjectChart';
import { chartCategoryKey, chartMeasureKey } from '@object-ui/core';

afterEach(cleanup);

/**
 * Not transcribed — produced by the very builder the row projection uses, so a
 * change to the projected column names lands in this fixture instead of leaving
 * the pin asserting against a shape the product stopped emitting.
 */
const COUNT_ROWS = aggregateRecords(
  [
    { status: 'open' }, { status: 'open' },
    { status: 'paid' }, { status: 'paid' }, { status: 'paid' }, { status: 'paid' }, { status: 'paid' },
  ],
  { function: 'count', groupBy: 'status' },
);

/** The aggregate the card's widget declares — its category named ONCE, as groupBy. */
const AGGREGATE = { function: 'count', groupBy: 'status' } as const;

/** The two literal floors the relays used to bind unconditionally. */
const CATEGORY_FLOOR = 'name';
const MEASURE_FLOOR = 'value';

const readChart = (container: HTMLElement) => ({
  marks: container.querySelectorAll('.recharts-rectangle').length,
  series: container.querySelectorAll('.recharts-bar').length,
  refusal: container.querySelector('[data-chart-error]')?.getAttribute('data-chart-error') ?? null,
  refusalText: container.querySelector('[data-chart-error]')?.textContent ?? null,
  emptyState: !!screen.queryByTestId('chart-empty-state'),
  ticks: Array.from(container.querySelectorAll('.recharts-cartesian-axis-tick-value')).map((n) => n.textContent),
});

/**
 * Wait for a TERMINAL state — a plot or a refusal. Either satisfies it, so a
 * refusal is never mistaken for a timeout and a timeout is never read as "it
 * drew nothing".
 */
const settleChart = async (container: HTMLElement) => {
  await waitFor(() => {
    if (!container.querySelector('.recharts-surface') && !container.querySelector('[data-chart-error]')) {
      throw new Error('neither a plot nor a refusal');
    }
  }, { timeout: 5000 });
  return readChart(container);
};

const drawWith = async (xAxisKey: string, dataKey: string) => {
  const { container } = render(
    <ChartRenderer
      schema={{
        chartType: 'bar',
        data: COUNT_ROWS,
        xAxisKey,
        series: [{ dataKey }],
        isAnimationActive: false,
      } as any}
    />,
  );
  return settleChart(container);
};

describe('the cardized baseline: which (xAxisKey, dataKey) pairs draw (objectui#8269)', () => {
  it('is the shape the row builder emits — the premise the rest of the file rests on', () => {
    expect(COUNT_ROWS).toEqual([
      { status: 'open', count: 2 },
      { status: 'paid', count: 5 },
    ]);
  });

  it('status/count — the only pair that draws', async () => {
    const drawn = await drawWith('status', 'count');
    expect(drawn.refusal).toBeNull();
    expect(drawn.series).toBe(1);
    expect(drawn.marks).toBe(2);
    expect(drawn.ticks).toEqual(expect.arrayContaining(['open', 'paid', '0', '2', '4']));
  });

  it('status/value — objectui#8266: nothing drawn, and since objectui#10396 the missing column is named', async () => {
    // Was a silent frame with the categories on it (ticks open/paid, no
    // refusal); re-decided by objectui#10396, see the file header.
    const drawn = await drawWith('status', MEASURE_FLOOR);
    expect(drawn.marks).toBe(0);
    expect(drawn.refusal).toBe('missing-series-key');
    expect(drawn.refusalText).toContain(`no row has a ${MEASURE_FLOOR} field`);
    // The category key IS carried, so the category refusal must not claim it.
    expect(drawn.refusalText).not.toContain('status');
    expect(drawn.ticks).toEqual([]);
    expect(drawn.emptyState).toBe(false);
  });

  // With `value` both keys are missing: `missing-category-key` wins over
  // objectui#10396's `missing-series-key` (precedence, see the file header).
  it.each([MEASURE_FLOOR, 'count'])(
    'name/%s — refused, and the message names the key the author never wrote',
    async (dataKey) => {
      const drawn = await drawWith(CATEGORY_FLOOR, dataKey);
      expect(drawn.refusal).toBe('missing-category-key');
      // The wrong-CAUSE half of the defect: `name` is named, `status` is not.
      expect(drawn.refusalText).toContain(CATEGORY_FLOOR);
      expect(drawn.refusalText).not.toContain('status');
      expect(drawn.marks).toBe(0);
    },
  );
});

describe('the binding the relays compose now draws (objectui#8269)', () => {
  // Computed by the very seam the relays call, not transcribed: if
  // `chartCategoryKey` stops answering for this aggregate, this file measures
  // the binding that actually ships rather than a stale copy of it.
  const composedCategory = chartCategoryKey(AGGREGATE, CATEGORY_FLOOR);
  const composedMeasure = chartMeasureKey(AGGREGATE, MEASURE_FLOOR);

  it('resolves the pair away from BOTH literal floors', () => {
    expect(composedCategory).toBe('status');
    expect(composedMeasure).toBe('count');
  });

  it('draws marks where the pre-fix binding rendered a refusal', async () => {
    // Before: (name, count) — the last row of the baseline table, a refusal.
    const before = await drawWith(CATEGORY_FLOOR, composedMeasure);
    expect(before.refusal).toBe('missing-category-key');
    expect(before.marks).toBe(0);

    cleanup();

    // After: the pair the relays compose today.
    const after = await drawWith(composedCategory, composedMeasure);
    expect(after.refusal).toBeNull();
    expect(after.series).toBe(1);
    expect(after.marks).toBe(2);
    expect(after.ticks).toEqual(expect.arrayContaining(['open', 'paid']));
  });
});

/**
 * The ordering question the card raises, MEASURED rather than reasoned about:
 *
 * > `resolveGroupByLabels` rewrites the groupBy column in place — check the
 * > resolved key is still valid at the point the axis reads it.
 *
 * A resolver returning the right key is worthless if a later pass renames the
 * column under it. This block runs the WHOLE `ObjectChart` fetch pipeline —
 * `runAggregate` → comparison merge → `resolveGroupByLabels` → `ChartRenderer`
 * → `AdvancedChartImpl` — against a data source whose groupBy field carries
 * picklist options, so the label pass really fires. Marks drawn UNDER
 * HUMANIZED TICKS is the two-in-one reading: the rewrite happened (the ticks
 * are the labels, not the raw enum values) AND the resolved key survived it
 * (had the column been renamed, `hasNoCategoryKey` would refuse instead).
 */
describe('the resolved key survives the groupBy label rewrite (objectui#8269)', () => {
  const OBJECT_SCHEMA = {
    fields: {
      status: {
        type: 'select',
        options: [
          { value: 'open', label: 'Open cases' },
          { value: 'paid', label: 'Paid cases' },
        ],
      },
    },
  };

  beforeEach(() => {
    // `ObjectChart` probes object metadata for option colours on the global
    // fetch. Answered from a double so the render is offline and deterministic.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws the marks with the LABELS on the axis, not a refusal', async () => {
    const dataSource = {
      aggregate: vi.fn(async () => COUNT_ROWS.map((row) => ({ ...row }))),
      getObjectSchema: vi.fn(async () => OBJECT_SCHEMA),
    };

    const { container } = render(
      <ObjectChart
        schema={{
          objectName: 'crm_case',
          chartType: 'bar',
          aggregate: { ...AGGREGATE },
          // Exactly what the relays compose for this widget.
          xAxisKey: chartCategoryKey(AGGREGATE, CATEGORY_FLOOR),
          series: [{ dataKey: chartMeasureKey(AGGREGATE, MEASURE_FLOOR) }],
          isAnimationActive: false,
        } as any}
        dataSource={dataSource as any}
      />,
    );

    const drawn = await settleChart(container);
    expect(dataSource.getObjectSchema).toHaveBeenCalled();
    expect(drawn.refusal).toBeNull();
    expect(drawn.marks).toBe(2);
    // The label pass ran…
    expect(drawn.ticks).toEqual(expect.arrayContaining(['Open cases', 'Paid cases']));
    // …and it replaced the VALUES, never the column name — the raw enums are
    // gone from the axis, and the axis still found its key.
    expect(drawn.ticks).not.toContain('open');
    expect(drawn.ticks).not.toContain('paid');
  });
});
