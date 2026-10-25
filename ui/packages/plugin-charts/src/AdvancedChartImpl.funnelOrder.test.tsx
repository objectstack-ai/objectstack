/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * framework#3588 — a funnel's shape asserts a sequence.
 *
 * The renderer used to sort funnel segments by value descending,
 * unconditionally — so a sales pipeline rendered as a tidy narrowing shape
 * regardless of the stages' real order, and any server-side ordering was
 * silently overridden. With a declared `categoryOrder` the pipeline order wins;
 * without one the value-descending default is preserved.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// Recharts' ResponsiveContainer measures its parent via ResizeObserver, which
// reports 0×0 under the headless DOM — so the funnel never paints. Replace it
// with a fixed-size passthrough so segments actually render.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 320, height: 320 }),
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';

afterEach(cleanup);

/**
 * Rows as analytics returns them: alphabetical, and deliberately NOT
 * monotonically narrowing — Proposal (200) is the largest, so a value sort and
 * the declared pipeline order produce visibly different funnels.
 */
const PIPELINE = [
  { stage: 'Needs Analysis', total_amount: 120 },
  { stage: 'Negotiation', total_amount: 90 },
  { stage: 'Proposal', total_amount: 200 },
  { stage: 'Qualification', total_amount: 150 },
];

/** As `buildCategoryOrder` emits it: value and label adjacent, in declared order. */
const DECLARED = [
  'qualification', 'Qualification',
  'needs_analysis', 'Needs Analysis',
  'proposal', 'Proposal',
  'negotiation', 'Negotiation',
];

/**
 * The segment labels in the order Recharts drew them. `<Funnel>` renders one
 * `<text>` label per trapezoid in source order, which is exactly the ordering
 * under test.
 */
function drawnOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('text'))
    .map((t) => t.textContent?.trim() ?? '')
    .filter(Boolean);
}

function renderFunnel(extra: Record<string, unknown>) {
  return render(
    <AdvancedChartImpl
      chartType="funnel"
      data={PIPELINE}
      xAxisKey="stage"
      series={[{ dataKey: 'total_amount' }]}
      config={{ total_amount: { label: 'Amount' } }}
      isAnimationActive={false}
      {...extra}
    />,
  );
}

describe('funnel stage order (#3588)', () => {
  it('draws every stage (guards the assertions below against an empty render)', () => {
    const { container } = renderFunnel({ categoryOrder: DECLARED });
    expect(container.querySelectorAll('.recharts-funnel-trapezoid')).toHaveLength(4);
    expect(drawnOrder(container)).toHaveLength(4);
  });

  it('draws in the DECLARED pipeline order, not by value', () => {
    const { container } = renderFunnel({ categoryOrder: DECLARED });
    expect(drawnOrder(container)).toEqual([
      'Qualification', 'Needs Analysis', 'Proposal', 'Negotiation',
    ]);
  });

  it('keeps the value-descending default when no order is declared', () => {
    const { container } = renderFunnel({});
    expect(drawnOrder(container)).toEqual([
      'Proposal', 'Qualification', 'Needs Analysis', 'Negotiation',
    ]);
  });

  it('keeps a category missing from the declared order, after the declared ones', () => {
    const { container } = render(
      <AdvancedChartImpl
        chartType="funnel"
        data={[...PIPELINE, { stage: 'Closed Won', total_amount: 10 }]}
        xAxisKey="stage"
        series={[{ dataKey: 'total_amount' }]}
        config={{ total_amount: { label: 'Amount' } }}
        isAnimationActive={false}
        categoryOrder={DECLARED}
      />,
    );
    // Never dropped — an unlisted stage still renders, and lands last.
    expect(drawnOrder(container)).toEqual([
      'Qualification', 'Needs Analysis', 'Proposal', 'Negotiation', 'Closed Won',
    ]);
  });

  it('orders by the stored VALUE too, for rows the server left unlabeled', () => {
    const { container } = render(
      <AdvancedChartImpl
        chartType="funnel"
        data={[
          { stage: 'negotiation', total_amount: 90 },
          { stage: 'qualification', total_amount: 150 },
          { stage: 'proposal', total_amount: 200 },
        ]}
        xAxisKey="stage"
        series={[{ dataKey: 'total_amount' }]}
        config={{ total_amount: { label: 'Amount' } }}
        isAnimationActive={false}
        categoryOrder={DECLARED}
      />,
    );
    expect(drawnOrder(container)).toEqual(['qualification', 'proposal', 'negotiation']);
  });
});
