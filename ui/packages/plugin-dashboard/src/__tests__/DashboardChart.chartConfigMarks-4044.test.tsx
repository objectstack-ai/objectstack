/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4044 — the PLOT-INTERNAL half of the inline dashboard `chartConfig`
 * forwarding, asserted **on the dashboard surface**: widget metadata in, drawn
 * Recharts marks out, no renderer stub anywhere in the chain.
 *
 * ## Why this file exists beside the two others
 *
 * The card's ruling names the pin shape: every forwarded key gets a rendering
 * assertion *on the dashboard surface* that reads it — never a "the prop was
 * passed" assertion. `DashboardChart.chartConfig-4044.test.tsx` pins the seam
 * (which keys the relays compose) and `DashboardChart.chartConfigDom-4044.test.tsx`
 * pins the keys that paint OUTSIDE Recharts' `ResponsiveContainer`
 * (`title` / `subtitle` / `description` / `height`). The remaining six —
 * `colors`, the `categoryColors` arm of `colors`, `showDataLabels`,
 * `annotations`, `interaction` and `showLegend` — paint *inside* it, and had no
 * dashboard-surface pin at all: their only drawn evidence lived in
 * `plugin-charts/src/ChartRenderer.dashboardChartConfig.test.tsx`, which
 * hand-builds its schema and therefore stays GREEN when the relays stop
 * forwarding. This file closes that gap.
 *
 * ## How the plot gets a box here, and why it is not a `recharts` mock
 *
 * The sibling files record that `recharts` resolves inside `plugin-charts`
 * alone — re-measured, still true: `require.resolve('recharts')` from
 * `packages/plugin-dashboard` is `MODULE_NOT_FOUND`, so `vi.mock('recharts')`
 * is not available here. It is also not needed. `ResponsiveContainer` reads
 * `containerRef.current.getBoundingClientRect()` SYNCHRONOUSLY inside its
 * resize effect and seeds its size from that, consulting `ResizeObserver` only
 * for later changes — and the repo's happy-dom `ResizeObserver` polyfill is a
 * no-op, which is exactly why nothing painted before. Sizing that one element
 * is therefore enough.
 *
 * ⚠️ SCOPED to the container element, never blanket — measured, because the
 * blanket form looks like it works: with every element answering 480x320,
 * Recharts' own axis-label measurement also reads 480x320, the x-axis claims
 * the whole box, and the plot clip rect comes back `height="0"` with the marks
 * absent while the `.recharts-surface` element is present. A file that waited
 * on the surface and then asserted "no data labels" would have passed for that
 * reason.
 */

import React from 'react';
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
import '@object-ui/components';
// Production reaches `AdvancedChartImpl` only through the `React.lazy(() =>
// import('./AdvancedChartImpl'))` factory inside `ChartRenderer`; this import
// registers the real `chart` entry and pays the recharts graph in the import
// phase, which no test timeout applies to (AGENTS.md, 测试纪律).
import '@object-ui/plugin-charts';
import '../index';
import { DashboardRenderer } from '../DashboardRenderer';
// Mounted directly: its `dashboard-grid` node key was retired by objectui#10859
// batch 8, so the component, not a registry lookup, is the surface under test.
import { DashboardGridLayout } from '../DashboardGridLayout';
import type { DataSource } from '@object-ui/types';

/**
 * NOTE (objectui#7912): `SchemaRendererProvider.dataSource` — and the context
 * it feeds — declare the published `DataSource` adapter contract. The values
 * this file injects are deliberately NOT adapters —
 * they are partial stubs carrying only the members the path under test calls;
 * completing them would change which capability probes fire, and so would
 * change what these tests measure.
 * Each injection therefore crosses the contract with an explicit
 * `as unknown as DataSource`. Every injected value is byte-for-byte what it
 * was before: this marks the crossing, it changes no assertion.
 */

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
  { status: 'open', total: 120 },
  { status: 'paid', total: 80 },
];

const dataSource = { aggregate: async () => [], find: async () => [] };

const SURFACES = ['grid', 'renderer'] as const;

/**
 * Render one INLINE-ROWS chart widget through a relay and settle it at the
 * drawn plot — `.recharts-surface`, not the chart container, so every
 * assertion below reads a plot that really painted. An empty result then means
 * "the chart drew and chose not to", never "it had not drawn yet".
 */
const renderWidget = async (
  surface: (typeof SURFACES)[number],
  chartConfig?: Record<string, unknown>,
  widgetType: 'bar' | 'pie' = 'bar',
) => {
  const widget = {
    id: 'w1',
    type: widgetType,
    title: 'Invoices',
    options: { xField: 'status', yField: 'total' },
    data: ROWS,
    ...(chartConfig ? { chartConfig } : {}),
  };
  const view = render(
    <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
      {surface === 'grid' ? (
        <DashboardGridLayout schema={{ widgets: [widget] } as any} />
      ) : (
        <DashboardRenderer schema={{ widgets: [widget] } as any} />
      )}
    </SchemaRendererProvider>,
  );
  // AGENTS.md records first-`import()` latencies up to 976 ms under full
  // parallelism, past RTL's 1000 ms default once the recharts graph is cold.
  await waitFor(() => expect(view.container.querySelector('.recharts-surface')).not.toBeNull(), {
    timeout: 15000,
  });
  return view;
};

const sectorFills = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('path.recharts-sector')).map((p) => p.getAttribute('fill'));
const dataLabels = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.recharts-label-list text')).map((t) => t.textContent);
const legendText = (c: HTMLElement) => c.querySelector('.recharts-legend-wrapper')?.textContent ?? null;

describe.each(SURFACES)('%s relay — inline chartConfig reaches the drawn marks (objectui#4044)', (surface) => {
  it('paints the marks from an array `colors` palette', async () => {
    // A pie draws one mark per CATEGORY, so a positional palette is readable
    // straight off the sectors' fills — a bar's fill is a gradient `url(#…)`.
    const { container } = await renderWidget(surface, { colors: ['#111111', '#222222'] }, 'pie');
    expect(sectorFills(container)).toEqual(['#111111', '#222222']);
  });

  it('keeps the relay default palette when `colors` is undeclared', async () => {
    // The control for the case above, and the reason it is not vacuous: the
    // relay pre-sets `colors: CHART_COLORS` (the theme's `--chart-N` vars), so
    // "the author's palette won" has to be told apart from "some palette was
    // used".
    const { container } = await renderWidget(surface, undefined, 'pie');
    expect(sectorFills(container)).toEqual(['hsl(var(--chart-1))', 'hsl(var(--chart-2))']);
  });

  it('paints per-category colours from a record `colors` map', async () => {
    // The record arm arrives as `categoryColors` (the whitelist splits it) and
    // wins per category — the precedence the spec's own `colors` field states.
    const { container } = await renderWidget(
      surface,
      { colors: { open: '#10B981', paid: '#EF4444' } },
      'pie',
    );
    expect(sectorFills(container)).toEqual(['#10B981', '#EF4444']);
  });

  it('prints each point value on the mark when showDataLabels is on', async () => {
    const { container } = await renderWidget(surface, { showDataLabels: true });
    expect(dataLabels(container)).toEqual(['120', '80']);
  });

  it('prints no data labels when showDataLabels is off or undeclared', async () => {
    const { container: off } = await renderWidget(surface, { showDataLabels: false });
    expect(dataLabels(off)).toEqual([]);
    cleanup();
    const { container: bare } = await renderWidget(surface);
    expect(dataLabels(bare)).toEqual([]);
  });

  it('draws a reference line for a line annotation', async () => {
    const { container } = await renderWidget(surface, {
      annotations: [{ type: 'line', axis: 'y', value: 100, label: 'Target' }],
    });
    expect(container.querySelectorAll('.recharts-reference-line').length).toBeGreaterThan(0);
    expect(screen.getByText('Target')).toBeTruthy();
  });

  it('draws a reference area for a region annotation', async () => {
    const { container } = await renderWidget(surface, {
      annotations: [{ type: 'region', axis: 'y', value: 50, endValue: 100 }],
    });
    expect(container.querySelectorAll('.recharts-reference-area').length).toBeGreaterThan(0);
  });

  it('draws no reference marks when no annotation is declared', async () => {
    const { container } = await renderWidget(surface);
    expect(container.querySelectorAll('.recharts-reference-line').length).toBe(0);
    expect(container.querySelectorAll('.recharts-reference-area').length).toBe(0);
  });

  it('adds the range selector when interaction.brush is on, and not by default', async () => {
    const { container: on } = await renderWidget(surface, { interaction: { brush: true } });
    expect(on.querySelectorAll('.recharts-brush').length).toBeGreaterThan(0);
    cleanup();
    const { container: bare } = await renderWidget(surface);
    expect(bare.querySelectorAll('.recharts-brush').length).toBe(0);
  });

  it('removes the hover tooltip when interaction.tooltips is false', async () => {
    // The "on" arm is the control: without it a missing tooltip wrapper would
    // read as honoured when it only meant the plot had not drawn.
    const { container: on } = await renderWidget(surface);
    expect(on.querySelectorAll('.recharts-tooltip-wrapper').length).toBeGreaterThan(0);
    cleanup();
    const { container: off } = await renderWidget(surface, { interaction: { tooltips: false } });
    expect(off.querySelectorAll('.recharts-tooltip-wrapper').length).toBe(0);
  });

  it('draws no legend when showLegend is false, and draws one otherwise', async () => {
    // A pie legends one entry per CATEGORY, so the legend's content is readable
    // without a second series. Recharts registers the legend payload from a
    // layout effect and the Legend re-renders off that store update, so the
    // text arrives a tick after the surface — hence `waitFor`.
    const { container: bare } = await renderWidget(surface, undefined, 'pie');
    await waitFor(() => expect(legendText(bare)).toContain('open'));
    cleanup();
    const { container: off } = await renderWidget(surface, { showLegend: false }, 'pie');
    expect(legendText(off)).toBeNull();
  });
});
