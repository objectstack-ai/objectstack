// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9203 — the PLOT-INTERNAL half of the DATASET face's `chartConfig`
 * forwarding, asserted **on the dashboard surface**: dataset widget metadata
 * in, drawn Recharts marks out, no renderer stub anywhere in the chain.
 *
 * ## Why this file exists beside `DatasetWidget.chartConfig.dom.test.tsx`
 *
 * objectui#4044's ruling names the pin shape: every forwarded key gets a
 * rendering assertion *on the dashboard surface* that reads it — never a "the
 * prop was passed" assertion. On this face that clause was half done.
 * `DatasetWidget.chartConfig.test.tsx` pins the seam (which keys
 * `chartConfigPresentation` composes) and `DatasetWidget.chartConfig.dom.test.tsx`
 * pins the four keys that paint OUTSIDE Recharts' `ResponsiveContainer`
 * (`title` / `subtitle` / `description` / `height`). The other five —
 * `colors`, the `categoryColors` arm of `colors`, `showDataLabels`,
 * `annotations` and `interaction` — paint *inside* it and had no
 * dashboard-surface pin at all.
 *
 * ## ⭐ Why `plugin-charts`' file was never their coverage — measured
 *
 * Their only apparent evidence was
 * `plugin-charts/src/ChartRenderer.dashboardChartConfig.test.tsx`, which
 * hand-builds its own chart schema and therefore never travels this seam. PR
 * objectui#9202 ablated the forwarding out of the two inline relays and ran
 * everything: **46 assertions red across the three dashboard files, and 0 in
 * `plugin-charts`' file.** An assertion that stays green while the thing it
 * names is deleted is not evidence (the shape objectui#7963's `confirmVariant`
 * survived in for months). ⛔ That file is not coverage for these five keys.
 *
 * ## How the plot gets a box here, and why it is not a `recharts` mock
 *
 * `recharts` resolves inside `plugin-charts` alone, so `vi.mock('recharts')` is
 * not available in this package. It is also not needed — the conclusion the
 * sibling file drew from that ("those marks can only be pinned inside
 * plugin-charts") is false, and this file is the counter-example.
 * `ResponsiveContainer` reads `containerRef.current.getBoundingClientRect()`
 * SYNCHRONOUSLY inside its resize effect and seeds its size from that,
 * consulting `ResizeObserver` only for later changes — and the repo's
 * happy-dom `ResizeObserver` polyfill is a no-op, which is exactly why nothing
 * painted before. Sizing that one element is enough.
 *
 * ⚠️ SCOPED to the container element, never blanket — the blanket form looks
 * like it works: with every element answering 480x320, Recharts' own axis-label
 * measurement reads 480x320 too, the x-axis claims the whole box, and the plot
 * clip rect comes back `height="0"` with the marks absent while
 * `.recharts-surface` is present. A file that waited on the surface and then
 * asserted "no data labels" would have passed for that reason.
 *
 * ⚠️ Every negative arm below is paired with a positive one taken through the
 * SAME harness. A bare "no mark drawn" reading cannot tell a honoured
 * `false` from a plot that never painted.
 */

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
// Registers `chart` in the ComponentRegistry, which is what the `SchemaRenderer`
// inside `DatasetWidget` resolves its `{ type: 'chart' }` schema through.
// Production reaches `AdvancedChartImpl` only through the `React.lazy(() =>
// import('./AdvancedChartImpl'))` factory inside `ChartRenderer`, so this test
// reaches it the same way — by rendering the real chain and awaiting the
// Suspense boundary (objectui#4529).
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

const rows = [
  { status: 'open', total: 120 },
  { status: 'paid', total: 80 },
];

/**
 * Render one DATASET-BOUND chart widget — `dataset` + `dimensions` + `values`
 * resolved through `queryDataset`, which is the whole point of this face — and
 * settle it at the drawn plot (`.recharts-surface`, not the chart container),
 * so every assertion below reads a plot that really painted. An empty result
 * then means "the chart drew and chose not to", never "it had not drawn yet".
 */
const renderWidget = async (
  chartConfig?: Record<string, unknown>,
  widgetType: 'bar' | 'pie' = 'bar',
) => {
  const src = { queryDataset: vi.fn(async () => ({ rows })) };
  const view = render(
    <DatasetWidget
      widget={{
        type: widgetType,
        dataset: 'invoices',
        dimensions: ['status'],
        values: ['total'],
        ...(chartConfig ? { chartConfig } : {}),
      }}
      dataSource={src}
    />,
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
// Measured, not assumed: with no `colors` on the schema the chart block falls
// back to the theme's own `--chart-N` ramp. Spelled out here so the control
// above reads a REAL palette rather than "whatever came back".
const DEFAULT_SECTOR_FILLS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))'];
const dataLabels = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.recharts-label-list text')).map((t) => t.textContent);

describe('DatasetWidget — chartConfig reaches the drawn marks (objectui#9203)', () => {
  it('paints the marks from an array `colors` palette', async () => {
    // A pie draws one mark per CATEGORY, so a positional palette is readable
    // straight off the sectors' fills — a bar's fill is a gradient `url(#…)`.
    const { container } = await renderWidget({ colors: ['#111111', '#222222'] }, 'pie');
    expect(sectorFills(container)).toEqual(['#111111', '#222222']);
  });

  it('keeps the renderer default palette when `colors` is undeclared', async () => {
    // The control for the case above, and the reason it is not vacuous: some
    // palette always paints, so "the author's palette won" has to be told apart
    // from "a palette was used".
    const { container } = await renderWidget(undefined, 'pie');
    expect(sectorFills(container)).toEqual(DEFAULT_SECTOR_FILLS);
  });

  it('paints per-category colours from a record `colors` map', async () => {
    // The record arm arrives at the renderer as `categoryColors` (the whitelist
    // splits it) and wins per category — the precedence the spec's own `colors`
    // field states.
    const { container } = await renderWidget({ colors: { open: '#10B981', paid: '#EF4444' } }, 'pie');
    expect(sectorFills(container)).toEqual(['#10B981', '#EF4444']);
  });

  it('prints each point value on the mark when showDataLabels is on', async () => {
    const { container } = await renderWidget({ showDataLabels: true });
    expect(dataLabels(container)).toEqual(['120', '80']);
  });

  it('prints no data labels when showDataLabels is off or undeclared', async () => {
    const { container: off } = await renderWidget({ showDataLabels: false });
    expect(dataLabels(off)).toEqual([]);
    cleanup();
    const { container: bare } = await renderWidget();
    expect(dataLabels(bare)).toEqual([]);
  });

  it('draws a reference line for a line annotation', async () => {
    const { container } = await renderWidget({
      annotations: [{ type: 'line', axis: 'y', value: 100, label: 'Target' }],
    });
    expect(container.querySelectorAll('.recharts-reference-line').length).toBeGreaterThan(0);
    expect(screen.getByText('Target')).toBeTruthy();
  });

  it('draws a reference area for a region annotation', async () => {
    const { container } = await renderWidget({
      annotations: [{ type: 'region', axis: 'y', value: 50, endValue: 100 }],
    });
    expect(container.querySelectorAll('.recharts-reference-area').length).toBeGreaterThan(0);
  });

  it('draws no reference marks when no annotation is declared', async () => {
    const { container } = await renderWidget();
    expect(container.querySelectorAll('.recharts-reference-line').length).toBe(0);
    expect(container.querySelectorAll('.recharts-reference-area').length).toBe(0);
  });

  it('adds the range selector when interaction.brush is on, and not by default', async () => {
    const { container: on } = await renderWidget({ interaction: { brush: true } });
    expect(on.querySelectorAll('.recharts-brush').length).toBeGreaterThan(0);
    cleanup();
    const { container: bare } = await renderWidget();
    expect(bare.querySelectorAll('.recharts-brush').length).toBe(0);
  });

  it('removes the hover tooltip when interaction.tooltips is false', async () => {
    // The "on" arm is the control: without it a missing tooltip wrapper would
    // read as honoured when it only meant the plot had not drawn.
    const { container: on } = await renderWidget();
    expect(on.querySelectorAll('.recharts-tooltip-wrapper').length).toBeGreaterThan(0);
    cleanup();
    const { container: off } = await renderWidget({ interaction: { tooltips: false } });
    expect(off.querySelectorAll('.recharts-tooltip-wrapper').length).toBe(0);
  });
});
