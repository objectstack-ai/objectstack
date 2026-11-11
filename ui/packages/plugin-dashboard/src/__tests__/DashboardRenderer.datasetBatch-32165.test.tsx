/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#32165 — one dashboard render sends its widgets' dataset queries
 * as ONE batch request (`queryDatasetBatch`), not one request per widget.
 *
 * Each widget keeps its own query, answer and refusal: the batch answers one
 * outcome per query, and a refused query reaches only its widget, drawn as the
 * single door's refusal of it is drawn. A data source with no batch door, and
 * a widget alone in its render window (a one-widget refetch), use the single
 * door unchanged.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { notifyDataChanged } from '@object-ui/react';
import type { DashboardComponentSchema } from '@object-ui/types';
// Side-effect imports at MODULE scope (ui AGENTS.md's flaky-test rule): the
// widgets render onward through the registry.
import '@object-ui/components';
import '@object-ui/plugin-charts';
import '../index';
import { DashboardRenderer } from '../DashboardRenderer';
import { DashboardGridLayout } from '../DashboardGridLayout';

beforeEach(() => {
  // The dimension-label metadata probe falls back to the global fetch; answer
  // it locally so no case reaches the network.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

type Selection = { dimensions?: string[]; measures?: string[] };

/** What the fake answers for one query: a row per dimension value, or one total. */
function answerFor(dataset: string, selection: Selection) {
  const object = dataset === 'accounts' ? 'account' : 'deal';
  const grouped = (selection?.dimensions ?? []).length > 0;
  return {
    rows: grouped ? [{ stage: `${dataset}-row`, n: 3 }] : [{ n: dataset === 'accounts' ? 11 : 7 }],
    fields: [
      { name: 'stage', type: 'string', label: 'Stage' },
      { name: 'n', type: 'number', label: 'Count' },
    ],
    object,
    dimensionFields: { stage: 'stage' },
  };
}

/**
 * A data source with both doors. `refuse` names a dataset whose query is
 * refused with `refusal`, by whichever door answers it.
 */
function makeSource({ batch = true, refuse, refusal }: { batch?: boolean; refuse?: string; refusal?: Error } = {}) {
  const single = vi.fn(async (dataset: string, selection: Selection) => {
    if (dataset === refuse) throw refusal;
    return answerFor(dataset, selection);
  });
  const batchDoor = vi.fn(async (queries: Array<{ dataset: string; selection: Selection }>, _options?: { packageId?: string; callerPackage?: string }) =>
    queries.map(({ dataset, selection }) => (dataset === refuse
      ? { status: 'rejected' as const, reason: refusal }
      : { status: 'fulfilled' as const, value: answerFor(dataset, selection) })));
  return {
    single,
    batchDoor,
    source: batch ? { queryDataset: single, queryDatasetBatch: batchDoor } : { queryDataset: single },
  };
}

const DASHBOARD = {
  type: 'dashboard',
  widgets: [
    { id: 'by_stage', type: 'table', title: 'By stage', dataset: 'deals', dimensions: ['stage'], values: ['n'] },
    { id: 'total', type: 'metric', title: 'Total', dataset: 'deals', values: ['n'] },
    { id: 'accounts_total', type: 'metric', title: 'Accounts', dataset: 'accounts', values: ['n'] },
    { id: 'pipeline', type: 'table', title: 'Pipeline', dataset: 'pipeline', dimensions: ['stage'], values: ['n'] },
  ],
} as unknown as DashboardComponentSchema;

const sentNames = (calls: Array<[Array<{ dataset: string }>, ...unknown[]]>) => calls.map(([queries]) => queries.map((q) => q.dataset));

describe('one dashboard render sends its dataset queries as one batch (objectstack#32165)', () => {
  it('asks the batch door once, with every widget query in render order, and paints every answer', async () => {
    const { source, single, batchDoor } = makeSource();
    render(<DashboardRenderer schema={DASHBOARD} dataSource={source} />);

    await waitFor(() => expect(batchDoor).toHaveBeenCalledTimes(1));
    expect(sentNames(batchDoor.mock.calls as never)).toEqual([['deals', 'deals', 'accounts', 'pipeline']]);
    // Each query is the one the widget asks the single door today.
    expect(batchDoor.mock.calls[0][0][0].selection).toMatchObject({ dimensions: ['stage'], measures: ['n'] });
    expect(single).not.toHaveBeenCalled();

    expect(await screen.findByText('deals-row')).toBeInTheDocument();
    expect(await screen.findByText('pipeline-row')).toBeInTheDocument();
    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(await screen.findByText('11')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByTestId('dataset-loading')).toHaveLength(0));
  });

  it('control: a data source with no batch door is asked once per widget, as before', async () => {
    const { source, single } = makeSource({ batch: false });
    render(<DashboardRenderer schema={DASHBOARD} dataSource={source} />);
    await waitFor(() => expect(single).toHaveBeenCalledTimes(4));
    expect(await screen.findByText('pipeline-row')).toBeInTheDocument();
  });

  it('sends the dashboard package with the batch as the reader\'s package, the caller every widget query is resolved for', async () => {
    const { source, batchDoor } = makeSource();
    const served = { ...DASHBOARD, _packageId: 'crm' } as unknown as DashboardComponentSchema;
    render(<DashboardRenderer schema={served} dataSource={source} />);
    await waitFor(() => expect(batchDoor).toHaveBeenCalledTimes(1));
    expect(batchDoor.mock.calls[0][1]).toEqual({ callerPackage: 'crm' });
    // Settle the widgets' follow-up metadata reads inside the test.
    expect(await screen.findByText('pipeline-row')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByTestId('dataset-loading')).toHaveLength(0));
  });

  it('the grid layout surface sends the dashboard package with its batch as the reader\'s package too', async () => {
    const { source, batchDoor } = makeSource();
    const served = { ...DASHBOARD, _packageId: 'crm' } as unknown as DashboardComponentSchema;
    render(<DashboardGridLayout schema={served} dataSource={source} />);
    await waitFor(() => expect(batchDoor).toHaveBeenCalledTimes(1));
    expect(batchDoor.mock.calls[0][1]).toEqual({ callerPackage: 'crm' });
    // Settle the widgets' follow-up metadata reads inside the test.
    expect(await screen.findByText('pipeline-row')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByTestId('dataset-loading')).toHaveLength(0));
  });

  it('control: a package-less dashboard sends its batch with no options at all', async () => {
    const { source, batchDoor } = makeSource();
    render(<DashboardRenderer schema={DASHBOARD} dataSource={source} />);
    await waitFor(() => expect(batchDoor).toHaveBeenCalledTimes(1));
    expect(batchDoor.mock.calls[0][1]).toBeUndefined();
    expect(await screen.findByText('pipeline-row')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByTestId('dataset-loading')).toHaveLength(0));
  });

  it('the grid layout surface batches the same way', async () => {
    const { source, single, batchDoor } = makeSource();
    render(<DashboardGridLayout schema={DASHBOARD} dataSource={source} />);
    await waitFor(() => expect(batchDoor).toHaveBeenCalledTimes(1));
    expect(sentNames(batchDoor.mock.calls as never)[0]).toHaveLength(4);
    expect(single).not.toHaveBeenCalled();
  });
});

describe('a refused query reaches only its widget (objectstack#32165)', () => {
  const refusal = () => new Error('Dataset query failed: 400 — relationship "owner" is not declared in include');

  it('its widget draws the refusal the single door gives it; its siblings render', async () => {
    const { source, batchDoor } = makeSource({ refuse: 'pipeline', refusal: refusal() });
    render(<DashboardRenderer schema={DASHBOARD} dataSource={source} />);
    await waitFor(() => expect(batchDoor).toHaveBeenCalledTimes(1));

    const message = await screen.findByText(/relationship "owner" is not declared/);
    const batchedAlert = message.closest('[role="alert"]');
    expect(batchedAlert, 'the refused widget drew no alert').not.toBeNull();
    expect(await screen.findByText('deals-row')).toBeInTheDocument();
    expect(await screen.findByText('11')).toBeInTheDocument();
    const batchedMarkup = batchedAlert!.outerHTML;
    cleanup();

    // CONTROL: the same refusal answered by the single door draws the same alert.
    const control = makeSource({ batch: false, refuse: 'pipeline', refusal: refusal() });
    render(<DashboardRenderer schema={DASHBOARD} dataSource={control.source} />);
    const singleMessage = await screen.findByText(/relationship "owner" is not declared/);
    expect(singleMessage.closest('[role="alert"]')!.outerHTML).toBe(batchedMarkup);
  });
});

describe('an invalidation refetch keeps each widget its own (objectstack#32165)', () => {
  it('a write to one object re-reads only the widget querying it, through the single door', async () => {
    const { source, single, batchDoor } = makeSource();
    render(<DashboardRenderer schema={DASHBOARD} dataSource={source} />);
    expect(await screen.findByText('11')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByTestId('dataset-loading')).toHaveLength(0));

    act(() => { notifyDataChanged({ objectName: 'account' }); });
    await waitFor(() => expect(single).toHaveBeenCalledTimes(1));
    expect(single.mock.calls[0][0]).toBe('accounts');
    expect(batchDoor).toHaveBeenCalledTimes(1);
  });

  it('a write several widgets read re-reads them together, in one batch', async () => {
    const { source, single, batchDoor } = makeSource();
    render(<DashboardRenderer schema={DASHBOARD} dataSource={source} />);
    expect(await screen.findByText('pipeline-row')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByTestId('dataset-loading')).toHaveLength(0));

    act(() => { notifyDataChanged({ objectName: 'deal' }); });
    await waitFor(() => expect(batchDoor).toHaveBeenCalledTimes(2));
    // `deals` (twice) and `pipeline` answer with base object `deal`.
    expect(sentNames(batchDoor.mock.calls as never)[1]).toEqual(['deals', 'deals', 'pipeline']);
    expect(single).not.toHaveBeenCalled();
  });
});
