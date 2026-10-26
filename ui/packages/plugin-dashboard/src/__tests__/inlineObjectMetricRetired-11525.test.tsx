/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11525 — a dataset-less `provider: 'object'` metric widget draws the
 * retired-format placeholder on both dashboard surfaces (maintainer ruling C).
 *
 * ## What changed
 *
 * A single-value widget (`metric`, `gauge`, `solid-gauge`, `kpi`, `bullet`, and
 * a typeless widget, which resolves to `metric` since objectui#11514) with no
 * `dataset` and an `options.data` (or widget-level `data`) of
 * `{ provider: 'object', … }` used to draw a number: both surfaces built a flat
 * `object-metric` node carrying an ObjectQL-dialect `filter`, which no node
 * type declares, and `ObjectMetricWidget` aggregated it. Both metric arms now
 * return `LEGACY_RETIRED_WIDGET_SCHEMA`, the object the pivot arms already
 * return for the same input (objectui#10528), so the tile draws "This widget
 * uses a retired data format. Edit it to bind a dataset." and sends no query.
 *
 * ## How it is read
 *
 * Every node a surface hands `SchemaRenderer` is recorded and then rendered by
 * the real renderer (the objectui#7353 listener), so the placeholder is checked
 * by identity, and the screen and the adapter are read too.
 *
 * ## Direction, stated before the reverse verification
 *
 * RED on the unmodified tree: every case under "the retired path" (the
 * surfaces built an `object-metric` node and queried). GREEN on both sides:
 * every control. The pivot arm is the control for the placeholder itself,
 * the dataset-bound metric for "a metric still draws its number", the static
 * metric and the inline chart and table arms for what this card did not
 * touch, and the envelope case for the filter-broadcast member this card kept.
 *
 * ⚠️ Dated note, 2026-10-03 — the envelope case flipped — objectui#11466. This
 * file pinned that an `object-metric` node in a widget's legacy `component`
 * envelope still drew its number, scoped by the filter bar, because this card
 * kept `object-metric` in the broadcast's filterable set for it. That flat
 * `filter` write is refused by the declared `object-metric` node, and the
 * maintainer's ruling A on objectui#11466 extended ruling C to this last
 * inline metric form: on both surfaces the envelope node now draws
 * `LEGACY_RETIRED_WIDGET_SCHEMA` and sends no query, and `object-metric` left
 * the filterable set. The last block below pins that. The rest of this header
 * is kept as the reading of objectui#11525.
 *
 * ⚠️ Dated note, 2026-10-12 — the broadcast's envelope control retired —
 * objectui#12254. A block here pinned that the dashboard filter bar still
 * scoped an `object-chart` or `object-data-table` node placed in that
 * envelope. The envelope now draws a `metric-card` and nothing else, so both
 * nodes draw the same placeholder and send no query, filter bar or not; that
 * is pinned, with the filter bar set, in `envelopeDrawRetired-12254.test.tsx`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

/**
 * Every node handed to `SchemaRenderer`, in arrival order. Hoisted so the mock
 * factory below can close over it.
 */
const received = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@object-ui/react', async () => {
  const actual: any = await vi.importActual('@object-ui/react');
  const RealSchemaRenderer = actual.SchemaRenderer;
  return {
    ...actual,
    // A listener, not a stub: the node is recorded and then rendered by the
    // REAL renderer. Everything else is the real export by identity.
    SchemaRenderer: (props: any) => {
      if (props?.schema && typeof props.schema === 'object') received.push(props.schema);
      return <RealSchemaRenderer {...props} />;
    },
  };
});

import { SchemaRendererProvider } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import type { DashboardComponentSchema } from '@object-ui/types';
// Side-effect imports at MODULE scope (AGENTS.md's flaky-test rule):
// `@object-ui/components` registers `text` / `data-table`, the package barrel
// registers `object-metric`, `object-data-table` and the metric cards.
import '@object-ui/components';
import { DashboardRenderer, DashboardGridLayout } from '../index';
import { LEGACY_RETIRED_WIDGET_SCHEMA } from '../legacyRetiredWidget';
import { METRIC_LIKE_TYPES, DASHBOARD_NODE_TYPES } from '../widgetDispatch';

// The chart arm is a control here, read off the recorded node. A stub keeps the
// real `object-chart` (and its metadata probe) out of this file.
ComponentRegistry.register('object-chart', () => null, {
  namespace: 'test',
  label: 'object-chart stub',
  category: 'plugin',
});

afterEach(() => {
  cleanup();
  received.length = 0;
});

const PLACEHOLDER = 'This widget uses a retired data format. Edit it to bind a dataset.';

const PROVIDER = { provider: 'object', object: 'deal', aggregate: { field: 'amount', function: 'sum' } } as const;

function makeAdapter() {
  return {
    find: vi.fn(async (_objectName: string, _params?: unknown) => ({ data: [{ id: 'd1', name: 'Acme', amount: 4242 }] })),
    aggregate: vi.fn(async (_objectName: string, _params?: unknown) => [{ amount: 4242 }]),
    queryDataset: vi.fn(async (_dataset: string, _selection?: unknown) => ({ rows: [{ revenue: 510000 }] })),
    getObjectSchema: vi.fn(async (_objectName: string) => ({
      name: 'deal',
      fields: { name: { type: 'text', label: 'Name' }, amount: { type: 'number', label: 'Amount' } },
    })),
  };
}

type Adapter = ReturnType<typeof makeAdapter>;

const dash = (widgets: Record<string, unknown>[], extra: Record<string, unknown> = {}): DashboardComponentSchema =>
  ({ type: 'dashboard', widgets, ...extra }) as unknown as DashboardComponentSchema;

const SURFACES = ['renderer', 'grid'] as const;
type Surface = (typeof SURFACES)[number];

function mount(surface: Surface, widgets: Record<string, unknown>[], adapter: Adapter, extra: Record<string, unknown> = {}) {
  return render(
    <SchemaRendererProvider dataSource={adapter as never}>
      {surface === 'renderer' ? (
        <DashboardRenderer schema={dash(widgets, extra)} dataSource={adapter} />
      ) : (
        <DashboardGridLayout schema={dash(widgets, extra)} dataSource={adapter} />
      )}
    </SchemaRendererProvider>,
  );
}

const nodesOfType = (type: string) => received.filter((n) => n.type === type);

/** The single-value family, read off the dispatch rather than restated. */
const METRIC_FAMILY = [...METRIC_LIKE_TYPES];

/** Each retired input, labelled. */
const RETIRED_CASES: Array<[string, Record<string, unknown>]> = [
  ...METRIC_FAMILY.map((type): [string, Record<string, unknown>] => [
    `\`${type}\` with options.data`,
    { id: 'w1', type, title: 'Pipeline', options: { data: PROVIDER } },
  ]),
  ['`metric` with widget-level data', { id: 'w1', type: 'metric', title: 'Pipeline', data: PROVIDER }],
  // objectui#11514: a typeless widget resolves to `metric`, so it answers too.
  ['a typeless widget with options.data', { id: 'w1', title: 'Pipeline', options: { data: PROVIDER } }],
];

describe.each(SURFACES)('%s surface — the retired path (objectui#11525)', (surface) => {
  it('reads a non-empty single-value family (non-vacuity)', () => {
    expect(METRIC_FAMILY).toContain('metric');
    expect(METRIC_FAMILY.length).toBeGreaterThan(1);
  });

  it.each(RETIRED_CASES)('%s draws the placeholder object and sends no query', async (_label, widget) => {
    const adapter = makeAdapter();
    mount(surface, [widget], adapter);

    await waitFor(() => expect(received).toContain(LEGACY_RETIRED_WIDGET_SCHEMA));
    expect(screen.getByText(PLACEHOLDER)).toBeInTheDocument();
    // The node the branch used to build is gone, and so is its query.
    expect(nodesOfType('object-metric')).toHaveLength(0);
    expect(adapter.aggregate).not.toHaveBeenCalled();
    expect(adapter.find).not.toHaveBeenCalled();
    expect(adapter.queryDataset).not.toHaveBeenCalled();
  });

  it('draws the same tile as the retired top-level `object` metric shape', () => {
    // The chrome is the family's, not the placeholder's: a dataset-less
    // `metric` is self-contained on both surfaces, so the retired provider tile
    // and the retired legacy-shape tile are one tile.
    const adapter = makeAdapter();
    const inline = mount(surface, [{ id: 'w1', type: 'metric', title: 'Pipeline', options: { data: PROVIDER } }], adapter).container.innerHTML;
    cleanup();
    const legacy = mount(surface, [{ id: 'w1', type: 'metric', title: 'Pipeline', object: 'deal', aggregate: 'count' }], adapter).container.innerHTML;
    expect(inline).toContain(PLACEHOLDER);
    expect(inline).toBe(legacy);
  });
});

describe.each(SURFACES)('%s surface — controls (objectui#11525)', (surface) => {
  it('the pivot arm answers a provider pivot with the same placeholder object', async () => {
    const adapter = makeAdapter();
    mount(surface, [{ id: 'w1', type: 'pivot', title: 'Deals', options: { rowField: 'name', valueField: 'amount', data: PROVIDER } }], adapter);
    await waitFor(() => expect(received).toContain(LEGACY_RETIRED_WIDGET_SCHEMA));
    expect(screen.getByText(PLACEHOLDER)).toBeInTheDocument();
  });

  it('a dataset-bound metric still draws its number', async () => {
    const adapter = makeAdapter();
    mount(surface, [{ id: 'w1', type: 'metric', title: 'Revenue', dataset: 'sales', values: ['revenue'] }], adapter);
    expect(await screen.findByText('510000')).toBeInTheDocument();
    expect(adapter.queryDataset).toHaveBeenCalledWith('sales', expect.anything());
    expect(screen.queryByText(PLACEHOLDER)).not.toBeInTheDocument();
  });

  it('a static metric still draws its inline value', async () => {
    const adapter = makeAdapter();
    mount(surface, [{ id: 'w1', type: 'metric', title: 'Static', options: { value: '77' } }], adapter);
    await waitFor(() => expect(nodesOfType(DASHBOARD_NODE_TYPES.metric).length).toBeGreaterThan(0));
    expect(screen.getByText('77')).toBeInTheDocument();
    expect(screen.queryByText(PLACEHOLDER)).not.toBeInTheDocument();
  });

  it('the inline chart arm is untouched: a provider bar still builds an object-chart node', async () => {
    const adapter = makeAdapter();
    mount(surface, [{ id: 'w1', type: 'bar', title: 'Deals', options: { data: PROVIDER } }], adapter);
    await waitFor(() => expect(nodesOfType('object-chart').length).toBeGreaterThan(0));
    expect(nodesOfType('object-chart')[0].objectName).toBe('deal');
    expect(received).not.toContain(LEGACY_RETIRED_WIDGET_SCHEMA);
  });

  it('the inline table arm is untouched: a provider table still fetches its rows', async () => {
    const adapter = makeAdapter();
    mount(surface, [{ id: 'w1', type: 'table', title: 'Deals', options: { data: PROVIDER } }], adapter);
    await waitFor(() => expect(nodesOfType('object-data-table').length).toBeGreaterThan(0));
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(received).not.toContain(LEGACY_RETIRED_WIDGET_SCHEMA);
  });
});

/** The dashboard filter bar, with a default value, so the broadcast applies on first render. */
const REGION_FILTER = {
  globalFilters: [{ name: 'region', field: 'region', type: 'select', options: [{ value: 'EMEA', label: 'EMEA' }], defaultValue: 'EMEA' }],
};

/** The envelope node objectui#11525 kept in the broadcast, written as its pin wrote it. */
const ENVELOPE_OBJECT_METRIC = { objectName: 'deal', aggregate: { field: 'amount', function: 'sum' } };

describe.each(SURFACES)('%s surface — an object-metric in a component envelope is retired (objectui#11466, ruling A)', (surface) => {
  it.each([
    ['its bare key', 'object-metric'],
    ["its registration's full name", 'plugin-dashboard:object-metric'],
  ])('under %s it draws the placeholder object and sends no query', async (_label, type) => {
    const adapter = makeAdapter();
    mount(surface, [{ id: 'w1', title: 'Envelope', component: { type, ...ENVELOPE_OBJECT_METRIC } }], adapter, REGION_FILTER);

    await waitFor(() => expect(received).toContain(LEGACY_RETIRED_WIDGET_SCHEMA));
    expect(screen.getByText(PLACEHOLDER)).toBeInTheDocument();
    expect(nodesOfType(type)).toHaveLength(0);
    expect(adapter.aggregate).not.toHaveBeenCalled();
    expect(adapter.find).not.toHaveBeenCalled();
  });
});
