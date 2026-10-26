/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10815 — a `dashboard` block held on a page loads its dataset-bound
 * widgets from the page's adapter.
 *
 * A page renders its blocks through `SchemaRenderer` under the host's
 * `SchemaRendererProvider`, and passes no `dataSource` prop to any of them:
 * `SchemaRenderer` strips the node's `dataSource` key (it is the spec's element
 * BINDING, objectstack#5576) and injects no adapter prop. `DashboardRenderer`
 * read its adapter from its props only, so on that path every dataset-bound
 * widget issued zero `queryDataset` calls and painted "This data source does
 * not support dataset queries." although the page held a capable adapter.
 *
 * The renderer now resolves its adapter the way the page-embeddable blocks of
 * the family do (`useResolvedDataSource` from `@object-ui/react`): an explicit
 * prop first, the `SchemaRendererProvider` context second. The visible alert
 * stays for a host that really has no capable adapter (the controls below).
 *
 * Every case renders the block the way `PageView` does: the real
 * `SchemaRenderer`, this package's own registration, and no host prop unless
 * the case is about one.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Side-effect imports at MODULE scope (AGENTS.md's flaky-test rule):
// `@object-ui/components` and `@object-ui/plugin-charts` register what the
// widgets render onward (`chart` for the bar widget), the package entry
// registers `dashboard`.
import '@object-ui/components';
import '@object-ui/plugin-charts';
import './index';
import { DashboardRenderer } from './DashboardRenderer';
import type { DashboardComponentSchema, DataSource } from '@object-ui/types';

/**
 * The fakes implement only what these cases read (`queryDataset`, or `find`
 * for the incapable control), so they are handed over as the adapter the
 * provider declares, and the node as the stored metadata it represents.
 */
type StoredNode = Parameters<typeof SchemaRenderer>[0]['schema'];
const asAdapter = (fake: object) => fake as unknown as DataSource;

beforeEach(() => {
  // The dimension-label metadata probe (`useDatasetDimensionMeta`) falls back
  // to the global fetch when the provider carries no `apiFetch`; answer it
  // locally so no case reaches the network. It is not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const UNSUPPORTED = 'This data source does not support dataset queries.';

/** A `queryDataset`-capable adapter whose answers name the dataset's base object. */
function makeDatasetSource(label = 'Won') {
  return {
    queryDataset: vi.fn(async (_dataset: string, selection: { dimensions?: string[] }) => {
      const grouped = (selection?.dimensions ?? []).length > 0;
      return {
        rows: grouped ? [{ stage: label, deal_count: 3 }] : [{ deal_count: 7 }],
        fields: [
          { name: 'stage', type: 'string', label: 'Stage' },
          { name: 'deal_count', type: 'number', label: 'Deals' },
        ],
        object: 'deal',
        dimensionFields: { stage: 'stage' },
      };
    }),
  };
}

const DASHBOARD = {
  type: 'dashboard',
  widgets: [
    { id: 'by_stage', type: 'table', title: 'By stage', dataset: 'deals', dimensions: ['stage'], values: ['deal_count'] },
    { id: 'stage_bar', type: 'bar', title: 'Stage bar', dataset: 'deals', dimensions: ['stage'], values: ['deal_count'] },
    { id: 'total', type: 'metric', title: 'Total', dataset: 'deals', values: ['deal_count'] },
  ],
};

const datasetCalls = (src: ReturnType<typeof makeDatasetSource>) =>
  src.queryDataset.mock.calls.filter(([name]) => name === 'deals').length;

describe('a `dashboard` block on the page path reads the ambient adapter (objectui#10815)', () => {
  it('its dataset widgets query the provider’s adapter and paint the answer, with no host prop', async () => {
    const ambient = makeDatasetSource();
    render(
      <SchemaRendererProvider dataSource={asAdapter(ambient)}>
        <SchemaRenderer schema={DASHBOARD as unknown as StoredNode} />
      </SchemaRendererProvider>,
    );

    // One read per dataset widget (table, bar, metric).
    await waitFor(() => expect(datasetCalls(ambient)).toBe(3));
    // The table widget painted the answer's row, and the metric its value.
    const cell = await screen.findByText('Won');
    expect(cell.closest('table'), 'the table widget did not paint its rows').not.toBeNull();
    expect(await screen.findByText('7')).toBeInTheDocument();
    // No widget shows the no-adapter diagnostic, and none is left loading.
    await waitFor(() => expect(screen.queryAllByTestId('dataset-loading')).toHaveLength(0));
    expect(screen.queryByText(UNSUPPORTED)).not.toBeInTheDocument();
  });

  it('control: with no adapter anywhere, every dataset widget still shows the visible alert', async () => {
    render(<SchemaRenderer schema={DASHBOARD as unknown as StoredNode} />);
    await waitFor(() => expect(screen.getAllByText(UNSUPPORTED)).toHaveLength(3));
    for (const message of screen.getAllByText(UNSUPPORTED)) {
      expect(message.closest('[role="alert"]')).not.toBeNull();
    }
  });

  it('control: a provider that binds no adapter (`null`) still shows the alert', async () => {
    render(
      <SchemaRendererProvider dataSource={null}>
        <SchemaRenderer schema={DASHBOARD as unknown as StoredNode} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(screen.getAllByText(UNSUPPORTED)).toHaveLength(3));
  });

  it('control: an ambient adapter without `queryDataset` is not a capable one, and the alert stays', async () => {
    const find = vi.fn(async () => ({ data: [], total: 0 }));
    render(
      <SchemaRendererProvider dataSource={asAdapter({ find })}>
        <SchemaRenderer schema={DASHBOARD as unknown as StoredNode} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(screen.getAllByText(UNSUPPORTED)).toHaveLength(3));
  });

  it('an explicit `dataSource` prop still wins over the ambient adapter', async () => {
    const ambient = makeDatasetSource('Ambient');
    const explicit = makeDatasetSource('Explicit');
    render(
      <SchemaRendererProvider dataSource={asAdapter(ambient)}>
        <DashboardRenderer schema={DASHBOARD as unknown as DashboardComponentSchema} dataSource={explicit} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(datasetCalls(explicit)).toBe(3));
    const table = (await screen.findByText('Explicit')).closest('table');
    expect(table).not.toBeNull();
    expect(within(table as HTMLElement).queryByText('Ambient')).toBeNull();
    expect(ambient.queryDataset, 'the ambient adapter was read although the host passed one').not.toHaveBeenCalled();
  });

  it('a host prop handed through `SchemaRenderer` also wins over the ambient adapter', async () => {
    const ambient = makeDatasetSource('Ambient');
    const explicit = makeDatasetSource('Explicit');
    render(
      <SchemaRendererProvider dataSource={asAdapter(ambient)}>
        <SchemaRenderer schema={DASHBOARD as unknown as StoredNode} dataSource={explicit} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(datasetCalls(explicit)).toBe(3));
    expect(await screen.findByText('Explicit')).toBeInTheDocument();
    expect(ambient.queryDataset).not.toHaveBeenCalled();
  });
});
