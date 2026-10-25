/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8266 — the series binding both dashboard relays compose for an
 * object-bound aggregate.
 *
 * ## What was measured before the fix (origin/main `0fa7a9c83`)
 *
 * A widget with `provider: 'object'` and `aggregate: { function: 'count',
 * groupBy: 'status' }` — no `field`, the normal way to author "how many records
 * per status" — composed `series: [{ dataKey: 'value' }]` on BOTH relays, while
 * the rows an object-bound fieldless count carries are keyed `'count'` (the
 * alias the engine projects `COUNT(*)` under; pinned since framework#3701 by
 * `plugin-charts/src/ObjectChart.aggregateResultColumns.test.ts`).
 *
 * The picture that produced is measured in the sibling file
 * `plugin-charts/src/ObjectChart.countSeriesKeyRender-8266.test.tsx`, because a
 * seam assertion cannot tell a honoured `dataKey` from an ignored one and
 * `recharts` resolves inside `plugin-charts` alone. Short version: a
 * `.recharts-surface` with the category ticks drawn, ZERO marks, no refusal and
 * no empty state — indistinguishable from "this object has no rows".
 *
 * ## Why the recorder rather than the real chart
 *
 * The decision under test is which column the RELAY names, and it is spelled
 * twice — `DashboardGridLayout` and `DashboardRenderer` each compose their own
 * `object-chart` node. Registering a recorder for the two component types those
 * nodes resolve to reads exactly that, from the real render path, for both
 * surfaces, without depending on anything the chart layer does afterwards.
 *
 * ## The third spelling, settled
 *
 * `DashboardGridLayout` and `DashboardRenderer` each ALSO build
 * `series: [{ dataKey: yField }]` from the RAW `yField` twenty-odd lines below
 * the aggregate site. That is a different branch, not a third spelling of one
 * decision: it is reached only after `isObjectProvider` returns false, for a
 * widget whose rows are an AUTHORED literal array. There is no aggregate to
 * consult there and the author's `yField` names a column in their own rows, so
 * it must keep reading `yField` — which the last describe block pins, in both
 * directions, so a future "unify the two" refactor cannot quietly break it.
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

const objectWidget = (aggregate: unknown, options: Record<string, unknown> = { xField: 'status' }) => ({
  id: 'w1',
  type: 'bar',
  title: 'By status',
  options,
  data: { provider: 'object', object: 'crm_case', ...(aggregate ? { aggregate } : {}) },
});

const SURFACES = ['grid', 'renderer'] as const;

describe.each(SURFACES)('%s relay — object-bound aggregate series key (objectui#8266)', (surface) => {
  it('binds a FIELDLESS count to the column the rows carry, not to the yField floor', async () => {
    const node = await composeVia(surface, objectWidget({ function: 'count', groupBy: 'status' }));
    // The regression: 'value' here, against rows keyed 'count'.
    expect(node.series[0].dataKey).toBe('count');
  });

  it('ignores an authored yField that an object-bound aggregate cannot project', async () => {
    // `yField` names a column of the RECORDS, and a grouped aggregate does not
    // return records. Honouring it plots nothing for exactly the same reason
    // 'value' did, so the aggregate's own column wins.
    const node = await composeVia(
      surface,
      objectWidget({ function: 'count', groupBy: 'status' }, { xField: 'status', yField: 'amount' }),
    );
    expect(node.series[0].dataKey).toBe('count');
  });

  it('still binds a field-bearing aggregate to its raw field', async () => {
    const node = await composeVia(surface, objectWidget({ function: 'sum', field: 'amount', groupBy: 'status' }));
    expect(node.series[0].dataKey).toBe('amount');
  });

  it('still binds a count that DOES name a field to that field', async () => {
    const node = await composeVia(surface, objectWidget({ function: 'count', field: 'amount', groupBy: 'status' }));
    expect(node.series[0].dataKey).toBe('amount');
  });

  it('keeps the yField floor for an object provider with NO aggregate', async () => {
    // Rows are raw records here, so the author's yField really is the key —
    // this is the arm a floor that fired too eagerly would have broken.
    expect((await composeVia(surface, objectWidget(null))).series[0].dataKey).toBe('value');
    expect(
      (await composeVia(surface, objectWidget(null, { xField: 'status', yField: 'amount' }))).series[0].dataKey,
    ).toBe('amount');
  });
});

describe.each(SURFACES)('%s relay — the authored-rows branch is NOT the same decision', (surface) => {
  const literalWidget = (options: Record<string, unknown>) => ({
    id: 'w2',
    type: 'bar',
    title: 'Literal',
    options,
    data: [
      { name: 'open', value: 2, hours: 7 },
      { name: 'paid', value: 5, hours: 9 },
    ],
  });

  it('binds the authored yField, because there is no aggregate to consult', async () => {
    expect((await composeVia(surface, literalWidget({}))).series[0].dataKey).toBe('value');
    expect((await composeVia(surface, literalWidget({ yField: 'hours' }))).series[0].dataKey).toBe('hours');
  });

  it('composes the literal `chart` node, not `object-chart`', async () => {
    // The branch discriminator itself: these rows never reach the object path,
    // which is why consulting an aggregate there would be meaningless.
    const node = await composeVia(surface, literalWidget({ yField: 'hours' }));
    expect(node.type).toBe('chart');
    expect(node.aggregate).toBeUndefined();
    expect(Array.isArray(node.data)).toBe(true);
  });
});
