/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10035 — `ObjectChart` refetches IN PLACE when the data-invalidation
 * bus reports a write to the object it queries (AGENTS.md #8's corollary:
 * refresh data, don't rebuild UI).
 *
 * The chart used to read no refresh input: its fetch effect named none, so a
 * host could show it a write only by bumping its `key` — a remount that also
 * closes an open drill drawer and resets the chart's own state.
 *
 * It has TWO fetch paths, and each is pinned:
 *   - object-bound — `aggregate` over `schema.objectName`; keys on that object;
 *   - dataset-bound (ADR-0021) — `queryDataset`; the node carries no
 *     `objectName`, so it keys on the dataset's base object as the query's
 *     answer names it (`object`, the field the dashboard's DatasetWidget reads
 *     for drill-through).
 *
 * `ChartRenderer` is a stand-in carrying an instance id from a `useState`
 * initializer (once per mount) and the row count it was handed. Each in-place
 * case asserts:
 *   (a) the SAME `ChartRenderer` instance afterwards — neither a remount nor the
 *       loading skeleton swapped it out;
 *   (b) the rows written after the first read reach it;
 *   (c) one invalidation costs exactly one query (no refetch storm).
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, act, screen } from '@testing-library/react';
import { notifyDataChanged } from '@object-ui/react';

let instanceSeq = 0;

vi.mock('./ChartRenderer', () => ({
  ChartRenderer: ({ schema }: any) => {
    const [id] = React.useState(() => ++instanceSeq);
    return (
      <div
        data-testid="chart-renderer"
        data-instance={id}
        data-rows={Array.isArray(schema?.data) ? schema.data.length : -1}
      />
    );
  },
}));

import { ObjectChart } from './ObjectChart';

beforeEach(() => {
  instanceSeq = 0;
  // The metadata probes (option colours, dataset definition) are best-effort
  // and not what these cases are about; answer them with nothing.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
const chart = () => screen.getByTestId('chart-renderer');

/** An aggregate server whose answer grows by one bucket per call. */
function makeAggregateSource() {
  let answered = 0;
  const aggregate = vi.fn(async () => {
    answered += 1;
    return Array.from({ length: answered }, (_, i) => ({ stage: `s${i + 1}`, amount: i + 1 }));
  });
  return { aggregate };
}

const OBJECT_SCHEMA: any = {
  type: 'object-chart',
  chartType: 'bar',
  objectName: 'crm_opportunity',
  aggregate: { field: 'amount', function: 'sum', groupBy: 'stage' },
  xAxisKey: 'stage',
  series: [{ dataKey: 'amount', label: 'Amount' }],
};

/** A dataset server that names its base object, and grows by one row per call. */
function makeDatasetSource(object: string | undefined = 'task') {
  let answered = 0;
  const queryDataset = vi.fn(async () => {
    answered += 1;
    return {
      rows: Array.from({ length: answered }, (_, i) => ({ status: `st${i + 1}`, task_count: i + 1 })),
      fields: [
        { name: 'status', label: 'Status' },
        { name: 'task_count', label: 'Tasks' },
      ],
      ...(object ? { object } : {}),
    };
  });
  return { queryDataset };
}

const DATASET_SCHEMA: any = {
  type: 'object-chart',
  chartType: 'bar',
  dataset: 'task_metrics',
  dimensions: ['status'],
  values: ['task_count'],
  xAxisKey: 'status',
  series: [{ dataKey: 'task_count', label: 'task_count' }],
};

describe('ObjectChart refetches in place on a data-invalidation (objectui#10035)', () => {
  it('object-bound: a write to its object re-runs the aggregate once, into the same chart', async () => {
    const ds = makeAggregateSource();
    render(<ObjectChart schema={OBJECT_SCHEMA} dataSource={ds} />);
    await waitFor(() => expect(chart().dataset.rows).toBe('1'));
    await settle();
    const before = chart().dataset.instance;
    const queriesBefore = ds.aggregate.mock.calls.length;

    await act(async () => {
      notifyDataChanged({ objectName: 'crm_opportunity' });
    });

    await waitFor(() =>
      expect(
        chart().dataset.rows,
        '(b) The chart never re-ran its aggregate after the bus reported a write to its object.',
      ).toBe('2'),
    );
    await settle();
    expect(ds.aggregate.mock.calls.length - queriesBefore, '(c) one invalidation, one query').toBe(1);
    expect(chart().dataset.instance, '(a) the chart was rebuilt instead of refreshed').toBe(before);
  });

  it('object-bound: a write to another object does not query', async () => {
    const ds = makeAggregateSource();
    render(<ObjectChart schema={OBJECT_SCHEMA} dataSource={ds} />);
    await waitFor(() => expect(chart().dataset.rows).toBe('1'));
    await settle();
    const queriesBefore = ds.aggregate.mock.calls.length;

    await act(async () => {
      notifyDataChanged({ objectName: 'some_other_object' });
    });
    await settle();

    expect(ds.aggregate.mock.calls.length - queriesBefore).toBe(0);
  });

  it('dataset-bound: a write to the dataset\'s base object re-runs queryDataset once, into the same chart', async () => {
    const ds = makeDatasetSource('task');
    render(<ObjectChart schema={DATASET_SCHEMA} dataSource={ds} />);
    await waitFor(() => expect(chart().dataset.rows).toBe('1'));
    await settle();
    const before = chart().dataset.instance;
    const queriesBefore = ds.queryDataset.mock.calls.length;

    await act(async () => {
      notifyDataChanged({ objectName: 'task' });
    });

    await waitFor(() =>
      expect(
        chart().dataset.rows,
        '(b) The dataset chart never re-ran queryDataset after the bus reported a write to\n'
          + 'the base object its query answer names.',
      ).toBe('2'),
    );
    await settle();
    expect(ds.queryDataset.mock.calls.length - queriesBefore, '(c) one invalidation, one query').toBe(1);
    expect(chart().dataset.instance, '(a) the chart was rebuilt instead of refreshed').toBe(before);
  });

  it('dataset-bound: a write to another object does not query', async () => {
    const ds = makeDatasetSource('task');
    render(<ObjectChart schema={DATASET_SCHEMA} dataSource={ds} />);
    await waitFor(() => expect(chart().dataset.rows).toBe('1'));
    await settle();
    const queriesBefore = ds.queryDataset.mock.calls.length;

    await act(async () => {
      notifyDataChanged({ objectName: 'some_other_object' });
    });
    await settle();

    expect(ds.queryDataset.mock.calls.length - queriesBefore).toBe(0);
  });

  it('a chart drawing inline rows queries nothing on an invalidation', async () => {
    const ds = makeAggregateSource();
    render(
      <ObjectChart
        schema={{ ...OBJECT_SCHEMA, data: [{ stage: 'a', amount: 1 }] }}
        dataSource={ds}
      />,
    );
    await waitFor(() => expect(chart().dataset.rows).toBe('1'));

    await act(async () => {
      notifyDataChanged({ objectName: 'crm_opportunity' });
    });
    await settle();

    expect(ds.aggregate).not.toHaveBeenCalled();
  });
});
