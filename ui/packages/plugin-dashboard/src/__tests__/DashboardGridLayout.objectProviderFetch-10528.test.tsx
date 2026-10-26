/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10528 — on the editable `dashboard-grid`, a `provider: 'object'`
 * table widget fetches its rows and draws them, and a `provider: 'object'`
 * pivot widget shows the retired-widget placeholder.
 *
 * ## The defect
 *
 * `DashboardGridLayout` mapped a table-family widget whose data is
 * `{ provider: 'object', object }` to a STATIC `data-table` node with
 * `data: []` and `objectName` beside it. `data-table` reads no `objectName`, so
 * the tile drew an empty table and issued no query. The read dashboard
 * (`DashboardRenderer`) maps the same stored widget to `object-data-table`,
 * the self-fetching node, so the two dashboard surfaces disagreed on the same
 * metadata. The pivot arm had the same shape (a static `pivot` node with
 * `data: []`), while the read dashboard showed the retired-widget placeholder
 * for the same pivot.
 *
 * ## The fix, and what this file pins
 *
 * The grid's table arm now emits the same `object-data-table` node, with the
 * same props, that `DashboardRenderer`'s table arm emits. Its pivot arm, for a
 * `provider: 'object'` pivot, now returns the retired-widget placeholder that
 * `DashboardRenderer`'s pivot arm returns (the card's option B: ADR-0021 puts a
 * cross-tab on the dataset layer only). Four things are pinned:
 *
 *  1. The grid composes `object-data-table` (bound through `objectName`, with
 *     no retired `dataProvider`, objectui#7353). The adapter's `find` is called
 *     for that object, and the rows it returns are on screen.
 *  2. Parity: for the same stored widget, the node the grid composes EQUALS the
 *     node `DashboardRenderer` composes. The two surfaces build the table node
 *     separately, so this equality is what stops the two copies from drifting.
 *  3. A provider-object pivot on the grid shows the placeholder, composed as
 *     the SAME object `DashboardRenderer` composes (not a copy), with no `pivot`
 *     node and no query.
 *  4. Lit controls: a static-data table and a static-data pivot on the grid
 *     still draw their authored rows (objectui#4618's `Array.isArray` arm).
 *
 * ## Why a listener, not a recorder
 *
 * The node is recorded and then rendered by the REAL `SchemaRenderer`, so the
 * widget mounts, fetches and draws as it does in production. That is the same
 * shape `widgetDataProviderRetired-7353.test.tsx` uses.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';

/** Every node handed to `SchemaRenderer`, in arrival order. */
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
import type { DashboardComponentSchema } from '@object-ui/types';
// Side-effect imports at MODULE scope (never inside a case or a hook), per
// AGENTS.md's flaky-test rule: `@object-ui/components` registers `data-table`,
// and the package barrel registers `object-data-table` / `pivot`.
import '@object-ui/components';
import { DashboardRenderer, DashboardGridLayout } from '../index';
import { LEGACY_RETIRED_WIDGET_SCHEMA } from '../legacyRetiredWidget';

afterEach(() => {
  cleanup();
  received.length = 0;
});

const ROWS = [
  { id: 'a1', name: 'Acme', region: 'EMEA', amount: 3 },
  { id: 'a2', name: 'Globex', region: 'APAC', amount: 5 },
];

/** A real adapter surface: `find` records every call and answers with ROWS. */
function makeAdapter() {
  return {
    find: vi.fn(async (_objectName: string, _params?: unknown) => ({ data: ROWS })),
    getObjectSchema: vi.fn(async (_objectName: string) => ({
      name: 'account',
      fields: { name: { type: 'text', label: 'Name' }, region: { type: 'text' }, amount: { type: 'number' } },
    })),
  };
}

const dash = (widgets: Record<string, unknown>[]): DashboardComponentSchema =>
  ({ type: 'dashboard', widgets }) as unknown as DashboardComponentSchema;

const nodesOfType = (type: string) => received.filter((n) => n.type === type);

function renderGrid(widget: Record<string, unknown>, adapter = makeAdapter()) {
  render(
    <SchemaRendererProvider dataSource={adapter as never}>
      <DashboardGridLayout schema={dash([widget])} />
    </SchemaRendererProvider>,
  );
  return adapter;
}

describe('objectui#10528 — grid: a provider-object table widget fetches and draws its rows', () => {
  it('composes object-data-table, queries the object, and draws the returned rows', async () => {
    const adapter = renderGrid({
      id: 'accounts',
      type: 'table',
      title: 'Accounts',
      options: { data: { provider: 'object', object: 'account' } },
    });

    // The rows the adapter returned are on screen.
    expect(await screen.findByText('Acme')).toBeTruthy();
    expect(screen.getByText('Globex')).toBeTruthy();

    // The query was issued, and only for the bound object.
    expect(adapter.find).toHaveBeenCalled();
    expect(adapter.find.mock.calls.every(([objectName]) => objectName === 'account')).toBe(true);

    // The node the grid composed is the self-fetching one, bound through
    // objectName, without the key objectui#7353 retired.
    const widgetNodes = nodesOfType('object-data-table');
    expect(widgetNodes.length).toBeGreaterThan(0);
    for (const node of widgetNodes) {
      expect(node.objectName).toBe('account');
      expect(Object.keys(node)).not.toContain('dataProvider');
    }
  });

  it("forwards the provider's filter to the query", async () => {
    const filter = [['region', '=', 'EMEA']];
    const adapter = renderGrid({
      id: 'emea',
      type: 'table',
      title: 'EMEA accounts',
      options: { data: { provider: 'object', object: 'account', filter } },
    });

    await screen.findByText('Acme');
    const params = adapter.find.mock.calls.map(([, p]) => p as { $filter?: unknown });
    expect(params.length).toBeGreaterThan(0);
    expect(params.every((p) => JSON.stringify(p.$filter) === JSON.stringify(filter))).toBe(true);
  });
});

describe('objectui#10528 — grid and renderer compose the same object-data-table node', () => {
  it.each([
    ['a plain table', { type: 'table', options: { data: { provider: 'object', object: 'account' } } }],
    [
      'a table with a provider filter, search and pagination',
      {
        type: 'table',
        searchable: true,
        pagination: true,
        options: { columns: ['name', 'region'], data: { provider: 'object', object: 'account', filter: [['region', '=', 'EMEA']] } },
      },
    ],
    ['a list, which never carries search or pagination chrome', { type: 'list', searchable: true, pagination: true, options: { data: { provider: 'object', object: 'account' } } }],
    [
      'a table with an authored drillDown',
      { type: 'table', options: { drillDown: { enabled: false }, data: { provider: 'object', object: 'account' } } },
    ],
  ])('%s', async (_label, shape) => {
    const widget = { id: 'w1', title: 'Accounts', ...shape };

    const gridAdapter = renderGrid(widget);
    await waitFor(() => expect(nodesOfType('object-data-table').length).toBeGreaterThan(0));
    const gridNode = nodesOfType('object-data-table')[0];
    cleanup();
    received.length = 0;

    const rendererAdapter = makeAdapter();
    render(
      <SchemaRendererProvider dataSource={rendererAdapter as never}>
        <DashboardRenderer schema={dash([widget])} dataSource={rendererAdapter} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(nodesOfType('object-data-table').length).toBeGreaterThan(0));
    const rendererNode = nodesOfType('object-data-table')[0];

    expect(gridNode).toEqual(rendererNode);
    // Non-vacuity: both surfaces really bound the object.
    expect(gridNode.objectName).toBe('account');
    expect(gridAdapter.find).toHaveBeenCalled();
  });
});

describe('objectui#10528 — grid: a provider-object pivot widget shows the retired-widget placeholder', () => {
  const pivotWidget = {
    id: 'account-pivot',
    type: 'pivot',
    title: 'Accounts by region',
    options: {
      rowField: 'region',
      columnField: 'stage',
      valueField: 'amount',
      aggregation: 'sum',
      data: { provider: 'object', object: 'account' },
    },
  };

  it('renders the placeholder, composes no pivot node, and issues no query', async () => {
    const adapter = renderGrid(pivotWidget);

    expect(await screen.findByText(LEGACY_RETIRED_WIDGET_SCHEMA.content)).toBeTruthy();
    expect(received).toContain(LEGACY_RETIRED_WIDGET_SCHEMA);
    expect(nodesOfType('pivot')).toHaveLength(0);
    expect(nodesOfType('object-pivot')).toHaveLength(0);
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('is the same placeholder object DashboardRenderer composes for the same widget', async () => {
    renderGrid(pivotWidget);
    await waitFor(() => expect(received).toContain(LEGACY_RETIRED_WIDGET_SCHEMA));
    cleanup();
    received.length = 0;

    const rendererAdapter = makeAdapter();
    render(
      <SchemaRendererProvider dataSource={rendererAdapter as never}>
        <DashboardRenderer schema={dash([pivotWidget])} dataSource={rendererAdapter} />
      </SchemaRendererProvider>,
    );
    // `toContain` compares by identity: both surfaces hand SchemaRenderer the
    // one shared declaration, never a restated copy of it.
    await waitFor(() => expect(received).toContain(LEGACY_RETIRED_WIDGET_SCHEMA));
    expect(rendererAdapter.find).not.toHaveBeenCalled();
  });
});

describe('objectui#10528 — lit controls: static-data widgets on the grid draw their authored rows', () => {
  it('a static-data table draws its authored rows and issues no query', async () => {
    const adapter = renderGrid({
      id: 'static-table',
      type: 'table',
      title: 'Static',
      options: { data: [{ name: 'Initech', amount: 7 }, { name: 'Umbrella', amount: 9 }] },
    });

    expect(await screen.findByText('Initech')).toBeTruthy();
    expect(screen.getByText('Umbrella')).toBeTruthy();
    expect(nodesOfType('data-table').length).toBeGreaterThan(0);
    expect(nodesOfType('object-data-table')).toHaveLength(0);
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('a static-data pivot draws its authored cross-tab and issues no query', async () => {
    const adapter = renderGrid({
      id: 'static-pivot',
      type: 'pivot',
      title: 'Static pivot',
      options: {
        rowField: 'region',
        columnField: 'stage',
        valueField: 'amount',
        aggregation: 'sum',
        data: [
          { region: 'North', stage: 'won', amount: 4 },
          { region: 'South', stage: 'lost', amount: 6 },
        ],
      },
    });

    const grid = await screen.findByTestId('grid-layout');
    expect(await within(grid).findByText('North')).toBeTruthy();
    expect(within(grid).getByText('South')).toBeTruthy();
    expect(nodesOfType('pivot').length).toBeGreaterThan(0);
    expect(adapter.find).not.toHaveBeenCalled();
  });
});
