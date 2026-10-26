/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8650 — the "Tremor/simple format" adapter inside `ChartRenderer` is
 * retired, and the four keys it read do NOT share one verdict.
 *
 * ## What was measured, and why the four split
 *
 * The card filed this as one group of four undeclared reads. A cast-aware read
 * census (`schemaReads`, objectui#6576) plus a TypeScript-checker declaredness
 * reading (`getPropertyOfType`, never a grep — objectui#8410) measured them
 * apart:
 *
 *   - `categories` is a DECLARED member of the published `ChartSchema` and of
 *     its zod mirror, is documented in the schema reference as an alternative
 *     series list, and was ruled LIVE by objectui#6896. It was never a foreign
 *     spelling. `normalizeChartSchema` — the ONE translation point
 *     (objectui#2880 S1) — already consumed it, so `ChartRenderer`'s own branch
 *     was a SECOND, un-normalized read of a key the normalizer owns and could
 *     not be reached by any well-formed chart. ⇒ the branch goes, the
 *     capability stays. The cases below pin that it still plots.
 *   - `index`, `category` and `value` are declared on NO published face, are
 *     advertised by no registry `inputs`, are taught by no doc or skill, and a
 *     structural producer census over this repo found ZERO nodes writing them.
 *     ⇒ retired, per AGENTS.md #0.1 (the remedy belongs at the producer, and
 *     there is no producer).
 *
 * ## The failure mode the retirement degrades to — measured, not assumed
 *
 * ⚠️ It is CONDITIONAL on the rows, and an earlier reading of it here was too
 * strong. With no `xAxisKey` bound, `AdvancedChartImpl` falls back to its
 * default category key `name`: rows carrying no `name` column — `DATA` below
 * — hit its on-screen `missing-category-key` refusal (objectui#8168's family),
 * but rows that DO carry one plot SILENTLY against `name`. The cases below pin
 * the refusing half, and read the refusal by its `data-chart-error` CODE — the
 * machine-readable half that sibling suites already pin — never by its wording,
 * which no consumer parses.
 *
 * ⛔ The negative form these cases used to take — sleep a fixed window, then
 * assert no plot surface YET — is gone and must not come back. It was a race in
 * the FALSE-GREEN direction: warm time-to-surface for the canonical control was
 * measured at 97–168 ms (cold 578 ms) against a 150 ms window, so on a loaded
 * runner a re-added alias that plotted LATE would satisfy it — a pin that
 * cannot fail. A `waitFor` on the POSITIVE signal fails the other way: a slow
 * runner makes it slower, never green.
 *
 * ⭐ Every refusal below is read against the CANONICAL control in the same
 * file: the same data and the same chart, written with `xAxisKey` / `series`,
 * must plot. Without it a renderer that had stopped drawing anything at all
 * would satisfy every negative case here.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

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

import { ChartRenderer } from './ChartRenderer';
// `ChartRenderer` lazy-loads its implementation; import it eagerly with the
// SAME specifier so the dynamic import's cost lands in the import phase rather
// than inside `waitFor`'s budget (the reasoning is spelled out in
// `ChartRenderer.specSeries.test.tsx`).
import './AdvancedChartImpl';

afterEach(cleanup);

const DATA = [
  { month: 'Jan', revenue: 120, margin: 40 },
  { month: 'Feb', revenue: 80, margin: 90 },
];

const marks = (c: HTMLElement) => ({
  bars: c.querySelectorAll('.recharts-bar').length,
  lines: c.querySelectorAll('.recharts-line').length,
});

/** Waits for the real plot past the lazy boundary, then counts the marks. */
const plotted = async (c: HTMLElement) => {
  await waitFor(() => expect(c.querySelector('.recharts-surface')).toBeTruthy());
  return marks(c);
};

/**
 * The positive reading for a retired AXIS alias: wait for the refusal
 * `AdvancedChartImpl` renders when nothing binds the category axis. Re-add the
 * alias and the chart plots instead, no refusal ever arrives, and this
 * `waitFor` reddens on timeout.
 */
const expectCategoryAxisRefusal = async (c: HTMLElement) => {
  await waitFor(() =>
    expect(c.querySelector('[data-chart-error="missing-category-key"]')).not.toBeNull(),
  );
  // The refusal REPLACES the chart, so no plot surface may coexist with it.
  expect(c.querySelector('.recharts-surface')).toBeNull();
};

/**
 * The positive reading for a retired SERIES alias: wait for the refusal
 * `AdvancedChartImpl` renders when a bar chart declares no series at all
 * (objectui#4695). Same shape and same reasoning as the axis helper above.
 */
const expectNoSeriesRefusal = async (c: HTMLElement) => {
  await waitFor(() =>
    expect(c.querySelector('[data-chart-error="no-plottable-series"]')).not.toBeNull(),
  );
  expect(c.querySelector('.recharts-surface')).toBeNull();
};

const renderChart = (schema: Record<string, unknown>) =>
  render(<ChartRenderer schema={schema as any} />).container;

describe('objectui#8650 — the canonical spellings still plot (the control)', () => {
  it('plots `xAxisKey` + `series` — every refusal below is read against this', async () => {
    const container = renderChart({
      type: 'chart',
      chartType: 'bar',
      data: DATA,
      xAxisKey: 'month',
      series: [{ dataKey: 'revenue' }, { dataKey: 'margin' }],
      isAnimationActive: false,
    });
    expect(await plotted(container)).toEqual({ bars: 2, lines: 0 });
  });
});

describe('objectui#8650 — `categories` is NOT retired: the declared key still plots', () => {
  it('plots a `categories` series list through `normalizeChartSchema`', async () => {
    // The read that used to serve this case lived in `ChartRenderer`; it is
    // gone, and the chart still draws both columns because the ONE translation
    // point has always consumed this key. If this case ever reds, the
    // objectui#6896 capability was removed by accident.
    const container = renderChart({
      type: 'chart',
      chartType: 'bar',
      data: DATA,
      xAxisKey: 'month',
      categories: ['revenue', 'margin'],
      isAnimationActive: false,
    });
    expect(await plotted(container)).toEqual({ bars: 2, lines: 0 });
  });

  it('still ignores `categories` when `series` is present — the documented precedence', async () => {
    const container = renderChart({
      type: 'chart',
      chartType: 'bar',
      data: DATA,
      xAxisKey: 'month',
      series: [{ dataKey: 'revenue' }],
      categories: ['revenue', 'margin'],
      isAnimationActive: false,
    });
    expect(await plotted(container)).toEqual({ bars: 1, lines: 0 });
  });

  it('no longer throws on a malformed `categories` — the retired branch called `.map` on it', async () => {
    // `categories: 'revenue'` (a string, not a list) reached `.map` on a string
    // in the retired branch and threw during render. The normalizer answers
    // "no series" instead, which is the honest reading of an off-contract
    // value: the chart mounts, and — since objectui#4695 — says it has no
    // series to plot rather than drawing an empty frame.
    const container = renderChart({
      type: 'chart',
      chartType: 'bar',
      data: DATA,
      xAxisKey: 'month',
      categories: 'revenue',
      isAnimationActive: false,
    });
    await expectNoSeriesRefusal(container);
  });
});

describe('objectui#8650 — the foreign dialect is retired', () => {
  it('`index` no longer binds the category axis', async () => {
    const container = renderChart({
      type: 'chart',
      chartType: 'bar',
      data: DATA,
      index: 'month',
      series: [{ dataKey: 'revenue' }, { dataKey: 'margin' }],
      isAnimationActive: false,
    });
    await expectCategoryAxisRefusal(container);
  });

  it('`category` no longer binds the category axis', async () => {
    const container = renderChart({
      type: 'chart',
      chartType: 'bar',
      data: DATA,
      category: 'month',
      series: [{ dataKey: 'revenue' }, { dataKey: 'margin' }],
      isAnimationActive: false,
    });
    await expectCategoryAxisRefusal(container);
  });

  it('`value` no longer becomes a single series', async () => {
    const container = renderChart({
      type: 'chart',
      chartType: 'bar',
      data: DATA,
      xAxisKey: 'month',
      value: 'revenue',
      isAnimationActive: false,
    });
    // The axis IS bound here, so this case isolates the series half — and the
    // reading is positive: with no series declared, a bar chart refuses
    // (objectui#4695), so this waits for that refusal to ARRIVE rather than for
    // a fixed window to elapse. Re-add the `value` read and a bar plots
    // instead, no refusal ever arrives, and the `waitFor` reddens on timeout.
    await expectNoSeriesRefusal(container);
  });
});
