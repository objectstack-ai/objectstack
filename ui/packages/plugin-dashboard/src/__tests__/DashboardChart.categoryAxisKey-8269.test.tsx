/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8269 — the CATEGORY-axis binding both dashboard relays compose for
 * an object-bound aggregate. The mirror of
 * `DashboardChart.countSeriesKey-8266.test.tsx`, which pins the SERIES binding
 * of the same two sites.
 *
 * ## What was measured before the fix (origin/main `3c6394cb2`)
 *
 * A widget with `provider: 'object'` and `aggregate: { function: 'count',
 * groupBy: 'status' }` and NO `options.xField` — a perfectly ordinary way to
 * author a grouped chart — composed `xAxisKey: 'name'` on BOTH relays, because
 * each floored the binding on a literal:
 *
 *     const xAxisKey = options.xField || 'name';
 *
 * The rows an object-bound aggregate returns are keyed by the raw `groupBy`
 * field, so no row carries `name`, and `hasNoCategoryKey`
 * (`plugin-charts/src/AdvancedChartImpl.tsx`, framework#4033) refused the
 * widget with "no row has a `name` field" — a key the author never wrote,
 * while the `groupBy` they DID write went unmentioned.
 *
 * The picture that produced, and the picture the fix produces, is measured in
 * `plugin-charts/src/ObjectChart.categoryAxisKeyRender-8269.test.tsx`: a seam
 * assertion cannot tell a refusal from a plot, and `recharts` resolves inside
 * `plugin-charts` alone (verified: `require.resolve('recharts')` from
 * `packages/plugin-dashboard` is MODULE_NOT_FOUND, since it is a dependency of
 * `plugin-charts` and pnpm does not hoist it).
 *
 * ## Why the recorder rather than the real chart
 *
 * The decision under test is which column the RELAY names, and it is spelled
 * twice — `DashboardGridLayout` and `DashboardRenderer` each compose their own
 * `object-chart` node. Registering a recorder for the two component types those
 * nodes resolve to reads exactly that, from the real render path, for both
 * surfaces.
 *
 * ## All FOUR `xAxisKey` consumers are settled here, not two
 *
 * Each relay's single `xAxisKey` local feeds TWO composed nodes
 * (`DashboardGridLayout.tsx` 253 + 268, `DashboardRenderer.tsx` 632 + 658 on
 * `3c6394cb2`). They are NOT one decision spelled twice:
 *
 *   - the object-provider node (the first of each pair) is reached with an
 *     aggregate in hand and is what this file's first block fixes;
 *   - the authored-literal node (the second) is reached only AFTER
 *     `isObjectProvider` returns false, for a widget whose rows are a literal
 *     array the author wrote. There is no aggregate to consult and the
 *     author's `xField` names a column of their own rows, so the floor is
 *     CORRECT there and must stay — which the last block pins, in both
 *     directions, so a future "unify the two" refactor cannot quietly break it.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import '@object-ui/components';
// Registers the real `object-chart` / `chart` entries this file then overrides,
// so the override is measured against the production registration order rather
// than against an empty registry.
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

/**
 * The card's authoring shape: `options` carries NO `xField`, which is the whole
 * point — the category is declared once, as `aggregate.groupBy`.
 */
const objectWidget = (aggregate: unknown, options: Record<string, unknown> = {}) => ({
  id: 'w1',
  type: 'bar',
  title: 'By status',
  options,
  data: { provider: 'object', object: 'crm_case', ...(aggregate ? { aggregate } : {}) },
});

const SURFACES = ['grid', 'renderer'] as const;

describe.each(SURFACES)('%s relay — object-bound category axis key (objectui#8269)', (surface) => {
  it('binds a groupBy-only widget to the column the rows carry, not to the name floor', async () => {
    const node = await composeVia(surface, objectWidget({ function: 'count', groupBy: 'status' }));
    // The regression: 'name' here, against rows keyed 'status' — and unlike
    // objectui#8266 this one was LOUD, refusing the whole widget.
    expect(node.xAxisKey).toBe('status');
  });

  it('ignores an authored xField that an object-bound aggregate cannot project', async () => {
    // `xField` names a column of the RECORDS, and a grouped aggregate does not
    // return records. Honouring it refuses the chart for exactly the same
    // reason 'name' did, so the aggregate's own column wins — the same verdict
    // objectui#8266 reached for `yField`.
    const node = await composeVia(
      surface,
      objectWidget({ function: 'count', groupBy: 'status' }, { xField: 'title' }),
    );
    expect(node.xAxisKey).toBe('status');
  });

  it('binds a field-bearing aggregate to its groupBy just the same', async () => {
    const node = await composeVia(surface, objectWidget({ function: 'sum', field: 'amount', groupBy: 'stage' }));
    expect(node.xAxisKey).toBe('stage');
  });

  it('reads a structured groupBy node, and prefers its alias', async () => {
    // `ChartGroupBySchema` admits both spellings; `ObjectChart`'s own fetch path
    // keys the returned rows `alias || field`, so the binding must agree.
    expect(
      (await composeVia(surface, objectWidget({ function: 'count', groupBy: { field: 'closed_at', dateGranularity: 'month' } })))
        .xAxisKey,
    ).toBe('closed_at');
    expect(
      (await composeVia(surface, objectWidget({ function: 'count', groupBy: { field: 'closed_at', alias: 'month' } })))
        .xAxisKey,
    ).toBe('month');
  });

  it('keeps the xField floor for an object provider with NO aggregate', async () => {
    // Rows are raw records here, so the author's xField really is the key —
    // this is the arm a floor that fired too eagerly would have broken.
    expect((await composeVia(surface, objectWidget(null))).xAxisKey).toBe('name');
    expect((await composeVia(surface, objectWidget(null, { xField: 'title' }))).xAxisKey).toBe('title');
  });

  it('keeps the xField floor for an UNGROUPED aggregate, which has no category column', async () => {
    // One row, one number: there is no category for the contract to name, so
    // inventing one would bind an axis to a column that never exists.
    const agg = { function: 'sum', field: 'amount' };
    expect((await composeVia(surface, objectWidget(agg))).xAxisKey).toBe('name');
    expect((await composeVia(surface, objectWidget(agg, { xField: 'title' }))).xAxisKey).toBe('title');
  });

  it('still composes the object node, and still names the measure column', async () => {
    // The category fix rides on the same site objectui#8266 fixed; asserting
    // both halves here means a regression in either is attributed correctly
    // rather than showing up as an unexplained shape change.
    const node = await composeVia(surface, objectWidget({ function: 'count', groupBy: 'status' }));
    expect(node.type).toBe('object-chart');
    expect(node.series[0].dataKey).toBe('count');
  });
});

describe.each(SURFACES)('%s relay — the authored-rows branch is NOT the same decision', (surface) => {
  const literalWidget = (options: Record<string, unknown>) => ({
    id: 'w2',
    type: 'bar',
    title: 'Literal',
    options,
    data: [
      { name: 'open', value: 2, bucket: 'a' },
      { name: 'paid', value: 5, bucket: 'b' },
    ],
  });

  it('binds the authored xField, because there is no aggregate to consult', async () => {
    expect((await composeVia(surface, literalWidget({}))).xAxisKey).toBe('name');
    expect((await composeVia(surface, literalWidget({ xField: 'bucket' }))).xAxisKey).toBe('bucket');
  });

  it('composes the literal `chart` node, not `object-chart`', async () => {
    // The branch discriminator itself: these rows never reach the object path,
    // which is why consulting an aggregate there would be meaningless.
    const node = await composeVia(surface, literalWidget({ xField: 'bucket' }));
    expect(node.type).toBe('chart');
    expect(node.aggregate).toBeUndefined();
    expect(Array.isArray(node.data)).toBe(true);
  });
});
