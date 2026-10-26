/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4044 — END TO END on the INLINE dashboard chart relays: widget
 * metadata → real chart DOM.
 *
 * The sibling `DashboardChart.chartConfig-4044.test.tsx` pins WHICH keys the
 * two relays compose. That is necessary and not sufficient: the criterion for
 * lowering a `chartConfig` key is that the chart block DRAWS it, and a seam
 * assertion cannot tell a honoured prop from an ignored one — forwarding a prop
 * nobody reads would only move declared-but-not-delivered one layer down. So
 * this file renders the REAL chain with no renderer stub at all —
 * `DashboardRenderer` / `DashboardGridLayout` → `SchemaRenderer` → the registry's
 * `chart` (`ChartRenderer`) → `AdvancedChartImpl` — and reads the resulting DOM.
 *
 * Scope of this file: everything the chart draws OUTSIDE Recharts'
 * `ResponsiveContainer` — the ChartFrame titles, and the chart container's
 * height and accessible name. Recharts' own marks (bars, LabelList, reference
 * lines, Brush) need a measured box, which this file does not arrange, so they
 * are asserted — also on the dashboard surface, also end to end — in
 * `DashboardChart.chartConfigMarks-4044.test.tsx` beside this one, which sizes
 * the `ResponsiveContainer` element itself.
 *
 * ⚠️ This paragraph used to say the marks could only be pinned inside
 * `plugin-charts` (whose `ChartRenderer.dashboardChartConfig.test.tsx` mocks
 * `ResponsiveContainer`), because `recharts` resolves in that package alone.
 * The premise is still true — re-measured, `require.resolve('recharts')` from
 * `packages/plugin-dashboard` is MODULE_NOT_FOUND — but the CONCLUSION was
 * wrong, and wrong in the expensive direction: it left every plot-internal key
 * with no dashboard-surface pin at all, so the relays could stop forwarding
 * them and the only drawn evidence (in a file that hand-builds its own schema)
 * would stay green. A `recharts` mock is not the only way to give the plot a
 * box; see the sibling file for the one that needs no module mock.
 *
 * The widget below binds INLINE ROWS — deliberately not an ADR-0021 dataset,
 * which is the path `DatasetWidget.chartConfig.dom.test.tsx` already covers.
 * Both relays are exercised, because each composes its own chart node.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
import '@object-ui/components';
// Registers `chart` in the ComponentRegistry, which is what `SchemaRenderer`
// resolves the relay's `{ type: 'chart' }` node through. Production reaches
// `AdvancedChartImpl` ONLY through the `React.lazy(() =>
// import('./AdvancedChartImpl'))` factory inside `ChartRenderer`, so this test
// reaches it the same way — by rendering the real chain and awaiting the
// Suspense boundary.
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

afterEach(cleanup);

const ROWS = [
  { status: 'open', total: 120 },
  { status: 'paid', total: 80 },
];

const dataSource = { aggregate: async () => [], find: async () => [] };

const SURFACES = ['grid', 'renderer'] as const;

/**
 * Render one inline-rows chart widget through a relay and settle it.
 *
 * The chart container only exists once the lazy chart chunk has mounted — i.e.
 * once the whole dashboard chart path really ran. Every witness in this file is
 * post-boundary DOM by design (that is the point of the file), so the wait is
 * BUDGETED rather than removed: AGENTS.md records first-`import()` latencies up
 * to 976 ms under full parallelism, well past RTL's 1000 ms default once the
 * recharts graph is cold. `waitFor` polls and returns as soon as the node
 * appears, so a large timeout costs nothing when the chunk is warm.
 */
const renderWidget = async (surface: (typeof SURFACES)[number], chartConfig?: Record<string, unknown>) => {
  const widget = {
    id: 'w1',
    type: 'bar',
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
  await waitFor(() => expect(view.container.querySelector('[data-slot="chart"]')).not.toBeNull(), {
    timeout: 15000,
  });
  return view;
};

const chartEl = (container: HTMLElement) => container.querySelector('[data-slot="chart"]') as HTMLElement;

describe.each(SURFACES)('%s relay — inline chartConfig reaches the real chart DOM (objectui#4044)', (surface) => {
  it('draws chartConfig.title / .subtitle above the plot', async () => {
    const { container } = await renderWidget(surface, { title: 'Invoice value', subtitle: 'by status' });
    const titleEl = screen.getByText('Invoice value');
    const subtitleEl = screen.getByText('by status');
    // Drawn by the CHART's own frame, not by the relay's card header — which is
    // a real possibility to exclude, since the relay paints the widget's own
    // `title` ('Invoices') there. `ChartFrame` wraps the chrome and the plot
    // together and inserts one `min-h-0 flex-1` slot around the plot, so the
    // plot's grandparent contains the chrome and the card header cannot.
    const frame = chartEl(container).parentElement?.parentElement as HTMLElement;
    expect(frame.contains(titleEl)).toBe(true);
    expect(frame.contains(subtitleEl)).toBe(true);
  });

  it('adds no title chrome when chartConfig declares none', async () => {
    const { container } = await renderWidget(surface);
    expect(screen.queryByText('Invoice value')).toBeNull();
    expect(screen.queryByText('by status')).toBeNull();
    // `ChartFrame` is a passthrough with neither title nor subtitle, so the
    // plot gains no wrapper at all — the structural counterpart of the case
    // above, and what makes "no chrome" different from "empty chrome".
    expect(container.querySelector('[data-slot="chart"]')).toBe(chartEl(container));
  });

  it('announces chartConfig.description as the chart graphic accessible name', async () => {
    const { container } = await renderWidget(surface, { description: 'Invoice value by status' });
    expect(chartEl(container).getAttribute('role')).toBe('img');
    expect(chartEl(container).getAttribute('aria-label')).toBe('Invoice value by status');
  });

  it('leaves the graphic unlabelled when no description is declared', async () => {
    // Not the same as an empty one: role="img" with no name is worse for a
    // screen reader than a plain div it can skip past.
    const { container } = await renderWidget(surface);
    expect(chartEl(container).getAttribute('role')).toBeNull();
    expect(chartEl(container).getAttribute('aria-label')).toBeNull();
  });

  it('applies chartConfig.height over the relay height class', async () => {
    // The relay hands the chart a height UTILITY CLASS, and `cn` in
    // `ChartContainerImpl` is a plain join rather than tailwind-merge, so the
    // authored height cannot win by replacing that class — it wins because
    // `AdvancedChartImpl` lowers it to an INLINE style on the same element.
    // That is the fact this asserts, and it is specific to these relays: the
    // dataset path carries no such class.
    const { container } = await renderWidget(surface, { height: 420 });
    expect(chartEl(container).style.height).toBe('420px');
  });

  it('keeps the relay height class in charge when none is declared', async () => {
    const { container } = await renderWidget(surface);
    expect(chartEl(container).style.height).toBe('');
  });

  // The one key on the ruling's DO-NOW list that is NOT forwarded, and this is
  // the measurement behind that refusal rather than a pin of it.
  //
  // ⚠️ Read what it can and cannot fail for. It stays green whether or not the
  // relay forwards `aria` — measured, by forwarding it on purpose in both
  // spellings and re-running this file: with `aria` lowered as the nested spec
  // object, and again with it FLATTENED onto the node's own `ariaLabel` /
  // `ariaDescribedBy` / `role` (which `BaseSchema` already declares and
  // `SchemaRenderer` already converts to DOM attributes), every assertion here
  // still passed and only the seam refusal in the sibling file went red. That
  // is the finding: an authored `aria` reaches no attribute on this surface in
  // EITHER spelling, because `ChartRenderer` destructures `{ schema,
  // onChartClick }` and drops the rest, so forwarding it would move
  // declared-but-not-delivered one layer down instead of delivering it.
  //
  // The control that makes this readable is four assertions up: `description`,
  // travelling the same whitelist onto the same node, DOES produce
  // `role="img"` + `aria-label` here.
  it('an authored chartConfig.aria reaches no attribute on this surface', async () => {
    const { container } = await renderWidget(surface, {
      aria: { ariaLabel: 'Authored name', role: 'figure' },
    });
    expect(container.querySelector('[aria-label]')).toBeNull();
    expect(container.querySelector('[role="figure"]')).toBeNull();
    expect(chartEl(container).getAttribute('role')).toBeNull();
  });
});
