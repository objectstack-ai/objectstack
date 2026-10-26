// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#25970 — a `compareTo` KPI tile on a dashboard whose reader picks
 * All time in the date filter shows its number, with no comparison badge and
 * no error.
 *
 * All time is a supported filter choice the author cannot prevent: the filter
 * bar stores no value, `DashboardRenderer` merges no condition, and the
 * widget's resolved filter dates nothing. The tile used to send `compareTo`
 * anyway and render the executor's "compareTo needs a dated window to shift"
 * refusal in place of its number. A window the AUTHOR wrote as one bound (YTD)
 * keeps that refusal: the executor and the spec define a comparison only
 * against a two-bound window.
 *
 * Drives the real Radix select with user-event; the data source answers the
 * way the executor does (`resolveCompareDimension`).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DashboardComponentSchema } from '@object-ui/types';
import { DashboardRenderer } from '../DashboardRenderer';

afterEach(cleanup);

const REFUSAL =
  'Dataset query failed: 400 Bad Request — [dataset-executor] compareTo needs a dated window to shift';

const makeQueryDataset = () =>
  vi.fn(async (_dataset: string, selection: any) => {
    const shiftable = (selection.timeDimensions ?? []).some((t: any) => t.dateRange);
    if (selection.compareTo && !shiftable) throw new Error(REFUSAL);
    return {
      rows: [selection.compareTo ? { revenue: 120, revenue__compare: 100 } : { revenue: 120 }],
      fields: [],
    };
  });

/** The selection of the LAST `queryDataset` call for a given dataset. */
const lastSelection = (queryDataset: ReturnType<typeof makeQueryDataset>, dataset: string): any => {
  const calls = queryDataset.mock.calls.filter((c) => c[0] === dataset);
  return calls.length ? calls[calls.length - 1][1] : undefined;
};

const schema: DashboardComponentSchema = {
  type: 'dashboard',
  dateRange: { field: 'close_date', defaultRange: 'this_quarter' },
  widgets: [
    // Dated by the dashboard filter alone — the "Selected Period" tile.
    {
      id: 'selected', type: 'metric', title: 'Selected period', dataset: 'sales', values: ['revenue'],
      compareTo: { kind: 'previousPeriod' },
    },
    // Dated by its own one-bound window, opted out of the dashboard filter — the YTD tile.
    {
      id: 'ytd', type: 'metric', title: 'Year to date', dataset: 'sales_ytd', values: ['revenue'],
      filter: { close_date: { $gte: '{current_year_start}' } },
      filterBindings: { dateRange: false },
      compareTo: { kind: 'previousPeriod' },
    },
  ],
};

describe('DashboardRenderer — a compareTo tile under All time (#25970)', () => {
  it('compares under the default range, then shows the bare number under All time', async () => {
    const user = userEvent.setup();
    const queryDataset = makeQueryDataset();
    render(<DashboardRenderer schema={schema} dataSource={{ queryDataset }} />);

    // Control: the default range is a closed window, so the comparison runs.
    await waitFor(() => expect(screen.getAllByTestId('dataset-compare-trend')).toHaveLength(1));
    expect(lastSelection(queryDataset, 'sales').compareTo).toEqual({ kind: 'previousPeriod' });
    expect(lastSelection(queryDataset, 'sales').timeDimensions).toEqual([
      { dimension: 'close_date', dateRange: [expect.any(String), expect.any(String)] },
    ]);

    await user.click(within(screen.getByTestId('dashboard-filter-dateRange')).getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'All time' }));

    await waitFor(() => expect(lastSelection(queryDataset, 'sales')).toEqual({ dimensions: [], measures: ['revenue'] }));
    // The YTD tile never shows a number (see below), so this one is the selected-period tile.
    expect(await screen.findByText('120')).toBeInTheDocument();
    expect(screen.queryByTestId('dataset-compare-trend')).not.toBeInTheDocument();
    // The one refusal left on the page is the YTD tile's.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('keeps the refusal for an author-written one-bound window', async () => {
    const queryDataset = makeQueryDataset();
    render(<DashboardRenderer schema={schema} dataSource={{ queryDataset }} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/dated window to shift/);
    expect(lastSelection(queryDataset, 'sales_ytd').compareTo).toEqual({ kind: 'previousPeriod' });
  });
});
