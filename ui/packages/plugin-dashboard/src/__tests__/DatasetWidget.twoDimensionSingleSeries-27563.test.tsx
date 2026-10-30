// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27563 — the card's own widgets, through the real chain: a pie,
 * donut, funnel or treemap with `dimensions: ['stage', 'owner']` and one
 * amount measure.
 *
 * The widget pivots the second dimension into one series per owner, and these
 * arms drew `series[0]` only: the first owner's amounts, with the other owners
 * dropped and nothing saying so. The cells are pinned beside the renderer
 * (`AdvancedChartImpl.twoDimensionSingleSeries-27563.test.tsx`); this file pins
 * that the dashboard hands every group on, that the treemap draws every cell
 * and that the pie, donut and funnel name every group in a refusal on the tile,
 * and that a stored widget declaring two measures still draws its first one.
 *
 * The chain is `DatasetWidget` → `SchemaRenderer` → the registry's `chart` →
 * `AdvancedChartImpl`, with the scoped `getBoundingClientRect` stub of
 * `DatasetWidget.singleSeriesMeasures-11417.test.tsx`, whose header says why
 * `vi.mock('recharts')` is not available in this package.
 */

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
// Registers `chart`, reached through `ChartRenderer`'s `React.lazy` factory as
// in production (objectui#4529).
import '@object-ui/plugin-charts';
import { DatasetWidget } from '../DatasetWidget';

const PLOT_BOX = { width: 480, height: 320 } as const;
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList?.contains('recharts-responsive-container')) {
      return {
        ...PLOT_BOX,
        top: 0,
        left: 0,
        right: PLOT_BOX.width,
        bottom: PLOT_BOX.height,
        x: 0,
        y: 0,
        toJSON() {},
      } as DOMRect;
    }
    return originalGetBoundingClientRect.call(this);
  };
});

afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

afterEach(cleanup);

const ROWS = [
  { stage: 'Prospect', owner: 'Ann', amount: 100, cost: 10 },
  { stage: 'Prospect', owner: 'Bo', amount: 50, cost: 5 },
  { stage: 'Proposal', owner: 'Ann', amount: 80, cost: 8 },
  { stage: 'Proposal', owner: 'Cy', amount: 40, cost: 4 },
  { stage: 'Won', owner: 'Bo', amount: 120, cost: 12 },
];

const renderWidget = async (type: string, dimensions: string[], values: string[] = ['amount']) => {
  const src = { queryDataset: vi.fn(async () => ({ rows: ROWS })) };
  const view = render(
    <DatasetWidget
      widget={{ id: `deals_${type}`, type, dataset: 'deals', dimensions, values }}
      dataSource={src}
    />,
  );
  await waitFor(
    () => expect(view.container.querySelector('.recharts-surface, [data-chart-error]')).not.toBeNull(),
    { timeout: 15000 },
  );
  return view;
};

describe('objectstack#27563 — a two-dimension single-series widget draws every group or refuses', () => {
  it('treemap: draws one leaf per answered (stage, owner) pair, every owner included', async () => {
    const { container } = await renderWidget('treemap', ['stage', 'owner']);
    expect(container.querySelector('[data-chart-note], [data-chart-error]')).toBeNull();
    expect(container.querySelectorAll('.recharts-treemap-depth-2')).toHaveLength(ROWS.length);
  });

  it.each(['pie', 'donut', 'funnel'])('%s: refuses on the tile and names every owner', async (type) => {
    const { container } = await renderWidget(type, ['stage', 'owner']);
    expect(container.querySelector('.recharts-surface')).toBeNull();
    const refusal = container.querySelector('[data-chart-error]')!;
    expect(refusal.getAttribute('data-chart-error')).toBe('one-series-family');
    expect([...refusal.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['Ann', 'Bo', 'Cy']);
  });

  it.each(['pie', 'donut', 'funnel', 'treemap'])(
    'CONTROL: a one-dimension %s draws, with no refusal and no note',
    async (type) => {
      const { container } = await renderWidget(type, ['stage']);
      expect(container.querySelector('.recharts-surface')).not.toBeNull();
      expect(container.querySelector('[data-chart-note], [data-chart-error]')).toBeNull();
    },
  );

  it.each(['pie', 'donut', 'funnel', 'treemap'])(
    'CONTROL: a stored one-dimension %s with two measures still draws its first measure, not a group refusal',
    async (type) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { container } = await renderWidget(type, ['stage'], ['amount', 'cost']);
        expect(container.querySelector('.recharts-surface')).not.toBeNull();
        expect(container.querySelector('[data-chart-error]')).toBeNull();
        // A treemap would nest the second measure under each stage if it were handed it.
        expect(container.querySelectorAll('.recharts-treemap-depth-2')).toHaveLength(0);
      } finally {
        warn.mockRestore();
      }
    },
  );
});
