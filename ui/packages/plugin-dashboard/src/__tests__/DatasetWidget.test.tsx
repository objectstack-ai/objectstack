// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
import { DatasetWidget, buildDrillFilter, buildPivot, pivotCellKey, toCsv } from '../DatasetWidget';
// The drill-through case below mounts DrillDownDrawer's record list, which is
// rendered through the component registry. Imported at module scope, not in a
// hook: the cold transform must not be billed to a bounded test/hook budget
// (AGENTS.md 测试纪律, objectui#3010).
import '@object-ui/components';

/* ────────────────────────────────────────────────────────────────────────────
 * objectui#5280 — the metadata probe this file used to send to the REAL network
 *
 * Same root cause as objectui#5225 (packages/plugin-report), a different
 * consumer of the shared hook. Every fixture below whose mocked query result
 * carries `object` (the drill-through / pivot-drill cases) made a live TCP
 * connection per run to `http://localhost:3000` — 10 stderr lines, 5 real
 * connection attempts (measured on this file: 3× `showcase_task`, 2×
 * `showcase_deal`), while all 52 tests reported green throughout.
 *
 *   DatasetWidget
 *     → useDatasetDimensionMeta        packages/react/src/hooks/useDatasetDimensionLabels.ts
 *       → `const doFetch = apiFetch ?? fetch`  ← the escape
 *         → loadDimensionFieldMeta     packages/core/src/utils/chart-series.ts
 *           GET /api/v1/meta/object/<object>
 *
 * With no `SchemaRendererProvider` in the tree the hook has no host `apiFetch`
 * and degrades to the GLOBAL `fetch` on purpose (objectui#4121 — a standalone
 * embed must keep rendering, not crash). Under happy-dom that global `fetch`
 * is a real HTTP client, and vitest's happy-dom environment defaults the
 * document URL to `http://localhost:3000`, so the relative `/api/v1/...`
 * resolved to a live request to whatever happens to own port 3000 in a shared
 * container.
 *
 * Why the existing `dataSource` double never intercepted it: this read is a
 * SECOND data channel. `dataSource.queryDataset` serves the widget's ROWS; the
 * dimension-label metadata never goes through it at all. The read is
 * best-effort (`catch {}` leaves rows exactly as the server sent them), which
 * is why the suite stayed green while the request always failed.
 *
 * Answered here from a RECORDING double, the same shape objectui#5225's
 * reference fix (PR #5283, `DatasetReportRenderer.test.tsx`) settled on. It is
 * deliberately NOT a blanket network stub: it records every URL it is handed,
 * `afterEach` fails on any URL that is not the metadata route, and the probe's
 * shape — previously asserted by nobody in this file — is pinned below.
 *
 * The default document declares no option-bearing fields, so
 * `deriveDimensionLabelMaps` resolves nothing and `relabelDimensions` returns
 * the rows by identity: byte-identical to what the failing request produced.
 * No pre-existing assertion changes meaning.
 * ──────────────────────────────────────────────────────────────────────────── */

const META_OBJECT_ROUTE = /^\/api\/v1\/meta\/object\/(.+)$/;

type MetaFieldDoc = { type?: string; options?: Array<{ value: string; label?: string }> };
type MetaObjectDoc = { name: string; fields?: Record<string, MetaFieldDoc> };

let metaCalls: Array<{ url: string; init?: { headers?: Record<string, string>; credentials?: string } }> = [];
let metaDocs: Record<string, MetaObjectDoc> = {};

/** Serve `/api/v1/meta/object/<name>` from `metaDocs`; record everything. */
function installMetaObjectDouble() {
  metaCalls = [];
  metaDocs = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      metaCalls.push({ url, init: init as { headers?: Record<string, string>; credentials?: string } });
      const m = META_OBJECT_ROUTE.exec(url);
      if (!m) return { ok: false, status: 404, json: async () => ({}) };
      const name = decodeURIComponent(m[1]);
      const doc = metaDocs[name] ?? { name, fields: {} };
      return { ok: true, status: 200, json: async () => ({ item: doc }) };
    }),
  );
}

/** The object names this render probed, in request order. */
const probedObjects = () =>
  metaCalls.map((c) => META_OBJECT_ROUTE.exec(c.url)?.[1]).filter((n): n is string => Boolean(n)).map(decodeURIComponent);

beforeEach(() => {
  installMetaObjectDouble();
});

afterEach(() => {
  // The double is a router, not a sink: an escape to any OTHER endpoint fails
  // here instead of vanishing into the hook's best-effort `catch`.
  expect(metaCalls.filter((c) => !META_OBJECT_ROUTE.test(c.url)).map((c) => c.url)).toEqual([]);
  // Unmount BEFORE restoring the real `fetch`. Vitest runs `afterEach` hooks in
  // reverse registration order, so the light DOM setup's RTL cleanup (its own
  // `afterEach`, registered before this file loads) runs AFTER this one:
  // unstubbing first would leave the tree mounted with the real global back in
  // place, and a metadata effect that settles in that window escapes again
  // (objectui#5225 measured this at 1 leaked attempt in 6 runs).
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Resolve a cross-tab cell the way the renderer does: find the row/column
 * bucket by its DISPLAY labels, then look the pair up with the module's own key
 * builder. Tests state which (row, column) combination must resolve to which
 * flat row index — never how the key is spelled — so the encoding stays free to
 * change while the guarantee (distinct combinations never share a cell) does
 * not. Spelling keys literally (`cellIndex.get('Open High')`) is what let a key
 * that merged two rows on a space read as correct for so long (objectstack#5473).
 */
const cellAt = (
  p: ReturnType<typeof buildPivot>,
  rowLabels: string[],
  colLabel: string,
): number | undefined => {
  const rh = p.rowHeaders.find(
    (r) => r.labels.length === rowLabels.length && r.labels.every((l, i) => l === rowLabels[i]),
  );
  const ch = p.colHeaders.find((c) => c.label === colLabel);
  return rh && ch ? p.cellIndex.get(pivotCellKey(rh.id, ch.id)) : undefined;
};

const makeSource = (impl: (d: string, s: any) => Promise<{ rows: any[] }>) => ({ queryDataset: vi.fn(impl) });

describe('DatasetWidget', () => {
  it('renders a KPI value for a metric widget', async () => {
    const src = makeSource(async () => ({ rows: [{ revenue: 510000 }] }));
    render(<DatasetWidget widget={{ type: 'metric', dataset: 'sales', values: ['revenue'] }} dataSource={src} />);
    expect(await screen.findByText('510000')).toBeInTheDocument();
    expect(src.queryDataset).toHaveBeenCalledWith('sales', { dimensions: [], measures: ['revenue'] });
  });

  it('renders the measure label + formatted value from the result fields', async () => {
    const src = { queryDataset: vi.fn(async () => ({
      rows: [{ spent_sum: 616000 }],
      fields: [{ name: 'spent_sum', type: 'number', label: 'Total Spent', format: '$0,0' }],
    })) };
    render(<DatasetWidget widget={{ type: 'metric', dataset: 'sales', values: ['spent_sum'] }} dataSource={src} />);
    expect(await screen.findByText('$616,000')).toBeInTheDocument();
    expect(screen.getByText('Total Spent')).toBeInTheDocument();
  });

  it('scales a fraction-stored percent measure to display magnitude (avg 0.608 → "60.8%", not "0.6%")', async () => {
    // Reproduces the AI-built sales CRM bug: win_probability is a `percent`
    // field stored as a FRACTION (0.75 ⇒ 75%); its avg over the seeded rows is
    // 0.6083. The list view already shows each row as "75%", so the metric card
    // must show "60.8%" — not the "0.6%" produced when the '0.0%' format was
    // applied without numeral's ×100. The measure renders identically on both
    // surfaces via the shared percentDisplayValue scaling.
    const src = { queryDataset: vi.fn(async () => ({
      rows: [{ avg_win_probability: 0.6083333333333333 }],
      fields: [{ name: 'avg_win_probability', type: 'number', label: 'Average 赢单概率', format: '0.0%' }],
    })) };
    render(<DatasetWidget widget={{ type: 'metric', dataset: 'opportunity_ds', values: ['avg_win_probability'] }} dataSource={src} />);
    expect(await screen.findByText('60.8%')).toBeInTheDocument();
    expect(screen.queryByText('0.6%')).not.toBeInTheDocument();
  });

  it('renders a declared-fraction ratio of exactly 1 as "100.0%" on BOTH the metric card and the table (#3136)', async () => {
    // A ratio of exactly 1 is the one value the magnitude heuristic cannot
    // resolve — 1 is both "100%" (a full-compliance ratio) and "1%" (a single
    // percentage point) — and it resolved it as "1.0%": "everything met the
    // SLA" reported to management as "1% met the SLA". The server now declares
    // the column's scale, and both dataset-bound surfaces honour it.
    const fields = [
      { name: 'status', type: 'string', label: 'Status' },
      { name: 'sla_rate', type: 'number', label: 'SLA rate', format: '0.0%', percentScale: 'fraction' as const },
    ];
    const metricSrc = { queryDataset: vi.fn(async () => ({ rows: [{ sla_rate: 1 }], fields })) };
    render(<DatasetWidget widget={{ type: 'metric', dataset: 'sla_ds', values: ['sla_rate'] }} dataSource={metricSrc} />);
    expect(await screen.findByText('100.0%')).toBeInTheDocument();
    expect(screen.queryByText('1.0%')).not.toBeInTheDocument();

    // Same column in the grouped table: the "met" bucket is 100%, and a
    // measured ZERO stays "0.0%" — a real 0% is not missing data.
    const tableSrc = { queryDataset: vi.fn(async () => ({
      rows: [{ status: 'met', sla_rate: 1 }, { status: 'breached', sla_rate: 0 }],
      fields,
    })) };
    render(<DatasetWidget widget={{ type: 'table', dataset: 'sla_ds', dimensions: ['status'], values: ['sla_rate'] }} dataSource={tableSrc} />);
    await waitFor(() => expect(screen.getAllByText('100.0%').length).toBe(2));
    expect(screen.getByText('0.0%')).toBeInTheDocument();
  });

  it('runs the dataset query for a dimensioned (chart) widget — rows→dimensions, values→measures', async () => {
    const src = makeSource(async () => ({ rows: [{ stage: 'won', revenue: 100 }, { stage: 'lost', revenue: 20 }] }));
    render(<DatasetWidget widget={{ type: 'bar', dataset: 'sales', dimensions: ['stage'], values: ['revenue'] }} dataSource={src} />);
    await waitFor(() => expect(src.queryDataset).toHaveBeenCalledWith('sales', { dimensions: ['stage'], measures: ['revenue'] }));
  });

  // Replaces (does not amend) the assertion that pinned "structured forwarded,
  // strings dropped". `compareTo` converged on the executor's own
  // `{ kind, dimension? }` (objectstack#5011), so there is no second widget form
  // left for this widget to discard — the whole value forwards, and the string
  // spelling is now invalid METADATA, rejected where it is authored rather than
  // laundered here.
  it('forwards compareTo unchanged — the executor’s own { kind, dimension? } contract', async () => {
    const withDimension = { kind: 'previousPeriod', dimension: 'close_date' };
    const src1 = makeSource(async () => ({ rows: [{ revenue: 1 }] }));
    render(<DatasetWidget widget={{ type: 'metric', dataset: 'sales', values: ['revenue'], compareTo: withDimension }} dataSource={src1} />);
    await waitFor(() => expect(src1.queryDataset).toHaveBeenCalledWith('sales', { dimensions: [], measures: ['revenue'], compareTo: withDimension }));

    // `dimension` omitted — the executor resolves it (or fails loudly naming the
    // candidates). The widget must NOT fill one in on its way past.
    const bare = { kind: 'previousYear' };
    const src2 = makeSource(async () => ({ rows: [{ revenue: 1 }] }));
    render(<DatasetWidget widget={{ type: 'metric', dataset: 'sales', values: ['revenue'], compareTo: bare }} dataSource={src2} />);
    await waitFor(() => expect(src2.queryDataset).toHaveBeenCalledWith('sales', { dimensions: [], measures: ['revenue'], compareTo: bare }));
    expect(src2.queryDataset.mock.calls[0][1].compareTo).not.toHaveProperty('dimension');
  });

  it('forwards the widget filter as runtimeFilter — a dataset-bound widget stays filtered (ADR-0021)', async () => {
    const src = makeSource(async () => ({ rows: [{ revenue: 8179769 }] }));
    const filter = { stage: { $nin: ['closed_won', 'closed_lost'] } };
    render(<DatasetWidget widget={{ type: 'metric', dataset: 'sales', values: ['revenue'], filter }} dataSource={src} />);
    await waitFor(() => expect(src.queryDataset).toHaveBeenCalledWith('sales', {
      dimensions: [], measures: ['revenue'], runtimeFilter: filter,
    }));
  });

  it('resolves date macros in the widget filter before sending runtimeFilter', async () => {
    const src = makeSource(async () => ({ rows: [{ revenue: 1 }] }));
    render(<DatasetWidget widget={{ type: 'metric', dataset: 'sales', values: ['revenue'], filter: { close_date: { $gte: '{current_quarter_start}' } } }} dataSource={src} />);
    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    const selection = src.queryDataset.mock.calls[0][1] as any;
    // Macro is resolved to a concrete value, not passed through verbatim.
    expect(selection.runtimeFilter.close_date.$gte).not.toBe('{current_quarter_start}');
  });

  it('surfaces a dataset error instead of wrong numbers', async () => {
    const src = makeSource(async () => { throw new Error('relationship "account" not declared'); });
    render(<DatasetWidget widget={{ type: 'metric', dataset: 'sales', values: ['revenue'] }} dataSource={src} />);
    expect(await screen.findByText(/not declared/)).toBeInTheDocument();
  });

  it('errors when the data source cannot run dataset queries', async () => {
    render(<DatasetWidget widget={{ type: 'metric', dataset: 'sales', values: ['revenue'] }} dataSource={{}} />);
    await waitFor(() => expect(screen.getByText(/does not support dataset queries/)).toBeInTheDocument());
  });

  it('prompts when no measures are selected (no query run)', () => {
    const src = makeSource(async () => ({ rows: [] }));
    render(<DatasetWidget widget={{ type: 'bar', dataset: 'sales', dimensions: ['stage'], values: [] }} dataSource={src} />);
    expect(screen.getByText(/Pick measures/)).toBeInTheDocument();
    expect(src.queryDataset).not.toHaveBeenCalled();
  });

  // ── loading skeleton (three distinct states: loading ≠ empty ≠ data) ──────
  // A query that never settles keeps the widget in its pending state so we can
  // assert what the FIRST paint shows. The bug this guards: pending used to read
  // as empty/0 (a 0-value axis / blank table) instead of "loading".
  const pendingSource = () => ({ queryDataset: vi.fn(() => new Promise<{ rows: any[] }>(() => {})) });

  it('shows a chart skeleton (not the empty state, not a 0-axis) while a chart query is pending', () => {
    const src = pendingSource();
    const { container } = render(<DatasetWidget widget={{ type: 'bar', dataset: 'sales', dimensions: ['stage'], values: ['revenue'] }} dataSource={src} />);
    expect(screen.getByTestId('dataset-loading')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="chart-skeleton"]')).toBeInTheDocument();
    // The empty state must NOT show while loading — that was the bug.
    // Selected by test id, not by the copy: objectui#7063 replaced the bare
    // 'No rows' string, and a `queryByText` for a string that no longer exists
    // anywhere passes for the wrong reason.
    expect(screen.queryByTestId('widget-empty-state')).not.toBeInTheDocument();
  });

  it('shows a row (grid) skeleton while a table query is pending', () => {
    const src = pendingSource();
    const { container } = render(<DatasetWidget widget={{ type: 'table', dataset: 'tasks', dimensions: ['status'], values: ['task_count'] }} dataSource={src} />);
    expect(screen.getByTestId('dataset-loading')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="grid-skeleton"]')).toBeInTheDocument();
  });

  it('shows a skeleton (not a premature 0) while a metric query is pending', () => {
    const src = pendingSource();
    render(<DatasetWidget widget={{ type: 'metric', dataset: 'sales', values: ['revenue'] }} dataSource={src} />);
    expect(screen.getByTestId('dataset-loading')).toBeInTheDocument();
    // The loading state must not pre-render the empty-metric "0".
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('clears the loading skeleton once the chart query resolves with rows', async () => {
    const src = makeSource(async () => ({ rows: [{ stage: 'won', revenue: 100 }, { stage: 'lost', revenue: 20 }] }));
    render(<DatasetWidget widget={{ type: 'bar', dataset: 'sales', dimensions: ['stage'], values: ['revenue'] }} dataSource={src} />);
    // Skeleton first…
    expect(screen.getByTestId('dataset-loading')).toBeInTheDocument();
    // …then it clears once data arrives (status → ok, rows present).
    await waitFor(() => expect(screen.queryByTestId('dataset-loading')).not.toBeInTheDocument());
    expect(screen.queryByTestId('widget-empty-state')).not.toBeInTheDocument();
  });

  it('shows 0 (not an empty state) for a metric over an empty dataset', async () => {
    const src = makeSource(async () => ({ rows: [] }));
    render(<DatasetWidget widget={{ type: 'metric', dataset: 'books', values: ['count'] }} dataSource={src} />);
    expect(await screen.findByText('0')).toBeInTheDocument();
    expect(screen.queryByTestId('widget-empty-state')).not.toBeInTheDocument();
  });

  it('formats the empty-metric zero (e.g. $0) using the measure format', async () => {
    const src = { queryDataset: vi.fn(async () => ({
      rows: [],
      fields: [{ name: 'revenue', type: 'number', label: 'Revenue', format: '$0,0' }],
    })) };
    render(<DatasetWidget widget={{ type: 'metric', dataset: 'sales', values: ['revenue'] }} dataSource={src} />);
    expect(await screen.findByText('$0')).toBeInTheDocument();
  });

  // ── objectui#7063: the DEFAULT empty state is self-explaining ────────────
  // Maintainer ruling 2026-08-31 (hotcrm#1212): a legitimately young widget
  // must not read as a load failure, and it must say what is empty without any
  // authored copy. The measured shape was a bare `暂无数据行` / 'No rows'
  // fragment mid-dashboard beside eleven populated tiles.
  //
  // These pin the three properties the ruling fixes, NOT the exact sentence
  // (copy is review's to move): the state announces itself as a STATUS rather
  // than an alert, it carries an explanation as well as a title, and it names
  // the widget's data source.
  it('renders a self-explaining empty state for a dimensioned chart over an empty dataset', async () => {
    const src = makeSource(async () => ({ rows: [] }));
    render(<DatasetWidget widget={{ type: 'bar', dataset: 'crm_forecast', dimensions: ['stage'], values: ['revenue'] }} dataSource={src} />);
    const panel = await screen.findByTestId('widget-empty-state');
    // (1) a state, not a failure. The error branch of this same component is
    // `role="alert"`; before this card the empty branch carried NO role at all,
    // so assistive tech could not tell the two apart either.
    expect(panel).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // (2) title AND explanation — the placeholder was a single fragment.
    expect(panel.textContent).toContain('No data yet');
    expect(panel.textContent).toContain('loaded successfully');
    // (3) it names WHAT is empty, with zero authored copy on the widget.
    expect(screen.getByTestId('widget-empty-source').textContent).toContain('crm_forecast');
  });

  it('the empty state degrades to un-sourced copy rather than printing a blank source', async () => {
    // `dataset` is what every path into this component carries, so this is the
    // defensive half: a blank binding must drop the source LINE, not render
    // "Source:" with nothing after it.
    const src = makeSource(async () => ({ rows: [] }));
    render(<DatasetWidget widget={{ type: 'bar', dataset: '', dimensions: ['stage'], values: ['revenue'] }} dataSource={src} />);
    const panel = await screen.findByTestId('widget-empty-state');
    expect(panel.textContent).toContain('No data yet');
    expect(screen.queryByTestId('widget-empty-source')).not.toBeInTheDocument();
  });

  it('a load FAILURE still reads as a failure, not as an empty state', async () => {
    // The other half of property (1), measured on the same component: the card
    // is only satisfied if empty and failed remain distinguishable, so a fix
    // that softened the error path would defeat it.
    const src = { queryDataset: vi.fn(async () => { throw new Error('dataset service unreachable'); }) };
    render(<DatasetWidget widget={{ type: 'bar', dataset: 'crm_forecast', dimensions: ['stage'], values: ['revenue'] }} dataSource={src} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('dataset service unreachable');
    expect(screen.queryByTestId('widget-empty-state')).not.toBeInTheDocument();
  });

  // ── #2 header labels ────────────────────────────────────────────────────
  it('renders the dataset display label for a dimension header, not the raw field name', async () => {
    const src = { queryDataset: vi.fn(async () => ({
      rows: [{ status: 'Open', task_count: 5 }],
      fields: [
        { name: 'status', type: 'string', label: 'Status' },
        { name: 'task_count', type: 'number', label: 'Tasks' },
      ],
    })) };
    render(<DatasetWidget widget={{ type: 'table', dataset: 'tasks', dimensions: ['status'], values: ['task_count'] }} dataSource={src} />);
    expect(await screen.findByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    // The raw field name must not leak into a header (cell value is "Open").
    expect(screen.queryByText('status')).not.toBeInTheDocument();
  });

  // ── #3 currency ─────────────────────────────────────────────────────────
  it('formats an amount with NO declared currency as a plain number (no $)', async () => {
    const src = { queryDataset: vi.fn(async () => ({
      rows: [{ budget_sum: 616000 }],
      fields: [{ name: 'budget_sum', type: 'number', label: 'Total Budget', format: '0,0' }],
    })) };
    render(<DatasetWidget widget={{ type: 'metric', dataset: 'proj', values: ['budget_sum'] }} dataSource={src} />);
    expect(await screen.findByText('616,000')).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('uses the declared currency (Intl symbol) when the field carries a currency', async () => {
    const src = { queryDataset: vi.fn(async () => ({
      rows: [{ budget_sum: 616000 }],
      fields: [{ name: 'budget_sum', type: 'number', label: 'Total Budget', format: '0,0', currency: 'CNY' }],
    })) };
    render(<DatasetWidget widget={{ type: 'metric', dataset: 'proj', values: ['budget_sum'] }} dataSource={src} />);
    // CNY → "¥"/"CN¥"/"CNY" depending on ICU; never "$".
    const el = await screen.findByText(/(¥|CNY)\s?616,000/);
    expect(el).toBeInTheDocument();
    expect(el.textContent).not.toContain('$');
  });

  // ── #1 drill-through ────────────────────────────────────────────────────
  it('is NOT drillable without server object + dimensionFields metadata', async () => {
    const src = { queryDataset: vi.fn(async () => ({
      rows: [{ status: 'Open', task_count: 5 }],
      fields: [{ name: 'status', type: 'string', label: 'Status' }, { name: 'task_count', type: 'number', label: 'Tasks' }],
    })) };
    render(<DatasetWidget widget={{ type: 'pivot', dataset: 'tasks', dimensions: ['status'], values: ['task_count'] }} dataSource={src} />);
    await screen.findByText('Status');
    expect(screen.queryByTestId('dataset-drill-row')).not.toBeInTheDocument();
  });

  it('marks rows drillable once the server returns object + dimensionFields', async () => {
    const src = { queryDataset: vi.fn(async () => ({
      rows: [{ status: 'Open', task_count: 5 }],
      fields: [{ name: 'status', type: 'string', label: 'Status' }, { name: 'task_count', type: 'number', label: 'Tasks' }],
      object: 'showcase_task',
      dimensionFields: { status: 'status' },
      drillRawRows: [{ status: 'open' }],
    })) };
    render(<DatasetWidget widget={{ type: 'pivot', dataset: 'tasks', dimensions: ['status'], values: ['task_count'] }} dataSource={src} />);
    expect(await screen.findByTestId('dataset-drill-row')).toBeInTheDocument();
  });

  it('#1752 marks a date-ONLY pivot drillable via the server range sidecar (no equality dim)', async () => {
    const src = { queryDataset: vi.fn(async () => ({
      rows: [{ close_date: '2026-Q2', task_count: 5 }],
      fields: [{ name: 'close_date', type: 'date', label: 'Close Date' }, { name: 'task_count', type: 'number', label: 'Tasks' }],
      object: 'showcase_task',
      // No dimensionFields — a date bucket isn't equality-drillable; only a range sidecar.
      drillRanges: [{ close_date: { field: 'close_date', gte: '2026-04-01', lt: '2026-07-01' } }],
    })) };
    render(<DatasetWidget widget={{ type: 'pivot', dataset: 'tasks', dimensions: ['close_date'], values: ['task_count'] }} dataSource={src} />);
    expect(await screen.findByTestId('dataset-drill-row')).toBeInTheDocument();
  });

  it('buildDrillFilter filters by the RAW stored value, not the display label', () => {
    // The raw-values row carries the stored value "open"; the display label
    // "Open" never reaches the filter.
    expect(buildDrillFilter({ status: 'open' }, ['status'], { status: 'status' })).toEqual({ status: 'open' });
  });

  it('buildDrillFilter maps a dimension to its underlying object field', () => {
    expect(buildDrillFilter({ account: 'acc_123' }, ['account'], { account: 'account_id' })).toEqual({ account_id: 'acc_123' });
  });

  // objectui#9137 — this test's NAME became true here. The widget filter used
  // to be SPREAD into the drill filter, which is an AND only for the object
  // arm; `DashboardWidgetSchema.filter` declares the ARRAY arm, and spreading
  // an array yields index keys. It is now conjoined through
  // `composeDrillFilter`, the repo's single filter confluence, so the result is
  // a real `$and` of the two sources rather than one object overwriting the
  // other. The nested `$and` is the drill filter's own two conditions.
  it('buildDrillFilter ANDs the widget runtime filter in', () => {
    expect(
      buildDrillFilter({ status: 'open', priority: 'high' }, ['status', 'priority'], { status: 'status', priority: 'priority' }, { archived: false }),
    ).toEqual({ $and: [{ archived: false }, { $and: [{ status: 'open' }, { priority: 'high' }] }] });
  });

  // objectui#9137 — the arm the declaration names. `widget.filter` reaches
  // `buildDrillFilter` as an ObjectQL FilterNode ARRAY (the `DatasetWidget`
  // guard admits it: `typeof [] === 'object'` and `Object.keys(['x']).length`
  // is 1), and spreading it produced the index key `{ '0': [...] }` — which no
  // sink treats as a condition: `convertFiltersToAST` THROWS on a bare-array
  // comparand, so the drill was DEAD, not merely unscoped.
  it('buildDrillFilter conjoins the ARRAY arm of the widget filter instead of spreading it to index keys', () => {
    const composed = buildDrillFilter({ status: 'open' }, ['status'], { status: 'status' }, [['region', '=', 'emea']]);
    expect(composed).toEqual({ $and: [{ region: 'emea' }, { status: 'open' }] });
    // The defect's exact signature, pinned as ABSENT: an index key from a
    // spread array. `'0' in composed` is what failed before this card.
    expect(Object.keys(composed)).not.toContain('0');
  });

  // objectui#9085: an empty bucket used to normalize to a bare `null`, which
  // `convertFiltersToAST` SKIPS — so the constraint never reached the wire and
  // the drill answered with every row. The is-empty spelling the converter
  // carries end to end is `{ $null: true }` -> `[field, 'is_null', true]`. The
  // row-set consequence is pinned in `@object-ui/core`'s
  // `dataset-drill-empty-bucket-9085.test.ts`; this is the producer's own shape.
  it('buildDrillFilter normalizes a missing/empty raw value to an is-empty predicate', () => {
    expect(buildDrillFilter({ status: '' }, ['status'], { status: 'status' })).toEqual({ status: { $null: true } });
    expect(buildDrillFilter(undefined, ['status'], { status: 'status' })).toEqual({ status: { $null: true } });
    // `null` is in the same class: JSON cannot carry `undefined`, so a SQL NULL
    // grouped value arrives over the wire AS `null`.
    expect(buildDrillFilter({ status: null }, ['status'], { status: 'status' })).toEqual({ status: { $null: true } });
  });

  // ── #1752 date-bucket RANGE drill ────────────────────────────────────────
  it('buildDrillFilter emits a half-open range for a date bucket (not equality)', () => {
    expect(
      buildDrillFilter(undefined, [], {}, undefined, {
        close_date: { field: 'close_date', gte: '2026-04-01', lt: '2026-07-01' },
      }),
    ).toEqual({ close_date: { $gte: '2026-04-01', $lt: '2026-07-01' } });
  });

  it('buildDrillFilter ANDs an equality dim, a date range, and the runtime filter together', () => {
    expect(
      buildDrillFilter(
        { stage: 'qualification' },
        ['stage'],
        { stage: 'stage' },
        { archived: false },
        { close_date: { field: 'close_date', gte: '2026-06-01', lt: '2026-07-01' } },
      ),
    // objectui#9137 — conjoined, not spread. The half-open range SURVIVES the
    // composition: `convertFiltersToAST` emits one node per bound, so the pair
    // arrives as two `$and` children on the same field rather than one key with
    // two operators. Same rows, and `serializeDrillFilterParams` still writes
    // both `filter[close_date][gte]` and `[lt]`.
    ).toEqual({
      $and: [
        { archived: false },
        {
          $and: [
            { stage: 'qualification' },
            { close_date: { $gte: '2026-06-01' } },
            { close_date: { $lt: '2026-07-01' } },
          ],
        },
      ],
    });
  });

  // ── pivot cross-tab ──────────────────────────────────────────────────────
  it('buildPivot turns flat rows into a cross-tab keyed to flat row indices', () => {
    const rows = [
      { status: 'Open', priority: 'High', task_count: 2 },
      { status: 'Open', priority: 'Low', task_count: 1 },
      { status: 'Done', priority: 'High', task_count: 3 },
    ];
    const p = buildPivot(rows, ['status'], 'priority');
    expect(p.rowHeaders.map((r) => r.labels[0])).toEqual(['Open', 'Done']);
    expect(p.colHeaders.map((c) => c.label)).toEqual(['High', 'Low']);
    expect(cellAt(p, ['Open'], 'High')).toBe(0);
    expect(cellAt(p, ['Open'], 'Low')).toBe(1);
    expect(cellAt(p, ['Done'], 'High')).toBe(2);
    expect(cellAt(p, ['Done'], 'Low')).toBeUndefined(); // sparse combo absent
  });

  // objectstack#5473 — the cell key joined the row id and the column id with a
  // PLAIN SPACE, and dimension values contain spaces constantly ("New York",
  // "In Progress"). Two rows whose ids met at a different point of the same
  // string produced one key, the later row overwrote the earlier one, and the
  // cell showed a different row's number with no error anywhere.
  it('buildPivot keeps two rows apart whose ids meet at a different point of the same string', () => {
    const rows = [
      { region: 'New', quarter: 'York Q1', amount: 111 },
      { region: 'New York', quarter: 'Q1', amount: 222 },
    ];
    const p = buildPivot(rows, ['region'], 'quarter');
    // Two rows in, two cells out — one key for both is the defect.
    expect(p.cellIndex.size).toBe(2);
    expect(cellAt(p, ['New'], 'York Q1')).toBe(0);
    expect(cellAt(p, ['New York'], 'Q1')).toBe(1);
    // The combinations no row covers stay absent — a merged key made one of
    // them borrow the other row's index instead.
    expect(cellAt(p, ['New'], 'Q1')).toBeUndefined();
    expect(cellAt(p, ['New York'], 'York Q1')).toBeUndefined();
  });

  it('buildPivot keeps multi-dimension rows apart when the dimension values contain spaces', () => {
    // The same collision one dimension deeper, and the shape a single-row-
    // dimension fixture cannot reach: under the old space join, "New York" ·
    // "SMB Retail" × "Q1" and "New York" · "SMB" × "Retail Q1" spelled one key.
    const rows = [
      { region: 'New York', segment: 'SMB Retail', quarter: 'Q1', amount: 10 },
      { region: 'New York', segment: 'SMB', quarter: 'Retail Q1', amount: 20 },
    ];
    const p = buildPivot(rows, ['region', 'segment'], 'quarter');
    expect(p.cellIndex.size).toBe(2);
    expect(cellAt(p, ['New York', 'SMB Retail'], 'Q1')).toBe(0);
    expect(cellAt(p, ['New York', 'SMB'], 'Retail Q1')).toBe(1);
  });

  // objectstack#5450 added this case: before it, every pivot fixture had ONE row
  // dimension, so the boundary that joins several of them was never exercised —
  // it could have been anything, including the empty string, and the suite
  // stayed green. That version pinned the ids' literal shape (a control
  // character built from a number via fromCharCode); objectstack#5473 replaced
  // that encoding, so what is pinned here now is what the boundary is FOR. No
  // control character is referenced by this file any more — not as a literal,
  // not as an escape, not via fromCharCode.
  it('buildPivot keeps two row dimensions apart that would merge without a boundary', () => {
    const rows = [
      // "x" + "yz" and "xy" + "z" concatenate to the same string, so an absent
      // boundary collapses these into ONE row header and the second row's cell
      // overwrites the first.
      { region: 'x', segment: 'yz', priority: 'High', total: 1 },
      { region: 'xy', segment: 'z', priority: 'High', total: 2 },
    ];
    const p = buildPivot(rows, ['region', 'segment'], 'priority');

    expect(p.rowHeaders).toHaveLength(2);
    expect(p.rowHeaders.map((r) => r.labels)).toEqual([
      ['x', 'yz'],
      ['xy', 'z'],
    ]);

    expect(p.rowHeaders[0].id).not.toBe(p.rowHeaders[1].id);
    expect(cellAt(p, ['x', 'yz'], 'High')).toBe(0);
    expect(cellAt(p, ['xy', 'z'], 'High')).toBe(1);
  });

  // objectui#4056 — the LAST encoding in this family that still relied on "the
  // data will not contain this character". Every id above is JSON-encoded, but
  // the values fed into it were `String(row[d] ?? '∅')`: an absent value became
  // the STRING "∅", so a row whose dimension value literally IS that character
  // encoded to the same bucket as a row whose value is null. Same shape as
  // objectstack#5473 — one bucket, the later row overwriting the earlier one —
  // reached through the placeholder rather than through the join. An empty value
  // is now JSON `null`, which no string can collide with.
  it('buildPivot keeps a null row-dimension value apart from the literal placeholder character', () => {
    const rows = [
      { region: null, quarter: 'Q1', amount: 111 },
      { region: '∅', quarter: 'Q1', amount: 222 },
    ];
    const p = buildPivot(rows, ['region'], 'quarter');
    // Two rows in, two buckets out — one bucket for both is the defect.
    expect(p.rowHeaders).toHaveLength(2);
    expect(p.rowHeaders[0].id).not.toBe(p.rowHeaders[1].id);
    expect(p.cellIndex.size).toBe(2);
    // Resolved by DISPLAY label, never by id spelling: null renders as the
    // em-dash placeholder, the literal character renders as itself.
    expect(cellAt(p, ['—'], 'Q1')).toBe(0);
    expect(cellAt(p, ['∅'], 'Q1')).toBe(1);
  });

  it('buildPivot keeps a null COLUMN-dimension value apart from the literal placeholder character', () => {
    // The across axis is the half the row-id fix could not reach: the column
    // bucket id was a bare string built by the same `?? '∅'` expression, so it
    // carried the collision independently of the JSON-encoded row id.
    const rows = [
      { status: 'Open', priority: null, task_count: 1 },
      { status: 'Open', priority: '∅', task_count: 2 },
    ];
    const p = buildPivot(rows, ['status'], 'priority');
    expect(p.colHeaders).toHaveLength(2);
    expect(p.colHeaders[0].id).not.toBe(p.colHeaders[1].id);
    expect(p.colHeaders.map((c) => c.label)).toEqual(['—', '∅']);
    expect(p.cellIndex.size).toBe(2);
    expect(cellAt(p, ['Open'], '—')).toBe(0);
    expect(cellAt(p, ['Open'], '∅')).toBe(1);
  });

  it('buildPivot regroups ordinary data exactly as before (no nulls, no placeholder character)', () => {
    // Regrouping stability: the encoding changed for BOTH axes, so the control
    // is that data containing neither a null nor the placeholder character
    // buckets identically — same header count, same first-seen order, same
    // labels, same cell→index mapping. The ids are opaque lookup keys (Map keys
    // and React keys only — never parsed back into a value, never displayed,
    // never persisted), so what has to hold is the structure, not the spelling.
    const rows = [
      { region: 'North', segment: 'SMB', quarter: 'Q1', amount: 1 },
      { region: 'North', segment: 'Enterprise', quarter: 'Q1', amount: 2 },
      { region: 'South', segment: 'SMB', quarter: 'Q2', amount: 3 },
    ];
    const p = buildPivot(rows, ['region', 'segment'], 'quarter');
    expect(p.rowHeaders.map((r) => r.labels)).toEqual([
      ['North', 'SMB'],
      ['North', 'Enterprise'],
      ['South', 'SMB'],
    ]);
    expect(p.colHeaders.map((c) => c.label)).toEqual(['Q1', 'Q2']);
    expect(p.cellIndex.size).toBe(3);
    expect(cellAt(p, ['North', 'SMB'], 'Q1')).toBe(0);
    expect(cellAt(p, ['North', 'Enterprise'], 'Q1')).toBe(1);
    expect(cellAt(p, ['South', 'SMB'], 'Q2')).toBe(2);
    expect(cellAt(p, ['North', 'SMB'], 'Q2')).toBeUndefined();
    // The row id for all-string values is still exactly the JSON tuple
    // objectstack#5473 introduced — the placeholder fix did not re-spell it.
    expect(p.rowHeaders[0].id).toBe(JSON.stringify(['North', 'SMB']));
  });

  it('renders a pivot (≥2 dims) as a true cross-tab, not a flat table', async () => {
    const src = { queryDataset: vi.fn(async () => ({
      rows: [
        { status: 'Open', priority: 'High', task_count: 2 },
        { status: 'Open', priority: 'Low', task_count: 1 },
        { status: 'Done', priority: 'High', task_count: 3 },
      ],
      fields: [
        { name: 'status', type: 'string', label: 'Status' },
        { name: 'priority', type: 'string', label: 'Priority' },
        { name: 'task_count', type: 'number', label: 'Tasks' },
      ],
    })) };
    render(<DatasetWidget widget={{ type: 'pivot', dataset: 'tasks', dimensions: ['status', 'priority'], values: ['task_count'] }} dataSource={src} />);
    const matrix = await screen.findByTestId('dataset-matrix');
    // Last dim (priority) spreads across as column headers…
    expect(within(matrix).getByText('High')).toBeInTheDocument();
    expect(within(matrix).getByText('Low')).toBeInTheDocument();
    // …first dim (status) is the row header (rendered once per row, not per combo).
    expect(within(matrix).getByText('Status')).toBeInTheDocument();
    expect(within(matrix).getByText('Done')).toBeInTheDocument();
    expect(within(matrix).getAllByText('Open')).toHaveLength(1);
  });

  it('falls back to a flat table for a single-dimension pivot', async () => {
    const src = { queryDataset: vi.fn(async () => ({
      rows: [{ status: 'Open', task_count: 5 }],
      fields: [{ name: 'status', type: 'string', label: 'Status' }, { name: 'task_count', type: 'number', label: 'Tasks' }],
    })) };
    render(<DatasetWidget widget={{ type: 'pivot', dataset: 'tasks', dimensions: ['status'], values: ['task_count'] }} dataSource={src} />);
    await screen.findByText('Status');
    expect(screen.queryByTestId('dataset-matrix')).not.toBeInTheDocument();
  });

  it('gives each colliding row its OWN cell and drills that cell to ITS record set (objectstack#5473)', async () => {
    // End-to-end shape of the defect: two rows whose region/quarter values meet
    // at a different point of the same string. The cell key merged them, so the
    // table showed 222 twice, 111 was unreachable anywhere, and the "New" cell
    // drilled into the OTHER row's records — all with no error.
    const src = {
      queryDataset: vi.fn(async () => ({
        rows: [
          { region: 'New', quarter: 'York Q1', amount: 111 },
          { region: 'New York', quarter: 'Q1', amount: 222 },
        ],
        fields: [
          { name: 'region', type: 'string', label: 'Region' },
          { name: 'quarter', type: 'string', label: 'Quarter' },
          { name: 'amount', type: 'number', label: 'Amount' },
        ],
        object: 'showcase_deal',
        dimensionFields: { region: 'region', quarter: 'quarter' },
        drillRawRows: [
          { region: 'new', quarter: 'york_q1' },
          { region: 'new_york', quarter: 'q1' },
        ],
      })),
      // Parameters DECLARED because the drill assertion below reads
      // `find.mock.calls[0][1]`: a bare `vi.fn(async () => …)` types `mock.calls`
      // as an array of EMPTY tuples, so that read is out of bounds and resolves
      // to `undefined` — invisibly, since it is cast (objectui#4040).
      find: vi.fn(async (_object: string, _params: unknown) => ({ data: [] })),
      getObjectSchema: vi.fn(async () => ({ fields: { region: { type: 'text', label: 'Region' } } })),
    };
    render(<DatasetWidget widget={{ type: 'pivot', dataset: 'deals', dimensions: ['region', 'quarter'], values: ['amount'] }} dataSource={src} />);
    const m = await screen.findByTestId('dataset-matrix');

    // Column order is first-seen: "York Q1", then "Q1".
    const rowNew = within(m).getByText('New').closest('tr') as HTMLElement;
    expect([...rowNew.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['New', '111', '—']);
    const rowNewYork = within(m).getByText('New York').closest('tr') as HTMLElement;
    expect([...rowNewYork.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['New York', '—', '222']);

    // Drill-through reads `drillRawRows` by the same index the cell resolved,
    // so a merged cell drilled into the wrong records too.
    fireEvent.click(within(rowNew).getByTestId('dataset-drill-cell'));
    await waitFor(() => expect(src.find).toHaveBeenCalled());
    expect((src.find.mock.calls[0][1] as any).$filter).toEqual({ region: 'new', quarter: 'york_q1' });
  });

  it('gives the null bucket its OWN cell and drills it to the null rows, not the placeholder rows (objectui#4056)', async () => {
    // End-to-end shape of the placeholder collision: an unset region and a
    // region whose value literally IS the placeholder character shared one
    // bucket, so the table showed 222 twice, 111 was unreachable, and the null
    // row's cell drilled into the OTHER row's records — the objectstack#5473
    // symptom class, reached through the null placeholder.
    const src = {
      queryDataset: vi.fn(async () => ({
        rows: [
          { region: null, quarter: 'Q1', amount: 111 },
          { region: '∅', quarter: 'Q1', amount: 222 },
        ],
        fields: [
          { name: 'region', type: 'string', label: 'Region' },
          { name: 'quarter', type: 'string', label: 'Quarter' },
          { name: 'amount', type: 'number', label: 'Amount' },
        ],
        object: 'showcase_deal',
        dimensionFields: { region: 'region', quarter: 'quarter' },
        // Deliberately distinguishable raw values: the drill filter names which
        // flat index the clicked cell resolved to.
        drillRawRows: [
          { region: 'was_null', quarter: 'q1' },
          { region: 'literal_emptyset', quarter: 'q1' },
        ],
      })),
      // Parameters DECLARED because the drill assertion below reads
      // `find.mock.calls[0][1]`: a bare `vi.fn(async () => …)` types `mock.calls`
      // as an array of EMPTY tuples, so that read is out of bounds and resolves
      // to `undefined` — invisibly, since it is cast (objectui#4040).
      find: vi.fn(async (_object: string, _params: unknown) => ({ data: [] })),
      getObjectSchema: vi.fn(async () => ({ fields: { region: { type: 'text', label: 'Region' } } })),
    };
    render(<DatasetWidget widget={{ type: 'pivot', dataset: 'deals', dimensions: ['region', 'quarter'], values: ['amount'] }} dataSource={src} />);
    const m = await screen.findByTestId('dataset-matrix');

    // Control (display layer untouched): the null dimension still renders as the
    // em dash `formatDimensionValue` has always produced, and the row whose
    // value IS the character renders as that character. The placeholders only
    // ever entered the ids.
    const rowNull = within(m).getByText('—').closest('tr') as HTMLElement;
    expect([...rowNull.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['—', '111']);
    const rowLiteral = within(m).getByText('∅').closest('tr') as HTMLElement;
    expect([...rowLiteral.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['∅', '222']);

    // Drill-through reads `drillRawRows` by the same index the cell resolved,
    // so a merged bucket drilled into the wrong records too.
    fireEvent.click(within(rowNull).getByTestId('dataset-drill-cell'));
    await waitFor(() => expect(src.find).toHaveBeenCalled());
    expect((src.find.mock.calls[0][1] as any).$filter).toEqual({ region: 'was_null', quarter: 'q1' });
  });

  it('makes matrix cells drillable when the server returns drill metadata', async () => {
    const src = { queryDataset: vi.fn(async () => ({
      rows: [{ status: 'Open', priority: 'High', task_count: 2 }],
      fields: [{ name: 'status', type: 'string', label: 'Status' }, { name: 'priority', type: 'string', label: 'Priority' }, { name: 'task_count', type: 'number', label: 'Tasks' }],
      object: 'showcase_task',
      dimensionFields: { status: 'status', priority: 'priority' },
      drillRawRows: [{ status: 'open', priority: 'high' }],
    })) };
    render(<DatasetWidget widget={{ type: 'pivot', dataset: 'tasks', dimensions: ['status', 'priority'], values: ['task_count'] }} dataSource={src} />);
    expect(await screen.findByTestId('dataset-drill-cell')).toBeInTheDocument();
  });

  // ── pivot totals ─────────────────────────────────────────────────────────
  it('requests subtotal groupings (rows, [col], grand) for a pivot matrix', async () => {
    const src = makeSource(async () => ({ rows: [{ status: 'Open', priority: 'High', task_count: 1 }] }));
    render(<DatasetWidget widget={{ type: 'pivot', dataset: 'tasks', dimensions: ['status', 'priority'], values: ['task_count'] }} dataSource={src} />);
    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    expect((src.queryDataset.mock.calls[0][1] as any).totals).toEqual({ groupings: [['status'], ['priority'], []] });
  });

  // objectui#5846 RULED the flat table's own totals row, which this case used
  // to pin the absence of: a flat table now asks for the GRAND TOTAL alone —
  // never the cross-tab's row/column subtotals, which have no meaning without a
  // second axis — and renders it as a `tfoot`. The rendering contract lives in
  // `DatasetWidget.tableTotalsRow.test.tsx`; what stays here is the shape of
  // the REQUEST beside the pivot case above.
  it('requests ONLY the grand-total grouping for a flat table', async () => {
    const src = makeSource(async () => ({ rows: [{ status: 'Open', task_count: 1 }] }));
    render(<DatasetWidget widget={{ type: 'table', dataset: 'tasks', dimensions: ['status'], values: ['task_count'] }} dataSource={src} />);
    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    expect((src.queryDataset.mock.calls[0][1] as any).totals).toEqual({ groupings: [[]] });
  });

  it('requests no totals at all for a flat table truncated by options.limit', async () => {
    // A total computed over the whole selection cannot be reconciled against a
    // top-N list, so the grouping is not requested — and the extra query is not
    // paid for either.
    const src = makeSource(async () => ({ rows: [{ status: 'Open', task_count: 1 }] }));
    render(<DatasetWidget widget={{ type: 'table', dataset: 'tasks', dimensions: ['status'], values: ['task_count'], options: { limit: 10 } }} dataSource={src} />);
    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    expect((src.queryDataset.mock.calls[0][1] as any).totals).toBeUndefined();
  });

  it('renders server-supplied row / column / grand totals in the cross-tab', async () => {
    const src = { queryDataset: vi.fn(async () => ({
      rows: [
        { status: 'Open', priority: 'High', task_count: 2 },
        { status: 'Open', priority: 'Low', task_count: 1 },
        { status: 'Done', priority: 'High', task_count: 3 },
      ],
      fields: [
        { name: 'status', type: 'string', label: 'Status' },
        { name: 'priority', type: 'string', label: 'Priority' },
        { name: 'task_count', type: 'number', label: 'Tasks' },
      ],
      totals: [
        { dimensions: ['status'], rows: [{ status: 'Open', task_count: 3 }, { status: 'Done', task_count: 3 }] },
        { dimensions: ['priority'], rows: [{ priority: 'High', task_count: 5 }, { priority: 'Low', task_count: 1 }] },
        { dimensions: [], rows: [{ task_count: 6 }] },
      ],
    })) };
    render(<DatasetWidget widget={{ type: 'pivot', dataset: 'tasks', dimensions: ['status', 'priority'], values: ['task_count'] }} dataSource={src} />);
    const m = await screen.findByTestId('dataset-matrix');
    expect(within(m).getByTestId('matrix-total-col-header')).toBeInTheDocument();
    expect(within(m).getByTestId('matrix-total-row')).toBeInTheDocument();
    // Per-row totals (Open=3, Done=3) — server's true aggregate, not re-derived.
    expect(within(m).getAllByTestId('matrix-row-total').map((e) => e.textContent)).toEqual(['3', '3']);
    // Grand total.
    expect(within(m).getByTestId('matrix-grand-total').textContent).toBe('6');
  });

  it('matches column subtotals to the null bucket and the placeholder bucket separately (objectui#4056)', async () => {
    // The card's radius warning, pinned: the column bucket id and the
    // `colTotalById` key are built by the same expression, so they must change
    // together. If either kept the placeholder spelling, the two null-ish
    // columns would merge — or worse, the headers would split while the
    // subtotal map still merged, and every column subtotal would land under the
    // wrong header (the "one id, two encodings" shape objectui#3414 converged
    // away).
    const src = { queryDataset: vi.fn(async () => ({
      rows: [
        { status: 'Open', priority: null, task_count: 1 },
        { status: 'Open', priority: '∅', task_count: 2 },
      ],
      fields: [
        { name: 'status', type: 'string', label: 'Status' },
        { name: 'priority', type: 'string', label: 'Priority' },
        { name: 'task_count', type: 'number', label: 'Tasks' },
      ],
      totals: [
        { dimensions: ['status'], rows: [{ status: 'Open', task_count: 3 }] },
        { dimensions: ['priority'], rows: [{ priority: null, task_count: 10 }, { priority: '∅', task_count: 20 }] },
        { dimensions: [], rows: [{ task_count: 30 }] },
      ],
    })) };
    render(<DatasetWidget widget={{ type: 'pivot', dataset: 'tasks', dimensions: ['status', 'priority'], values: ['task_count'] }} dataSource={src} />);
    const m = await screen.findByTestId('dataset-matrix');
    // Two column headers, in first-seen order, labelled by the display layer.
    const headers = [...m.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toEqual(['Status', '—', '∅', 'Total']);
    // Each column subtotal under ITS OWN header, then the grand total.
    const totalRow = within(m).getByTestId('matrix-total-row');
    expect([...totalRow.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['Total', '10', '20', '30']);
  });

  it('matches server row subtotals to a MULTI-dimension row bucket', async () => {
    // The row-total lookup keys the same row bucket ids as the row headers, so
    // it has to build them with the same encoder. It used to roll its own join,
    // which agreed with the headers only while a pivot had exactly ONE row
    // dimension — the shape every fixture in this file had. With two row
    // dimensions (a 3-dimension pivot) every lookup missed and the Total column
    // rendered blank. Unifying the encoder (objectstack#5473) is what makes
    // this pass; the assertion is on the totals, not on the id spelling.
    const src = { queryDataset: vi.fn(async () => ({
      rows: [
        { region: 'North', segment: 'SMB', quarter: 'Q1', amount: 1 },
        { region: 'North', segment: 'Enterprise', quarter: 'Q1', amount: 2 },
      ],
      fields: [
        { name: 'region', type: 'string', label: 'Region' },
        { name: 'segment', type: 'string', label: 'Segment' },
        { name: 'quarter', type: 'string', label: 'Quarter' },
        { name: 'amount', type: 'number', label: 'Amount' },
      ],
      totals: [
        { dimensions: ['region', 'segment'], rows: [
          { region: 'North', segment: 'SMB', amount: 10 },
          { region: 'North', segment: 'Enterprise', amount: 20 },
        ] },
        { dimensions: ['quarter'], rows: [{ quarter: 'Q1', amount: 30 }] },
        { dimensions: [], rows: [{ amount: 30 }] },
      ],
    })) };
    render(<DatasetWidget widget={{ type: 'pivot', dataset: 'deals', dimensions: ['region', 'segment', 'quarter'], values: ['amount'] }} dataSource={src} />);
    const m = await screen.findByTestId('dataset-matrix');
    expect(within(m).getAllByTestId('matrix-row-total').map((e) => e.textContent)).toEqual(['10', '20']);
    expect(within(m).getByTestId('matrix-grand-total').textContent).toBe('30');
  });

  it('renders no totals UI when the server omits totals (older server)', async () => {
    const src = { queryDataset: vi.fn(async () => ({
      rows: [{ status: 'Open', priority: 'High', task_count: 2 }],
      fields: [{ name: 'status', type: 'string', label: 'Status' }, { name: 'priority', type: 'string', label: 'Priority' }, { name: 'task_count', type: 'number', label: 'Tasks' }],
    })) };
    render(<DatasetWidget widget={{ type: 'pivot', dataset: 'tasks', dimensions: ['status', 'priority'], values: ['task_count'] }} dataSource={src} />);
    await screen.findByTestId('dataset-matrix');
    expect(screen.queryByTestId('matrix-total-row')).not.toBeInTheDocument();
    expect(screen.queryByTestId('matrix-total-col-header')).not.toBeInTheDocument();
  });

  // ── CSV export ───────────────────────────────────────────────────────────
  it('toCsv serializes a 2D array, quoting/escaping as needed', () => {
    expect(toCsv([['a', 'b'], [1, 2]])).toBe('a,b\r\n1,2');
    // comma, embedded quote (doubled), and newline force quoting.
    expect(toCsv([['x,y', 'a"b', 'l1\nl2']])).toBe('"x,y","a""b","l1\nl2"');
    // null/undefined → empty field.
    expect(toCsv([[null, undefined, 0]])).toBe(',,0');
  });

  it('shows an export button on table and pivot widgets', async () => {
    const src = makeSource(async () => ({ rows: [{ status: 'Open', task_count: 5 }] }));
    render(<DatasetWidget widget={{ type: 'table', dataset: 'tasks', dimensions: ['status'], values: ['task_count'] }} dataSource={src} />);
    expect(await screen.findByTestId('dataset-export')).toBeInTheDocument();
  });

  it('does NOT show an export button on a metric widget', async () => {
    const src = makeSource(async () => ({ rows: [{ task_count: 5 }] }));
    render(<DatasetWidget widget={{ type: 'metric', dataset: 'tasks', values: ['task_count'] }} dataSource={src} />);
    expect(await screen.findByText('5')).toBeInTheDocument();
    expect(screen.queryByTestId('dataset-export')).not.toBeInTheDocument();
  });

  it('exports display-label headers + grouped rows (measures stay numeric) on click', async () => {
    const calls: any[] = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    (URL as any).createObjectURL = (b: any) => { calls.push(b); return 'blob:x'; };
    (URL as any).revokeObjectURL = () => {};
    try {
      const src = { queryDataset: vi.fn(async () => ({
        rows: [{ status: 'Open', task_count: 5 }],
        fields: [{ name: 'status', type: 'string', label: 'Status' }, { name: 'task_count', type: 'number', label: 'Tasks' }],
      })) };
      render(<DatasetWidget widget={{ type: 'table', dataset: 'tasks', title: 'My Tasks', dimensions: ['status'], values: ['task_count'] }} dataSource={src} />);
      fireEvent.click(await screen.findByTestId('dataset-export'));
      // A Blob was created → download was triggered.
      expect(calls.length).toBe(1);
      const text: string = await calls[0].text();
      expect(text).toContain('Status,Tasks');
      expect(text).toContain('Open,5');
    } finally {
      (URL as any).createObjectURL = origCreate;
      (URL as any).revokeObjectURL = origRevoke;
    }
  });
});

/**
 * objectui#5280 — the dimension-metadata probe's own shape.
 *
 * Before this file answered the probe from the double above, the request went
 * to the real network and always failed, so nothing here had ever asserted it
 * and its SUCCESS path had never once executed in this suite. These three pins
 * state what the widget's own wiring asks for — which object, how many times,
 * and that a resolved document actually reaches the rendered cells — so a
 * future widening of the read shows up as a red test rather than as a silent
 * extra request to whatever owns port 3000.
 *
 * (The label-resolution RULES are `@object-ui/core`'s and are unit-tested
 * there. What is new here is only this widget's request wiring — the same
 * three pins objectui#5225's reference fix added for the dataset report
 * block's copy of the same hook.)
 */
describe('DatasetWidget — dimension metadata probe (objectui#5280)', () => {
  it('probes exactly the result-declared object, once, over the metadata route', async () => {
    const src = { queryDataset: vi.fn(async () => ({
      rows: [{ status: 'Open', task_count: 5 }],
      fields: [{ name: 'status', type: 'string', label: 'Status' }, { name: 'task_count', type: 'number', label: 'Tasks' }],
      object: 'showcase_task',
      dimensionFields: { status: 'status' },
    })) };
    render(<DatasetWidget widget={{ type: 'table', dataset: 'tasks', dimensions: ['status'], values: ['task_count'] }} dataSource={src} />);
    await screen.findByText('Open');
    await waitFor(() => expect(probedObjects()).toEqual(['showcase_task']));
    // The rows come from `dataSource`; the metadata is a separate channel that
    // never touches it, which is why the prop double could not intercept this.
    expect(metaCalls.map((c) => c.url)).toEqual(['/api/v1/meta/object/showcase_task']);
    expect(metaCalls[0].init?.headers).toMatchObject({ accept: 'application/json' });
  });

  it('issues no metadata probe when the result declares no object', async () => {
    const src = { queryDataset: vi.fn(async () => ({
      rows: [{ status: 'Open', task_count: 5 }],
      fields: [{ name: 'status', type: 'string', label: 'Status' }, { name: 'task_count', type: 'number', label: 'Tasks' }],
    })) };
    render(<DatasetWidget widget={{ type: 'table', dataset: 'tasks', dimensions: ['status'], values: ['task_count'] }} dataSource={src} />);
    await screen.findByText('Open');
    expect(metaCalls).toEqual([]);
  });

  it('applies the probed document: a select dimension renders its option label', async () => {
    metaDocs.showcase_task = {
      name: 'showcase_task',
      fields: { status: { type: 'select', options: [{ value: 'in_progress', label: 'In Progress' }] } },
    };
    const src = { queryDataset: vi.fn(async () => ({
      // The server sent the STORED value here; the probe is what turns it into
      // the authored label — the path that never ran while the request was
      // failing.
      rows: [{ status: 'in_progress', task_count: 5 }],
      fields: [{ name: 'status', type: 'string', label: 'Status' }, { name: 'task_count', type: 'number', label: 'Tasks' }],
      object: 'showcase_task',
      dimensionFields: { status: 'status' },
    })) };
    render(<DatasetWidget widget={{ type: 'table', dataset: 'tasks', dimensions: ['status'], values: ['task_count'] }} dataSource={src} />);
    await waitFor(() => expect(screen.getByText('In Progress')).toBeInTheDocument());
    expect(screen.queryByText('in_progress')).not.toBeInTheDocument();
  });
});
