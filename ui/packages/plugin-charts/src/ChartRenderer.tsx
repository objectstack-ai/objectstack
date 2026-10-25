
import React, { Suspense } from 'react';
import { Skeleton } from '@object-ui/components';
import type { ChartContainerConfig } from './ChartContainerImpl';
import type { ChartSegmentClickEvent } from '@object-ui/core';
import { useObjectTranslation } from '@object-ui/i18n';
import { normalizeChartSchema } from './normalizeChartSchema';

// 🚀 Lazy load the implementation files
const LazyChart = React.lazy(() => import('./ChartImpl'));
const LazyAdvancedChart = React.lazy(() => import('./AdvancedChartImpl'));

export interface ChartBarRendererProps {
  schema: {
    type: string;
    id?: string;
    className?: string;
    data?: Array<Record<string, any>>;
    dataKey?: string;
    xAxisKey?: string;
    height?: number;
    color?: string;
  };
}

/**
 * ChartBarRenderer - The public API for the bar chart component
 */
export const ChartBarRenderer: React.FC<ChartBarRendererProps> = ({ schema }) => {
  return (
    <Suspense fallback={<Skeleton className="w-full h-48 sm:h-64 md:h-80 lg:h-[400px]" />}>
      <LazyChart
        data={schema.data}
        dataKey={schema.dataKey}
        xAxisKey={schema.xAxisKey}
        height={schema.height}
        className={schema.className}
        color={schema.color}
      />
    </Suspense>
  );
};

export interface ChartRendererProps {
  schema: {
    type: string;
    id?: string;
    className?: string;
    chartType?: 'bar' | 'column' | 'horizontal-bar' | 'line' | 'area' | 'pie' | 'donut' | 'radar' | 'scatter' | 'funnel' | 'combo' | 'treemap' | 'sankey';
    data?: Array<Record<string, any>>;
    config?: Record<string, any>;
    /** Internal binding. Authors write the spec `xAxis: { field }` (or the
     *  report surface's bare string); `normalizeChartSchema` resolves both. */
    xAxisKey?: string;
    /**
     * Plotted series — **both shapes**, unlike the bindings below.
     *
     * `series` is the one binding the spec and the internal contract spell with
     * the same key, so declaring only the internal shape here made
     * `series: [{ name: 'total' }]` a type error on an author who was writing
     * the protocol correctly — and, until #2945, one whose chart also rendered
     * blank. `normalizeChartSchema` translates every entry, of either shape,
     * uniformly — see the normalization comment in the component body.
     *
     * Both arms carry the per-series family override `type`, with the same
     * member type (objectui#8086): the renderer honours it on either shape,
     * because every entry goes through `normalizeSeries` (`01c27c431`), and
     * `ChartDataSeriesSchema` declares `dataKey` and `name` independently
     * optional beside it — so a `dataKey` entry carrying `type` is what the
     * contract and the renderer both accept, and this union says so.
     * `chartType` stays on the `dataKey` arm alone: it is the renderer's
     * INTERNAL spelling of `type`, and it wins when an entry writes both.
     * Pinned at compile time in `ChartRenderer.seriesTypeArm-8086.test.ts`.
     *
     * `aggregate` is internal too, on the `dataKey` arm alone (objectui#11681):
     * the measure's aggregate, carried by `buildChartSeries` from the dataset
     * answer, so a value axis over counts draws whole-number ticks. The
     * authoring face refuses it by name (`ChartDataSeriesSchema.aggregate`).
     */
    series?: Array<
      | { dataKey: string; label?: string; type?: string; variant?: 'current' | 'comparison'; opacity?: number; dashArray?: string; chartType?: 'bar' | 'line' | 'area'; stack?: string; yAxis?: 'left' | 'right'; color?: string; aggregate?: string }
      | { name: string; label?: unknown; type?: string; variant?: 'current' | 'comparison' | 'primary'; opacity?: number; dashArray?: string; stack?: string; yAxis?: 'left' | 'right'; color?: string }
    >;
    /** Spec `ChartConfig` shape — honored via `normalizeChartSchema`
     *  (objectui#2880). Listed here so the author-facing contract type-checks;
     *  the internal props above win when both are present. */
    xAxis?: unknown;
    yAxis?: unknown;
    showLegend?: boolean;
    showDataLabels?: boolean;
    title?: unknown;
    subtitle?: unknown;
    description?: unknown;
    height?: number;
    annotations?: Array<Record<string, any>>;
    interaction?: Record<string, any>;
    /** An author `type` rescued from the SDUI envelope's discriminator
     *  collision by the react-page wrapper — see `normalizeChartSchema`. */
    specType?: string;
    colors?: string[];
    /** Per-category colour map (value/label → colour). Wins over `colors` per
     *  category; see AdvancedChartImpl. Set by ObjectChart from select/lookup
     *  dimension option colours and/or an explicit author map. */
    categoryColors?: Record<string, string>;
    /** Declared category order (value/label keys, in domain order) for
     *  ordered-sequence charts — funnel/pyramid stages. Set by DatasetWidget
     *  from the dimension's picklist order or an explicit `stageOrder`; see
     *  AdvancedChartImpl. Omitted → the funnel's value-descending default. */
    categoryOrder?: string[];
    /** Pass `false` for a deterministic, export-safe render with no entrance
     *  animation (see AdvancedChartImpl). Omitted → animated default. */
    isAnimationActive?: boolean;
  };
  /** Drill-down click handler — wired by ObjectChart when drillDown is enabled. */
  onChartClick?: (event: ChartSegmentClickEvent) => void;
}

/**
 * ChartRenderer - The public API for the advanced chart component
 */
export const ChartRenderer: React.FC<ChartRendererProps> = ({ schema, onChartClick }) => {
  // The VIEWER's active language, for the `I18nLabel` slots `normalizeChartSchema`
  // resolves — the chart heading above all (objectui#8943). Read HERE because
  // that function is pure and cannot call a hook, which is the whole reason the
  // heading used to be decided by the author's key order instead.
  //
  // `useObjectTranslation` is provider-safe (an optional context read that falls
  // back to react-i18next's global instance), so this adds no provider
  // requirement to a host that embeds `ChartRenderer` bare — the same property
  // `ObjectChart` already relies on for the drill-drawer heading.
  const { language } = useObjectTranslation();

  // ⚡️ Adapter: Normalize the AUTHOR-facing chart schema to Recharts props.
  //
  // The spec shape (`type` / `xAxis: {field}` / `yAxis: [{field, format, …}]` /
  // `series: [{name, stack, yAxis}]`) and the renderer's internal shape
  // (`chartType` / `xAxisKey` / `series: [{dataKey}]`) both land here;
  // `normalizeChartSchema` is the single translation point, with internal props
  // winning so DashboardRenderer/ObjectView/the dataset path are untouched
  // (objectui#2880 S1).
  const props = React.useMemo(() => {
    const spec = normalizeChartSchema(schema, language);

    // `series` is the one binding both shapes spell with the SAME key, so the
    // blanket "internal props win" rule degenerated here: a spec author's
    // `[{ name, type }]` shadowed the normalized `[{ dataKey, chartType }]` and
    // reached a renderer that reads `dataKey` — so the chart rendered BLANK, and
    // the per-series family override went with it (#2945). Every other spec
    // binding has a distinct name (`xAxis` vs `xAxisKey`) and so was unaffected.
    //
    // #2945's fix took the raw array whenever it ALREADY spoke the internal
    // shape (every entry has `dataKey`), on the theory that an internal
    // producer's array should pass through untouched — but that same fast path
    // skips `normalizeSeries` entirely, and `normalizeSeries`'s
    // `str(raw.chartType) ?? str(raw.type)` is the ONLY place the declared
    // per-series override (`ChartDataSeries.type`, objectui#6121) is translated
    // to the renderer-internal `chartType`. So an author who writes the
    // documented `dataKey` binding *and* the documented `type` override
    // together — both valid on `ChartDataSeriesSchema` independently — got
    // NEITHER honoured (`01c27c431`).
    //
    // `normalizeSeries` is a no-op on a well-formed internal-shaped entry apart
    // from `type`: it round-trips every other key the internal arm of
    // `ChartRendererProps.series` declares (`dataKey`/`label`/`chartType`/
    // `variant`/`opacity`/`dashArray`/`stack`/`yAxis`/`color`/`aggregate`) unchanged, and
    // translates `type` to `chartType` — the translation this routing exists
    // for. So always taking the normalized array
    // is not a second read site for `type` (AGENTS.md #0.1) — it is routing
    // EVERY entry, of either shape, through the ONE normalization layer
    // (objectui#2880 S1) instead of special-casing one shape around it, which
    // is what made the fast path a second, un-normalized path in the first
    // place. `authored` remains only as the fallback for a series
    // `normalizeSeries` could not translate at all (no `dataKey` and no `name`
    // on any entry).
    const authored = Array.isArray(schema.series) ? schema.series : undefined;
    const series: any[] | undefined = spec.series ?? authored;
    const xAxisKey = schema.xAxisKey ?? spec.xAxisKey;
    let config = schema.config;

    // ⛔ The "Tremor/simple format" adapter that used to sit here is RETIRED
    // (objectui#8650). It read four keys off `schema` behind `as any` casts --
    // `index` / `category` (-> `xAxisKey`) and `categories` / `value`
    // (-> `series`) -- and the census that ruled on it found the four do NOT
    // share one verdict:
    //
    //   - `categories` was never a foreign spelling at all. It is a declared
    //     member of the published `ChartSchema` and of its zod mirror,
    //     documented in the schema reference as an ALTERNATIVE SERIES LIST, and
    //     ruled LIVE by the maintainer ruling of 2026-08-31 (prose
    //     follows machine). `normalizeChartSchema` -- the ONE translation point
    //     (objectui#2880 S1) -- already consumes it, so `spec.series` above is
    //     populated before the old branch could be reached. That branch was a
    //     SECOND, un-normalized read of a key the normalizer owns: the shape
    //     `01c27c431` removed for `series`. It was unreachable for every
    //     well-formed chart, and on malformed input it was WORSE than nothing
    //     (`categories: 'revenue'` reached `.map` on a string and threw; a
    //     `categories` whose entries the normalizer rejects produced
    //     `[{ dataKey: '' }]`). The capability is untouched and stays pinned in
    //     `normalizeChartSchema.test.ts`.
    //   - `index`, `category` and `value` WERE a second authoring vocabulary:
    //     declared on no published face (not `ChartSchema`, not its zod mirror,
    //     not `ChartRendererProps.schema` above), advertised by no registry
    //     `inputs`, taught by no doc, guide or skill, and written by ZERO
    //     producers anywhere in this repo. AGENTS.md #0.1 puts the remedy at
    //     the producer; with no producer to route, the read was tolerance for a
    //     dialect nobody speaks. The canonical spellings are `xAxisKey` /
    //     `xAxis` for the category axis and `series` / `categories` for the
    //     plotted columns.
    //
    // ⛔ Do not re-add a key-aliasing branch here. A new inbound spelling is
    // translated in `normalizeChartSchema`, which is where every other dialect
    // this renderer accepts already resolves -- a second site here is how this
    // one became invisible to the normalizer's own tests.

    // Auto-generate config/colors if missing. A spec `series[].color` is an
    // explicit author choice, so it wins over the positional palette.
    if (!config && series) {
       const colors = schema.colors || ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))'];
       const newConfig: ChartContainerConfig = {};
       series.forEach((s: any, idx: number) => {
         newConfig[s.dataKey] = { label: s.label || s.dataKey, color: s.color || colors[idx % colors.length] };
       });
       config = newConfig;
    }

    return {
      chartType: schema.chartType ?? spec.chartType,
      data: Array.isArray(schema.data) ? schema.data : [],
      config,
      xAxisKey,
      series,
      className: schema.className,
      spec,
    };
  }, [schema, language]);

  return (
    <Suspense fallback={<Skeleton className="w-full h-48 sm:h-64 md:h-80 lg:h-[400px]" />}>
      <LazyAdvancedChart
        chartType={props.chartType}
        data={props.data}
        config={props.config}
        xAxisKey={props.xAxisKey}
        series={props.series}
        className={props.className}
        colors={Array.isArray(schema.colors) ? schema.colors : undefined}
        categoryColors={schema.categoryColors}
        categoryOrder={schema.categoryOrder}
        isAnimationActive={schema.isAnimationActive}
        onChartClick={onChartClick}
        xAxis={props.spec.xAxis}
        yAxes={props.spec.yAxes}
        showLegend={props.spec.showLegend}
        showDataLabels={props.spec.showDataLabels}
        title={props.spec.title}
        subtitle={props.spec.subtitle}
        description={props.spec.description}
        height={props.spec.height ?? schema.height}
        annotations={props.spec.annotations}
        interaction={props.spec.interaction}
      />
    </Suspense>
  );
};
