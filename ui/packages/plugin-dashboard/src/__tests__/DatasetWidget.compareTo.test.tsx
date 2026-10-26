// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#3337 point 5 — the one functional half of the `compareTo`
 * convergence (objectstack#5011).
 *
 * Forwarding the structured `compareTo` is not enough on its own: the executor
 * shifts a `timeDimensions` entry carrying a `dateRange`, and this widget only
 * ever produced a `runtimeFilter`. A widget whose window lives in its own
 * filter (a date macro, or the dashboard's date-range filter merged in) got
 * "compareTo needs a dated window to shift" back and rendered no comparison.
 *
 * These tests pin the three halves of making it real: the window is LOWERED
 * (and moved, not copied), the choice of dimension stays the EXECUTOR's, and
 * the `<measure>__compare` columns the executor sends back are actually shown.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
import { DashboardWidgetSchema as SpecDashboardWidgetSchema } from '@objectstack/spec/ui';

let lastChartSchema: any = null;

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SchemaRenderer: (props: any) => {
    lastChartSchema = props.schema;
    return null;
  },
}));

import { DatasetWidget, extractDateWindows } from '../DatasetWidget';

afterEach(() => {
  cleanup();
  lastChartSchema = null;
});

const makeSource = (impl: (d: string, s: any) => Promise<any>) => ({ queryDataset: vi.fn(impl) });
const oneRow = async () => ({ rows: [{ revenue: 1 }] });
const selectionOf = (src: { queryDataset: any }) => src.queryDataset.mock.calls[0][1];

const Q2 = { close_date: { $gte: '2026-04-01', $lte: '2026-06-30' } };

describe('extractDateWindows', () => {
  it('lowers a bounded ISO window and removes it from the filter', () => {
    const { windows, rest } = extractDateWindows({ ...Q2, stage: 'won' });
    expect(windows).toEqual([{ dimension: 'close_date', dateRange: ['2026-04-01', '2026-06-30'] }]);
    expect(rest).toEqual({ stage: 'won' });
  });

  it('returns no filter at all when the window was the whole filter', () => {
    const { windows, rest } = extractDateWindows({ ...Q2 });
    expect(windows).toHaveLength(1);
    expect(rest).toBeUndefined();
  });

  // A `dateRange` is a DATE window. These four are not one, and quietly
  // treating them as one is how a widget would end up shifting the wrong thing.
  it('leaves a numeric range alone', () => {
    const filter = { amount: { $gte: 1000, $lte: 5000 } };
    expect(extractDateWindows(filter)).toEqual({ windows: [], rest: filter });
  });

  it('leaves an exclusive bound alone (dateRange has no exclusive bound)', () => {
    const filter = { close_date: { $gte: '2026-04-01', $lt: '2026-07-01' } };
    expect(extractDateWindows(filter)).toEqual({ windows: [], rest: filter });
  });

  it('leaves a half-open window alone (nothing bounded to shift)', () => {
    const filter = { close_date: { $gte: '2026-04-01' } };
    expect(extractDateWindows(filter)).toEqual({ windows: [], rest: filter });
  });

  it('leaves a window inside $or alone (it is not the window the query runs in)', () => {
    const filter = { $or: [Q2, { stage: 'won' }] };
    expect(extractDateWindows(filter)).toEqual({ windows: [], rest: filter });
  });

  it('walks $and members and unwraps the one-member conjunction left behind', () => {
    // Exactly the shape DashboardRenderer's mergeFilters produces when a
    // dashboard date-range filter is broadcast into a widget's own filter.
    const { windows, rest } = extractDateWindows({ $and: [{ stage: 'won' }, Q2] });
    expect(windows).toEqual([{ dimension: 'close_date', dateRange: ['2026-04-01', '2026-06-30'] }]);
    expect(rest).toEqual({ stage: 'won' });
  });

  it('intersects two conjunctive windows on the SAME dimension', () => {
    // Widget window (Q2) AND dashboard window (May) → May. Plain arithmetic on
    // the AND — and it keeps the executor from being handed the same dimension
    // twice and calling it ambiguous.
    const { windows } = extractDateWindows({
      $and: [Q2, { close_date: { $gte: '2026-05-01', $lte: '2026-05-31' } }],
    });
    expect(windows).toEqual([{ dimension: 'close_date', dateRange: ['2026-05-01', '2026-05-31'] }]);
  });

  it('keeps every dated dimension — picking one is the executor’s job', () => {
    const { windows } = extractDateWindows({
      close_date: { $gte: '2026-04-01', $lte: '2026-06-30' },
      created_at: { $gte: '2026-01-01', $lte: '2026-12-31' },
    });
    expect(windows.map((w) => w.dimension)).toEqual(['close_date', 'created_at']);
  });
});

describe('DatasetWidget — lowering the comparison window (#3337 point 5)', () => {
  it('lowers the resolved date window into timeDimensions and MOVES it out of runtimeFilter', async () => {
    const src = makeSource(oneRow);
    render(
      <DatasetWidget
        widget={{
          type: 'metric', dataset: 'sales', values: ['revenue'],
          filter: { ...Q2, stage: 'won' },
          compareTo: { kind: 'previousPeriod' },
        }}
        dataSource={src}
      />,
    );
    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    const selection = selectionOf(src);
    expect(selection.timeDimensions).toEqual([
      { dimension: 'close_date', dateRange: ['2026-04-01', '2026-06-30'] },
    ]);
    // MOVED, not copied. The comparison pass re-runs with the SHIFTED
    // timeDimensions but the same runtimeFilter — a copy left here would
    // intersect the shifted window with the current one and every
    // `<measure>__compare` column would come back empty.
    expect(selection.runtimeFilter).toEqual({ stage: 'won' });
  });

  it('resolves date macros before lowering them', async () => {
    const src = makeSource(oneRow);
    render(
      <DatasetWidget
        widget={{
          type: 'metric', dataset: 'sales', values: ['revenue'],
          filter: { close_date: { $gte: '{current_quarter_start}', $lte: '{current_quarter_end}' } },
          compareTo: { kind: 'previousPeriod' },
        }}
        dataSource={src}
      />,
    );
    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    const [td] = selectionOf(src).timeDimensions;
    expect(td.dimension).toBe('close_date');
    // Concrete dates, not the macro tokens the executor would have to guess at.
    expect(td.dateRange[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(td.dateRange[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('lowers nothing without compareTo — every other widget’s query is unchanged', async () => {
    const src = makeSource(oneRow);
    render(
      <DatasetWidget
        widget={{ type: 'metric', dataset: 'sales', values: ['revenue'], filter: { ...Q2 } }}
        dataSource={src}
      />,
    );
    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    expect(selectionOf(src)).toEqual({
      dimensions: [], measures: ['revenue'], runtimeFilter: Q2,
    });
  });

  it('sends BOTH dated dimensions rather than picking one', async () => {
    const src = makeSource(oneRow);
    render(
      <DatasetWidget
        widget={{
          type: 'metric', dataset: 'sales', values: ['revenue'],
          filter: { ...Q2, created_at: { $gte: '2026-01-01', $lte: '2026-12-31' } },
          compareTo: { kind: 'previousYear' },
        }}
        dataSource={src}
      />,
    );
    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    expect(selectionOf(src).timeDimensions).toHaveLength(2);
    expect(selectionOf(src).compareTo).toEqual({ kind: 'previousYear' });
  });

  it('surfaces the executor’s ambiguity error un-swallowed', async () => {
    // Verbatim from dataset-executor's resolveCompareDimension: the message
    // names the candidates so the author can pick one. A renderer that guessed
    // instead would have replaced this with a quietly wrong window.
    const message =
      '[dataset-executor] compareTo.dimension is ambiguous: 2 time dimensions carry a dateRange '
      + '("close_date", "created_at"). Name the one to shift — '
      + "compareTo: { kind: 'previousYear', dimension: 'close_date' }.";
    const src = makeSource(async () => { throw new Error(message); });
    render(
      <DatasetWidget
        widget={{
          type: 'metric', dataset: 'sales', values: ['revenue'],
          filter: { ...Q2, created_at: { $gte: '2026-01-01', $lte: '2026-12-31' } },
          compareTo: { kind: 'previousYear' },
        }}
        dataSource={src}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/ambiguous/);
    expect(screen.getByRole('alert')).toHaveTextContent(/"close_date", "created_at"/);
  });
});

describe('DatasetWidget — showing the comparison the executor returned', () => {
  it('renders the KPI delta + window label from the __compare column', async () => {
    const src = makeSource(async () => ({
      rows: [{ revenue: 120, revenue__compare: 100 }],
      fields: [{ name: 'revenue', type: 'number', label: 'Revenue' }, { name: 'revenue__compare', type: 'number' }],
    }));
    render(
      <DatasetWidget
        widget={{
          type: 'metric', dataset: 'sales', values: ['revenue'],
          filter: { ...Q2 }, compareTo: { kind: 'previousYear' },
        }}
        dataSource={src}
      />,
    );
    const trend = await screen.findByTestId('dataset-compare-trend');
    expect(trend).toHaveTextContent('20%');
    expect(trend).toHaveTextContent(/vs last year/i);
  });

  it('shows no trend when the executor attached no comparison', async () => {
    const src = makeSource(async () => ({ rows: [{ revenue: 120 }] }));
    render(
      <DatasetWidget
        widget={{ type: 'metric', dataset: 'sales', values: ['revenue'], filter: { ...Q2 }, compareTo: { kind: 'previousYear' } }}
        dataSource={src}
      />,
    );
    await screen.findByText('120');
    expect(screen.queryByTestId('dataset-compare-trend')).not.toBeInTheDocument();
  });

  it('renders a comparison COLUMN in the table, formatted as its base measure', async () => {
    const src = makeSource(async () => ({
      rows: [
        { stage: 'won', revenue: 120, revenue__compare: 100 },
        { stage: 'lost', revenue: 20, revenue__compare: 40 },
      ],
      fields: [
        { name: 'stage', type: 'string', label: 'Stage' },
        { name: 'revenue', type: 'number', label: 'Revenue', format: '$0,0' },
        { name: 'revenue__compare', type: 'number' },
      ],
    }));
    render(
      <DatasetWidget
        widget={{
          type: 'table', dataset: 'sales', dimensions: ['stage'], values: ['revenue'],
          filter: { ...Q2 }, compareTo: { kind: 'previousYear' },
        }}
        dataSource={src}
      />,
    );
    const header = await screen.findByTestId('dataset-compare-column');
    expect(header).toHaveTextContent(/Revenue/);
    expect(header).toHaveTextContent(/vs last year/i);
    // The comparison value carries the base measure's format — it is the same
    // measure over an earlier window, so "$100", never a bare 100.
    expect(screen.getByText('$100')).toBeInTheDocument();
    expect(screen.getByText('$120')).toBeInTheDocument();
  });

  it('appends a comparison SERIES to the chart, marked for the overlay treatment', async () => {
    const src = makeSource(async () => ({
      rows: [
        { stage: 'won', revenue: 120, revenue__compare: 100 },
        { stage: 'lost', revenue: 20, revenue__compare: 40 },
      ],
      fields: [{ name: 'revenue', type: 'number', label: 'Revenue' }],
    }));
    render(
      <DatasetWidget
        widget={{
          type: 'bar', dataset: 'sales', dimensions: ['stage'], values: ['revenue'],
          filter: { ...Q2 }, compareTo: { kind: 'previousYear' },
        }}
        dataSource={src}
      />,
    );
    await waitFor(() => expect(lastChartSchema).not.toBeNull());
    expect(lastChartSchema.series).toHaveLength(2);
    expect(lastChartSchema.series[0]).toMatchObject({ dataKey: 'revenue', variant: 'current' });
    expect(lastChartSchema.series[1]).toMatchObject({
      dataKey: 'revenue__compare',
      variant: 'comparison',
    });
    expect(lastChartSchema.series[1].label).toMatch(/vs last year/i);
  });

  it('adds no comparison series when no __compare column came back', async () => {
    const src = makeSource(async () => ({ rows: [{ stage: 'won', revenue: 120 }] }));
    render(
      <DatasetWidget
        widget={{ type: 'bar', dataset: 'sales', dimensions: ['stage'], values: ['revenue'], compareTo: { kind: 'previousYear' } }}
        dataSource={src}
      />,
    );
    await waitFor(() => expect(lastChartSchema).not.toBeNull());
    expect(lastChartSchema.series).toHaveLength(1);
    expect(lastChartSchema.series[0].variant).toBeUndefined();
  });
});

/**
 * objectui#11632 — on this path the label names the window the EXECUTOR
 * compared, and `compareTo.kind` alone decides that window: `previousPeriod` is
 * the equal-length window right before the resolved one, `previousYear` the
 * same window a calendar year back. The label used to be guessed from the RAW
 * filter's date-macro tokens, a guess that only holds on the inline path, where
 * `shiftFilterByCompareTo` really does swap `{today}` for `{yesterday}`. So a
 * dashboard's `last_30_days` range compared the previous 30 days and read
 * "vs yesterday". The inline path keeps its guess; its pins live with
 * `compareToTrendLabelKey` in `@object-ui/core` and with `ObjectMetricWidget`.
 */
describe('DatasetWidget — the comparison label comes from compareTo.kind (objectui#11632)', () => {
  // The dashboard's `last_30_days` date range as `DashboardRenderer` merges it
  // into a widget's filter: `{30_days_ago}` to `{today}`.
  const LAST_30_DAYS = { created_at: { $gte: '{30_days_ago}', $lte: '{today}' } };
  const compared = async () => ({
    rows: [{ revenue: 120, revenue__compare: 100 }],
    fields: [{ name: 'revenue', type: 'number', label: 'Revenue' }],
  });

  it('labels previousPeriod over a {today} window "vs previous period", not "vs yesterday"', async () => {
    const src = makeSource(compared);
    render(
      <DatasetWidget
        widget={{
          type: 'metric', dataset: 'sales', values: ['revenue'],
          filter: LAST_30_DAYS, compareTo: { kind: 'previousPeriod' },
        }}
        dataSource={src}
      />,
    );
    const trend = await screen.findByTestId('dataset-compare-trend');
    expect(trend).toHaveTextContent(/vs previous period/i);
    expect(trend).not.toHaveTextContent(/yesterday/i);
    // The whole resolved window went to the executor to shift. A one-day
    // window would be the only one whose previous period is a single day.
    const [td] = selectionOf(src).timeDimensions;
    expect(td.dimension).toBe('created_at');
    expect(td.dateRange[0]).not.toBe(td.dateRange[1]);
  });

  it('names the chart’s comparison series from the kind too (the line legend)', async () => {
    const src = makeSource(async () => ({
      rows: [
        { stage: 'won', revenue: 120, revenue__compare: 100 },
        { stage: 'lost', revenue: 20, revenue__compare: 40 },
      ],
      fields: [{ name: 'revenue', type: 'number', label: 'Revenue' }],
    }));
    render(
      <DatasetWidget
        widget={{
          type: 'line', dataset: 'sales', dimensions: ['stage'], values: ['revenue'],
          filter: LAST_30_DAYS, compareTo: { kind: 'previousPeriod' },
        }}
        dataSource={src}
      />,
    );
    await waitFor(() => expect(lastChartSchema).not.toBeNull());
    expect(lastChartSchema.series[1]).toMatchObject({ dataKey: 'revenue__compare', variant: 'comparison' });
    expect(lastChartSchema.series[1].label).toMatch(/vs previous period/i);
    expect(lastChartSchema.series[1].label).not.toMatch(/yesterday/i);
  });

  it('does not read a calendar unit off the macros: a quarter’s previousPeriod is "vs previous period"', async () => {
    // The equal-length window before a quarter is a calendar quarter only by
    // coincidence: Q1 (90 days) shifted back 90 days starts in October.
    const src = makeSource(compared);
    render(
      <DatasetWidget
        widget={{
          type: 'metric', dataset: 'sales', values: ['revenue'],
          filter: { close_date: { $gte: '{current_quarter_start}', $lte: '{current_quarter_end}' } },
          compareTo: { kind: 'previousPeriod' },
        }}
        dataSource={src}
      />,
    );
    const trend = await screen.findByTestId('dataset-compare-trend');
    expect(trend).toHaveTextContent(/vs previous period/i);
    expect(trend).not.toHaveTextContent(/quarter/i);
  });

  // Every kind the spec declares for a widget's `compareTo`, read from the spec
  // itself, so a kind added there fails the coverage check below until it has
  // a label of its own.
  const SPEC_KINDS: readonly string[] = SpecDashboardWidgetSchema.shape.compareTo.unwrap().shape.kind.options;
  const LABEL_OF_KIND: Record<string, RegExp> = {
    previousPeriod: /vs previous period/i,
    previousYear: /vs last year/i,
  };

  it('has an expected label for every kind the spec declares', () => {
    expect([...SPEC_KINDS].sort()).toEqual(Object.keys(LABEL_OF_KIND).sort());
  });

  it.each(SPEC_KINDS)('labels %s over a {today} window from the kind alone', async (kind) => {
    const src = makeSource(compared);
    render(
      <DatasetWidget
        widget={{
          type: 'metric', dataset: 'sales', values: ['revenue'],
          filter: LAST_30_DAYS, compareTo: { kind },
        }}
        dataSource={src}
      />,
    );
    const trend = await screen.findByTestId('dataset-compare-trend');
    expect(trend).toHaveTextContent(LABEL_OF_KIND[kind]);
    expect(trend).not.toHaveTextContent(/yesterday/i);
  });
});

/**
 * objectui#3614 — the cross-tab was the one render path PR #3612 left out, so a
 * `type: 'pivot'` widget with ≥2 dimensions ran a correct comparison query,
 * received the `<measure>__compare` columns, and showed none of them.
 *
 * Maintainer ruling 2026-08-07 chose **form 2, in-cell stacking**: the columns
 * stay `bucket × measure` (a comparison column would make them
 * `bucket × measure × window`), the comparison rides underneath the value in
 * smaller type, all three subtotals get the same treatment, and the CSV export
 * stays DATA-shaped — flat `<measure>__compare` columns, never a stacked
 * string. These tests pin all four.
 */
const PIVOT_FIELDS = [
  { name: 'status', type: 'string', label: 'Status' },
  { name: 'priority', type: 'string', label: 'Priority' },
  { name: 'amount', type: 'number', label: 'Amount', format: '$0,0' },
  { name: 'amount__compare', type: 'number' },
];

/**
 * Open/High rises (120 vs 100), Open/Low falls (30 vs 60), Done/High is flat
 * (200 vs 200) and Done/Low has no row at all — one fixture covering every
 * direction `computeMetricDelta` can return plus the empty cell. Subtotals are
 * the SERVER's aggregates (ADR-0021), comparison included, and deliberately not
 * re-derivable from the cells: 150/160, 200/200, 320/300, 30/60, 350/360.
 */
const comparedPivotResult = {
  rows: [
    { status: 'Open', priority: 'High', amount: 120, amount__compare: 100 },
    { status: 'Open', priority: 'Low', amount: 30, amount__compare: 60 },
    { status: 'Done', priority: 'High', amount: 200, amount__compare: 200 },
  ],
  fields: PIVOT_FIELDS,
  totals: [
    { dimensions: ['status'], rows: [
      { status: 'Open', amount: 150, amount__compare: 160 },
      { status: 'Done', amount: 200, amount__compare: 200 },
    ] },
    { dimensions: ['priority'], rows: [
      { priority: 'High', amount: 320, amount__compare: 300 },
      { priority: 'Low', amount: 30, amount__compare: 60 },
    ] },
    { dimensions: [], rows: [{ amount: 350, amount__compare: 360 }] },
  ],
};

const pivotWidget = (extra: Record<string, unknown> = {}) => ({
  type: 'pivot', dataset: 'deals', dimensions: ['status', 'priority'], values: ['amount'],
  filter: { ...Q2 }, title: 'Deals',
  ...extra,
});

/** The row whose first cell reads `label`, as a live element. */
const rowOf = (matrix: HTMLElement, label: string) =>
  within(matrix).getByText(label).closest('tr') as HTMLElement;
const cellsOf = (row: HTMLElement) => [...row.querySelectorAll('td')] as HTMLElement[];

describe('DatasetWidget — the cross-tab’s in-cell comparison (#3614)', () => {
  it('stacks the comparison value + delta under each cross-tab cell', async () => {
    const src = makeSource(async () => comparedPivotResult);
    render(<DatasetWidget widget={pivotWidget({ compareTo: { kind: 'previousYear' } })} dataSource={src} />);
    const m = await screen.findByTestId('dataset-matrix');

    // Columns are still bucket × measure — the ruling's whole point. Two
    // buckets (High, Low) + one Total column, no third header level.
    expect(within(m).getAllByRole('columnheader').map((h) => h.textContent))
      .toEqual(['Status', 'High', 'Low', 'Total']);

    const cells = cellsOf(rowOf(m, 'Open'));
    const rising = within(cells[1]).getByTestId('matrix-cell-compare');
    // The current value stays the cell's own top line; the comparison is a
    // separate node under it, NOT concatenated into the value.
    expect(cells[1].textContent?.replace(rising.textContent ?? '', '')).toBe('$120');
    // The comparison carries the base measure's format ($0,0) — it is the same
    // measure over an earlier window, so "$100", never a bare 100.
    expect(rising).toHaveTextContent('$100');
    expect(rising).toHaveTextContent('20%');
    expect(rising).toHaveAttribute('data-direction', 'up');
    // The window is named once per table (caption), and on the stack itself for
    // hover — the cross-tab has no per-window column header to qualify.
    expect(rising.getAttribute('title')).toMatch(/vs last year/i);
    expect(within(m).getByTestId('matrix-compare-caption').textContent).toMatch(/vs last year/i);

    // A fall and a flat cell — same delta helper as the KPI path, so the sign
    // and rounding come from one place.
    const falling = within(cells[2]).getByTestId('matrix-cell-compare');
    expect(falling).toHaveTextContent('$60');
    expect(falling).toHaveTextContent('50%');
    expect(falling).toHaveAttribute('data-direction', 'down');

    const doneCells = cellsOf(rowOf(m, 'Done'));
    expect(within(doneCells[1]).getByTestId('matrix-cell-compare')).toHaveAttribute('data-direction', 'neutral');
    // Done/Low has no row: an empty cell gains no comparison out of nowhere.
    expect(doneCells[2].textContent).toBe('—');
    expect(within(doneCells[2]).queryByTestId('matrix-cell-compare')).not.toBeInTheDocument();
  });

  it('stacks the comparison in the row, column and grand subtotals too', async () => {
    const src = makeSource(async () => comparedPivotResult);
    render(<DatasetWidget widget={pivotWidget({ compareTo: { kind: 'previousYear' } })} dataSource={src} />);
    const m = await screen.findByTestId('dataset-matrix');

    // Row subtotals (Open 150 vs 160 → down 6%, Done 200 vs 200 → flat).
    const rowTotals = within(m).getAllByTestId('matrix-row-total');
    expect(rowTotals.map((t) => within(t).getByTestId('matrix-cell-compare').textContent))
      .toEqual(['$1606%', '$2000%']);
    expect(within(rowTotals[0]).getByTestId('matrix-cell-compare')).toHaveAttribute('data-direction', 'down');

    // Column subtotals live in the Total row, before the grand total.
    const totalRow = within(m).getByTestId('matrix-total-row');
    const colTotals = cellsOf(totalRow).slice(1, 3);
    expect(colTotals.map((t) => within(t).getByTestId('matrix-cell-compare').textContent))
      .toEqual(['$3007%', '$6050%']);

    // Grand total (350 vs 360 → down 3%).
    const grand = within(m).getByTestId('matrix-grand-total');
    expect(grand.textContent).toContain('$350');
    const grandCompare = within(grand).getByTestId('matrix-cell-compare');
    expect(grandCompare).toHaveTextContent('$360');
    expect(grandCompare).toHaveTextContent('3%');
    expect(grandCompare).toHaveAttribute('data-direction', 'down');
  });

  it('exports FLAT metric__compare columns — the CSV is data, not the stacked cell', async () => {
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    const blobs: any[] = [];
    (URL as any).createObjectURL = (b: any) => { blobs.push(b); return 'blob:x'; };
    (URL as any).revokeObjectURL = () => {};
    try {
      const src = makeSource(async () => comparedPivotResult);
      render(<DatasetWidget widget={pivotWidget({ compareTo: { kind: 'previousYear' } })} dataSource={src} />);
      fireEvent.click(await screen.findByTestId('dataset-export'));
      expect(blobs).toHaveLength(1);
      const text: string = await blobs[0].text();

      // One flat column per compared measure, labelled like the flat table's
      // comparison column header.
      // downloadCsv prepends a UTF-8 BOM (U+FEFF) so Excel reads non-ASCII
      // labels; strip it before comparing the header line.
      const [header, ...body] = text.replace(/^\uFEFF/, '').split('\r\n');
      expect(header).toBe('Status,Priority,Amount,Amount · vs last year');
      expect(body).toEqual(['Open,High,120,100', 'Open,Low,30,60', 'Done,High,200,200']);
      // Not a stacked string anywhere: no display formatting survives into the
      // data ("$120", "20%"), so a spreadsheet can still compute on it.
      expect(text).not.toContain('$');
      expect(text).not.toContain('%');
    } finally {
      (URL as any).createObjectURL = origCreate;
      (URL as any).revokeObjectURL = origRevoke;
    }
  });

  // ── Regression pins: nothing appears where no comparison exists ───────────
  it('renders a pivot WITHOUT compareTo exactly as before', async () => {
    const src = makeSource(async () => ({
      rows: [
        { status: 'Open', priority: 'High', amount: 120 },
        { status: 'Done', priority: 'High', amount: 200 },
      ],
      fields: PIVOT_FIELDS.filter((f) => f.name !== 'amount__compare'),
      totals: [
        { dimensions: ['status'], rows: [{ status: 'Open', amount: 120 }, { status: 'Done', amount: 200 }] },
        { dimensions: ['priority'], rows: [{ priority: 'High', amount: 320 }] },
        { dimensions: [], rows: [{ amount: 320 }] },
      ],
    }));
    render(<DatasetWidget widget={pivotWidget()} dataSource={src} />);
    const m = await screen.findByTestId('dataset-matrix');
    expect(cellsOf(rowOf(m, 'Open')).map((c) => c.textContent)).toEqual(['Open', '$120', '$120']);
    expect(cellsOf(within(m).getByTestId('matrix-total-row')).map((c) => c.textContent))
      .toEqual(['Total', '$320', '$320']);
    expect(within(m).queryAllByTestId('matrix-cell-compare')).toHaveLength(0);
    expect(within(m).queryByTestId('matrix-compare-caption')).not.toBeInTheDocument();
  });

  it('stacks nothing when compareTo is set but the executor attached no comparison', async () => {
    const src = makeSource(async () => ({
      rows: [{ status: 'Open', priority: 'High', amount: 120 }],
      fields: PIVOT_FIELDS.filter((f) => f.name !== 'amount__compare'),
    }));
    render(<DatasetWidget widget={pivotWidget({ compareTo: { kind: 'previousYear' } })} dataSource={src} />);
    const m = await screen.findByTestId('dataset-matrix');
    expect(within(m).getByText('$120')).toBeInTheDocument();
    expect(within(m).queryAllByTestId('matrix-cell-compare')).toHaveLength(0);
    expect(within(m).queryByTestId('matrix-compare-caption')).not.toBeInTheDocument();
  });

  it('stacks nothing for __compare columns the widget never asked to compare', async () => {
    // Detection is data-driven but still gated on `compareTo` (the same gate the
    // KPI / flat-table / chart paths use): a stray `<measure>__compare` column
    // in the result is not a comparison this widget asked for, and rendering it
    // would put an unexplained second number in every cell.
    const src = makeSource(async () => comparedPivotResult);
    render(<DatasetWidget widget={pivotWidget()} dataSource={src} />);
    const m = await screen.findByTestId('dataset-matrix');
    expect(within(m).queryAllByTestId('matrix-cell-compare')).toHaveLength(0);
    expect(within(m).queryByTestId('matrix-compare-caption')).not.toBeInTheDocument();
  });
});
