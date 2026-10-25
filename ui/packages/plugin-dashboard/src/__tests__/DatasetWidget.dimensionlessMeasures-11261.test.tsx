// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11261 — a DIMENSIONLESS widget with two or more measures renders
 * every one of them where the spec says it does.
 *
 * The spec's metric-family arity refusal, and its ADR-0087 entry
 * `dashboard-widget-metric-family-multi-measure-refused`, send an author who
 * wants several numbers in one widget to "`type: 'table'` renders a row of
 * measures, and the chart families (`bar` / `line` / `area` / `combo`) render
 * one mark per measure". Every door accepts such a widget with no
 * `dimensions`, and `DatasetWidget` used to classify every dimensionless widget
 * as a one-number tile, so it rendered `values[0]` and dropped the rest.
 *
 * `SUBJECT` rows are red before this change and green after it. `CONTROL` rows
 * are green on both sides: the metric tile, the single-measure dimensionless
 * widget (which stays a tile: nothing is dropped there), the query, and the
 * types the spec's text does not name (measured below, and returned to the
 * maintainer as an open question rather than given invented semantics).
 *
 * objectui#8894 answered that question for two of them, by triage's ruling on
 * the card: `column` and `horizontal-bar` are the bar family in another
 * orientation, so they join the transposition and their rows here are
 * SUBJECTS of that card. The other seven keep the tile and its dropped-measure
 * diagnostic until the spec refuses the shape at its door (objectstack#20958).
 *
 * The chart rows draw REAL Recharts marks through the registry, with the
 * `ResponsiveContainer` sized the way `DatasetWidget.chartConfigMarks-9203`
 * explains (scoped to that one element, never blanket). No `dist/` is
 * involved: the root `vitest.config.mts` aliases every `@object-ui/*`
 * specifier to its `src/`, and this file imports `../DatasetWidget` relatively.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
// Registers `chart`, which the `SchemaRenderer` inside `DatasetWidget`
// resolves. Imported at module scope so the cold transform is not billed to a
// bounded test budget (AGENTS.md's flaky-test discipline, objectui#3010).
import '@object-ui/plugin-charts';
import { DatasetWidget } from '../DatasetWidget';

const PLOT_BOX = { width: 480, height: 320 } as const;
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList?.contains('recharts-responsive-container')) {
      return { ...PLOT_BOX, top: 0, left: 0, right: PLOT_BOX.width, bottom: PLOT_BOX.height, x: 0, y: 0, toJSON() {} } as DOMRect;
    }
    return originalGetBoundingClientRect.call(this);
  };
});

afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  warn.mockRestore();
});

/**
 * objectui#8894's dropped-measure diagnostic, if this render produced it. Keyed
 * on the phrase that diagnostic keeps on purpose ("Queried and then never
 * displayed"), so a reworded message cannot turn the `toBeUndefined()` checks
 * below into checks that pass because they match nothing.
 */
const droppedMeasureWarning = (): string | undefined =>
  warn.mock.calls
    .map((c: unknown[]) => c.join(' '))
    .find((m: string) => m.startsWith('[DatasetWidget]') && m.includes('Queried and then never displayed'));

const ROW = { revenue: 510000, cost: 120000, margin: 390000 };
const FIELDS = [
  { name: 'revenue', label: 'Revenue', type: 'number' },
  { name: 'cost', label: 'Cost', type: 'number' },
  { name: 'margin', label: 'Margin', type: 'number' },
];

const sourceOf = (rows: Record<string, unknown>[], fields?: Record<string, unknown>[]) => ({
  queryDataset: vi.fn(async () => ({ rows, ...(fields ? { fields } : {}) })),
});

/** The tile's markup for `revenue` = 510000, as the metric-family pins spell it. */
const REVENUE_TILE =
  '<div class="flex h-full w-full flex-col items-start justify-center gap-1 p-2">'
  + '<span class="text-2xl font-semibold tabular-nums">510000</span>'
  + '<span class="text-xs text-muted-foreground">revenue</span>'
  + '</div>';

const renderTile = async (widget: Record<string, unknown>) => {
  const { container } = render(<DatasetWidget widget={widget} dataSource={sourceOf([ROW])} />);
  await screen.findByText('510000');
  return container;
};

/** Render a dimensionless chart widget and settle it at the drawn plot. */
const renderChart = async (widget: Record<string, unknown>, rows: Record<string, unknown>[] = [ROW]) => {
  const view = render(<DatasetWidget widget={widget} dataSource={sourceOf(rows, FIELDS)} />);
  await waitFor(() => expect(view.container.querySelector('.recharts-surface')).not.toBeNull(), { timeout: 15000 });
  return view.container;
};

// Recharts 3 paints tick labels in their own layer, outside `.recharts-xAxis`
// (see `AdvancedChartImpl.nullCategoryBucket`), so the x-axis label layer is read.
const categoryTicks = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')).map((t) => t.textContent);
// `horizontal-bar` runs its categories DOWN the plot, so they are the y-axis label layer's ticks.
const yAxisTicks = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value')).map((t) => t.textContent);
const barMarks = (c: HTMLElement) => c.querySelectorAll('.recharts-bar-rectangle').length;

describe('objectui#11261 — a dimensionless table renders one row of every measure', () => {
  it.each(['table', 'pivot'])(
    "SUBJECT: the card's %s over revenue, cost and margin renders all three",
    async (type) => {
      const widget = { id: 'totals', type, dataset: 'sales', values: ['revenue', 'cost', 'margin'] };
      const { container } = render(<DatasetWidget widget={widget} dataSource={sourceOf([ROW])} />);
      await screen.findByText('390000');
      const bodyRows = container.querySelectorAll('tbody tr');
      expect(bodyRows).toHaveLength(1);
      expect(Array.from(bodyRows[0].querySelectorAll('td')).map((td) => td.textContent)).toEqual(['510000', '120000', '390000']);
      expect(Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual(['revenue', 'cost', 'margin']);
      // The one row IS the `[]` grand total, so no footer prints it twice.
      expect(screen.queryByTestId('dataset-table-total-row')).toBeNull();
      // Nothing is dropped, so objectui#8894's warning has nothing to say.
      expect(droppedMeasureWarning()).toBeUndefined();
    },
  );
});

describe('objectui#11261 — a dimensionless chart renders one mark per measure', () => {
  it("SUBJECT: a two-measure bar draws two marks, the measures' labels on the category axis", async () => {
    const container = await renderChart({ id: 'rc', type: 'bar', dataset: 'sales', values: ['revenue', 'cost'] });
    await waitFor(() => expect(barMarks(container)).toBe(2));
    expect(categoryTicks(container)).toEqual(['Revenue', 'Cost']);
    expect(droppedMeasureWarning()).toBeUndefined();
  });

  it("SUBJECT: a two-measure combo draws two marks, the measures' labels on the category axis", async () => {
    const container = await renderChart({ id: 'rc', type: 'combo', dataset: 'sales', values: ['revenue', 'cost'] });
    await waitFor(() => expect(barMarks(container)).toBe(2));
    expect(categoryTicks(container)).toEqual(['Revenue', 'Cost']);
  });

  it.each([
    ['line', '.recharts-line-curve'],
    ['area', '.recharts-area-area'],
  ])("SUBJECT: a two-measure %s plots across the two measures' labels", async (type, curve) => {
    const container = await renderChart({ id: 'rc', type, dataset: 'sales', values: ['revenue', 'cost'] });
    await waitFor(() => expect(container.querySelector(curve)).not.toBeNull());
    expect(categoryTicks(container)).toEqual(['Revenue', 'Cost']);
    expect(droppedMeasureWarning()).toBeUndefined();
  });

  // objectui#8894 — triage's first pin on that card: the bar family in its two
  // other orientations draws every measure of a dimensionless widget too.
  it("SUBJECT (objectui#8894): a three-measure column draws three marks, the measures' labels along the bottom", async () => {
    const container = await renderChart({ id: 'rc', type: 'column', dataset: 'sales', values: ['revenue', 'cost', 'margin'] });
    await waitFor(() => expect(barMarks(container)).toBe(3));
    expect(categoryTicks(container)).toEqual(['Revenue', 'Cost', 'Margin']);
    expect(droppedMeasureWarning()).toBeUndefined();
  });

  it("SUBJECT (objectui#8894): a three-measure horizontal-bar draws three marks, the measures' labels down the side", async () => {
    const container = await renderChart({ id: 'rc', type: 'horizontal-bar', dataset: 'sales', values: ['revenue', 'cost', 'margin'] });
    await waitFor(() => expect(barMarks(container)).toBe(3));
    expect(yAxisTicks(container)).toEqual(['Revenue', 'Cost', 'Margin']);
    // The x axis carries the VALUE scale here, not the measures.
    expect(categoryTicks(container)).not.toContain('Revenue');
    expect(droppedMeasureWarning()).toBeUndefined();
  });

  it('SUBJECT: a comparison the query fetched is drawn beside each measure, not dropped', async () => {
    // A dimensionless bar used to be a tile that showed its comparison as a
    // delta. As a chart it keeps asking for one, so the overlay has to draw.
    const container = await renderChart(
      { id: 'rc', type: 'bar', dataset: 'sales', values: ['revenue', 'cost'], compareTo: { kind: 'previousPeriod' } },
      [{ revenue: 510000, cost: 120000, revenue__compare: 400000, cost__compare: 100000 }],
    );
    await waitFor(() => expect(barMarks(container)).toBe(4));
    expect(categoryTicks(container)).toEqual(['Revenue', 'Cost']);
  });
});

describe('objectui#11261 — what did not move', () => {
  it('CONTROL: a two-measure metric tile with no dimension is the tile it was', async () => {
    const container = await renderTile({ id: 'kpi', type: 'metric', dataset: 'sales', values: ['revenue', 'cost'] });
    expect(container.innerHTML).toBe(REVENUE_TILE);
    expect(droppedMeasureWarning()).toContain('"cost"');
  });

  it.each(['table', 'pivot', 'bar', 'column', 'horizontal-bar', 'line', 'area', 'combo'])(
    'CONTROL: a ONE-measure dimensionless %s takes the metric branch and renders the tile',
    async (type) => {
      // Nothing is dropped with one measure, so the branch is unchanged.
      const container = await renderTile({ id: 'one', type, dataset: 'sales', values: ['revenue'] });
      expect(container.innerHTML).toBe(REVENUE_TILE);
    },
  );

  it.each([
    ['table', ['revenue', 'cost', 'margin']],
    ['bar', ['revenue', 'cost']],
  ])('CONTROL: a dimensionless %s queries exactly the declared measures', async (type, values) => {
    const src = sourceOf([ROW]);
    render(<DatasetWidget widget={{ id: 'q', type, dataset: 'sales', values }} dataSource={src} />);
    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    for (const [dataset, selection] of src.queryDataset.mock.calls as unknown as Array<[string, unknown]>) {
      expect(dataset).toBe('sales');
      expect(selection).toEqual({ dimensions: [], measures: values });
    }
  });

  it.each(['pie', 'donut', 'funnel', 'scatter', 'radar', 'treemap', 'sankey'])(
    'CONTROL (measured, ruled): a two-measure dimensionless %s is still a tile that drops the second',
    async (type) => {
      // The spec's text names no dimensionless rendering for these, so none is
      // invented: they keep the tile, render `values[0]`, and objectui#8894's
      // diagnostic still names the dropped measure. Triage ruled these seven to
      // the spec's door (objectstack#20958 refuses the shape); this row moves
      // when that refusal is installed. `column` and `horizontal-bar` were on
      // this row until objectui#8894 drew them (the SUBJECTS above).
      const container = await renderTile({ id: 'u', type, dataset: 'sales', values: ['revenue', 'cost'] });
      expect(container.innerHTML).toBe(REVENUE_TILE);
      expect(droppedMeasureWarning()).toContain('"cost"');
    },
  );
});
