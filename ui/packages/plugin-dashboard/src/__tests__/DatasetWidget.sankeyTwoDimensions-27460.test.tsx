// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27460 — the card's own widget, through the real chain: a
 * `sankey` with `dimensions: ['status', 'category']` and one count measure.
 *
 * The widget pivots the second dimension into one series per category, and the
 * renderer's sankey drew `series[0]` only: one root node (`Alpha`, the first
 * category) and its three flows, with `Beta` and `Gamma` dropped and nothing
 * saying so. The flows' values are pinned beside the renderer
 * (`AdvancedChartImpl.sankeyTwoDimensions-27460.test.tsx`); this file pins that
 * the dashboard hands the sankey every group and that every one is drawn.
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
  { status: 'Open', category: 'Alpha', task_count: 3 },
  { status: 'Open', category: 'Beta', task_count: 1 },
  { status: 'Done', category: 'Alpha', task_count: 2 },
  { status: 'Done', category: 'Gamma', task_count: 4 },
  { status: 'Blocked', category: 'Alpha', task_count: 2 },
  { status: 'Blocked', category: 'Beta', task_count: 5 },
];

const renderSankey = async (dimensions: string[]) => {
  const src = { queryDataset: vi.fn(async () => ({ rows: ROWS })) };
  const view = render(
    <DatasetWidget
      widget={{ id: 'tasks_flow', type: 'sankey', dataset: 'tasks', dimensions, values: ['task_count'] }}
      dataSource={src}
    />,
  );
  await waitFor(
    () => expect(view.container.querySelector('.recharts-surface, [data-chart-error]')).not.toBeNull(),
    { timeout: 15000 },
  );
  return view;
};

const nodeNames = (container: HTMLElement) =>
  [...container.querySelectorAll('.recharts-sankey-node-label')].map((t) => t.textContent).sort();

describe('objectstack#27460 — a two-dimension sankey widget draws every flow', () => {
  it('draws a node for every status and every category, and one flow per answered pair', async () => {
    const { container } = await renderSankey(['status', 'category']);
    expect(nodeNames(container)).toEqual(['Alpha', 'Beta', 'Blocked', 'Done', 'Gamma', 'Open']);
    expect(container.querySelectorAll('.recharts-sankey-link')).toHaveLength(ROWS.length);
    expect(container.querySelector('[data-chart-note], [data-chart-error]')).toBeNull();
  });
});
