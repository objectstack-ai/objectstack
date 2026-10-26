/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11095 — a dataset-bound KPI tile (a `metric` widget with no
 * dimensions) re-reads on the data-invalidation bus.
 *
 * `DatasetWidget` subscribes `useDataInvalidation` on the base object its
 * query's ANSWER names (`object`, objectui#10815). The analytics service used
 * to name it only beside drill-through metadata, which needs a drillable
 * dimension and at least one row, so a dimension-less tile's answer named
 * nothing and the tile ignored every bus event: the dashboard timer, Refresh
 * All, and declared writes. The fix is the producer's
 * (objectstack-ai/objectstack#20644): `AnalyticsResult.object` is declared in
 * `@objectstack/spec` 17.6.0 and named on every dataset answer, with or
 * without dimensions and with or without rows. The producer half is pinned
 * upstream, by `service-analytics`'s `dataset-answer-object.test.ts`, not here.
 * Nothing changed in this package, so these cases pin the consumer half.
 *
 * The answers below have the shape the producer returns for a
 * `dimensions: []` selection: `rows`, `fields` and `object`, with no
 * `dimensionFields` and no `drillRawRows`. The last case keeps the triage
 * ruling on the card: the subscription key is the answer's `object` and
 * nothing else, so there is no `'*'` subscription and no second read of the
 * dataset's metadata.
 *
 * Rendered on the page path: the real `SchemaRenderer` under a
 * `SchemaRendererProvider`, this package's own registration, no host prop.
 * The bare `useDataInvalidation` reader mounted beside the block is the
 * positive control: it proves the event reached subscribers in this harness.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, notifyDataChanged, useDataInvalidation } from '@object-ui/react';
// Side-effect imports at MODULE scope (AGENTS.md's flaky-test rule).
import '@object-ui/components';
import './index';
import type { DataSource } from '@object-ui/types';

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

const BASE_OBJECT = 'showcase_project';

type Answer = { rows: Array<Record<string, unknown>>; fields: unknown[]; object?: string };

/**
 * A `queryDataset`-capable adapter answering a dimension-less selection.
 * `count` is the number the next answer carries (`null` answers zero rows).
 * `object` is what every answer names (`undefined` answers the pre-fix shape).
 */
function makeKpiSource(opts: { count: number | null; object?: string }) {
  let count = opts.count;
  const answer = (): Answer => ({
    rows: count === null ? [] : [{ project_count: count }],
    fields: [{ name: 'project_count', type: 'number', label: 'Projects' }],
    ...(opts.object ? { object: opts.object } : {}),
  });
  return {
    setCount(next: number | null) {
      count = next;
    },
    queryDataset: vi.fn((_dataset: string, _selection?: { dimensions?: string[] }) => Promise.resolve(answer())),
  };
}

/** The positive control: a bare reader of the dataset's base object, beside the block. */
function BusControl() {
  const nonce = useDataInvalidation(BASE_OBJECT);
  return <span data-testid="bus-control">{`bus:${nonce}`}</span>;
}

// The showcase ops dashboard's KPI shape: a `metric` over a dataset, no dimensions.
const KPI_WIDGET = { id: 'kpi_at_risk', type: 'metric', title: 'At-Risk (Red)', dataset: 'showcase_project_ds', values: ['project_count'] };
const dashboard = { type: 'dashboard', widgets: [KPI_WIDGET] };

const renderOnPage = (ds: ReturnType<typeof makeKpiSource>) =>
  render(
    <SchemaRendererProvider dataSource={asAdapter(ds)}>
      <BusControl />
      <SchemaRenderer schema={dashboard as unknown as StoredNode} />
    </SchemaRendererProvider>,
  );

describe('a dataset-bound KPI tile re-reads on the data-invalidation bus once its answer names the base object (objectui#11095)', () => {
  it('a write to the answer’s object re-reads the tile once, in place; a write to another object does not', async () => {
    const ds = makeKpiSource({ count: 1, object: BASE_OBJECT });
    const { getByTestId } = renderOnPage(ds);
    const tileValue = await screen.findByText('1');
    await settle();
    expect(ds.queryDataset).toHaveBeenCalledTimes(1);
    // The query really is the dimension-less one this card is about.
    expect(ds.queryDataset.mock.calls[0][1]?.dimensions).toEqual([]);

    ds.setCount(2);
    await act(async () => {
      notifyDataChanged({ objectName: 'some_other_object' });
    });
    await settle();
    expect(ds.queryDataset, 'a change to another object re-read this tile').toHaveBeenCalledTimes(1);

    await act(async () => {
      notifyDataChanged({ objectName: BASE_OBJECT, recordId: 'p-7' });
    });
    await settle();
    expect(getByTestId('bus-control').textContent, 'control: the event never reached a subscriber').toBe('bus:1');
    expect(ds.queryDataset, 'the KPI tile never re-read after a write to its base object').toHaveBeenCalledTimes(2);
    // In place: the same value node now carries the new number.
    expect(await screen.findByText('2')).toBe(tileValue);
  });

  it('the unscoped change the console’s timer and Refresh All declare (objectName "*") re-reads the tile once', async () => {
    const ds = makeKpiSource({ count: 1, object: BASE_OBJECT });
    const { getByTestId } = renderOnPage(ds);
    await screen.findByText('1');
    await settle();
    expect(ds.queryDataset).toHaveBeenCalledTimes(1);

    ds.setCount(3);
    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();
    expect(getByTestId('bus-control').textContent).toBe('bus:1');
    expect(ds.queryDataset, 'the KPI tile never re-read after an unscoped change').toHaveBeenCalledTimes(2);
    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('a zero-row first answer that names the object subscribes too, so the first record written reaches the tile', async () => {
    const ds = makeKpiSource({ count: null, object: BASE_OBJECT });
    renderOnPage(ds);
    // A metric over an empty answer reads 0, not an empty state.
    await screen.findByText('0');
    await settle();
    expect(ds.queryDataset).toHaveBeenCalledTimes(1);

    ds.setCount(1);
    await act(async () => {
      notifyDataChanged({ objectName: BASE_OBJECT });
    });
    await settle();
    expect(ds.queryDataset, 'an empty first answer left the tile unsubscribed').toHaveBeenCalledTimes(2);
    expect(await screen.findByText('1')).toBeInTheDocument();
  });

  it('the subscription key is the answer’s object and nothing else: an answer naming none subscribes to nothing', async () => {
    // The pre-fix producer's dimension-less answer. The tile has no fallback key
    // (no '*' subscription, no read of the dataset's metadata), so it stays put.
    const ds = makeKpiSource({ count: 1 });
    const { getByTestId } = renderOnPage(ds);
    await screen.findByText('1');
    await settle();
    expect(ds.queryDataset).toHaveBeenCalledTimes(1);

    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();
    expect(getByTestId('bus-control').textContent, 'control: the event never reached a subscriber').toBe('bus:1');
    expect(ds.queryDataset, 'a tile whose answer names no object re-read on the bus').toHaveBeenCalledTimes(1);
  });
});
