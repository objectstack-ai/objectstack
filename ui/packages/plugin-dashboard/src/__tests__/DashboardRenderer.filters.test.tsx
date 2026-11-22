/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Dashboard-level filter broadcast (framework#2501).
 *
 * ADR-0021: widgets bind a semantic-layer `dataset` and render through
 * DatasetWidget, which forwards the widget's EFFECTIVE `filter` (its own filter
 * AND the dashboard broadcast, resolved through the same bindings + `$and` merge)
 * to `dataSource.queryDataset` as `runtimeFilter`. We assert that call so the
 * page-variables provider, filter bar, binding resolution, and merge all run for
 * real. Date macros (`{today}`, `{30_days_ago}`) are resolved client-side before
 * the query, so date-range assertions check the SHAPE, not the literal tokens.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { DashboardComponentSchema } from '@object-ui/types';
import { DashboardRenderer } from '../DashboardRenderer';

afterEach(cleanup);

/**
 * A dataset data source that records every `queryDataset` call.
 *
 * The two parameters are DECLARED, not decorative: `DatasetWidget` calls this
 * adapter as `queryDataset(dataset, selection)` (see `DatasetCapableSource` in
 * `../DatasetWidget`), and a bare `vi.fn(async () => …)` types `mock.calls` as
 * an array of EMPTY tuples — so `c[0]` / `c[1]` below read out of bounds and
 * `lastRuntimeFilter` was comparing and casting `undefined` while every
 * assertion still passed. Declaring the call shape here is what lets `tsc`
 * check the two reads this whole file is built on (objectui#4040).
 */
const makeQueryDataset = () =>
  vi.fn(async (_dataset: string, _selection: unknown) => ({ rows: [{ count: 1 }], fields: [] }));

/** The `runtimeFilter` of the LAST `queryDataset` call for a given dataset. */
const lastRuntimeFilter = (
  queryDataset: ReturnType<typeof makeQueryDataset>,
  dataset: string,
): unknown => {
  const calls = queryDataset.mock.calls.filter((c) => c[0] === dataset);
  if (calls.length === 0) return undefined;
  return (calls[calls.length - 1][1] as { runtimeFilter?: unknown })?.runtimeFilter;
};

describe('DashboardRenderer dashboard-level filters', () => {
  it('renders no filter bar when the schema declares no filters', async () => {
    const queryDataset = makeQueryDataset();
    const schema: DashboardComponentSchema = {
      type: 'dashboard',
      widgets: [{ id: 'w1', type: 'bar', dataset: 'invoices', values: ['count'] }],
    };
    render(<DashboardRenderer schema={schema} dataSource={{ queryDataset }} />);
    expect(screen.queryByTestId('dashboard-filter-bar')).not.toBeInTheDocument();
    await waitFor(() => expect(queryDataset).toHaveBeenCalledWith('invoices', expect.anything()));
    expect(lastRuntimeFilter(queryDataset, 'invoices')).toBeUndefined();
  });

  it('broadcasts the default date range into each widget via its own bound field', async () => {
    const queryDataset = makeQueryDataset();
    const schema: DashboardComponentSchema = {
      type: 'dashboard',
      dateRange: { field: 'created_at', defaultRange: 'last_30_days', allowCustomRange: true },
      widgets: [
        // Default binding → dateRange.field (created_at).
        { id: 'w1', type: 'bar', dataset: 'invoices', values: ['count'] },
        // Explicit per-widget override → this widget's own field.
        { id: 'w2', type: 'line', dataset: 'accounts', values: ['count'], filterBindings: { dateRange: 'signed_at' } },
      ],
    };
    render(<DashboardRenderer schema={schema} dataSource={{ queryDataset }} />);

    expect(screen.getByTestId('dashboard-filter-bar')).toBeInTheDocument();
    await waitFor(() => {
      expect(lastRuntimeFilter(queryDataset, 'invoices')).toEqual({
        created_at: { $gte: expect.any(String), $lte: expect.any(String) },
      });
      expect(lastRuntimeFilter(queryDataset, 'accounts')).toEqual({
        signed_at: { $gte: expect.any(String), $lte: expect.any(String) },
      });
    });
  });

  it('broadcasts the spec default range when dateRange omits defaultRange (objectui#10339)', async () => {
    const queryDataset = makeQueryDataset();
    const schema: DashboardComponentSchema = {
      type: 'dashboard',
      // No `defaultRange` — the spec defaults it, so the dashboard is filtered.
      dateRange: { field: 'created_at' },
      widgets: [{ id: 'w1', type: 'bar', dataset: 'invoices', values: ['count'] }],
    };
    render(<DashboardRenderer schema={schema} dataSource={{ queryDataset }} />);

    await waitFor(() => {
      expect(lastRuntimeFilter(queryDataset, 'invoices')).toEqual({
        created_at: { $gte: expect.any(String), $lte: expect.any(String) },
      });
    });
  });

  it('merges the broadcast with a widget\'s own filter and honors opt-out', async () => {
    const queryDataset = makeQueryDataset();
    const schema: DashboardComponentSchema = {
      type: 'dashboard',
      globalFilters: [
        // Options in @objectstack/spec's `{ value, label }` pair form. The
        // bare-string shorthand these used to spell is refused by
        // `GlobalFilterSchema` and, since objectui#4356, no longer lifted by
        // `normalizeFilterOptions` either — a bare member yields no option; its
        // own coverage is `packages/core/src/utils/__tests__/dashboard-filters.test.ts`.
        // Nothing here reads the list — the broadcast under test comes from `defaultValue`.
        {
          name: 'region',
          field: 'region',
          type: 'select',
          options: [
            { value: 'EMEA', label: 'EMEA' },
            { value: 'APAC', label: 'APAC' },
          ],
          defaultValue: 'EMEA',
        },
      ],
      widgets: [
        { id: 'w1', type: 'bar', dataset: 'invoices', values: ['count'], filter: { status: 'paid' } },
        { id: 'w2', type: 'pie', dataset: 'accounts', values: ['count'], filterBindings: { region: false } },
      ],
    };
    render(<DashboardRenderer schema={schema} dataSource={{ queryDataset }} />);

    // Widget filter AND dashboard filter.
    await waitFor(() => {
      expect(lastRuntimeFilter(queryDataset, 'invoices')).toEqual({
        $and: [{ status: 'paid' }, { region: 'EMEA' }],
      });
    });
    // Opted out — own (absent) filter untouched, so no runtimeFilter.
    expect(lastRuntimeFilter(queryDataset, 'accounts')).toBeUndefined();
  });

  it('re-scopes all bound widgets live when a filter value changes', async () => {
    const queryDataset = makeQueryDataset();
    const schema: DashboardComponentSchema = {
      type: 'dashboard',
      globalFilters: [{ name: 'q', field: 'name', type: 'text', label: 'Search' }],
      widgets: [
        { id: 'w1', type: 'bar', dataset: 'invoices', values: ['count'] },
        { id: 'w2', type: 'line', dataset: 'accounts', values: ['count'], filterBindings: { q: 'title' } },
      ],
    };
    render(<DashboardRenderer schema={schema} dataSource={{ queryDataset }} />);

    await waitFor(() => expect(queryDataset).toHaveBeenCalledWith('invoices', expect.anything()));
    expect(lastRuntimeFilter(queryDataset, 'invoices')).toBeUndefined();

    const input = screen.getByTestId('dashboard-filter-q');
    fireEvent.change(input, { target: { value: 'acme' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(lastRuntimeFilter(queryDataset, 'invoices')).toEqual({ name: { $contains: 'acme' } });
      expect(lastRuntimeFilter(queryDataset, 'accounts')).toEqual({ title: { $contains: 'acme' } });
    });

    // Clearing the value removes the broadcast again.
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(lastRuntimeFilter(queryDataset, 'invoices')).toBeUndefined();
      expect(lastRuntimeFilter(queryDataset, 'accounts')).toBeUndefined();
    });
  });

  it('injects the merged filter into a dataset widget\'s runtimeFilter', async () => {
    const queryDataset = vi.fn(async () => ({ rows: [{ revenue: 1 }] }));
    const schema: DashboardComponentSchema = {
      type: 'dashboard',
      globalFilters: [
        // Pair form, as above — the shorthand's own pin lives in `@object-ui/core`.
        { name: 'region', field: 'region', type: 'select', options: [{ value: 'EMEA', label: 'EMEA' }], defaultValue: 'EMEA' },
      ],
      widgets: [
        { id: 'w1', type: 'metric', dataset: 'sales', values: ['revenue'], filter: { stage: 'won' } } as any,
      ],
    };
    render(<DashboardRenderer schema={schema} dataSource={{ queryDataset }} />);

    await waitFor(() => {
      expect(queryDataset).toHaveBeenCalledWith('sales', expect.objectContaining({
        runtimeFilter: { $and: [{ stage: 'won' }, { region: 'EMEA' }] },
      }));
    });
  });
});

/**
 * objectstack#36372 — the always-visible mark naming the dashboard filters a
 * widget is not filtered by. It is asked of the binding the widget's query is
 * built from (`dashboardFiltersNotApplied` over `resolveBoundField`), so each
 * case reads the query beside the mark: a marked filter is absent from the
 * widget's `runtimeFilter`, an unmarked one is in it.
 */
describe('DashboardRenderer — the not-filtered mark agrees with the query (objectstack#36372)', () => {
  const region = {
    name: 'region',
    field: 'region',
    label: 'Region',
    type: 'select' as const,
    options: [{ value: 'EMEA', label: 'EMEA' }],
    defaultValue: 'EMEA',
  };

  it('marks the opted-out widget, and only it, with the filter it does not follow', async () => {
    const queryDataset = makeQueryDataset();
    const schema: DashboardComponentSchema = {
      type: 'dashboard',
      globalFilters: [region],
      widgets: [
        { id: 'w1', type: 'bar', dataset: 'invoices', values: ['count'] },
        { id: 'w2', type: 'pie', dataset: 'accounts', values: ['count'], filterBindings: { region: false } },
        { id: 'w3', type: 'line', dataset: 'orders', values: ['count'], filterBindings: { region: 'ship_region' } },
      ],
    };
    render(<DashboardRenderer schema={schema} dataSource={{ queryDataset }} />);

    await waitFor(() => {
      expect(lastRuntimeFilter(queryDataset, 'invoices')).toEqual({ region: 'EMEA' });
      expect(lastRuntimeFilter(queryDataset, 'orders')).toEqual({ ship_region: 'EMEA' });
    });
    expect(lastRuntimeFilter(queryDataset, 'accounts')).toBeUndefined();

    const mark = screen.getByTestId('dashboard-widget-filter-mark-w2');
    expect(mark).toHaveAttribute('data-filters', 'region');
    expect(mark).toHaveTextContent('Region');
    expect(screen.queryByTestId('dashboard-widget-filter-mark-w1')).not.toBeInTheDocument();
    // A rebound filter still reaches the widget, on another field: no mark.
    expect(screen.queryByTestId('dashboard-widget-filter-mark-w3')).not.toBeInTheDocument();
  });

  it('marks a widget a filter\'s targetWidgets leaves out', async () => {
    const queryDataset = makeQueryDataset();
    const schema: DashboardComponentSchema = {
      type: 'dashboard',
      globalFilters: [{ ...region, targetWidgets: ['w1'] } as any],
      widgets: [
        { id: 'w1', type: 'bar', dataset: 'invoices', values: ['count'] },
        { id: 'w2', type: 'pie', dataset: 'accounts', values: ['count'] },
      ],
    };
    render(<DashboardRenderer schema={schema} dataSource={{ queryDataset }} />);

    await waitFor(() => expect(lastRuntimeFilter(queryDataset, 'invoices')).toEqual({ region: 'EMEA' }));
    expect(lastRuntimeFilter(queryDataset, 'accounts')).toBeUndefined();
    expect(screen.getByTestId('dashboard-widget-filter-mark-w2')).toHaveAttribute('data-filters', 'region');
    expect(screen.queryByTestId('dashboard-widget-filter-mark-w1')).not.toBeInTheDocument();
  });

  it('names the built-in date filter "Date range", never its reserved name', async () => {
    const queryDataset = makeQueryDataset();
    const schema: DashboardComponentSchema = {
      type: 'dashboard',
      dateRange: { field: 'created_at', defaultRange: 'last_90_days' },
      widgets: [
        { id: 'w1', type: 'bar', dataset: 'invoices', values: ['count'] },
        { id: 'w2', type: 'pie', dataset: 'accounts', values: ['count'], filterBindings: { dateRange: false } },
      ],
    } as DashboardComponentSchema;
    render(<DashboardRenderer schema={schema} dataSource={{ queryDataset }} />);

    await waitFor(() => expect(lastRuntimeFilter(queryDataset, 'invoices')).toHaveProperty('created_at'));
    expect(lastRuntimeFilter(queryDataset, 'accounts')).toBeUndefined();
    const mark = screen.getByTestId('dashboard-widget-filter-mark-w2');
    expect(mark).toHaveAttribute('data-filters', 'dateRange');
    expect(mark).toHaveTextContent('Not filtered by Date range');
    expect(screen.queryByTestId('dashboard-widget-filter-mark-w1')).not.toBeInTheDocument();
  });

  it('draws no mark on a dashboard that declares no filters', async () => {
    const queryDataset = makeQueryDataset();
    const schema: DashboardComponentSchema = {
      type: 'dashboard',
      widgets: [{ id: 'w1', type: 'bar', dataset: 'invoices', values: ['count'], filterBindings: { region: false } }],
    };
    render(<DashboardRenderer schema={schema} dataSource={{ queryDataset }} />);
    await waitFor(() => expect(queryDataset).toHaveBeenCalled());
    expect(screen.queryByTestId('dashboard-widget-filter-mark-w1')).not.toBeInTheDocument();
  });
});
