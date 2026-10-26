// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11417 — a dimensioned `pie` / `donut` / `funnel` / `treemap` /
 * `sankey` with two measures draws the first, and the dropped-measure
 * diagnostic (objectui#8894) must SAY SO. What is drawn does not change.
 *
 * The chart branch of `DatasetWidget` hands every declared measure to the
 * shared chart renderer as a series, and the renderer's arms for those five
 * families bind `series[0]` and read no other series. Every door accepted the
 * document (objectui's `DashboardWidgetSchema` and `@objectstack/spec` alike)
 * until 17.7.0, the query runs both measures, and the chart looks finished while answering a
 * narrower question than its metadata asked. Triage's ruling on the card: the
 * spec refuses the shape (objectstack#21293, in `@objectstack/spec` 17.7.0, which
 * objectui's door follows since objectui#11717), and for a widget stored before
 * that refusal the widget's existing diagnostic reports the dropped measure.
 *
 * The pins are triage's: for each of the five types with a dimension and two
 * measures, the diagnostic names the dropped measure; one measure stays silent
 * (the control). Beside them:
 *
 *  - a dimensioned `bar` with two measures stays silent: it draws both;
 *  - the message for this shape states the cause and points to no ADR-0087
 *    entry, because the one the tile message points to answers for a
 *    one-number tile, and a chart with a dimension is not one;
 *  - the TIE: `SINGLE_SERIES_CHART_FAMILIES` is a list kept in `DatasetWidget`,
 *    because the renderer declares no such set. So the last block renders every
 *    chart type the spec declares through the REAL renderer and measures, per
 *    type, whether the second measure reaches the drawn chart at all — and
 *    requires the diagnostic to fire exactly where it does not.
 *
 * How the tie measures "drawn": the same widget renders twice with different
 * values in the second measure. A chart that draws that measure paints
 * something different; one that drops it paints the same markup byte for byte.
 * Two controls make the reading mean something: the same values twice must give
 * the same markup (the harness is deterministic), and different values in the
 * FIRST measure must give different markup (the plot really painted — a chart
 * with no box would read "dropped" for every measure).
 *
 * No renderer stub anywhere: the chain is `DatasetWidget` → `SchemaRenderer` →
 * the registry's `chart` → `AdvancedChartImpl`, as in
 * `DatasetWidget.chartConfigMarks-9203.test.tsx`, whose scoped
 * `getBoundingClientRect` stub gives the plot its box (that file's header says
 * why a blanket stub reads wrong and why `vi.mock('recharts')` is not available
 * in this package).
 *
 * No `dist/` is involved: the root `vitest.config.mts` aliases every
 * `@object-ui/*` specifier to that package's `src/`, and this file imports
 * `../DatasetWidget` relatively, so an ablation reads source directly.
 */

import { describe, it, expect, vi, afterEach, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ChartTypeSchema as SpecChartTypeSchema, DashboardWidgetSchema as SpecDashboardWidgetSchema } from '@objectstack/spec/ui';
import { DashboardWidgetSchema } from '@object-ui/types/zod';
// Registers `chart` in the ComponentRegistry, which is what the `SchemaRenderer`
// inside `DatasetWidget` resolves its `{ type: 'chart' }` schema through.
// Production reaches `AdvancedChartImpl` only through the `React.lazy(() =>
// import('./AdvancedChartImpl'))` factory inside `ChartRenderer`, so this test
// reaches it the same way (objectui#4529).
import '@object-ui/plugin-charts';
import { DatasetWidget } from '../DatasetWidget';

const PLOT_BOX = { width: 480, height: 320 } as const;
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList?.contains('recharts-responsive-container')) {
      return {
        ...PLOT_BOX,
        top: 0,
        left: 0,
        right: PLOT_BOX.width,
        bottom: PLOT_BOX.height,
        x: 0,
        y: 0,
        toJSON() {},
      } as DOMRect;
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
 * The one diagnostic this card is about, or `undefined`. Keyed on the phrase
 * the diagnostic keeps on purpose (objectui#8894's file pins it), so a control
 * that expects silence cannot pass by matching nothing after a rewording.
 */
const measureWarning = (): string | undefined =>
  warn.mock.calls
    .map((c: unknown[]) => c.join(' '))
    .find((m: string) => m.startsWith('[DatasetWidget]') && m.includes('Queried and then never displayed'));

/** The five types triage's ruling names. */
const SINGLE_SERIES_TYPES = ['pie', 'donut', 'funnel', 'treemap', 'sankey'] as const;

/** The ADR-0087 entry the TILE message points to; this shape's message must not. */
const METRIC_FAMILY_ENTRY_ID = 'dashboard-widget-metric-family-multi-measure-refused';

type Row = { stage: string; revenue: number; cost: number };

const ROWS: Row[] = [
  { stage: 'won', revenue: 120, cost: 30 },
  { stage: 'open', revenue: 70, cost: 45 },
  { stage: 'lost', revenue: 40, cost: 25 },
];

const widgetOf = (type: string, values: string[] = ['revenue', 'cost']) => ({
  id: `${type}_by_stage`,
  type,
  dataset: 'sales',
  dimensions: ['stage'],
  values,
});

/**
 * Render one dataset-bound widget through the real chain and settle it at the
 * drawn plot, or at the renderer's own refusal notice (`data-chart-error`),
 * whichever the type renders — so every reading below is taken from a chart
 * that finished drawing, never from a Suspense fallback.
 *
 * "Finished drawing" includes the legend (objectui#11459). Recharts registers a
 * pie's legend items through its store's auto-batched notification, which it
 * delivers on the next animation frame. So the surface and the sectors land one
 * commit before the legend items do, and a read taken in between sees an empty
 * `recharts-legend-wrapper`. The TIE below compares whole markups, so such a
 * read differs from a settled one in the legend alone: on CI that turned the
 * determinism control red, and it can flip `secondDrawn` the same way.
 *
 * The signal is positive on every path this file renders. A chart that draws a
 * legend mounts its wrapper in the same commit as the surface and is settled
 * once every wrapper holds its items. A chart that draws none (`funnel`,
 * `treemap`, `sankey`, the scatter's refusal) mounts no wrapper, so it settles
 * on the surface or the notice alone. Both facts were measured once, on
 * objectui#11459's pull request; nothing in this file re-derives them. A
 * settled chart whose legend stayed empty would time out here and fail loudly,
 * never pass on a half-drawn chart.
 */
const renderChart = async (widget: Record<string, unknown>, rows: Row[] = ROWS) => {
  const src = { queryDataset: vi.fn(async () => ({ rows })) };
  const view = render(<DatasetWidget widget={widget} dataSource={src} />);
  // AGENTS.md records first-`import()` latencies up to 976 ms under full
  // parallelism, past RTL's 1000 ms default once the recharts graph is cold.
  await waitFor(
    () => {
      expect(view.container.querySelector('.recharts-surface, [data-chart-error]')).not.toBeNull();
      const unfilledLegends = Array.from(view.container.querySelectorAll('.recharts-legend-wrapper')).filter(
        (wrapper) => wrapper.childElementCount === 0,
      );
      expect(unfilledLegends, 'a legend the chart mounted has not drawn its items yet').toHaveLength(0);
    },
    { timeout: 15000 },
  );
  return view;
};

describe('objectui#11417 — a single-series chart with a dimension says which measure it drops', () => {
  it.each(SINGLE_SERIES_TYPES)('SUBJECT (triage pin): a dimensioned `%s` with two measures names the dropped one', async (type) => {
    const doc = widgetOf(type);
    // A STORED document now, as objectui#8894's stored-metric pin is. Since
    // `@objectstack/spec` 17.7.0 (objectstack#21293) the spec refuses the shape at
    // `values`, and objectui's door refuses it with the spec's own issue (the
    // mirror chains `checkDashboardWidgetChartMeasureArity`, objectui#11717,
    // triage's item 2 on objectui#11417). These two asserted the acceptance until
    // the pin moved past that refusal; they flipped on purpose. A widget stored
    // before the refusal still renders, and the diagnostic still names the drop.
    const spec = SpecDashboardWidgetSchema.safeParse(doc);
    expect(spec.success, 'the spec\'s door refuses a dimensioned two-measure single-series widget').toBe(false);
    const specIssue = spec.error!.issues.find((i) => i.path.join('.') === 'values')!;
    expect(specIssue.code).toBe('custom');
    const mirror = DashboardWidgetSchema.safeParse(doc);
    expect(mirror.success, 'objectui\'s door refuses it too').toBe(false);
    expect(
      mirror.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message })),
    ).toContainEqual({ code: 'custom', path: 'values', message: specIssue.message });
    await renderChart(doc);
    const msg = measureWarning();
    expect(msg).toBeDefined();
    expect(msg).toContain(
      `[DatasetWidget] Widget "${type}_by_stage" (type "${type}", dataset "sales") renders 1 of its 2 declared measures: "revenue".`,
    );
    expect(msg).toContain('Queried and then never displayed: "cost".');
  });

  it('SUBJECT: the message states the cause and points to no ADR-0087 entry — the tile\'s entry does not answer for a chart', async () => {
    await renderChart(widgetOf('pie'));
    const msg = measureWarning()!;
    expect(msg).toContain('Its chart family "pie" draws a single series: the first declared measure.');
    // The metric-family entry's `replacement` answers for a one-number tile,
    // and this widget is a chart with a dimension: pointing there would send
    // the reader to advice about a different shape.
    expect(msg).not.toContain(METRIC_FAMILY_ENTRY_ID);
    expect(msg).not.toContain('one-number tile');
    // No advice of its own, and no widget type named but its own family.
    expect(msg).not.toMatch(/\bDeclare\b|\buse a\b|\binstead\b/);
    const prose = msg.replace('(type "pie",', '').replace('family "pie"', '');
    const named = SpecChartTypeSchema.options.filter((t: string) =>
      new RegExp(`(^|[^\\w-])${t.replace(/[-]/g, '\\-')}([^\\w-]|$)`).test(prose),
    );
    expect(named).toEqual([]);
  });

  it('SUBJECT: the FAMILY decides, not the widget type — a stored `pyramid` renders as a funnel and says so', async () => {
    // `pyramid` is no door's widget type; it reaches the renderer only as a
    // stored document, through CHART_TYPE_MAP's fallback to `funnel`.
    await renderChart({ ...widgetOf('pyramid'), id: 'stages' });
    const msg = measureWarning();
    expect(msg).toContain('(type "pyramid", dataset "sales") renders 1 of its 2 declared measures: "revenue".');
    expect(msg).toContain('Its chart family "funnel" draws a single series: the first declared measure.');
  });

  it('CONTROL (triage pin): one measure on a dimensioned `pie` stays silent', async () => {
    // Nothing is dropped: the one measure is the one series the arm draws.
    await renderChart(widgetOf('pie', ['revenue']));
    expect(measureWarning()).toBeUndefined();
  });

  it('CONTROL: a dimensioned `bar` with two measures stays silent — it draws both', async () => {
    await renderChart(widgetOf('bar'));
    expect(measureWarning()).toBeUndefined();
  });
});

/**
 * React's `useId` (`_r_…_`) and Recharts' own counters mint document-unique ids
 * per mount, so the same chart mounted twice differs there and nowhere else —
 * the determinism control below measures that.
 */
const normalisedMarkup = (container: HTMLElement): string =>
  container.innerHTML.replace(/_r_[0-9a-z]+_/g, '_r_ID_').replace(/recharts[\w-]*?\d+/g, 'recharts-ID');

const markupWith = async (type: string, rows: Row[]): Promise<{ markup: string; refused: string | null; warned: boolean }> => {
  warn.mockClear();
  const view = await renderChart(widgetOf(type), rows);
  const out = {
    markup: normalisedMarkup(view.container),
    refused: view.container.querySelector('[data-chart-error]')?.getAttribute('data-chart-error') ?? null,
    warned: measureWarning() !== undefined,
  };
  cleanup();
  return out;
};

/**
 * Replacement values for one measure, in an ORDER neither measure has: a
 * proportional change (every value scaled) can leave a part-of-whole chart —
 * a treemap's areas — pixel-identical, which would read as "not drawn".
 */
const REORDERED = [15, 160, 90] as const;
const withValues = (rows: Row[], measure: 'revenue' | 'cost'): Row[] =>
  rows.map((r, i) => ({ ...r, [measure]: REORDERED[i] }));

/** Every chart type the spec declares — the metric family is a tile and `table` / `pivot` a table. */
const SPEC_CHART_TYPES = SpecChartTypeSchema.options.filter(
  (t: string) => !['metric', 'kpi', 'gauge', 'solid-gauge', 'bullet', 'table', 'pivot'].includes(t),
);

describe('objectui#11417 — the TIE: the diagnostic fires exactly where the renderer leaves the second measure undrawn', () => {
  it.each(SPEC_CHART_TYPES)('`%s`: fires iff the second measure\'s values leave the drawn chart unchanged', async (type) => {
    const base = await markupWith(type, ROWS);
    const again = await markupWith(type, ROWS);
    const secondChanged = await markupWith(type, withValues(ROWS, 'cost'));
    const firstChanged = await markupWith(type, withValues(ROWS, 'revenue'));

    // Control: the harness is deterministic, so a difference below is the data's.
    expect(again.markup, 'the same rows rendered twice must give the same markup').toBe(base.markup);

    if (base.refused) {
      // The renderer refuses the shape out loud, with a notice on the chart that
      // names the series: nothing is dropped in silence, so the console has
      // nothing to add. Only the scatter's arity refusal is expected here; any
      // other refusal means the harness drew something this pin never measured.
      expect({ type, refused: base.refused, warned: base.warned }).toEqual({ type, refused: 'scatter-multi-series', warned: false });
      return;
    }
    // Control: the plot painted, so "unchanged" below cannot mean "never drew".
    expect(firstChanged.markup, 'the first measure must reach the drawn chart').not.toBe(base.markup);

    const secondDrawn = secondChanged.markup !== base.markup;
    expect({ type, secondDrawn, warned: base.warned }).toEqual({ type, secondDrawn, warned: !secondDrawn });
  });
});
