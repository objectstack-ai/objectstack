// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { I18nLabelSchema, AriaPropsSchema } from './i18n.zod';

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
//    about the output: grouped-bar / stacked-bar / bi-polar-bar (→ bar, no
//    multi-series grouping/stacking), stacked-area (→ area), step-line / spline
//    (→ line), pyramid (→ funnel), bubble (→ scatter, no size encoding).
//
// Both can return via an opt-in renderer once there is a real renderer and a
// data model to back them. (`metric`/`kpi` are kept as honest single-value
// synonyms; `gauge`/`solid-gauge`/`bullet` render a value today and gain a dial
// when a gauge renderer lands.)

export type ChartType = z.infer<typeof ChartTypeSchema>;

/**
 * Chart Axis Schema
 * Definition for X and Y axes
 */
export const ChartAxisSchema = lazySchema(() => z.object({
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
}));

/**
 * Chart Series Schema
 * Defines a single data series in the chart
 */
export const ChartSeriesSchema = lazySchema(() => z.object({
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
}));

/**
 * Chart Annotation Schema
 * Static lines or regions to highlight data
 */
export const ChartAnnotationSchema = lazySchema(() => z.object({
  type: z.enum(['line', 'region']).default('line'),
  axis: z.enum(['x', 'y']).default('y'),
  value: z.union([z.number(), z.string()]).describe('Start value'),
  endValue: z.union([z.number(), z.string()]).optional().describe('End value for regions'),
  color: z.string().optional(),
  label: I18nLabelSchema.optional(),
  style: z.enum(['solid', 'dashed', 'dotted']).default('dashed'),
}));

/**
 * Chart Interaction Schema
 */
export const ChartInteractionSchema = lazySchema(() => z.object({
  tooltips: z.boolean().default(true),
  zoom: z.boolean().default(false),
  brush: z.boolean().default(false),
  clickAction: z.string().optional().describe('Action ID to trigger on click'),
}));

/**
 * Chart Configuration Base
 * Common configuration for all chart types
 */
export const ChartConfigSchema = lazySchema(() => z.object({
  /** Chart Type */
  type: ChartTypeSchema,
  
  /** Titles */
  title: I18nLabelSchema.optional().describe('Chart title'),
  subtitle: I18nLabelSchema.optional().describe('Chart subtitle'),
  description: I18nLabelSchema.optional().describe('Accessibility description'),
  
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
  height: z.number().optional().describe('Fixed height in pixels'),
  
  /** Components */
  showLegend: z.boolean().default(true).describe('Display legend'),
  showDataLabels: z.boolean().default(false).describe('Display data labels'),
  
  /** Annotations & Reference Lines */
  annotations: z.array(ChartAnnotationSchema).optional(),
  
  /** Interactions */
  interaction: ChartInteractionSchema.optional(),

  /** ARIA accessibility attributes */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));

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
