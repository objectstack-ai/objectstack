/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Sankey — rows arrived, none of them is a positive number (objectui#7140).
 *
 * The sankey arm keeps only strictly positive measures
 * (`data.filter((r) => (Number(r?.[dataKey]) || 0) > 0)`), so a chart handed
 * REAL rows whose measure is all `0`, all `null`, all negative, or unparseable
 * built no links and returned a bare `<div className={className} />`.
 *
 * Measured in Chromium against a populated control before the fix, at
 * `origin/main` e8e4c4df5: the control drew 1 `<svg>` / 7 `<path>` /
 * 26 descendants; each of the four blank tiles rendered `descendantCount: 1`,
 * `svgCount: 0`, `textContent: ''`, and their screenshots hashed identical to
 * one another. Nothing was on the page — no marks, no text, no `role` — so the
 * tile was indistinguishable from a widget that had crashed, which is the one
 * distinction every other refusal in that file exists to make.
 *
 * The two boundaries this pins are the ones that make the message TRUE rather
 * than merely present:
 *
 *   - **no rows at all still returns the bare div.** That is the empty-RESULT
 *     question (objectui#7130), answered upstream in `ObjectChart` where the
 *     query outcome is known. "No row's measure is above zero" would be a false
 *     sentence about a dataset with no rows in it.
 *   - **one positive row among zeros still DRAWS.** The refusal fires on an
 *     empty link set, never on a thin one; a sankey that can draw anything is
 *     never replaced by prose.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

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

const SERIES = [{ dataKey: 'amount', label: 'Amount' }];

const renderSankey = (data: Array<Record<string, unknown>>) =>
  render(
    <AdvancedChartImpl
      chartType="sankey"
      xAxisKey="stage"
      series={SERIES as any}
      data={data as any}
    />,
  );

const refusalOf = (container: HTMLElement) =>
  container.querySelector('[data-chart-error="no-positive-flow"]');

/**
 * The four row shapes that reach the empty link set. They are NOT the same
 * situation — a genuinely all-zero flow, values a flow cannot represent because
 * they are negative, and measures `Number(…) || 0` folds to zero — but the
 * predicate the filter applies is the one thing true of all of them, so one
 * message serves all four without saying anything false about any of them.
 */
const NO_POSITIVE_ROWS: Array<[string, Array<Record<string, unknown>>]> = [
  ['every measure is 0', [{ stage: 'Prospecting', amount: 0 }, { stage: 'Won', amount: 0 }]],
  ['every measure is null', [{ stage: 'Prospecting', amount: null }, { stage: 'Won', amount: null }]],
  ['every measure is negative', [{ stage: 'Refunds', amount: -40 }, { stage: 'Credits', amount: -12 }]],
  ['every measure is unparseable', [{ stage: 'A', amount: 'n/a' }, { stage: 'B', amount: 'n/a' }]],
];

describe('AdvancedChartImpl — sankey with no positive flow (objectui#7140)', () => {
  it.each(NO_POSITIVE_ROWS)('says so instead of rendering nothing when %s', (_label, rows) => {
    const { container } = renderSankey(rows);

    const refusal = refusalOf(container);
    expect(refusal, 'renders the explanatory placeholder').not.toBeNull();
    // A refusal is a STATE, not an alert — the shell the other two refusals in
    // this file render through.
    expect(refusal?.getAttribute('role')).toBe('status');
    // Names the measure it tested, so the author knows WHICH column was all
    // zero rather than being told the chart is empty.
    expect(refusal?.textContent).toContain('amount');
    expect(refusal?.textContent).toContain('above zero');
    // The old behaviour was a bare `<div>` with nothing in it. Anything that
    // paints a plot here would be a sankey drawn from links that do not exist.
    expect(container.querySelector('svg')).toBeNull();
  });

  it('leaves the no-rows case alone — that is the empty-result question, answered upstream', () => {
    const { container } = renderSankey([]);

    expect(refusalOf(container), 'no refusal without rows to refuse over').toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    // Byte-for-byte what this arm returned before objectui#7140: an empty div,
    // carrying only the className it was handed.
    expect(container.textContent).toBe('');
  });

  it('still draws when ONE row is positive among zeros', () => {
    const { container } = renderSankey([
      { stage: 'Prospecting', amount: 0 },
      { stage: 'Proposal', amount: 7 },
      { stage: 'Won', amount: 0 },
    ]);

    expect(refusalOf(container), 'a drawable sankey is never replaced by prose').toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('CONTROL — an all-positive sankey draws, and carries no refusal', () => {
    const { container } = renderSankey([
      { stage: 'Prospecting', amount: 40 },
      { stage: 'Proposal', amount: 25 },
      { stage: 'Won', amount: 12 },
    ]);

    expect(refusalOf(container)).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('does not fire for other chart families handed the same all-zero rows', () => {
    // The guard lives inside the sankey arm and reads the sankey filter's own
    // result, so it cannot reach a family that has no such filter. Pinned
    // because a hoisted copy of the predicate is the obvious refactor and would
    // blank four working charts: bar/pie/funnel/treemap all render an all-zero
    // dataset today (measured in Chromium — axes, labels and legend).
    for (const chartType of ['bar', 'pie', 'funnel', 'treemap'] as const) {
      const { container } = render(
        <AdvancedChartImpl
          chartType={chartType}
          xAxisKey="stage"
          series={SERIES as any}
          data={[{ stage: 'A', amount: 0 }, { stage: 'B', amount: 0 }] as any}
        />,
      );
      expect(refusalOf(container), `${chartType} must be untouched`).toBeNull();
      cleanup();
    }
  });
});
