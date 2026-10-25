/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10814 — a `report` block over a dataset (flat, or wrapping the spec
 * report in its `report` member, the spelling `spec-report` carried until
 * objectui#11440 retired that alias) re-reads
 * when the data-invalidation bus (`notifyDataChanged` from `@object-ui/react`)
 * reports a write to the object its dataset queries, in place.
 *
 * Before this card the one fetch every dataset presentation funnels through
 * (`useDatasetRows`: the summary / tabular table, the matrix, the embedded
 * chart, each joined block) keyed its effect on the selection signature alone,
 * so a write declared on the bus (a page action over raw HTTP, a flow, a
 * server action) left the report stale until something remounted it, and
 * `PageView`'s remount is what objectui#10519 removes. The effect now names the
 * `useDataInvalidation` nonce for the dataset's base object, which only the
 * query's answer names (the `ObjectChart` dataset arm's key, objectui#10035).
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration, over a data source that counts `queryDataset` calls and lets
 * the test settle each one by hand. The bare `useDataInvalidation` reader
 * mounted beside the block is the positive control: it proves the event
 * reached subscribers in this harness, so a block that did not re-read failed
 * to listen rather than missed an event that never came.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, notifyDataChanged, useDataInvalidation } from '@object-ui/react';
// Registers `report` through this package's own entry.
import '../index';

beforeEach(() => {
  // The dimension-label probe (`/api/v1/meta/object/NAME`) is best-effort and
  // not what these cases are about; answer it with an empty document.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ item: { fields: {} } }) })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

interface PendingQuery {
  dataset: string;
  selection: { dimensions?: string[]; measures?: string[] };
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * Every `queryDataset` returns a promise the test settles by hand, so a case
 * can look at the block WHILE a re-read is in flight. The answer names `deal`
 * as the dataset's base object, the way the server's does.
 */
function makeDataSource() {
  const queries: PendingQuery[] = [];
  return {
    queries,
    queryDataset: vi.fn(
      (dataset: string, selection: PendingQuery['selection']) =>
        new Promise((resolve, reject) => {
          queries.push({ dataset, selection, resolve, reject });
        }),
    ),
  };
}

const answer = (amount: number) => ({
  rows: [{ stage: 'Won', amount_sum: amount }],
  fields: [
    { name: 'stage', type: 'string', label: 'Stage' },
    { name: 'amount_sum', type: 'number', label: 'Amount' },
  ],
  object: 'deal',
});

/** Settle every query issued so far that has not been answered yet. */
async function answerAll(ds: ReturnType<typeof makeDataSource>, amount: number, from = 0) {
  await act(async () => {
    for (const q of ds.queries.slice(from)) q.resolve(answer(amount));
    await Promise.resolve();
  });
}

/** Fail the `n`-th query (1-based). */
async function failQuery(ds: ReturnType<typeof makeDataSource>, n: number, message: string) {
  await act(async () => {
    ds.queries[n - 1].reject(new Error(message));
    await Promise.resolve();
  });
}

async function emit(change: { objectName: string; recordId?: string }) {
  await act(async () => {
    notifyDataChanged(change);
    await Promise.resolve();
  });
}

/** The positive control: a bare reader of the same object, beside the block. */
function BusControl() {
  const nonce = useDataInvalidation('deal');
  return <span data-testid="bus-control">{nonce}</span>;
}

const renderBlock = (schema: Record<string, unknown>, ds: ReturnType<typeof makeDataSource>) =>
  render(
    <SchemaRendererProvider dataSource={ds as any}>
      <BusControl />
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );

const SUMMARY = { type: 'summary', dataset: 'deals_ds', rows: ['stage'], values: ['amount_sum'] };

describe('report over a dataset re-reads on the data-invalidation bus (objectui#10814)', () => {
  it('`report` wrapping a spec report: an unscoped change (objectName "*") re-runs its query once, keeping the table drawn', async () => {
    const ds = makeDataSource();
    const { container, getByTestId, getByText, queryByText } = renderBlock({ type: 'report', report: SUMMARY }, ds);
    await waitFor(() => expect(ds.queryDataset).toHaveBeenCalledTimes(1));
    await answerAll(ds, 100);
    await waitFor(() => expect(getByText('100')).toBeTruthy());
    const table = container.querySelector('table');
    expect(table).not.toBeNull();

    await emit({ objectName: '*' });

    expect(getByTestId('bus-control').textContent, 'control: the event never reached a subscriber').toBe('1');
    await waitFor(() => expect(ds.queryDataset, 'the report never re-read after the bus reported a change').toHaveBeenCalledTimes(2));
    // In flight: the rows already on screen stay drawn, not the loading line.
    expect(queryByText('Running report…'), 'the re-read blanked the report to its loading state').toBeNull();
    expect(container.querySelector('table'), 'the re-read unmounted the table').toBe(table);
    expect(getByText('100')).toBeTruthy();

    await answerAll(ds, 250, 1);
    await waitFor(() => expect(getByText('250')).toBeTruthy());
    expect(container.querySelector('table'), 'the table was remounted by the re-read').toBe(table);
  });

  it('`report`: a change to the object its dataset queries re-reads once; another object does not', async () => {
    const ds = makeDataSource();
    // On the `report` key the node's `type` is the registry key, so the report
    // renders its declared default presentation (`tabular`).
    const { getByTestId, getByText } = renderBlock(
      { type: 'report', dataset: 'deals_ds', rows: ['stage'], values: ['amount_sum'] },
      ds,
    );
    await waitFor(() => expect(ds.queryDataset).toHaveBeenCalledTimes(1));
    await answerAll(ds, 100);
    await waitFor(() => expect(getByText('100')).toBeTruthy());

    await emit({ objectName: 'some_other_object' });
    expect(ds.queryDataset, 'a change to another object re-read this report').toHaveBeenCalledTimes(1);

    await emit({ objectName: 'deal', recordId: '1' });
    expect(getByTestId('bus-control').textContent).toBe('1');
    await waitFor(() => expect(ds.queryDataset).toHaveBeenCalledTimes(2));
    await answerAll(ds, 300, 1);
    await waitFor(() => expect(getByText('300')).toBeTruthy());
  });

  it('every query of the report re-reads: the embedded chart and each joined block', async () => {
    const ds = makeDataSource();
    renderBlock(
      {
        type: 'report',
        report: {
          type: 'joined',
          blocks: [
            { name: 'by_stage', type: 'summary', dataset: 'deals_ds', rows: ['stage'], values: ['amount_sum'] },
            {
              name: 'by_owner',
              type: 'matrix',
              dataset: 'deals_ds',
              rows: ['stage'],
              columns: ['owner'],
              values: ['amount_sum'],
            },
          ],
        },
      },
      ds,
    );
    await waitFor(() => expect(ds.queryDataset).toHaveBeenCalledTimes(2));
    await answerAll(ds, 100);

    await emit({ objectName: '*' });
    await waitFor(() => expect(ds.queryDataset).toHaveBeenCalledTimes(4));
    cleanup();

    const withChart = makeDataSource();
    renderBlock(
      { type: 'report', report: { ...SUMMARY, chart: { type: 'bar', xAxis: 'stage', yAxis: 'amount_sum' } } },
      withChart,
    );
    // The chart runs its own narrower query beside the table's.
    await waitFor(() => expect(withChart.queryDataset).toHaveBeenCalledTimes(2));
    await answerAll(withChart, 100);

    await emit({ objectName: '*' });
    await waitFor(() => expect(withChart.queryDataset).toHaveBeenCalledTimes(4));
    const reread = withChart.queries.slice(2).map((q) => q.selection.dimensions?.join(','));
    expect(reread.sort(), 'the chart query and the table query each re-read').toEqual(['stage', 'stage']);
  });

  it('a re-read that FAILS keeps listening: the error replaces the rows, and the next change re-reads', async () => {
    const ds = makeDataSource();
    const { container, queryByRole, getByText } = renderBlock({ type: 'report', report: SUMMARY }, ds);
    await waitFor(() => expect(ds.queryDataset).toHaveBeenCalledTimes(1));
    await answerAll(ds, 100);
    await waitFor(() => expect(getByText('100')).toBeTruthy());

    await emit({ objectName: '*' });
    await waitFor(() => expect(ds.queryDataset).toHaveBeenCalledTimes(2));
    await failQuery(ds, 2, 'upstream timeout');
    // The table's error branch draws the error INSTEAD of the rows.
    await waitFor(() => expect(queryByRole('alert')?.textContent).toContain('upstream timeout'));
    expect(container.querySelector('table'), 'rows were kept under the error').toBeNull();

    await emit({ objectName: '*' });
    await waitFor(() =>
      expect(ds.queryDataset, 'one failed re-read left the report deaf to the bus').toHaveBeenCalledTimes(3),
    );
    await answerAll(ds, 400, 2);
    await waitFor(() => expect(getByText('400')).toBeTruthy());
    expect(queryByRole('alert')).toBeNull();
  });

  it('control: a first load that fails, with no answer ever, subscribes to nothing', async () => {
    const ds = makeDataSource();
    const { getByTestId, queryByRole } = renderBlock({ type: 'report', report: SUMMARY }, ds);
    await waitFor(() => expect(ds.queryDataset).toHaveBeenCalledTimes(1));
    await failQuery(ds, 1, 'no such dataset');
    await waitFor(() => expect(queryByRole('alert')?.textContent).toContain('no such dataset'));

    await emit({ objectName: '*' });

    expect(getByTestId('bus-control').textContent).toBe('1');
    expect(ds.queryDataset).toHaveBeenCalledTimes(1);
  });

  it('control: a new selection does not keep the previous selection’s subscription', async () => {
    const ds = makeDataSource();
    const tree = (report: Record<string, unknown>) => (
      <SchemaRendererProvider dataSource={ds as any}>
        <BusControl />
        <SchemaRenderer schema={{ type: 'report', report } as any} />
      </SchemaRendererProvider>
    );
    const view = render(tree(SUMMARY));
    await waitFor(() => expect(ds.queryDataset).toHaveBeenCalledTimes(1));
    await answerAll(ds, 100);

    // Another selection, whose first load fails: it has had no answer, so it
    // must not listen on the object the previous selection's answer named.
    view.rerender(tree({ ...SUMMARY, values: ['amount_avg'] }));
    await waitFor(() => expect(ds.queryDataset).toHaveBeenCalledTimes(2));
    await failQuery(ds, 2, 'unknown measure');

    await emit({ objectName: '*' });

    expect(view.getByTestId('bus-control').textContent).toBe('1');
    expect(ds.queryDataset, 'the new selection listened on the previous selection’s object').toHaveBeenCalledTimes(2);
  });

  it('control: a report over authored rows queries nothing on an invalidation', async () => {
    const ds = makeDataSource();
    const { getByTestId, getByText } = renderBlock(
      {
        type: 'report',
        title: 'Static',
        data: [{ stage: 'Won', amount: 7 }],
        columns: [{ field: 'stage', header: 'Stage' }],
      },
      ds,
    );
    await waitFor(() => expect(getByText('Static')).toBeTruthy());

    await emit({ objectName: '*' });

    expect(getByTestId('bus-control').textContent).toBe('1');
    expect(ds.queryDataset).not.toHaveBeenCalled();
  });
});
