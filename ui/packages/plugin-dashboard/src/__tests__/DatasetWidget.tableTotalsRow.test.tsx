/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5846 — the flat dataset `table` widget's totals row.
 *
 * #5827 declined it: a CORRECT total cannot be computed in this file, because
 * this file's standing rule is no client re-aggregation (an avg/min/max cannot
 * be recombined from bucketed values), and the server's marginal totals were
 * requested only for the cross-tab. #5846 rules the query-shape change: the
 * flat branch asks for the same `[]` grouping the cross-tab already requests
 * and renders the answer as a `tfoot`.
 *
 * The fixture is built so a client recombination is DISTINGUISHABLE from the
 * server's answer, which is the whole point of the card:
 *  - `avg_deal`: the server's whole-set average is 4,200,000; averaging the
 *    three bucket averages gives 3,333,333 — a different number.
 *  - `distinct_owners`: the buckets hold 1 + 3 + 5 = 9, the whole-set distinct
 *    count is 6 — adding the column up is simply wrong for this aggregate.
 * Only `annual_revenue_sum` reconciles, because only a sum does.
 *
 * DIRECTIONS, stated before the reverse verification was run — every case here
 * is RED on `origin/main` except the two that pin what did NOT move (the
 * cross-tab's three groupings, and the CSV's contents). On `origin/main`
 * `totalsGroupings` was `isMatrix ? … : undefined`, so a flat table asked for
 * nothing and no `tfoot` existed to render. There is no ablation-through-`dist`
 * here: this file imports the component by relative source path
 * (`../DatasetWidget`), so no build stands between the edit and the run.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { DatasetWidget } from '../DatasetWidget';

/** Observe the drill filter without rendering the real drawer. */
const drillFilters: Array<Record<string, unknown>> = [];
vi.mock('../DrillDownDrawer', () => ({
  DrillDownDrawer: ({ filter }: { filter: Record<string, unknown> }) => {
    drillFilters.push(filter);
    return null;
  },
}));

/** Plain TEXT dimension field, no `options` — nothing here relabels. */
const ACCOUNT = { name: 'crm_account', fields: { industry: { type: 'text' } } };

function installMetaRouter() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ item: ACCOUNT }) })),
  );
}

afterEach(() => {
  cleanup();
  drillFilters.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const industryRows = () => [
  { industry: null, annual_revenue_sum: 0, avg_deal: 0, distinct_owners: 1 },
  { industry: 'Finance', annual_revenue_sum: 12000000, avg_deal: 4000000, distinct_owners: 3 },
  { industry: 'Technology', annual_revenue_sum: 30000000, avg_deal: 6000000, distinct_owners: 5 },
];

const industryFields = [
  { name: 'industry', type: 'text', label: 'Industry' },
  { name: 'annual_revenue_sum', type: 'number', label: 'Annual Revenue' },
  { name: 'avg_deal', type: 'number', label: 'Avg Deal' },
  { name: 'distinct_owners', type: 'number', label: 'Owners' },
];

/** The server's `[]` grouping: whole-set aggregates, per measure semantics. */
const GRAND_TOTAL = { annual_revenue_sum: 42000000, avg_deal: 4200000, distinct_owners: 6 };
const grandTotals = () => [{ dimensions: [] as string[], rows: [GRAND_TOTAL] }];

const industrySource = (extra: Record<string, unknown> = {}) => ({
  queryDataset: vi.fn(async () => ({
    rows: industryRows(),
    fields: industryFields,
    totals: grandTotals(),
    ...extra,
  })),
});

/** The drillable variant — identity keys spelled unlike the display labels. */
const drillableSource = () =>
  industrySource({
    object: 'crm_account',
    dimensionFields: { industry: 'industry' },
    drillRawRows: [{ industry: null }, { industry: 'fin' }, { industry: 'tech' }],
  });

const TABLE_WIDGET = {
  type: 'table',
  dataset: 'accounts_by_industry',
  dimensions: ['industry'],
  values: ['annual_revenue_sum', 'avg_deal', 'distinct_owners'],
};

const bodyRows = () => Array.from(document.querySelectorAll('tbody tr'));
const footRow = () => document.querySelector('tfoot tr');
const footCells = () =>
  Array.from(footRow()?.querySelectorAll('td') ?? []).map((td) => td.textContent ?? '');
const dimensionColumn = () => bodyRows().map((r) => r.querySelector('td')?.textContent ?? '');
const sortButtons = () => screen.getAllByTestId('dataset-table-sort');
const selectionOf = (src: { queryDataset: ReturnType<typeof vi.fn> }) =>
  src.queryDataset.mock.calls[0][1] as Record<string, unknown>;

describe('objectui#5846 — the flat table asks the server for the `[]` grouping', () => {
  it('requests exactly the grand-total grouping, the same one the cross-tab already asks for', async () => {
    installMetaRouter();
    const src = industrySource();
    render(<DatasetWidget widget={TABLE_WIDGET} dataSource={src} />);
    await screen.findByText('Industry');

    expect(selectionOf(src).totals).toEqual({ groupings: [[]] });
  });

  it('leaves the CROSS-TAB\'s three groupings exactly as they were', async () => {
    // What did NOT move. A pivot with >=2 dimensions still asks for row
    // subtotals, column subtotals and the grand total, in that order.
    installMetaRouter();
    const src = {
      queryDataset: vi.fn(async () => ({
        rows: [{ industry: 'Finance', stage: 'won', annual_revenue_sum: 1 }],
        fields: [
          { name: 'industry', type: 'text', label: 'Industry' },
          { name: 'stage', type: 'text', label: 'Stage' },
          { name: 'annual_revenue_sum', type: 'number', label: 'Annual Revenue' },
        ],
      })),
    };
    render(
      <DatasetWidget
        widget={{ ...TABLE_WIDGET, type: 'pivot', dimensions: ['industry', 'stage'], values: ['annual_revenue_sum'] }}
        dataSource={src}
      />,
    );
    await screen.findByText('Industry');

    expect(selectionOf(src).totals).toEqual({ groupings: [['industry'], ['stage'], []] });
  });

  it('asks for NOTHING when `options.limit` truncates the table, and renders no footer', async () => {
    // The executor drops `limit` for a totals query by design, so a top-N table
    // would print a whole-set total the reader cannot reconcile against the
    // rows in front of them. No request is issued, so the cost is not paid
    // either — and the fixture answers `[]` anyway to prove the RENDER is gated
    // too, not just the request.
    installMetaRouter();
    const src = industrySource();
    render(
      <DatasetWidget widget={{ ...TABLE_WIDGET, options: { limit: 2 } }} dataSource={src} />,
    );
    await screen.findByText('Industry');
    await waitFor(() => expect(bodyRows().length).toBe(3));

    expect(selectionOf(src).totals).toBeUndefined();
    expect(footRow()).toBeNull();
    expect(screen.queryByTestId('dataset-table-total-row')).toBeNull();
  });
});

describe('objectui#5846 — the totals row is the SERVER\'s answer, never a recombination', () => {
  it('renders the server\'s whole-set aggregate per measure, under the console\'s own Total label', async () => {
    installMetaRouter();
    render(<DatasetWidget widget={TABLE_WIDGET} dataSource={industrySource()} />);
    await screen.findByText('Industry');
    await waitFor(() => expect(footRow()).not.toBeNull());

    // `dashboard.total` — the key the cross-tab's total row and PivotTable
    // already use. No new string was minted for this row.
    expect(footCells()[0]).toBe('Total');
    // sum: reconciles with the column, because a sum is the one that does.
    expect(footCells()[1]).toBe('42000000');
    // avg: the average over ALL records. Averaging the three bucket averages
    // (0, 4m, 6m) would print 3333333 — this is what "no client
    // re-aggregation" means in a number.
    expect(footCells()[2]).toBe('4200000');
    expect(footCells()[2]).not.toBe('3333333');
    // count-distinct: 6 owners overall, though the buckets hold 1 + 3 + 5 = 9.
    expect(footCells()[3]).toBe('6');
    expect(footCells()[3]).not.toBe('9');
  });

  it('omits the footer entirely when the executor answered no `[]` grouping', async () => {
    // An older server, or a dataset shape the executor cannot answer `[]` for:
    // the row is omitted rather than approximated from the rows on screen.
    installMetaRouter();
    render(<DatasetWidget widget={TABLE_WIDGET} dataSource={industrySource({ totals: undefined })} />);
    await screen.findByText('Industry');
    await waitFor(() => expect(bodyRows().length).toBe(3));

    expect(footRow()).toBeNull();
  });

  it('omits the footer when the `[]` grouping came back with no row', async () => {
    installMetaRouter();
    render(
      <DatasetWidget
        widget={TABLE_WIDGET}
        dataSource={industrySource({ totals: [{ dimensions: [], rows: [] }] })}
      />,
    );
    await screen.findByText('Industry');
    await waitFor(() => expect(bodyRows().length).toBe(3));

    expect(footRow()).toBeNull();
  });

  it('formats a footer cell through the same PER-COLUMN formatter the body uses', async () => {
    // The formatter is keyed by MEASURE, not by row, so the footer cannot drift
    // from the column above it. `percentScale: 'fraction'` is the sharp probe:
    // a footer that skipped it would render the stored 0.55 as "0.55%" (or, via
    // the magnitude heuristic, "1%") instead of "55%".
    installMetaRouter();
    const src = {
      queryDataset: vi.fn(async () => ({
        rows: [
          { industry: 'Finance', win_rate: 0.5 },
          { industry: 'Technology', win_rate: 0.6 },
        ],
        fields: [
          { name: 'industry', type: 'text', label: 'Industry' },
          { name: 'win_rate', type: 'number', label: 'Win Rate', format: '0%', percentScale: 'fraction' },
        ],
        totals: [{ dimensions: [], rows: [{ win_rate: 0.55 }] }],
      })),
    };
    render(<DatasetWidget widget={{ ...TABLE_WIDGET, values: ['win_rate'] }} dataSource={src} />);
    await screen.findByText('Win Rate');
    await waitFor(() => expect(footRow()).not.toBeNull());

    // Body first, so the comparison is against what this column actually shows.
    const bodyCell = bodyRows()[0].querySelectorAll('td')[1].textContent ?? '';
    expect(bodyCell).toMatch(/50/);
    expect(bodyCell).toMatch(/%/);
    const footCell = footCells()[1];
    expect(footCell).toMatch(/55/);
    expect(footCell).toMatch(/%/);
    expect(footCell).not.toMatch(/0\.55/);
  });

  it('right-aligns the footer\'s numeric measure cells, matching the column above', async () => {
    installMetaRouter();
    render(<DatasetWidget widget={TABLE_WIDGET} dataSource={industrySource()} />);
    await waitFor(() => expect(footRow()).not.toBeNull());

    const cells = Array.from(footRow()!.querySelectorAll('td'));
    // The label cell spans the dimension columns and stays left.
    expect(cells[0].getAttribute('colspan')).toBe('1');
    expect(cells[0].className).not.toContain('text-right');
    for (const c of cells.slice(1)) expect(c.className).toContain('text-right');
  });
});

describe('objectui#5846 — the totals row is outside the sortable rows', () => {
  it('stays last and unchanged through a sort, and never joins the body rows', async () => {
    installMetaRouter();
    render(<DatasetWidget widget={TABLE_WIDGET} dataSource={industrySource()} />);
    await waitFor(() => expect(bodyRows().length).toBe(3));

    const allRowsLast = () => {
      const rows = Array.from(document.querySelectorAll('table tr'));
      return rows[rows.length - 1];
    };
    expect(allRowsLast()).toBe(footRow());
    // Default order puts the `—` null bucket last among the BODY rows; the
    // totals row still sorts below it, because `tfoot` follows `tbody`.
    expect(dimensionColumn()).toEqual(['Finance', 'Technology', '—']);

    // Sort the measure descending, then ascending, then back to dataset order.
    for (const _ of [0, 1, 2]) {
      fireEvent.click(sortButtons()[1]);
      expect(bodyRows().length).toBe(3);
      expect(allRowsLast()).toBe(footRow());
      expect(footCells()[1]).toBe('42000000');
    }
    // The dimension column is a different first-click direction; still last.
    fireEvent.click(sortButtons()[0]);
    expect(dimensionColumn()).toEqual(['Finance', 'Technology', '—']);
    expect(allRowsLast()).toBe(footRow());
  });

  it('does not drill, and does not disturb the (row, index) pairing the body rows drill by', async () => {
    installMetaRouter();
    render(<DatasetWidget widget={TABLE_WIDGET} dataSource={drillableSource()} />);
    await waitFor(() => expect(bodyRows().length).toBe(3));
    await waitFor(() => expect(footRow()).not.toBeNull());

    // The footer carries no drill affordance at all.
    expect(footRow()!.getAttribute('data-testid')).toBe('dataset-table-total-row');
    expect(screen.getAllByTestId('dataset-drill-row').length).toBe(3);

    fireEvent.click(footRow()!);
    expect(drillFilters.length).toBe(0);

    // …and the body rows still drill by their OWN incoming index. Row 0 shows
    // Finance, whose identity key is `fin` — index 1 of the raw sidecar.
    fireEvent.click(bodyRows()[0]);
    await waitFor(() => expect(drillFilters.length).toBeGreaterThan(0));
    expect(drillFilters[drillFilters.length - 1]).toEqual({ industry: 'fin' });

    fireEvent.click(bodyRows()[2]);
    // objectui#9085 spelling; the (row, index) pairing this test pins is unchanged.
    await waitFor(() => expect(drillFilters[drillFilters.length - 1]).toEqual({ industry: { $null: true } }));
  });

  it('keeps the totals row OUT of the CSV, as the cross-tab already does', async () => {
    // What did NOT move. The export is the table's DATA — one line per bucket.
    // The cross-tab has never exported its own total row or column either.
    installMetaRouter();
    const blobs: Blob[] = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    (URL as any).createObjectURL = (b: Blob) => { blobs.push(b); return 'blob:x'; };
    (URL as any).revokeObjectURL = () => {};
    try {
      render(<DatasetWidget widget={TABLE_WIDGET} dataSource={industrySource()} />);
      await waitFor(() => expect(footRow()).not.toBeNull());
      fireEvent.click(screen.getByTestId('dataset-export'));

      expect(blobs.length).toBe(1);
      const lines = (await blobs[0].text()).trim().split('\n').map((l) => l.trim());
      expect(lines.length).toBe(4); // header + 3 buckets, no total line
      expect(lines.some((l) => l.startsWith('Total'))).toBe(false);
      expect(lines.some((l) => l.includes('42000000'))).toBe(false);
    } finally {
      (URL as any).createObjectURL = origCreate;
      (URL as any).revokeObjectURL = origRevoke;
    }
  });
});
