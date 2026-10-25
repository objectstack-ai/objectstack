/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10815 — a dataset-bound dashboard widget (`DatasetWidget`) re-reads
 * when the data-invalidation bus (`notifyDataChanged` from `@object-ui/react`)
 * reports a write to the object its dataset is built on, in place.
 *
 * Its `queryDataset` effect named no nonce, so a write declared on the bus (a
 * page action over raw HTTP, a flow, a server action) left the widget stale
 * until something remounted it. It now names the `useDataInvalidation` nonce
 * the objectui#10623 / objectui#10778 way. A dataset node carries no
 * `objectName`, so the object is the one the query's ANSWER names (`object`),
 * kept in state from the answer: the same subscription key `ObjectChart` uses
 * for a dataset-bound chart (objectui#10035).
 *
 * The re-read keeps the widget mounted: the current rows stay on screen under a
 * `RefreshIndicator`, never the loading skeleton, and the same table node is
 * there after it (AGENTS.md #8: refresh data, don't rebuild UI).
 *
 * Rendered on the page path: the real `SchemaRenderer` under a
 * `SchemaRendererProvider`, this package's own registration, no host prop. The
 * bare `useDataInvalidation` reader mounted beside the block is the positive
 * control: it proves the event reached subscribers in this harness.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, notifyDataChanged, useDataInvalidation } from '@object-ui/react';
// Side-effect imports at MODULE scope (AGENTS.md's flaky-test rule).
import '@object-ui/components';
import './index';
import { DashboardGridLayout } from './DashboardGridLayout';
import type { DataSource } from '@object-ui/types';

/**
 * The fakes implement only what these cases read, so they are handed over as
 * the adapter the provider declares, and the node as the stored metadata it
 * represents.
 */
type StoredNode = Parameters<typeof SchemaRenderer>[0]['schema'];
const asAdapter = (fake: object) => fake as unknown as DataSource;

beforeEach(() => {
  // The dimension-label metadata probe falls back to the global fetch when the
  // provider carries no `apiFetch`; answer it locally. Not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 150)));

type Answer = { rows: Array<Record<string, unknown>>; fields: unknown[]; object?: string; dimensionFields?: Record<string, string> };

/**
 * A `queryDataset`-capable adapter. `label` is what the next answer paints;
 * `hold()` parks the next answer until `release()` so a case can look at the
 * widget while a re-read is in flight.
 */
function makeDatasetSource(opts: { object?: string } = { object: 'deal' }) {
  let label = 'Won';
  let parked: { resolve: () => void } | null = null;
  let holdNext = false;
  const answer = (): Answer => ({
    rows: [{ stage: label, deal_count: 3 }],
    fields: [
      { name: 'stage', type: 'string', label: 'Stage' },
      { name: 'deal_count', type: 'number', label: 'Deals' },
    ],
    ...(opts.object ? { object: opts.object, dimensionFields: { stage: 'stage' } } : {}),
  });
  return {
    relabel(next: string) {
      label = next;
    },
    hold() {
      holdNext = true;
    },
    release() {
      parked?.resolve();
      parked = null;
    },
    queryDataset: vi.fn((_dataset: string, _selection?: unknown) => {
      if (!holdNext) return Promise.resolve(answer());
      holdNext = false;
      return new Promise<Answer>((resolve) => {
        parked = { resolve: () => resolve(answer()) };
      });
    }),
  };
}

/** The positive control: a bare reader of the dataset's base object, beside the block. */
function BusControl() {
  const nonce = useDataInvalidation('deal');
  return <span data-testid="bus-control">{nonce}</span>;
}

const TABLE_WIDGET = { id: 'by_stage', type: 'table', title: 'By stage', dataset: 'deals', dimensions: ['stage'], values: ['deal_count'] };
const dashboard = (type = 'dashboard') => ({ type, widgets: [TABLE_WIDGET] });

const renderOnPage = (schema: Record<string, unknown>, ds: ReturnType<typeof makeDatasetSource>) =>
  render(
    <SchemaRendererProvider dataSource={asAdapter(ds)}>
      <BusControl />
      <SchemaRenderer schema={schema as unknown as StoredNode} />
    </SchemaRendererProvider>,
  );

describe('a dataset-bound dashboard widget re-reads on the data-invalidation bus (objectui#10815)', () => {
  it('an unscoped change (objectName "*") re-runs its query once, in place', async () => {
    const ds = makeDatasetSource();
    const { getByTestId } = renderOnPage(dashboard(), ds);
    const table = (await screen.findByText('Won')).closest('table');
    expect(table).not.toBeNull();
    await settle();
    expect(ds.queryDataset).toHaveBeenCalledTimes(1);

    ds.relabel('Won (after the write)');
    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();

    expect(getByTestId('bus-control').textContent, 'control: the event never reached a subscriber').toBe('1');
    expect(ds.queryDataset, 'the widget never re-read after the bus reported a change').toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Won (after the write)')).toBeInTheDocument();
    // In place: the same table node, so the widget's sort and drill state survive.
    expect(screen.getByText('Won (after the write)').closest('table'), 'the table was remounted by the re-read').toBe(table);
  });

  it('a change to the dataset’s own object re-runs its query once; another object does not', async () => {
    const ds = makeDatasetSource();
    const { getByTestId } = renderOnPage(dashboard(), ds);
    await screen.findByText('Won');
    await settle();
    expect(ds.queryDataset).toHaveBeenCalledTimes(1);

    await act(async () => {
      notifyDataChanged({ objectName: 'some_other_object' });
    });
    await settle();
    expect(ds.queryDataset, 'a change to another object re-read this widget').toHaveBeenCalledTimes(1);

    await act(async () => {
      notifyDataChanged({ objectName: 'deal', recordId: '1' });
    });
    await settle();
    expect(getByTestId('bus-control').textContent).toBe('1');
    expect(ds.queryDataset).toHaveBeenCalledTimes(2);
  });

  it('keeps the current rows under a refresh indicator while the re-read is in flight, never the skeleton', async () => {
    const ds = makeDatasetSource();
    renderOnPage(dashboard(), ds);
    const table = (await screen.findByText('Won')).closest('table');
    await settle();
    expect(screen.queryByTestId('refresh-indicator')).toBeNull();

    ds.hold();
    ds.relabel('Lost');
    await act(async () => {
      notifyDataChanged({ objectName: 'deal' });
    });
    await settle();

    expect(ds.queryDataset).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('dataset-loading'), 'the re-read swapped the widget for its loading skeleton').toBeNull();
    expect(screen.getByText('Won').closest('table'), 'the current rows left the screen during the re-read').toBe(table);
    expect(screen.getByTestId('refresh-indicator')).toBeInTheDocument();

    await act(async () => {
      ds.release();
    });
    await settle();
    expect(screen.getByText('Lost').closest('table')).toBe(table);
    expect(screen.queryByTestId('refresh-indicator')).toBeNull();
  });

  // `DashboardGridLayout` is mounted directly: its `dashboard-grid` node key was
  // retired by objectui#10859 batch 8, and the component is what still ships.
  it('the same reader serves a `DashboardGridLayout` block’s dataset widget', async () => {
    const ds = makeDatasetSource();
    // The adapter goes in as the component's own `dataSource` prop — what
    // `SchemaRenderer` forwarded to it when it was reached by node key.
    render(
      <>
        <BusControl />
        <DashboardGridLayout schema={dashboard() as never} dataSource={ds} />
      </>,
    );
    await screen.findByText('Won');
    await settle();
    expect(ds.queryDataset).toHaveBeenCalledTimes(1);

    await act(async () => {
      notifyDataChanged({ objectName: 'deal' });
    });
    await settle();
    expect(ds.queryDataset).toHaveBeenCalledTimes(2);
  });

  it('a widget whose adapter cannot run dataset queries subscribes to nothing and keeps its alert', async () => {
    const find = vi.fn(async () => ({ data: [], total: 0 }));
    const { getByTestId } = render(
      <SchemaRendererProvider dataSource={asAdapter({ find })}>
        <BusControl />
        <SchemaRenderer schema={dashboard() as unknown as StoredNode} />
      </SchemaRendererProvider>,
    );
    expect(await screen.findByText('This data source does not support dataset queries.')).toBeInTheDocument();

    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();
    expect(getByTestId('bus-control').textContent).toBe('1');
    expect(screen.getByText('This data source does not support dataset queries.')).toBeInTheDocument();
    expect(find).not.toHaveBeenCalled();
  });
});
