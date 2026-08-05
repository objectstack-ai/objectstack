// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { I18nLabelSchema, AriaPropsSchema } from './i18n.zod';
import { strictObject } from '../shared/strict-object';

// ---------------------------------------------------------------------------
// UNKNOWN-KEY POSTURE (#4001 批 15, ADR-0078) — this file is SPLIT, on a
// measurement, and the split is the point. Five of its seven object sites are
// closed; two are deliberately left open with the reason recorded, because
// closing them would gate nothing.
//
// ⚠️ Nothing above this block may be a JSDoc block: `build-docs.ts`'s
// `getFileDescription()` publishes the module's FIRST doc block as the
// reference page's description (#3746 trap 1). Hence `//`. Note you cannot
// safely spell that token out here either — see the longer note in
// `theme.zod.ts`, where quoting it inside a `//` line silently emptied the
// published page description.
//
// CLOSED (real door, three measurements, 2026-08-03):
//   `ChartConfigSchema`, `ChartAxisSchema`, `ChartSeriesSchema`,
//   `ChartAnnotationSchema`, `ChartInteractionSchema`.
//
//   1. CARRIER KEY — `dashboard.zod.ts` declares `DashboardWidget.chartConfig`
//      and `report.zod.ts` declares `ReportChartSchema` (a
//      `ChartConfigSchema.extend(...)`). `dashboard` and `report` are both
//      registered metadata types.
//   2. GRAPH — a BFS from all 24 metadata-type roots plus `ObjectStackSchema`
//      (the `build-schemas.ts` / #4650 closure) reaches all five as
//      `root-graph`. Controls in the same run: `PageSchema` /
//      `DashboardSchema` / `ReportSchema` / `WebhookSchema` /
//      `StateMachineSchema` resolve; 批 13's measured no-door shapes
//      (`TouchTargetConfigSchema`, `GestureConfigSchema`) did not. (Those two
//      negative controls are gone as of #4988, which retired the five no-door
//      interaction modules outright; a re-run needs a fresh negative control —
//      an inline `z.object({ a: z.string() })` is the cheapest one.)
//   3. PARSE — `getMetadataTypeSchema('dashboard' | 'report')` is what
//      `MetadataManager.validate`, `GET /api/v1/meta` and the Studio form all
//      go through, so a chart key is judged on the stored-metadata path.
//
//   ⚠️ Strictness RIDES `.extend()` onto `ReportChartSchema` (the #4001 trap
//   that bit `webhook` and `view`). That is intended and pinned in
//   `chart.test.ts` — the report chart narrows `xAxis`/`yAxis` to dataset
//   dimension/measure NAMES and adds no key of its own, so the inherited key
//   set is exactly right and no `extraKeys` entry is needed.
//
// LEFT OPEN, DELIBERATELY (`ChartAggregateSchema`, `ChartGroupBySchema`) —
// see the block above those two schemas. Short version: their carrier is the
// REACT tier's `<ObjectChart aggregate={…}>` prop, and nothing parses them.
// ---------------------------------------------------------------------------

/**
 * Unified Chart Type Taxonomy
 * 
 * Shared by Dashboard and Report widgets.
 * Provides a comprehensive set of chart types for data visualization.
 */

/**
 * Chart Type Enum
 * Categorized by visualization purpose
 */
import { lazySchema } from '../shared/lazy-schema';
export const ChartTypeSchema = lazySchema(() => z.enum([
  // Comparison
  'bar',
  'horizontal-bar',
  'column',

  // Trend
  'line',
  'area',

  // Distribution
  'pie',
  'donut',
  'funnel',

  // Relationship
  'scatter',

  // Composition
  'treemap',
  'sankey',

  // Mixed — bar/line/area series on shared dual axes. `ChartSeriesSchema.type`
  // and `ChartSeriesSchema.yAxis` below exist precisely to configure this
  // family (the former's own doc comment says "combo charts"), so the taxonomy
  // was unable to name the one chart type the rest of the file is written for.
  // objectui's renderer draws it distinctly — mixed marks, left/right axes,
  // per-series type — and had to carry `combo` in a local fork of this list.
  'combo',

  // Performance (single value — metric/kpi render a number; gauge/solid-gauge/
  // bullet are honest single-value variants pending a real dial/target renderer)
  'gauge',
  'solid-gauge',
  'metric',
  'kpi',
  'bullet',

  // Advanced
  'radar',

  // Tabular
  'table',
  'pivot',
]));

// NOTE: the taxonomy lists only chart families the default Recharts renderer
// draws DISTINCTLY. Two groups are intentionally absent:
//
// 1. Families requiring data/dependencies the platform does not model — OHLC
//    (candlestick/stock), per-record distributions (box-plot/violin), geo
//    (choropleth/bubble-map/gl-map), or extra renderers (sunburst, heatmap,
//    word-cloud, waterfall).
// 2. VARIANTS that only render as their base chart, so advertising them lies
//    about the output: bi-polar-bar (→ bar), step-line / spline (→ line),
//    pyramid (→ funnel), bubble (→ scatter, no size encoding).
//
// Both can return via an opt-in renderer once there is a real renderer and a
// data model to back them.
//
// Grouped/stacked bar and stacked area are absent for a DIFFERENT reason, and
// a better one: stacking is not a chart family, it is a property of the series
// (`ChartSeries.stack` — series sharing a group id stack, otherwise they
// group). One `bar` family plus a series-level stack group expresses all three
// without multiplying the taxonomy. The renderer honors it (objectui#2880);
// before that it did not, which is why they once sat in the list above.
//
// `metric`/`kpi` are kept as honest single-value synonyms; `gauge`/
// `solid-gauge`/`bullet` render a value today and gain a dial when a gauge
// renderer lands.

export type ChartType = z.infer<typeof ChartTypeSchema>;

/**
 * Chart Axis Schema
 * Definition for X and Y axes
 */
export const ChartAxisSchema = lazySchema(() => strictObject(
  {
    surface: 'this chart axis',
    history:
      'Until #4001 an undeclared axis key was dropped at parse and the axis rendered with the default scale and ticks — a chart that looked configured and was not.',
    // MEASURED same-file inconsistency, both directions: this schema names its
    // bound column `field` and its caption `title`, while `ChartSeriesSchema`
    // twenty lines below names them `name` and `label`. An author who has just
    // written a series writes the series spelling here. `dataKey` / `stackId` /
    // `yAxisId` are Recharts' own prop names, and Recharts is the renderer
    // behind these shapes — so they are what an author debugging in the browser
    // reads off the component and writes back into the metadata.
    aliases: {
      name: 'field', key: 'field', dataKey: 'field', column: 'field', value: 'field',
      label: 'title', text: 'title', caption: 'title',
      grid: 'showGridLines', showGrid: 'showGridLines', gridLines: 'showGridLines',
      step: 'stepSize', tickStep: 'stepSize', interval: 'stepSize',
      log: 'logarithmic', logScale: 'logarithmic', scale: 'logarithmic',
      minimum: 'min', maximum: 'max',
      formatter: 'format', numberFormat: 'format',
      side: 'position', align: 'position',
    },
  },
  {
    /** Data field to map to this axis */
    field: z.string().describe('Data field key'),

    /** Axis title */
    title: I18nLabelSchema.optional().describe('Axis display title'),

    /** Value formatting (d3-format or similar) */
    format: z.string().optional().describe('Value format string (e.g., "$0,0.00")'),

    /** Axis scale settings */
    min: z.number().optional().describe('Minimum value'),
    max: z.number().optional().describe('Maximum value'),
    stepSize: z.number().optional().describe('Step size for ticks'),

    /** Appearance */
    showGridLines: z.boolean().default(true),
    position: z.enum(['left', 'right', 'top', 'bottom']).optional().describe('Axis position'),

    /** Logarithmic scale */
    logarithmic: z.boolean().default(false),
  },
));

/**
 * Chart Series Schema
 * Defines a single data series in the chart
 */
export const ChartSeriesSchema = lazySchema(() => strictObject(
  {
    surface: 'this chart series',
    history:
      'Until #4001 an undeclared series key was dropped at parse — the series still drew, in the palette colour, on the left axis, unstacked, which is precisely the configuration the author was overriding.',
    // The mirror of `ChartAxisSchema`'s entries: `field`/`title` are the axis
    // spellings of this schema's `name`/`label`. `stackId` / `yAxisId` /
    // `strokeDasharray` are Recharts' prop names — and `dashArray`'s own
    // `.describe()` says "SVG stroke-dasharray override", so the file itself
    // teaches the spelling it then refuses. `chartType` is named in
    // `react-blocks.ts` as the INTERNAL spelling that is deliberately not part
    // of the author contract, which makes it a wrong-layer near-miss rather
    // than a typo.
    aliases: {
      field: 'name', key: 'name', dataKey: 'name', column: 'name',
      title: 'label', text: 'label', caption: 'label',
      chartType: 'type', seriesType: 'type', kind: 'type',
      stackId: 'stack', stackGroup: 'stack', group: 'stack',
      axis: 'yAxis', yAxisId: 'yAxis', side: 'yAxis',
      role: 'variant',
      // Recharts' own casing alone covers `strokeDashArray` — one probe (#5481).
      strokeDasharray: 'dashArray', dashed: 'dashArray',
      alpha: 'opacity', fillOpacity: 'opacity', strokeOpacity: 'opacity',
      colour: 'color', fill: 'color', stroke: 'color',
    },
  },
  {
  /** Field name for values */
  name: z.string().describe('Field name or series identifier'),

  /** Display label */
  label: I18nLabelSchema.optional().describe('Series display label'),
  
  /** Series type override (combo charts) */
  type: ChartTypeSchema.optional().describe('Override chart type for this series'),
  
  /** Specific color */
  color: z.string().optional().describe('Series color (hex/rgb/token)'),
  
  /** Stacking group */
  stack: z.string().optional().describe('Stack identifier to group series'),
  
  /** Axis binding */
  yAxis: z.enum(['left', 'right']).default('left').describe('Bind to specific Y-Axis'),

  /**
   * Series role.
   *
   * - `'primary'` (default) — normal styling using the chart palette.
   * - `'comparison'` — secondary period-over-period overlay; renderers
   *   render it muted (lower opacity, dashed stroke for line/area,
   *   lighter fill for bars) so it visually backgrounds against the
   *   primary series. Pair with `DashboardWidget.compareTo` on data-
   *   bound charts; for hand-authored series, set it directly.
   */
  variant: z.enum(['primary', 'comparison']).default('primary').optional().describe('Series visual role'),

  /** Override stroke dash pattern (e.g. "4 4" for dashed lines). */
  dashArray: z.string().optional().describe('SVG stroke-dasharray override'),

  /** Override series opacity (0–1). */
  opacity: z.number().min(0).max(1).optional().describe('Series opacity override'),
  },
));

/**
 * Chart Annotation Schema
 * Static lines or regions to highlight data
 */
export const ChartAnnotationSchema = lazySchema(() => strictObject(
  {
    surface: 'this chart annotation',
    history:
      'Until #4001 an undeclared annotation key was dropped at parse and the reference line drew at the wrong place, in the default style, or not at all — while the annotation itself reported valid.',
    // A region is authored as a RANGE, and every neighbouring range vocabulary
    // in the protocol spells its ends `from`/`to` or `start`/`end`
    // (`data/filter.zod.ts` operators, the dashboard date-range filter). This
    // schema spells them `value`/`endValue`, so the mismatch is a different
    // word for the same intent, not a slip. Getting `endValue` wrong is the
    // expensive one: the region collapses to a line at `value`.
    aliases: {
      from: 'value', start: 'value', at: 'value', threshold: 'value', y: 'value', x: 'value',
      to: 'endValue', end: 'endValue', until: 'endValue', valueEnd: 'endValue',
      title: 'label', text: 'label', caption: 'label',
      lineStyle: 'style', strokeStyle: 'style', dash: 'style',
      colour: 'color', stroke: 'color', fill: 'color',
      orientation: 'axis', direction: 'axis',
      kind: 'type', shape: 'type',
    },
  },
  {
    type: z.enum(['line', 'region']).default('line'),
    axis: z.enum(['x', 'y']).default('y'),
    value: z.union([z.number(), z.string()]).describe('Start value'),
    endValue: z.union([z.number(), z.string()]).optional().describe('End value for regions'),
    color: z.string().optional(),
    label: I18nLabelSchema.optional(),
    style: z.enum(['solid', 'dashed', 'dotted']).default('dashed'),
  },
));

/**
 * Chart Interaction Schema
 *
 * Both toggles are honored by the renderer. Two former members were removed in
 * #3752 rather than left declared-but-inert (ADR-0078; the #1475 trim-vs-
 * implement call), because each was redundant against something the platform
 * already delivers:
 *
 *   * `zoom` — no renderer had a zoom primitive behind it, and `brush` already
 *     narrows a range. Migration: `brush: true`.
 *   * `clickAction` — a chart segment click already has owners that DO work,
 *     so a third, silent one only invited authors to wire a click that never
 *     fired. Migration: in the react tier, the host's own `onSegmentClick`;
 *     on a report, `ReportSchema.drilldown` (ADR-0021 D2, on by default);
 *     on a dashboard widget, the renderer's segment drill under the widget's
 *     `options` bag, which is `passthrough` precisely so renderer-only
 *     capabilities have a declared home.
 */
// ⚠️ Kept OUT of the doc comment above on purpose — `build-docs.ts` publishes
// that block to the public reference page, and the following is a note to the
// next maintainer, not protocol documentation (the #3746 trap, in its subtler
// form: not the file's FIRST block, but internal prose inside a published one).
//
// That `clickAction` paragraph read "Migration: `drillDown`" from #3752 until
// #4001 批 15, when `drillDown` was not a key this protocol declared anywhere —
// it was an untyped `(schema as any).drillDown` read inside objectui's
// `ObjectChart`. Promoting that sentence into the strict rejection message
// below would have handed an author the platform's authority for a key the very
// same gate then rejects: the ledger's finding 7, third occurrence.
//
// #5022 closed the gap — see `ChartDrillDownSchema` below — but the
// prescription here STILL must not read "Migration: `drillDown`", and the pin
// in `chart.test.ts` still holds. The reason changed, it did not go away: the
// declared key is a REACT-TIER PROP (`<ObjectChart drillDown={…}>`), and this
// schema is reached from BOTH tiers — `chartConfig.interaction` on a dashboard
// widget and the react block — with no way to tell which one the author is on.
// A bare `drillDown` here would be right for half its readers and inert advice
// for the other half, which is finding 7 wearing a different hat. The
// surface-qualified prescription lives where the surface IS knowable: on
// `ChartConfigSchema`'s `guidance` (chart-config level) and on the dashboard
// widget's strict error (`dashboard.zod.ts`).
export const ChartInteractionSchema = lazySchema(() => strictObject(
  {
    surface: 'this chart interaction block',
    history:
      'Until #4001 an undeclared interaction key was dropped at parse — including the two #3752 removed, so an author who kept writing `zoom` after it was retired got exactly the same silence as before the removal.',
    aliases: { tooltip: 'tooltips', hover: 'tooltips', showTooltip: 'tooltips', rangeSelector: 'brush', slider: 'brush' },
    // The prescriptions #3752 wrote in this file's own doc comment, now
    // delivered at the rejection instead of only to whoever reads the source.
    // Two DISTINCT strings on purpose: `guidance` emits one bullet per key
    // verbatim, so a shared sentence prints the same paragraph twice (批 10's
    // `join`/`joinGateway` lesson).
    guidance: {
      zoom:
        '`zoom` was removed in #3752 — no renderer ever had a zoom primitive behind it, and `brush` already narrows the visible range. Write `brush: true`.',
      clickAction:
        '`clickAction` was removed in #3752 — a segment click already has owners that work: the host\'s own `onSegmentClick` in the react tier, `drilldown` on a report (`ReportSchema.drilldown`, ADR-0021 D2, already on by default), and the renderer\'s segment drill under a dashboard widget\'s `options` bag. Use one of those.',
    },
  },
  {
    tooltips: z.boolean().default(true).describe('Show the hover tooltip'),
    brush: z.boolean().default(false).describe('Show the range selector under the plot'),
  },
));

/**
 * Chart segment drill-down — the `<ObjectChart drillDown={…}>` REACT-TIER prop.
 *
 * Clicking a bar / slice / point opens the underlying records, filtered by the
 * click context, in a side drawer (default) or a dialog. Absent means OFF; an
 * empty object `{}` is enough to turn it on.
 *
 * ```jsx
 * <ObjectChart objectName="opportunity"
 *              aggregate={{ function: 'sum', field: 'amount', groupBy: 'stage' }}
 *              drillDown={{ columns: ['name', 'amount'], maxRows: 50 }} />
 * ```
 *
 * ## Which surface this is for
 *
 * This is the react tier only (ADR-0081) — the surface where a chart's config
 * props ARE the flat props the renderer reads. On a DASHBOARD widget there is
 * no per-widget drill configuration at all: an ADR-0021 dataset-bound widget
 * drills through the semantic layer, deriving the drill target and filter from
 * the dataset row that was clicked, and honours none of the keys below. That is
 * why `drillDown` is deliberately NOT a member of `ChartConfigSchema` — writing
 * it inside a widget's `chartConfig` is rejected, with a pointer, rather than
 * accepted-and-ignored (#5022).
 *
 * ## Not to be confused with `ReportSchema.drilldown`
 *
 * Same word, three differences, and they are two unrelated capabilities:
 *
 * - **spelling** — `drillDown` (camelCase) here; `drilldown` (all lowercase) on a report.
 * - **type** — a configuration OBJECT here; a plain BOOLEAN on a report.
 * - **surface** — a react `<ObjectChart>` prop here; a top-level key on
 *   `ReportSchema` there (ADR-0021 D2, on by default, switching row/cell click
 *   drill on or off for a `summary`/`matrix` report).
 *
 * ## Keys that belong to other widgets, not to a chart
 *
 * objectui's renderer carries a wider drill config shared by its table / pivot /
 * metric widgets (`mode`, `report`, and a `target: 'navigate'` arm). A chart
 * reads none of them, so they are not declared here — see the `guidance`
 * entries, which name each one and where it does apply.
 */
export const ChartDrillDownSchema = lazySchema(() => strictObject(
  {
    surface: 'this chart drill-down block',
    history:
      'Until #5022 `drillDown` was not declared anywhere in this protocol at all — objectui\'s ObjectChart read it as an untyped `(schema as any).drillDown`, so every key inside it, right or wrong, reached the renderer unchecked and a misspelling was simply ignored at click time.',
    aliases: {
      enable: 'enabled', on: 'enabled', active: 'enabled',
      where: 'filter', criteria: 'filter', filters: 'filter',
      label: 'title', heading: 'title', drawerTitle: 'title',
      display: 'target', open: 'target', openIn: 'target', presentation: 'target',
      fields: 'columns', columnList: 'columns', select: 'columns',
      limit: 'maxRows', pageSize: 'maxRows', rowLimit: 'maxRows', max: 'maxRows',
    },
    guidance: {
      // The near-key. Bidirectional: `ReportSchema`'s own strict gate carries
      // the mirror of this sentence for an author who writes `drillDown` there.
      drilldown:
        '`drilldown` (all lowercase) is a different capability on a different surface: it is `ReportSchema.drilldown`, a BOOLEAN that switches row/cell drill on a `summary`/`matrix` report (ADR-0021 D2, on by default). The chart\'s drill-down is `drillDown` (camelCase) and takes a configuration OBJECT. If you meant the chart, fix the capital D; if you meant the report, move the key to the report and write `true`/`false`.',
      // Keys of objectui's wider renderer-side drill config. Each is real —
      // on another widget — so a rename suggestion would be actively wrong.
      mode:
        '`mode` (`\'filter\'` | `\'record\'`) is a TABLE / PIVOT / METRIC drill key, not a chart one: it chooses whether a click drills through an aggregate to a filtered list or straight to one record. A chart segment is always an aggregate, so a chart drill is always the filtered-list kind and there is nothing to discriminate. Delete the key.',
      report:
        '`report` (drill into an analytical report instead of the record list) is a METRIC / PIVOT widget capability in the objectui renderer; `<ObjectChart>` does not read it and renders the record list regardless. Delete the key, or drill from a metric widget instead.',
      view:
        '`view` (render a named list view inside the drill drawer) is declared in objectui\'s renderer-side type as reserved and is read by no renderer at all (objectui#3354). It has never done anything — delete it and use `columns` to choose what the drill list shows.',
      sort:
        '`sort` (default ordering for the drill list) is declared in objectui\'s renderer-side type and read by no renderer (objectui#3354). Delete it; the drill list uses the object\'s own default ordering.',
    },
  },
  {
    /**
     * Master switch. OMITTING the whole `drillDown` block is what turns drill
     * off; once the block is present the default is ON, so `{}` enables it and
     * only an explicit `enabled: false` disables it again (which is what you
     * want when the block carries `columns`/`maxRows` you are toggling around).
     */
    enabled: z.boolean().optional()
      .describe('Turn the segment drill on/off; the block being present already means on, so this is only needed to force it off'),

    /**
     * Filter applied to the drilled record list. Every value supports
     * `${event.*}` interpolation against the click payload — a chart click
     * exposes `category` (the raw grouped value), `categoryLabel` (its display
     * label), `series` and `value`.
     *
     * OMIT IT for the common case: with no `filter` the drill derives one from
     * the chart's own grouping (`aggregate.groupBy`, else the x-axis field)
     * equal to the clicked category, which is what a segment click means.
     */
    filter: z.record(z.string(), z.unknown()).optional()
      .describe('Filter for the drilled list; values support ${event.*}. Omit to derive it from the clicked category'),

    /**
     * Drawer/dialog heading. Supports `${event.*}` interpolation
     * (e.g. `'${event.categoryLabel} deals'`). Falls back to the clicked
     * category label, then to the chart's own title.
     */
    title: z.string().optional()
      .describe('Drill drawer/dialog heading; supports ${event.*} interpolation'),

    /**
     * Where the drilled list is rendered. `'drawer'` (default) is an in-place
     * side sheet; `'dialog'` is a centered modal, for when the chart is already
     * inside a drawer and a second sheet would stack badly.
     *
     * There is no `'navigate'` arm here even though objectui's shared renderer
     * type has one: `<ObjectChart>` does not implement it and silently renders
     * the drawer instead (objectui#3354). Escalating to the object's full list
     * page is available anyway, and needs no config — the drill drawer shows an
     * "Open in list" action whenever the host app provides drill navigation.
     */
    target: z.enum(['drawer', 'dialog'], {
      error: (issue) =>
        issue.code === 'invalid_value' && issue.input === 'navigate'
          ? "`drillDown.target: 'navigate'` is not supported by a chart. objectui's shared drill type offers it for the table/pivot/metric widgets, but `<ObjectChart>` does not implement that arm — it renders the drawer regardless (objectui#3354), so declaring it here would promise a jump that never happens. Use 'drawer' (the default) or 'dialog'; the drawer already offers an \"Open in list\" action when the host app wires drill navigation."
          : undefined,
    }).optional()
      .describe("Where the drilled list opens: 'drawer' (default, side sheet) or 'dialog' (centered modal)"),

    /**
     * Whitelist of field names shown as columns in the drilled list, in order.
     * Omit to let the record table pick its default columns.
     */
    columns: z.array(z.string()).optional()
      .describe('Field names to show as columns in the drilled list (default: the table\'s own columns)'),

    /**
     * Page size for the drilled list. The list is paginated, so this caps what
     * one page fetches rather than truncating the result set.
     */
    maxRows: z.number().int().positive().optional()
      .describe('Rows per page in the drilled list'),
  },
));

/**
 * Chart Configuration Base
 * Common configuration for all chart types
 */
export const ChartConfigSchema = lazySchema(() => strictObject(
  {
    surface: 'this chart config',
    history:
      'Until #4001 an undeclared chart key was dropped at parse and the chart rendered with the defaults it was written to override — the failure #4001 exists for, on a shape reachable from both the dashboard and report metadata roots.',
    aliases: {
      // `chartType` is named in `react-blocks.ts` as the INTERNAL spelling that
      // is deliberately NOT part of the author contract, so an author who saw
      // it in a flattened SDUI envelope writes it back here.
      chartType: 'type', kind: 'type', visualization: 'type',
      palette: 'colors', colorScheme: 'colors', colours: 'colors',
      legend: 'showLegend', showLegends: 'showLegend',
      dataLabels: 'showDataLabels', showLabels: 'showDataLabels', labels: 'showDataLabels',
      // Same-file singular/plural split: `annotations` is plural and
      // `interaction` is singular, three lines apart.
      annotation: 'annotations', referenceLines: 'annotations', markers: 'annotations',
      interactions: 'interaction', interactivity: 'interaction',
      caption: 'subtitle', subTitle: 'subtitle',
      accessibility: 'aria', ariaProps: 'aria',
      plotHeight: 'height',
      xAxes: 'xAxis', yAxes: 'yAxis',
    },
    // Wrong-layer pointers. Each names the key the contract LANDS ON, not the
    // one the author typed (#4410's lesson), and none of them promises a slot
    // that does not exist — the check the `drillDown` correction above forced.
    guidance: {
      width:
        '`width` is not a chart-level key: a chart fills its container, and the container\'s width is owned by the dashboard widget\'s `layout.w` (or the report block). Only `height` is chart-level.',
      aggregate:
        '`aggregate` is not part of the chart config. On a DASHBOARD widget the pre-ADR-0021 inline analytics shape was removed — bind a `dataset` and select `dimensions` + `values`. On a react `<ObjectChart>` it is a sibling PROP next to `objectName`, not a key inside the chart config.',
      objectName:
        '`objectName` is not part of the chart config — the data binding lives one level up: `dataset` on a dashboard widget (ADR-0021), or the `objectName` PROP on a react `<ObjectChart>`.',
      dataset:
        '`dataset` is not part of the chart config — it is the dashboard widget\'s own key (ADR-0021), a sibling of `chartConfig`, not a key inside it.',
      data:
        '`data` is not part of the chart config. Inline/precomputed rows are a react-tier `<ObjectChart data={…}>` prop; a metadata chart gets its rows from the widget\'s `dataset` binding.',
      stacked:
        '`stacked` is not a chart-level key, because stacking is not a chart family: it is a property of the SERIES. Give the series that should stack a shared `series[].stack` group id; series without one are grouped.',
      axes:
        '`axes` is not a key — the two axes are declared separately and asymmetrically: `xAxis` is a single axis, `yAxis` is an ARRAY (that is how dual-axis and combo charts are configured).',
      options:
        '`options` is not part of the chart config — renderer-only presentation extras belong in the dashboard widget\'s `options` bag, which is deliberately open for exactly that.',
      // #5022. The one key on this list that IS declared elsewhere in this very
      // file, so the pointer has to name the SURFACE, not just the key — the
      // #4410 lesson. `drillDown` is real (ChartDrillDownSchema) and it is a
      // react-tier PROP; inside a dashboard widget's `chartConfig` it would be
      // parsed-and-ignored, which is the silence this campaign exists to kill.
      drillDown:
        '`drillDown` is not part of the chart config — it is a REACT-TIER prop, written beside `objectName`/`aggregate`: `<ObjectChart objectName="…" drillDown={{ columns: [\'name\'], maxRows: 50 }} />`. On a DASHBOARD widget there is no per-widget drill configuration at all: an ADR-0021 dataset-bound widget drills through the semantic layer (the drill target and filter come from the clicked dataset row), so a `drillDown` written here would parse and then do nothing. On a REPORT the switch is `drilldown` — all lowercase, and a boolean.',
    },
  },
  {
  /** Chart Type */
  type: ChartTypeSchema,

  /** Titles */
  title: I18nLabelSchema.optional().describe('Chart title'),
  subtitle: I18nLabelSchema.optional().describe('Chart subtitle'),
  description: I18nLabelSchema.optional().describe('Accessibility description — announced to screen readers as the chart’s label'),
  
  /** Axes Mapping */
  xAxis: ChartAxisSchema.optional().describe('X-Axis configuration'),
  yAxis: z.array(ChartAxisSchema).optional().describe('Y-Axis configuration (support dual axis)'),
  
  /** Series Configuration */
  series: z.array(ChartSeriesSchema).optional().describe('Defined series configuration'),
  
  /** Appearance. Either a positional palette (string[]) applied per category in
   *  order, or a value→color map ({ value: color }, kanban-style). A value→color
   *  map — and a select/lookup dimension's option colors — take precedence over
   *  the positional palette per category, so semantic charts (health, status)
   *  paint their own colors instead of the generic palette. */
  colors: z.union([
    z.array(z.string()),
    z.record(z.string(), z.string()),
  ]).optional().describe('Color palette (string[]) or value→color map ({ value: color })'),
  height: z.number().optional().describe('Fixed plot height in pixels (overrides the container default)'),
  
  /** Components */
  showLegend: z.boolean().default(true).describe('Display legend'),
  showDataLabels: z.boolean().default(false).describe('Display data labels'),
  
  /** Annotations & Reference Lines */
  annotations: z.array(ChartAnnotationSchema).optional()
    .describe('Reference lines/bands drawn over the plot: { type: "line" | "region", axis: "x" | "y", value, endValue?, color?, label?, style? }'),
  
  /** Interactions */
  interaction: ChartInteractionSchema.optional()
    .describe('Interaction toggles: { tooltips?, brush? }'),

  /** ARIA accessibility attributes */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
  },
));

/**
 * Object-bound chart aggregation
 *
 * A chart binds its data one of two ways: DATASET-bound (ADR-0021 — `dataset`
 * + `dimensions` + `values`), or OBJECT-bound (`objectName` + the inline
 * `aggregate` below, run as one ad-hoc `IDataEngine.aggregate()` call).
 *
 * The two key their result rows DIFFERENTLY, and that difference is the usual
 * cause of a chart that draws axes and no data. `./chart-aggregate.ts` records
 * the object-bound rule and exports the helpers that derive the columns
 * (`chartAggregateResultKeys`) — read it before binding an axis.
 */

// ---------------------------------------------------------------------------
// THE TWO SITES BELOW ARE DELIBERATELY NOT CLOSED (#4001 批 15) — and this is
// a measured verdict, not the batch running out of file.
//
// `ChartAggregateSchema` and `ChartGroupBySchema`'s object arm are the only
// two of this file's seven object sites the 批 15 door measurement could not
// find a PARSE for:
//
//   1. CARRIER KEY — yes, and a LIVE one, which is what makes this different
//      from 批 13's no-door files: `aggregate` is a real authorable prop on the
//      react tier's `<ObjectChart objectName aggregate={…}>` (ADR-0081), it is
//      published in the generated react-blocks contract, and objectui's
//      `ObjectChart` reads `schema.aggregate` to run the query.
//   2. GRAPH — but the carrier is a REACT prop, not a metadata key, so neither
//      schema is reachable from any of the 24 metadata-type roots or from
//      `ObjectStackSchema`. Both come back UNREACHABLE in the same BFS run
//      where the five closed schemas above come back `root-graph`.
//   3. PARSE — nothing in `objectstack`, `objectui` or the example apps calls
//      `.parse()`/`.safeParse()` on either, outside this file's own unit
//      tests. The gate that DOES judge an authored `aggregate` — the react-page
//      publish lint (`packages/lint/src/validate-react-page-props.ts`) —
//      re-derives the rules by hand (`CHART_FUNCTIONS`, the count/field
//      requirement, the result-column naming) and never checks unknown keys.
//      In `react-blocks.ts` the prop is published as a hand-written TYPE
//      STRING; the Zod schema beside it is not what the contract is generated
//      from.
//
// `.strict()` is a property of a PARSE, and there is no parse. Closing these
// two would spend a v17 breaking change to make the file look finished and
// leave behind exactly what the ledger warns about — "a precisely validated
// dead slot is the more convincing lie" (#4583) — except worse than 批 13's
// case, because this vocabulary is not dead: authors write it and the renderer
// runs it. The gap is that no unknown-key gate stands between them, so
// `groupby` / `fn` / `dateGranularty` are silently dropped today and would go
// on being silently dropped after a `strictObject` here.
//
// The contract-first fix is to make the react-page publish gate PARSE this
// schema instead of re-deriving it — a change in `packages/lint`, not a
// strictness change in the spec. Filed rather than smuggled in here.
//
// DO NOT convert these two to `strictObject` before that is decided: it would
// read as load-bearing, and it would make the real gap harder to see.
// ---------------------------------------------------------------------------

/**
 * Aggregation functions an object-bound chart may ask for.
 *
 * A deliberate subset of the engine's `AggregationFunction`: these are the five
 * the chart renderers implement in every path, including the client-side
 * fallback. `count_distinct` / `array_agg` / `string_agg` are engine-level
 * capabilities with no chart renderer behind them — advertising them here would
 * be a declared-but-not-delivered claim (Prime Directive #10).
 */
export const ChartAggregateFunctionSchema = lazySchema(() =>
  z.enum(['count', 'sum', 'avg', 'min', 'max']),
);

/**
 * What the rows are grouped by — the chart's category axis.
 *
 * Either a bare field name, or the structured node the date-bucketing engine
 * takes (`{ field, dateGranularity }`, see `data/query.zod.ts`
 * `GroupByNodeSchema`). Mirrored rather than imported so the UI protocol does
 * not depend on the query AST module; the two shapes are kept identical on
 * purpose — the structured form is passed straight through to
 * `IDataEngine.aggregate()`.
 */
export const ChartGroupBySchema = lazySchema(() =>
  z.union([
    z.string().describe('Field to group by'),
    z.object({
      field: z.string().describe('Field to group by'),
      dateGranularity: z
        .enum(['day', 'week', 'month', 'quarter', 'year'])
        .optional()
        .describe('Bucket date values into uniform periods'),
      alias: z
        .string()
        .optional()
        .describe('Alias for the projected group value (defaults to `field`) — this becomes the category column'),
    }),
  ]),
);

/**
 * Inline aggregation for an OBJECT-bound chart (`objectName` + `aggregate`).
 *
 * `field` is optional only because `count` counts rows rather than a column;
 * every other function needs something to aggregate, which the refinement
 * enforces rather than leaving to a renderer to shrug off (it used to reach the
 * renderer as `sum(undefined)` and render blank).
 */
export const ChartAggregateSchema = lazySchema(() =>
  z
    .object({
      field: z
        .string()
        .optional()
        .describe('Field to aggregate — required for sum/avg/min/max, optional for count'),
      function: ChartAggregateFunctionSchema.describe('Aggregation function'),
      groupBy: ChartGroupBySchema.describe('Field the rows are grouped by — the chart category axis'),
    })
    .superRefine((agg, ctx) => {
      if (agg.function !== 'count' && !agg.field) {
        ctx.addIssue({
          code: 'custom',
          path: ['field'],
          message: `aggregate.function "${agg.function}" needs a "field" to aggregate (only "count" may omit it).`,
        });
      }
    })
    .describe('Inline aggregation for an object-bound chart'),
);

export type ChartConfig = z.infer<typeof ChartConfigSchema>;
export type ChartAggregate = z.infer<typeof ChartAggregateSchema>;
export type ChartAggregateFunction = z.infer<typeof ChartAggregateFunctionSchema>;
export type ChartGroupBy = z.infer<typeof ChartGroupBySchema>;
export type ChartAxis = z.infer<typeof ChartAxisSchema>;
export type ChartSeries = z.infer<typeof ChartSeriesSchema>;
export type ChartAnnotation = z.infer<typeof ChartAnnotationSchema>;
export type ChartInteraction = z.infer<typeof ChartInteractionSchema>;
export type ChartDrillDown = z.infer<typeof ChartDrillDownSchema>;
