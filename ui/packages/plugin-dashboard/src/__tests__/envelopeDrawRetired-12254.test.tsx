/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12254 — a widget's legacy `component` envelope draws a `metric-card`
 * and nothing else, on both dashboard surfaces.
 *
 * ## What changed
 *
 * Since objectui#12163 (ruling C) both zod faces and
 * `DashboardWidgetSchema['component']` take a `metric-card` only in the
 * envelope (`{ id, component, layout }`, objectui's own format) and refuse any
 * other node by name. The surfaces still drew whatever a stored envelope held.
 * After a census of stored use found no producer, `DashboardRenderer` and
 * `DashboardGridLayout` draw the rule the faces state: a `metric-card` draws as
 * before, and any other node draws `LEGACY_RETIRED_WIDGET_SCHEMA`, the rebind
 * prompt, and sends no query. One predicate decides it for both,
 * `isRetiredEnvelopeNode`.
 *
 * ## How it is read
 *
 * Every node a surface hands `SchemaRenderer` is recorded and then rendered by
 * the real renderer (the listener `inlineObjectMetricRetired-11525.test.tsx`
 * uses), so the placeholder is checked by identity, and the screen and the
 * adapter are read too. Each retired input is also run through the zod face,
 * so the pin states that the draw refuses what authoring refuses.
 *
 * ## Direction, stated before the reverse verification
 *
 * RED with the old branch planted back: every case under "the retired draw"
 * (the surfaces handed the node itself to the renderer, and an `object-chart`
 * or `object-data-table` node queried) and the `custom` widget with no
 * `component` on `DashboardRenderer`. GREEN on both sides: the `metric-card`
 * CONTROL. The `object-metric` envelope pin objectui#11466 wrote, in the 11525
 * file, is unchanged and green on both sides.
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
import { DashboardWidgetSchema as DashboardWidgetZod } from '@object-ui/types/zod';
// Side-effect imports at MODULE scope (AGENTS.md's flaky-test rule):
// `@object-ui/components` registers `text` / `card` / `data-table`, the
// package barrel registers `object-data-table` and the metric cards.
import '@object-ui/components';
import { DashboardRenderer, DashboardGridLayout } from '../index';
import { LEGACY_RETIRED_WIDGET_SCHEMA } from '../legacyRetiredWidget';
import { DASHBOARD_NODE_TYPES, unsupportedWidgetSchema } from '../widgetDispatch';

// A stub keeps the real `object-chart` (and its metadata probe) out of this
// file. Under the old branch the envelope's `object-chart` node reaches it,
// and is recorded on the way.
ComponentRegistry.register('object-chart', () => null, {
  namespace: 'test',
  label: 'object-chart stub',
  category: 'plugin',
});

afterEach(() => {
  cleanup();
  received.length = 0;
});

const PLACEHOLDER = LEGACY_RETIRED_WIDGET_SCHEMA.content;

function makeAdapter() {
  return {
    find: vi.fn(async (_objectName: string, _params?: unknown) => ({ data: [{ id: 'd1', name: 'Acme', amount: 4242 }] })),
    aggregate: vi.fn(async (_objectName: string, _params?: unknown) => [{ name: 'Acme', amount: 4242 }]),
    queryDataset: vi.fn(async (_dataset: string, _selection?: unknown) => ({ rows: [] })),
    getObjectSchema: vi.fn(async (_objectName: string) => ({
      name: 'deal',
      fields: { name: { type: 'text', label: 'Name' }, amount: { type: 'number', label: 'Amount' } },
    })),
  };
}

type Adapter = ReturnType<typeof makeAdapter>;

/** The dashboard filter bar, with a default value, so the broadcast would apply on first render. */
const REGION_FILTER = {
  globalFilters: [{ name: 'region', field: 'region', type: 'select', options: [{ value: 'EMEA', label: 'EMEA' }], defaultValue: 'EMEA' }],
};

const dash = (widgets: Record<string, unknown>[]): DashboardComponentSchema =>
  ({ type: 'dashboard', widgets, ...REGION_FILTER }) as unknown as DashboardComponentSchema;

const SURFACES = ['renderer', 'grid'] as const;
type Surface = (typeof SURFACES)[number];

/** Stored metadata is what a surface receives, so it crosses the declared type once, here. */
function mount(surface: Surface, widget: Record<string, unknown>, adapter: Adapter) {
  return render(
    <SchemaRendererProvider dataSource={adapter as never}>
      {surface === 'renderer' ? (
        <DashboardRenderer schema={dash([widget])} dataSource={adapter} />
      ) : (
        <DashboardGridLayout schema={dash([widget])} dataSource={adapter} />
      )}
    </SchemaRendererProvider>,
  );
}

const nodesOfType = (type: string) => received.filter((n) => n.type === type);

/** Does the zod face refuse the widget at `component`? */
const refusedAtComponent = (widget: Record<string, unknown>) => {
  const verdict = DashboardWidgetZod.safeParse(widget);
  return !verdict.success && verdict.error.issues.some((i) => i.path[0] === 'component');
};

const ENVELOPE_CHART = {
  type: 'object-chart',
  objectName: 'deal',
  chartType: 'bar',
  aggregate: { field: 'amount', function: 'sum', groupBy: 'name' },
  xAxisKey: 'name',
  series: [{ dataKey: 'amount' }],
};

/**
 * Each non-`metric-card` envelope input, labelled, with the node type it
 * carried when no other node on the page has that type. A `text` node is read
 * by its marker instead: the placeholder is a `text` node too.
 */
const RETIRED_CASES: Array<[string, unknown, string | undefined]> = [
  ['a `custom` widget\'s `text` node', { type: 'text', content: 'ENVELOPE-TEXT' }, undefined],
  ['an `object-chart` node', ENVELOPE_CHART, 'object-chart'],
  ['an `object-data-table` node', { type: 'object-data-table', objectName: 'deal' }, 'object-data-table'],
  ['a `card` node', { type: 'card', title: 'ENVELOPE-CARD' }, 'card'],
  ['a node with no `type`', { content: 'ENVELOPE-UNTYPED' }, undefined],
  // The slot's accept set is the widget-vocabulary spelling both faces take;
  // the namespaced node key the surfaces hand the renderer is not authorable here.
  ['the namespaced node key of a metric card', { type: DASHBOARD_NODE_TYPES['metric-card'], value: 'ENVELOPE-NS' }, DASHBOARD_NODE_TYPES['metric-card']],
  ['a string', 'ENVELOPE-STRING', undefined],
  ['a number', 5, undefined],
  ['`true`', true, undefined],
];

describe.each(SURFACES)('%s surface — the retired draw (objectui#12254)', (surface) => {
  it.each(RETIRED_CASES)('%s draws the placeholder object and sends no query', async (_label, component, nodeType) => {
    const widget = { id: 'w1', type: 'custom', title: 'Envelope', component };
    // Authoring refuses the same input (objectui#12163), so the draw and the face agree.
    expect(refusedAtComponent(widget)).toBe(true);

    const adapter = makeAdapter();
    const { container } = mount(surface, widget, adapter);

    await waitFor(() => expect(received).toContain(LEGACY_RETIRED_WIDGET_SCHEMA));
    expect(screen.getByText(PLACEHOLDER)).toBeInTheDocument();
    // The node itself is never handed to the renderer, and nothing it would draw is on screen.
    if (nodeType) expect(nodesOfType(nodeType)).toHaveLength(0);
    expect(received.filter((n) => JSON.stringify(n).includes('ENVELOPE-'))).toEqual([]);
    expect(container.textContent).not.toMatch(/ENVELOPE-/);
    expect(adapter.aggregate).not.toHaveBeenCalled();
    expect(adapter.find).not.toHaveBeenCalled();
    expect(adapter.queryDataset).not.toHaveBeenCalled();
  });

  it.each([
    ['an `object-chart` node', ENVELOPE_CHART],
    ['a number', 5],
    ['`true`', true],
  ])('a typeless envelope holding %s keeps its card heading around the placeholder', async (_label, component) => {
    const adapter = makeAdapter();
    const { container } = mount(surface, { id: 'w1', title: 'Envelope', component }, adapter);
    await waitFor(() => expect(received).toContain(LEGACY_RETIRED_WIDGET_SCHEMA));
    expect(container.textContent).toContain('Envelope');
    expect(container.textContent).toContain(PLACEHOLDER);
    expect(nodesOfType('object-chart')).toHaveLength(0);
    expect(adapter.aggregate).not.toHaveBeenCalled();
  });

  it('a `custom` widget with no `component` draws the labelled placeholder an unsupported family draws', async () => {
    const adapter = makeAdapter();
    mount(surface, { id: 'w1', type: 'custom', title: 'Envelope' }, adapter);
    await waitFor(() => expect(received).toContainEqual(unsupportedWidgetSchema('custom')));
    expect(received).not.toContain(LEGACY_RETIRED_WIDGET_SCHEMA);
  });
});

describe.each(SURFACES)('%s surface — CONTROL: a `metric-card` envelope draws as before (objectui#12254)', (surface) => {
  const CARD = { type: 'metric-card', title: 'Revenue', value: '$24k' } as const;

  it.each([
    ['a typeless envelope', { id: 'w1', title: 'Envelope', component: CARD }],
    ['a `custom` widget', { id: 'w1', type: 'custom', title: 'Envelope', component: CARD }],
  ])('%s holding a `metric-card` draws the card under its namespaced node key', async (_label, widget) => {
    // Authoring accepts the card at `component`.
    expect(refusedAtComponent(widget)).toBe(false);

    const adapter = makeAdapter();
    mount(surface, widget, adapter);
    expect(await screen.findByText('$24k')).toBeInTheDocument();
    expect(nodesOfType(DASHBOARD_NODE_TYPES['metric-card'])).toContainEqual({ ...CARD, type: DASHBOARD_NODE_TYPES['metric-card'] });
    expect(received).not.toContain(LEGACY_RETIRED_WIDGET_SCHEMA);
    expect(screen.queryByText(PLACEHOLDER)).not.toBeInTheDocument();
  });
});
