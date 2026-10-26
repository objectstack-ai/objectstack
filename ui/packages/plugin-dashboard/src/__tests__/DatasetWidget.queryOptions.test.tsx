// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { DatasetWidget } from '../DatasetWidget';

afterEach(cleanup);

/**
 * Regression cover for framework #3588.
 *
 * Three widget `options` keys were accepted by the metadata layer and then
 * dropped: this component never read `options` at all, so a widget declaring
 * `dateGranularity: 'month'` still grouped by the raw timestamp (one bar per
 * record) and `sortBy`/`sortOrder` produced no ordering whatsoever.
 *
 * These assert on the SELECTION handed to `queryDataset`, because that is the
 * seam the bug lived at — the widget rendered fine and the query ran fine; only
 * the payload was missing the options the author wrote.
 */
describe('DatasetWidget — query-affecting widget options (#3588)', () => {
  // The two parameters are DECLARED because this suite reads them back:
  // `DatasetWidget` calls the adapter as `queryDataset(dataset, selection)`
  // (`DatasetCapableSource` in `../DatasetWidget`), and a bare
  // `vi.fn(async () => …)` types `mock.calls` as an array of EMPTY tuples, so
  // every `[1]` read below is out of bounds and resolves to `undefined` —
  // silently, because the reads are cast (objectui#4040).
  const makeSource = () => ({
    queryDataset: vi.fn(async (_dataset: string, _selection: unknown) => ({ rows: [], fields: [] })),
  });

  const selectionOf = (src: ReturnType<typeof makeSource>) =>
    src.queryDataset.mock.calls[0]?.[1] as Record<string, unknown>;

  it('lowers options.dateGranularity into the selection', async () => {
    const src = makeSource();
    render(
      <DatasetWidget
        widget={{
          type: 'bar',
          dataset: 'account_metrics',
          dimensions: ['created_at'],
          values: ['account_count'],
          options: { dateGranularity: 'month' },
        }}
        dataSource={src}
      />,
    );
    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    expect(selectionOf(src)).toMatchObject({
      dimensions: ['created_at'],
      measures: ['account_count'],
      dateGranularity: 'month',
    });
  });

  it('lowers options.sortBy/sortOrder into an order, and limit alongside it', async () => {
    const src = makeSource();
    render(
      <DatasetWidget
        widget={{
          type: 'table',
          dataset: 'account_metrics',
          dimensions: ['industry'],
          values: ['annual_revenue_sum', 'account_count'],
          options: { sortBy: 'annual_revenue_sum', sortOrder: 'desc', limit: 10 },
        }}
        dataSource={src}
      />,
    );
    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    expect(selectionOf(src)).toMatchObject({
      order: { annual_revenue_sum: 'desc' },
      limit: 10,
    });
  });

  it('defaults sortOrder to ascending', async () => {
    const src = makeSource();
    render(
      <DatasetWidget
        widget={{
          type: 'table', dataset: 'ds', dimensions: ['industry'], values: ['n'],
          options: { sortBy: 'industry' },
        }}
        dataSource={src}
      />,
    );
    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    expect(selectionOf(src)).toMatchObject({ order: { industry: 'asc' } });
  });

  it('drops a sortBy the widget does not project, rather than failing the query', async () => {
    // The server rejects an unresolvable order key. A stale `sortBy` left behind
    // by an edit should degrade to "unordered", not blank the whole widget.
    const src = makeSource();
    render(
      <DatasetWidget
        widget={{
          type: 'table', dataset: 'ds', dimensions: ['industry'], values: ['n'],
          options: { sortBy: 'a_measure_that_was_removed', sortOrder: 'desc' },
        }}
        dataSource={src}
      />,
    );
    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    expect(selectionOf(src)).not.toHaveProperty('order');
  });

  it('ignores non-query renderer extras and a non-numeric limit', async () => {
    const src = makeSource();
    render(
      <DatasetWidget
        widget={{
          type: 'table', dataset: 'ds', dimensions: ['industry'], values: ['n'],
          options: { striped: true, density: 'comfortable', columns: [{ header: 'x' }], limit: 'ten' },
        }}
        dataSource={src}
      />,
    );
    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    const sel = selectionOf(src);
    expect(sel).not.toHaveProperty('limit');
    expect(sel).not.toHaveProperty('striped');
    expect(sel).not.toHaveProperty('columns');
  });

  it('sends no query options at all when the widget declares none', async () => {
    const src = makeSource();
    render(
      <DatasetWidget
        widget={{ type: 'metric', dataset: 'ds', values: ['revenue'] }}
        dataSource={src}
      />,
    );
    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    expect(selectionOf(src)).toEqual({ dimensions: [], measures: ['revenue'] });
  });

  it('refetches when a query-affecting option changes', async () => {
    const src = makeSource();
    const widget = (granularity: string) => ({
      type: 'bar', dataset: 'ds', dimensions: ['created_at'], values: ['n'],
      options: { dateGranularity: granularity },
    });
    const { rerender } = render(<DatasetWidget widget={widget('month')} dataSource={src} />);
    await waitFor(() => expect(src.queryDataset).toHaveBeenCalledTimes(1));

    rerender(<DatasetWidget widget={widget('quarter')} dataSource={src} />);
    await waitFor(() => expect(src.queryDataset).toHaveBeenCalledTimes(2));
    expect(src.queryDataset.mock.calls[1][1]).toMatchObject({ dateGranularity: 'quarter' });
  });
});
