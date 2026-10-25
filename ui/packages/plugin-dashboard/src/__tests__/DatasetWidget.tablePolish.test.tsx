/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5827 — the flat dataset `table` widget read as a raw dump.
 *
 * Measured on HotCRM's `executive_dashboard` → 按行业统计客户 (`type: 'table'`,
 * dataset-backed, one dimension + two measures): numeric columns left-aligned
 * with `tabular-nums` applied and therefore wasted, no sort affordance on any
 * header, the empty-`industry` bucket rendering as row 1, and no hover on a
 * table that is not drillable. The fixture below is that widget's shape,
 * including the incoming row order (blank bucket first, then alphabetical).
 *
 * DIRECTIONS, stated before the reverse verification was run — every case in
 * this file is RED on `origin/main`:
 *  - alignment: `th`/`td` carried `text-left` (header) and no alignment class
 *    (cell), so the right-align assertions fail;
 *  - sorting: no `dataset-table-sort` control existed at all, so those cases
 *    fail at the query rather than at the assertion;
 *  - blank bucket last: the widget rendered `state.rows` in arrival order;
 *  - hover: `hover:bg-muted/40` was applied only through the `canDrill` arm.
 * There is no ablation-through-`dist` here: this file imports the component by
 * relative source path (`../DatasetWidget`), so no build stands between the
 * edit and the run.
 *
 * The drill case is the sharp one and is why the reorder is implemented over
 * DECORATED rows. `openDrill(i)` indexes the server's parallel `drillRawRows`;
 * reordering bare rows would keep every length and every click working while
 * filtering by another row's bucket. `drillRawRows` below is spelled in
 * lower-case identity keys, deliberately different from the display labels, so
 * an index-aligned drill can be told apart from a lucky string match.
 *
 * NOT this card, and deliberately unasserted: the untranslated measure header
 * ("Annual Revenue" beside 行业) is the dataset-label i18n gap filed as
 * objectstack#10292.
 *
 * objectui#5845 later RULED the first-click direction, which #5827 had shipped
 * as asc-first for every column and flagged as an open question: a numeric
 * MEASURE column now starts DESCENDING (desc → asc → dataset order), while a
 * dimension and a non-numeric measure keep asc → desc → dataset order. The
 * cases below are split along that line — the #5827 block pins what did NOT
 * move, the #5845 block pins what did — and the blanks-last invariant is
 * asserted on BOTH halves, because the descending arm (where naive negation of
 * `compareSortValues` would float blanks to the top) is now what a measure
 * column's very FIRST click runs.
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

/**
 * The dataset's base object. Every field is plain TEXT with no `options`, so
 * `relabelDimensions` resolves nothing and the rows reach the table exactly as
 * the fixture wrote them — this file is about ORDER and ALIGNMENT, and an
 * option-driven relabel would blur which channel produced a cell.
 */
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

/**
 * 按行业统计客户, as the server sends it: the empty bucket FIRST, then the named
 * industries alphabetically — which is how Technology (the largest) ended up
 * rendering last.
 */
const industryRows = () => [
  { industry: null, annual_revenue_sum: 0, account_count: 1 },
  { industry: 'Finance', annual_revenue_sum: 12000000, account_count: 3 },
  { industry: 'Technology', annual_revenue_sum: 30000000, account_count: 5 },
];

const industryFields = [
  { name: 'industry', type: 'text', label: 'Industry' },
  { name: 'annual_revenue_sum', type: 'number', label: 'Annual Revenue' },
  { name: 'account_count', type: 'number', label: 'Accounts' },
];

const industrySource = (extra: Record<string, unknown> = {}) => ({
  queryDataset: vi.fn(async () => ({ rows: industryRows(), fields: industryFields, ...extra })),
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
  values: ['annual_revenue_sum', 'account_count'],
};

const headerCells = () => Array.from(document.querySelectorAll('thead th'));
const bodyRows = () => Array.from(document.querySelectorAll('tbody tr'));
const rowCells = (i: number) =>
  Array.from(bodyRows()[i]?.querySelectorAll('td') ?? []).map((td) => td.textContent ?? '');
/** The first cell of each body row, top to bottom — i.e. the rendered order. */
const dimensionColumn = () => bodyRows().map((r) => r.querySelector('td')?.textContent ?? '');

const sortButtons = () => screen.getAllByTestId('dataset-table-sort');

describe('objectui#5827 — dataset table alignment', () => {
  it('right-aligns numeric measure columns, header AND cells, and leaves the dimension alone', async () => {
    installMetaRouter();
    render(<DatasetWidget widget={TABLE_WIDGET} dataSource={industrySource()} />);
    await screen.findByText('Industry');

    const [dimHead, revenueHead, countHead] = headerCells();
    // A dimension is a grouping axis, never a quantity.
    expect(dimHead.className).toContain('text-left');
    expect(dimHead.className).not.toContain('text-right');
    expect(revenueHead.className).toContain('text-right');
    expect(countHead.className).toContain('text-right');

    const cells = Array.from(bodyRows()[0].querySelectorAll('td'));
    expect(cells[0].className).not.toContain('text-right');
    expect(cells[1].className).toContain('text-right');
    expect(cells[2].className).toContain('text-right');
    // `tabular-nums` was already applied to every cell and is kept — it is the
    // right-alignment it was waiting for, not a replacement for it.
    expect(cells[1].className).toContain('tabular-nums');
  });

  it('does NOT right-align a measure whose values are text (a min()/max() over a text field)', async () => {
    // The declared column `type` cannot decide this: the executor stamps
    // `type: 'number'` on every measure it appends regardless of the aggregate.
    // So numeric-ness is read from the VALUES, and one non-null non-number is
    // enough to disqualify the column.
    installMetaRouter();
    const src = {
      queryDataset: vi.fn(async () => ({
        rows: [
          { industry: 'Finance', top_account: 'Northwind', account_count: 3 },
          { industry: 'Technology', top_account: 'Contoso', account_count: 5 },
        ],
        fields: [
          { name: 'industry', type: 'text', label: 'Industry' },
          // `type: 'number'` deliberately — that is what the executor sends.
          { name: 'top_account', type: 'number', label: 'Top Account' },
          { name: 'account_count', type: 'number', label: 'Accounts' },
        ],
      })),
    };
    render(
      <DatasetWidget
        widget={{ ...TABLE_WIDGET, values: ['top_account', 'account_count'] }}
        dataSource={src}
      />,
    );
    await screen.findByText('Top Account');

    const [, topAccountHead, countHead] = headerCells();
    expect(topAccountHead.className).not.toContain('text-right');
    expect(countHead.className).toContain('text-right');
    const cells = Array.from(bodyRows()[0].querySelectorAll('td'));
    expect(cells[1].className).not.toContain('text-right');
    expect(cells[2].className).toContain('text-right');
  });
});

describe('objectui#5827 — the empty dimension bucket sorts last', () => {
  it('keeps the — label but pins the blank bucket after the named rows in the default order', async () => {
    installMetaRouter();
    render(<DatasetWidget widget={TABLE_WIDGET} dataSource={industrySource()} />);
    await screen.findByText('Industry');

    // Arrival order was [blank, Finance, Technology].
    await waitFor(() => expect(bodyRows().length).toBe(3));
    expect(dimensionColumn()).toEqual(['Finance', 'Technology', '—']);
    // The named rows keep the server's relative order — the sort is stable and
    // says nothing about any pair except blank-vs-named.
    expect(rowCells(0)[0]).toBe('Finance');
    expect(rowCells(1)[0]).toBe('Technology');
  });

  it('drills the row it is showing, not the row that used to be in that slot', async () => {
    installMetaRouter();
    render(<DatasetWidget widget={TABLE_WIDGET} dataSource={drillableSource()} />);
    await waitFor(() => expect(bodyRows().length).toBe(3));
    expect(dimensionColumn()).toEqual(['Finance', 'Technology', '—']);

    // Row 0 now shows Finance, whose identity key is `fin` — index 1 of the
    // raw sidecar. Reordering bare rows would have filtered by `null` here.
    fireEvent.click(bodyRows()[0]);
    await waitFor(() => expect(drillFilters.length).toBeGreaterThan(0));
    expect(drillFilters[drillFilters.length - 1]).toEqual({ industry: 'fin' });

    // …and the blank bucket, now last, still drills to "is empty".
    fireEvent.click(bodyRows()[2]);
    await waitFor(() =>
      // objectui#9085 spelling; the sorted-row identity this test pins is unchanged.
      expect(drillFilters[drillFilters.length - 1]).toEqual({ industry: { $null: true } }),
    );
  });
});

describe('objectui#5827 — sortable headers', () => {
  it('cycles a DIMENSION column asc → desc → the default order and reports it via aria-sort', async () => {
    // A grouping axis keeps the console DataTable idiom, A→Z first. objectui#5845
    // moved the MEASURE columns only; this case is the unchanged half.
    installMetaRouter();
    render(<DatasetWidget widget={TABLE_WIDGET} dataSource={industrySource()} />);
    await screen.findByText('Industry');
    await waitFor(() => expect(bodyRows().length).toBe(3));

    // Default: no column claims a sort.
    expect(headerCells().map((th) => th.getAttribute('aria-sort'))).toEqual(['none', 'none', 'none']);

    fireEvent.click(sortButtons()[0]);
    expect(headerCells()[0].getAttribute('aria-sort')).toBe('ascending');
    expect(dimensionColumn()).toEqual(['Finance', 'Technology', '—']);

    fireEvent.click(sortButtons()[0]);
    expect(headerCells()[0].getAttribute('aria-sort')).toBe('descending');
    expect(dimensionColumn()).toEqual(['Technology', 'Finance', '—']);

    // Third click returns the dataset's own order.
    fireEvent.click(sortButtons()[0]);
    expect(headerCells()[0].getAttribute('aria-sort')).toBe('none');
    expect(dimensionColumn()).toEqual(['Finance', 'Technology', '—']);
  });

  it('starts a NEW column at its OWN first direction rather than inheriting the previous column state', async () => {
    installMetaRouter();
    render(<DatasetWidget widget={TABLE_WIDGET} dataSource={industrySource()} />);
    await waitFor(() => expect(bodyRows().length).toBe(3));

    fireEvent.click(sortButtons()[1]); // revenue — a measure, so DESCENDING
    fireEvent.click(sortButtons()[1]); // …then ascending
    fireEvent.click(sortButtons()[0]); // switch to the dimension: ascending, its own first
    expect(headerCells().map((th) => th.getAttribute('aria-sort'))).toEqual(['ascending', 'none', 'none']);
    expect(dimensionColumn()).toEqual(['Finance', 'Technology', '—']);

    // …and back the other way: leaving an ascending DIMENSION for a measure
    // does not carry `asc` across — the measure claims its own descending.
    fireEvent.click(sortButtons()[1]);
    expect(headerCells().map((th) => th.getAttribute('aria-sort'))).toEqual(['none', 'descending', 'none']);
    expect(dimensionColumn()).toEqual(['Technology', 'Finance', '—']);
  });

  it('sorts blanks LAST in both directions', async () => {
    // `compareSortValues` puts blanks last ascending and documents that callers
    // negate for descending — which would float them to the top. So the blank
    // arm is settled before the direction is applied. Sorted on the DIMENSION,
    // where the blank actually lives.
    installMetaRouter();
    render(<DatasetWidget widget={TABLE_WIDGET} dataSource={industrySource()} />);
    await waitFor(() => expect(bodyRows().length).toBe(3));

    fireEvent.click(sortButtons()[0]);
    expect(dimensionColumn()).toEqual(['Finance', 'Technology', '—']);
    fireEvent.click(sortButtons()[0]);
    expect(dimensionColumn()).toEqual(['Technology', 'Finance', '—']);
  });

  it('sorts numerically, not lexicographically', async () => {
    installMetaRouter();
    const src = {
      queryDataset: vi.fn(async () => ({
        rows: [
          { industry: 'Finance', account_count: 9 },
          { industry: 'Technology', account_count: 10 },
        ],
        fields: [
          { name: 'industry', type: 'text', label: 'Industry' },
          { name: 'account_count', type: 'number', label: 'Accounts' },
        ],
      })),
    };
    render(<DatasetWidget widget={{ ...TABLE_WIDGET, values: ['account_count'] }} dataSource={src} />);
    await waitFor(() => expect(bodyRows().length).toBe(2));

    // First click on a measure is DESCENDING (objectui#5845): 10 before 9.
    // A string compare would put '9' first descending, inverting this.
    fireEvent.click(sortButtons()[1]);
    expect(dimensionColumn()).toEqual(['Technology', 'Finance']);
    // Second click ascending: 9 before 10 — a string compare inverts this one too.
    fireEvent.click(sortButtons()[1]);
    expect(dimensionColumn()).toEqual(['Finance', 'Technology']);
  });

  it('exports the CSV in the order the table is showing', async () => {
    installMetaRouter();
    const blobs: Blob[] = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    (URL as any).createObjectURL = (b: Blob) => { blobs.push(b); return 'blob:x'; };
    (URL as any).revokeObjectURL = () => {};
    try {
      render(<DatasetWidget widget={TABLE_WIDGET} dataSource={industrySource()} />);
      await waitFor(() => expect(bodyRows().length).toBe(3));
      fireEvent.click(sortButtons()[1]); // revenue — one click IS descending now
      fireEvent.click(screen.getByTestId('dataset-export'));

      expect(blobs.length).toBe(1);
      const lines = (await blobs[0].text()).trim().split('\n').map((l) => l.trim());
      // Header, then the rows in the order on screen.
      expect(lines[1]).toContain('Technology');
      expect(lines[2]).toContain('Finance');
      // The measure round-trips as a bare number, as it always has.
      expect(lines[1]).toContain('30000000');
    } finally {
      (URL as any).createObjectURL = origCreate;
      (URL as any).revokeObjectURL = origRevoke;
    }
  });
});

describe('objectui#5845 — a numeric measure column starts DESCENDING', () => {
  it('cycles a measure desc → asc → the dataset order and reports each state via aria-sort', async () => {
    // The ruled contract. "Who is biggest" is the question a click asks of a
    // measure, and #5827's own motivating reading was that Technology — the
    // largest industry — rendered last; one click now answers it.
    installMetaRouter();
    render(<DatasetWidget widget={TABLE_WIDGET} dataSource={industrySource()} />);
    await screen.findByText('Industry');
    await waitFor(() => expect(bodyRows().length).toBe(3));

    expect(headerCells().map((th) => th.getAttribute('aria-sort'))).toEqual(['none', 'none', 'none']);

    // FIRST click: descending. `aria-sort` says so, and it is truthful about
    // the direction actually applied rather than about where the cycle began.
    fireEvent.click(sortButtons()[1]);
    expect(headerCells()[1].getAttribute('aria-sort')).toBe('descending');
    expect(dimensionColumn()).toEqual(['Technology', 'Finance', '—']);

    // Second click: ascending. The blank bucket's revenue is 0 — a real
    // number, not a blank — so it leads.
    fireEvent.click(sortButtons()[1]);
    expect(headerCells()[1].getAttribute('aria-sort')).toBe('ascending');
    expect(dimensionColumn()).toEqual(['—', 'Finance', 'Technology']);

    // Third click: the dataset's own order (blank dimension bucket last). The
    // measure keeps all THREE states — writing the middle step as the literal
    // `'desc'` would have collapsed the cycle to desc → desc.
    fireEvent.click(sortButtons()[1]);
    expect(headerCells()[1].getAttribute('aria-sort')).toBe('none');
    expect(dimensionColumn()).toEqual(['Finance', 'Technology', '—']);
  });

  it('starts a measure whose values are TEXT ascending — direction follows the numeric classification, not "is a measure"', async () => {
    // Same set that decides right-alignment: a `min()`/`max()` over a text
    // field is a measure but not a NUMERIC one, so it keeps the A→Z idiom.
    // The declared `type: 'number'` is deliberately kept in the fixture — it is
    // what the executor sends, and it must not be what decides this.
    installMetaRouter();
    const src = {
      queryDataset: vi.fn(async () => ({
        rows: [
          { industry: 'Finance', top_account: 'Northwind', account_count: 3 },
          { industry: 'Technology', top_account: 'Contoso', account_count: 5 },
        ],
        fields: [
          { name: 'industry', type: 'text', label: 'Industry' },
          { name: 'top_account', type: 'number', label: 'Top Account' },
          { name: 'account_count', type: 'number', label: 'Accounts' },
        ],
      })),
    };
    render(
      <DatasetWidget
        widget={{ ...TABLE_WIDGET, values: ['top_account', 'account_count'] }}
        dataSource={src}
      />,
    );
    await screen.findByText('Top Account');
    await waitFor(() => expect(bodyRows().length).toBe(2));

    fireEvent.click(sortButtons()[1]);
    expect(headerCells()[1].getAttribute('aria-sort')).toBe('ascending');
    expect(dimensionColumn()).toEqual(['Technology', 'Finance']); // Contoso before Northwind

    // …while the genuinely numeric measure beside it starts descending.
    fireEvent.click(sortButtons()[2]);
    expect(headerCells()[2].getAttribute('aria-sort')).toBe('descending');
    expect(dimensionColumn()).toEqual(['Technology', 'Finance']); // 5 before 3
  });

  it('keeps blanks LAST on a measure in both directions, starting with the descending FIRST click', async () => {
    // The negate-trap #5827 documented has to survive the flip, and the flip
    // makes it the FIRST thing a user hits: `compareSortValues` places blanks
    // last ASCENDING and expects callers to negate for descending, which would
    // float them to the top. A null value keeps the column numeric (nulls are
    // allowed by the all-non-null-values-are-numbers test), so this really is
    // a desc-first column.
    installMetaRouter();
    const src = {
      queryDataset: vi.fn(async () => ({
        rows: [
          { industry: 'Finance', annual_revenue_sum: 12000000, account_count: 3 },
          { industry: 'Technology', annual_revenue_sum: null, account_count: 5 },
          { industry: 'Retail', annual_revenue_sum: 30000000, account_count: 2 },
        ],
        fields: industryFields,
      })),
    };
    render(<DatasetWidget widget={TABLE_WIDGET} dataSource={src} />);
    await screen.findByText('Industry');
    await waitFor(() => expect(bodyRows().length).toBe(3));

    // Descending on the first click: 30m, 12m, then the blank — NOT the blank
    // first, which is what a negated comparator would have produced.
    fireEvent.click(sortButtons()[1]);
    expect(headerCells()[1].getAttribute('aria-sort')).toBe('descending');
    expect(dimensionColumn()).toEqual(['Retail', 'Finance', 'Technology']);

    // Ascending on the second: 12m, 30m, blank still last.
    fireEvent.click(sortButtons()[1]);
    expect(headerCells()[1].getAttribute('aria-sort')).toBe('ascending');
    expect(dimensionColumn()).toEqual(['Finance', 'Retail', 'Technology']);
  });
});

describe('objectui#5827 — row affordances', () => {
  it('gives every row hover feedback, drillable or not', async () => {
    installMetaRouter();
    render(<DatasetWidget widget={TABLE_WIDGET} dataSource={industrySource()} />);
    await waitFor(() => expect(bodyRows().length).toBe(3));
    // Not drillable: no object/dimensionFields in this fixture.
    expect(screen.queryByTestId('dataset-drill-row')).toBeNull();
    for (const row of bodyRows()) expect(row.className).toContain('hover:bg-muted/40');
  });

  it('keeps the drillable row on its stronger accent fill', async () => {
    installMetaRouter();
    render(<DatasetWidget widget={TABLE_WIDGET} dataSource={drillableSource()} />);
    await waitFor(() => expect(bodyRows().length).toBe(3));
    for (const row of bodyRows()) {
      expect(row.className).toContain('hover:bg-accent/40');
      expect(row.className).toContain('cursor-pointer');
      // tailwind-merge collapses the two hover fills to the later one.
      expect(row.className).not.toContain('hover:bg-muted/40');
    }
  });
});
