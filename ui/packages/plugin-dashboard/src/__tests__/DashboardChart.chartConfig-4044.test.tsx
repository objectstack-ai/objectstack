/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4044 — `DashboardWidget.chartConfig` on the INLINE dashboard chart
 * relays, pinned at the seam.
 *
 * ## What was measured on `origin/main` before this file
 *
 * `chartConfig` was declared as the spec's full `ChartConfigSchema` on every
 * dashboard widget (`dashboard.zod.ts`: `chartConfig: ChartConfigSchema`;
 * since spec 17.5.0 it is `DashboardWidgetChartConfigSchema`, see the keys
 * deliberately NOT here), and the maintainer's ruling on this card is that the
 * implementation follows the protocol. The ADR-0021 dataset path already did (objectstack#7016,
 * `DatasetWidget.chartConfig.test.tsx`). The two INLINE relays did not:
 * `DashboardRenderer.tsx` contained the string `chartConfig` **0** times
 * (lit control in the same sweep: `widget`, 173 times) and
 * `DashboardGridLayout.tsx` the same. So an author who bound a widget to
 * inline rows or to a `provider: 'object'` aggregate — neither of which is a
 * dataset — and wrote `chartConfig.title` / `.colors` / `.height` parsed clean
 * and got nothing on screen.
 *
 * ## Why the seam, and where the DRAWN half lives
 *
 * A seam assertion cannot tell a honoured prop from an ignored one, so it is
 * never the whole pin. It is the right place for THIS half because the decision
 * under test is what the relay COMPOSES, and that decision is spelled twice —
 * `DashboardRenderer` and `DashboardGridLayout` each build their own chart node
 * (the same duality `DashboardChart.categoryAxisKey-8269.test.tsx` pins, whose
 * recorder harness this file reuses). The drawn half is pinned in two places:
 *
 *  - `DashboardChart.chartConfigDom-4044.test.tsx` beside this file renders the
 *    REAL chain for the keys that paint outside Recharts' `ResponsiveContainer`
 *    (`title`, `subtitle`, `description`, `height`);
 *  - `DashboardChart.chartConfigMarks-4044.test.tsx`, also beside this file,
 *    renders the same real chain for the keys that paint INSIDE it (`colors`
 *    and its `categoryColors` arm, `showDataLabels`, `annotations`,
 *    `interaction`, `showLegend`), by sizing the `ResponsiveContainer` element.
 *
 * Both of those are on the dashboard surface, which is what the ruling asks
 * for. `plugin-charts/src/ChartRenderer.dashboardChartConfig.test.tsx` also
 * draws these keys, but it hand-builds its schema: measured, it stays entirely
 * GREEN when both relays stop forwarding, so it pins the CHART BLOCK and never
 * this seam.
 *
 * ## The keys deliberately NOT here
 *
 *  - `type` — the widget's own `type` already picks the chart family on this
 *    path; an authored one would shadow the dispatch. Spec 17.5.0 refuses it on
 *    a dashboard widget's `chartConfig` at parse.
 *  - `xAxis` / `yAxis` / `series` — spec 17.5.0 refuses all three on a
 *    dashboard widget's `chartConfig` at parse
 *    (`DashboardWidgetChartConfigSchema`, ADR-0021 · ADR-0049 D2), which
 *    answered the precedence question objectstack#17385 carried: the derived
 *    binding wins and the authored keys are refused. The whitelist emits none
 *    of the three, and the refusal block below pins that for a widget that
 *    reaches the relay still carrying them.
 *  - `aria` — read by NOTHING on this path (measured; see the refusal block),
 *    and no longer declared: spec 17.5.0 retired `ChartConfig.aria` as a
 *    `retiredKey` tombstone (objectstack#17751). Forwarding it would have moved
 *    declared-but-not-delivered one layer down, which is the failure this card
 *    exists to remove.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import '@object-ui/components';
// Registers the real `object-chart` / `chart` entries this file then overrides,
// so the override is measured against the production registration order.
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

/** Every composed chart node the relays handed the renderer, in order. */
const composed: any[] = [];

const recorder = (props: any) => {
  composed.push(props.schema ?? props);
  return null;
};
for (const type of ['object-chart', 'chart'] as const) {
  ComponentRegistry.register(type, recorder as any, {
    namespace: 'test',
    label: 'recorder',
    category: 'plugin',
  } as any);
}

afterEach(cleanup);

const dataSource = { aggregate: async () => [], find: async () => [] };

/** Render one widget through a relay and return the node it composed. */
const composeVia = async (surface: 'grid' | 'renderer', widget: Record<string, unknown>) => {
  composed.length = 0;
  render(
    <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
      {surface === 'grid' ? (
        <DashboardGridLayout schema={{ widgets: [widget] } as any} />
      ) : (
        <DashboardRenderer schema={{ widgets: [widget] } as any} />
      )}
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(composed.length).toBeGreaterThan(0));
  const node = composed[composed.length - 1];
  cleanup();
  return node;
};

const ROWS = [
  { status: 'open', total: 120 },
  { status: 'paid', total: 80 },
];

/** The two INLINE binding shapes, neither of which is an ADR-0021 dataset. */
const BRANCHES = [
  {
    name: 'inline rows',
    expectedType: 'chart',
    widget: (chartConfig?: Record<string, unknown>) => ({
      id: 'w1',
      type: 'bar',
      title: 'Invoices',
      options: { xField: 'status', yField: 'total' },
      data: ROWS,
      ...(chartConfig ? { chartConfig } : {}),
    }),
  },
  {
    name: 'object provider',
    expectedType: 'object-chart',
    widget: (chartConfig?: Record<string, unknown>) => ({
      id: 'w2',
      type: 'bar',
      title: 'Invoices',
      data: { provider: 'object', object: 'invoices', aggregate: { function: 'count', groupBy: 'status' } },
      ...(chartConfig ? { chartConfig } : {}),
    }),
  },
] as const;

const SURFACES = ['grid', 'renderer'] as const;

const CASES = SURFACES.flatMap((surface) => BRANCHES.map((branch) => ({ surface, branch })));

describe.each(CASES)('$surface relay, $branch.name — chartConfig lowered (objectui#4044)', ({ surface, branch }) => {
  const compose = (chartConfig?: Record<string, unknown>) => composeVia(surface, branch.widget(chartConfig));

  it('composes the branch this case is about', async () => {
    // Guards every assertion below against silently measuring the other branch:
    // both widgets carry `type: 'bar'`, and only the data shape forks them.
    expect((await compose()).type).toBe(branch.expectedType);
  });

  it('forwards the chart titles and the accessibility description', async () => {
    const node = await compose({
      title: 'Invoice value',
      subtitle: 'by status',
      description: 'Invoice value by status',
    });
    expect(node.title).toBe('Invoice value');
    expect(node.subtitle).toBe('by status');
    expect(node.description).toBe('Invoice value by status');
  });

  it('forwards an explicit plot height and drops a non-positive one', async () => {
    expect((await compose({ height: 420 })).height).toBe(420);
    expect('height' in (await compose({ height: 0 }))).toBe(false);
    expect('height' in (await compose({ height: -10 }))).toBe(false);
  });

  it('forwards showLegend and showDataLabels in both directions', async () => {
    expect((await compose({ showLegend: false })).showLegend).toBe(false);
    expect((await compose({ showLegend: true })).showLegend).toBe(true);
    expect((await compose({ showDataLabels: true })).showDataLabels).toBe(true);
    expect((await compose({ showDataLabels: false })).showDataLabels).toBe(false);
  });

  it('forwards annotations and the interaction toggles', async () => {
    const node = await compose({
      annotations: [{ type: 'line', axis: 'y', value: 100, label: 'Target' }],
      interaction: { tooltips: false, brush: true },
    });
    expect(node.annotations).toEqual([{ type: 'line', axis: 'y', value: 100, label: 'Target' }]);
    expect(node.interaction).toEqual({ tooltips: false, brush: true });
  });

  it('drops an empty annotations array instead of emitting a dead key', async () => {
    expect('annotations' in (await compose({ annotations: [] }))).toBe(false);
  });

  it('lets an array `colors` override the relay default palette', async () => {
    // This relay pre-sets `colors: CHART_COLORS`, so "the author's palette
    // wins" is a real question here that the dataset path never had to answer.
    expect((await compose({ colors: ['#111111', '#222222'] })).colors).toEqual(['#111111', '#222222']);
  });

  it('lowers a record `colors` as the per-category map, not as the palette', async () => {
    const node = await compose({ colors: { open: '#10B981', paid: '#EF4444' } });
    expect(node.categoryColors).toEqual({ open: '#10B981', paid: '#EF4444' });
    // The positional palette is untouched: a per-category map is consulted
    // FIRST and falls back to the palette, so replacing the default would
    // change the colour of every category the map does not name.
    expect(node.colors).not.toEqual({ open: '#10B981', paid: '#EF4444' });
  });

  it('emits none of the presentation keys when no chartConfig is declared', async () => {
    // The whole point of a whitelist: every dashboard that never wrote
    // `chartConfig` composes exactly what it composed before this card.
    const node = await compose();
    for (const key of [
      'title', 'subtitle', 'description', 'height', 'categoryColors',
      'showLegend', 'showDataLabels', 'annotations', 'interaction',
    ]) {
      expect({ key, present: key in node }).toEqual({ key, present: false });
    }
    expect(Array.isArray(node.colors)).toBe(true);
  });
});

describe.each(CASES)('$surface relay, $branch.name — chartConfig keys REFUSED (objectui#4044)', ({ surface, branch }) => {
  const compose = (chartConfig?: Record<string, unknown>) => composeVia(surface, branch.widget(chartConfig));

  it('emits no xAxis / yAxis / series from chartConfig, leaving the derivation alone', async () => {
    // Spec 17.5.0 refuses `xAxis` / `yAxis` / `series` on a dashboard widget's
    // `chartConfig` at parse, which answered the precedence question
    // objectstack#17385 carried: the derived binding wins. A widget that
    // reaches this relay still carrying them (stored metadata never
    // re-validated) must therefore not have any of the three travel.
    const before = await compose();
    const node = await compose({
      xAxis: { field: 'not_a_column', title: 'Authored X' },
      yAxis: [{ field: 'not_a_measure', min: 0, max: 5 }],
      series: [{ name: 'not_a_measure', stack: 'g' }],
    });
    expect('xAxis' in node).toBe(false);
    expect('yAxis' in node).toBe(false);
    expect(node.series).toEqual(before.series);
    expect(node.xAxisKey).toBe(before.xAxisKey);
  });

  it('emits no chart family from chartConfig.type — the widget type still picks it', async () => {
    const node = await compose({ type: 'pie' });
    expect(node.chartType).toBe('bar');
  });

  it('ignores chartConfig.aria, which nothing on this path reads', async () => {
    // `aria` IS on the ruling's DO-NOW list, so the refusal is measured rather
    // than assumed. Two ablations, both run on this tree: forwarding `aria` as
    // the nested spec object, and forwarding it FLATTENED onto the node's own
    // `ariaLabel` / `ariaDescribedBy` / `role` — members `BaseSchema` already
    // declares and `SchemaRenderer` already turns into DOM attributes, so the
    // flattened route needs no new declaration anywhere. In BOTH runs the only
    // red was this assertion; the DOM sibling's
    // `an authored chartConfig.aria reaches no attribute on this surface`
    // stayed green, i.e. the forwarded key still changed nothing on screen.
    // `ChartRenderer` destructures `{ schema, onChartClick }` and drops the
    // rest, `AdvancedChartImpl` declares no `aria` prop, and
    // `normalizeChartSchema` names neither; the chart's one accessible name
    // comes from `description` (`role="img"` + `aria-label`, pinned there).
    //
    // Delivering `aria` therefore needs a READER inside `@object-ui/plugin-charts`
    // — a new member on a published face — which this card is not authorised to
    // add, and which also has to answer to the accessible name `description`
    // already sets. Reported rather than guessed.
    const node = await compose({ aria: { ariaLabel: 'Authored name', role: 'figure' } });
    expect('aria' in node).toBe(false);
    expect('ariaLabel' in node).toBe(false);
    expect('role' in node).toBe(false);
  });
});
