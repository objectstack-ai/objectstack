/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Widget-type → dispatch family, shared by every dashboard surface.
 *
 * Three surfaces used to restate this knowledge independently and disagree:
 * `DatasetWidget` covered all 19 `ChartTypeSchema` values, `DashboardRenderer`
 * covered 15, and `DashboardGridLayout` 8. A type the surface didn't name fell
 * through to `{ ...widget }`, whose `type` no component registers — so
 * `SchemaRenderer` rendered a red `role="alert"` panel dumping the widget JSON
 * (#2943).
 *
 * The single-value families were the sharpest case: `DashboardRenderer` already
 * had `METRIC_LIKE_TYPES = ['gauge','solid-gauge','kpi','bullet']` with a
 * docstring saying they "render as a metric card rather than a chart" — and
 * consulted it only to pick a grid span. The tile was sized correctly and the
 * widget was never routed.
 */

import { DASHBOARD_COMPONENT_WIDGET_TYPES } from '@object-ui/types';
import type {
  BaseSchema,
  DashboardComponentSchema,
  DashboardWidgetSchema,
  DashboardWidgetSlotComponentSchema,
  DashboardWidgetTypeName,
  TextSchema,
} from '@object-ui/types';
import { DashboardWidgetSchema as SpecDashboardWidgetSchema } from '@objectstack/spec/ui';
import type { MetricWidgetProps } from './MetricWidget';

/**
 * One entry of a dashboard's `widgets[]`: the slot's element type, a widget or
 * a component node placed directly in the slot (the 2026-08-14 `metric-card`
 * slot ruling, objectstack#8593). Read off `DashboardComponentSchema.widgets`,
 * so it is the slot's own declaration, not a restatement.
 *
 * Every dashboard surface reads `widgets[]` entries by this type
 * (objectui#11514). The widget arm, `DashboardWidgetSchema`, is not a read type
 * for an entry: since objectui#11483's closure its `type` names the widget
 * vocabulary only, so the component arm is not assignable to it.
 *
 * ⛔ A widget key (`dataset`, `options`, `chartConfig`, `filter`, `component`,
 * …) is read on the widget arm alone: narrow the entry with
 * {@link isSlotComponentEntry} first (objectui#11598, N2 A), the read rule
 * `DashboardComponentSchema.widgets` states. The component arm declares none
 * of them, and a component node in the slot draws itself whatever else it
 * carries; reading one off the entry whichever arm it was compiled only through
 * `BaseSchema`'s index signature, which objectui#8347 removed.
 */
export type DashboardWidgetSlotEntry = DashboardComponentSchema['widgets'][number];

/**
 * The widget `type` the spec resolves an ABSENT one to — READ FROM THE SPEC,
 * never restated: `@objectstack/spec`'s `DashboardWidget.type` is
 * `ChartTypeSchema.default(...)`, so parsing an absent `type` through that
 * member returns the spec's own answer (`metric` at 17.5.0). The same reading
 * `@object-ui/core`'s dashboard filters take of the spec's `dateRange` default.
 *
 * objectui's zod mirror strips imported defaults, so a typeless widget reaches
 * the dashboard surfaces unresolved; this is where they resolve it
 * (objectui#11514, Q2 A, 「协议为基准」). Computed on first use: the spec's
 * schemas are lazy.
 */
let specWidgetTypeDefault: DashboardWidgetTypeName | undefined;
export function specDefaultWidgetType(): DashboardWidgetTypeName {
  if (specWidgetTypeDefault === undefined) {
    specWidgetTypeDefault = SpecDashboardWidgetSchema.shape.type.parse(undefined);
  }
  return specWidgetTypeDefault;
}

/**
 * The `type` a dashboard surface draws a `widgets[]` entry as: the authored
 * `type`, or {@link specDefaultWidgetType} when the entry names none
 * (objectui#11514, Q2 A). Every read of an entry's `type` on the two surfaces
 * goes through it — the dispatch, the metric span and chrome, the mobile
 * metric row — so a typeless widget draws exactly as the same widget with
 * `type: 'metric'` does. It used to reach the slot-component passthrough and
 * draw the registry's red OBJUI-001 panel.
 *
 * ⛔ Not for the legacy `component` envelope (`{ id, component, layout }`,
 * objectui's own format, which the spec's widget has no member for). It draws
 * its node, never a family, so the spec's default `type` says nothing about it:
 * an envelope that names no `type` keeps `undefined` here and draws, chrome
 * included, as it always did.
 */
export function resolveWidgetType(entry: DashboardWidgetSlotEntry): DashboardWidgetSlotEntry['type'] {
  if (entry.type !== undefined) return entry.type;
  return entryComponent(entry) ? undefined : specDefaultWidgetType();
}

/**
 * The node an entry's legacy `component` envelope holds, typed as the widget
 * arm declares that member (`DashboardWidgetSchema['component']`), or
 * `undefined` for a component node in the slot.
 *
 * `component` is a widget key, so it is read on the widget arm alone
 * (objectui#11598, N2 A). It used to be read off the entry whichever arm it
 * was: the component arm declares no `component`, so that read went through
 * `BaseSchema`'s index signature, and a `metric-card` entry carrying one (a
 * document the strict face refuses) drew the envelope's node in the card's
 * place.
 */
export function entryComponent(entry: DashboardWidgetSlotEntry): DashboardWidgetSchema['component'] {
  return isSlotComponentEntry(entry) ? undefined : entry.component;
}

/**
 * Whether a slot entry is the component arm, `DashboardWidgetSlotComponentSchema`:
 * its `type` is a member of the closed `DASHBOARD_COMPONENT_WIDGET_TYPES`, which
 * no widget `type` names (objectui#11483). Read at runtime, so a stored entry
 * whose `type` is a string outside every vocabulary is NOT the component arm.
 */
export function isSlotComponentEntry(entry: DashboardWidgetSlotEntry): entry is DashboardWidgetSlotComponentSchema {
  return (DASHBOARD_COMPONENT_WIDGET_TYPES as readonly unknown[]).includes(entry.type);
}

/**
 * The labelled placeholder a dashboard surface draws for a widget `type` it
 * has no renderer for: a known family with no renderer yet
 * (`UNSUPPORTED_CHART_TYPES`), and, since objectui#11514 (Q2 A), a `type` that
 * names no family at all — stale metadata both validator faces refuse at
 * `type`, which used to fall through to the slot-component passthrough and
 * draw the registry's red OBJUI-001 panel dumping the widget. One declaration
 * for both surfaces, which each spelled it out before.
 */
export function unsupportedWidgetSchema(widgetType: string | undefined) {
  return {
    type: 'text',
    content: `「${widgetType}」chart type is not supported yet`,
    variant: 'caption',
    align: 'center',
    className: 'flex h-full w-full items-center justify-center rounded border border-dashed bg-muted/20 p-4 text-muted-foreground',
  } as const satisfies TextSchema;
}

/**
 * Spec chart families that only render as another family. Normalizing them
 * here is what lets one branch serve `column` and `bar` (the spec's own
 * `ChartTypeSchema` comment records the same equivalences).
 */
export const CHART_TYPE_ALIASES: Record<string, string> = {
  column: 'bar',
  'stacked-bar': 'bar',
  'grouped-bar': 'bar',
  'bi-polar-bar': 'bar',
  spline: 'line',
  'step-line': 'line',
  'stacked-area': 'area',
  pyramid: 'funnel',
  bubble: 'scatter',
};

/** Cartesian / categorical / flow families the chart renderer draws. */
const SERIES_CHART_FAMILIES = [
  'bar', 'horizontal-bar', 'line', 'area', 'pie', 'donut',
  'scatter', 'funnel', 'radar', 'treemap', 'sankey',
  // `combo` joined `ChartTypeSchema` in spec 17.0.0-rc.1. The chart renderer
  // has always drawn it (it derives the base family from the series), but it
  // was renderer-local, so nothing routed it from a dashboard surface — a
  // stored `combo` widget fell through to the red "Unknown component type"
  // panel the moment the spec started accepting it.
  'combo',
] as const;

/**
 * A family {@link SERIES_CHART_TYPES} names, as a literal union: the
 * `chartType` a `series` dispatch carries. Each member is one of the families
 * `ObjectChartSchema.chartType` declares (objectui#11513), so the `object-chart`
 * node a surface builds from a dispatch names its family with no cast
 * (objectui#11514). Pinned by `__tests__/dashboard-producer-node-types-11514.test.ts`.
 */
export type SeriesChartFamily = (typeof SERIES_CHART_FAMILIES)[number];

/** Cartesian / categorical / flow families the chart renderer draws. */
export const SERIES_CHART_TYPES: ReadonlySet<string> = new Set<string>(SERIES_CHART_FAMILIES);

/** Whether `family` is a {@link SeriesChartFamily}. */
function isSeriesChartFamily(family: string): family is SeriesChartFamily {
  return SERIES_CHART_TYPES.has(family);
}

/**
 * Single-value "performance" families — one number, optionally against a
 * target. They render as a metric card, which is what the spec's own
 * `ChartTypeSchema` comment calls "honest single-value variants pending a real
 * dial/target renderer". `metric` is the objectui widget spelling of the same
 * thing.
 */
export const METRIC_LIKE_TYPES: ReadonlySet<string> = new Set([
  'metric', 'gauge', 'solid-gauge', 'kpi', 'bullet',
]);

/** Tabular families — a grouped/flat table of records. */
export const TABLE_LIKE_TYPES: ReadonlySet<string> = new Set(['table', 'list']);

/**
 * Chart families with no renderer and no honest approximation (they need
 * richer data — OHLC, per-record distributions — or a geo dependency). Some
 * were dropped from `ChartTypeSchema` entirely; they stay named so stale
 * stored dashboards get a labelled placeholder rather than a red error box.
 */
export const UNSUPPORTED_CHART_TYPES: ReadonlySet<string> = new Set([
  'sunburst', 'word-cloud', 'choropleth', 'bubble-map', 'gl-map',
  'heatmap', 'waterfall', 'box-plot', 'violin', 'candlestick', 'stock',
]);

/** How a dashboard surface should render one widget type. */
export type WidgetDispatchFamily =
  /** A series chart (the resolved base family is in `chartType`). */
  | 'series'
  /** A single-value metric card. */
  | 'metric'
  /** A records table. */
  | 'table'
  /** Cross-tab — dataset-bound only; a non-dataset pivot is stale metadata. */
  | 'pivot'
  /**
   * objectui's legacy `custom` widget. Its `component` envelope draws a
   * `metric-card` and nothing else (objectui#12254); with no `component` it
   * draws the labelled placeholder `unsupported` draws.
   */
  | 'custom'
  /** Known family, no renderer — labelled placeholder. */
  | 'unsupported'
  /** Not a widget vocabulary member — the surface passes it through. */
  | 'passthrough';

export interface WidgetDispatch {
  family: WidgetDispatchFamily;
  /** For `series`: the alias-resolved base family to draw. */
  chartType?: SeriesChartFamily;
}

/**
 * Classify a widget `type` into its dispatch family. Exported for the
 * spec-parity test, which asserts that no `ChartTypeSchema` value lands on
 * `passthrough` (the branch that produces the red box).
 */
export function classifyWidgetType(widgetType: string | undefined): WidgetDispatch {
  if (!widgetType) return { family: 'passthrough' };
  const resolved = CHART_TYPE_ALIASES[widgetType] ?? widgetType;
  if (isSeriesChartFamily(resolved)) return { family: 'series', chartType: resolved };
  if (METRIC_LIKE_TYPES.has(widgetType)) return { family: 'metric' };
  if (TABLE_LIKE_TYPES.has(widgetType)) return { family: 'table' };
  if (widgetType === 'pivot') return { family: 'pivot' };
  if (widgetType === 'custom') return { family: 'custom' };
  if (UNSUPPORTED_CHART_TYPES.has(widgetType)) return { family: 'unsupported' };
  return { family: 'passthrough' };
}

/**
 * The node key a dashboard surface hands `SchemaRenderer` for each component
 * this package registers with `skipFallback: true` (objectui#10859 batch 8,
 * phase 2b, seat ruling M3 option A).
 *
 * `metric` and `metric-card` are two vocabularies that happened to share one
 * spelling: the dashboard WIDGET type (the spec's `ChartTypeSchema` value
 * `metric`; the 2026-08-14 slot ruling's `metric-card`, objectstack#8593) and
 * the internal NODE key the dashboard renders that widget through. The widget
 * vocabulary is untouched. Only the node key moved: the registrations publish
 * `plugin-dashboard:metric` / `plugin-dashboard:metric-card` and no bare
 * fallback, so nothing authors a bare `metric` / `metric-card` NODE that the
 * registry mounts while `objectui validate` refuses it at `type`.
 *
 * ⛔ Both surfaces (`DashboardRenderer`, `DashboardGridLayout`) emit through
 * this table, so they cannot drift apart; a new `skipFallback` registration in
 * this package that a widget can reach gets its row here in the same edit.
 *
 * The values are literal types (objectui#11466), so a node a surface builds
 * under `DASHBOARD_NODE_TYPES.metric` is discriminated by its key and checked
 * against {@link DashboardMetricNodeSchema}, the `CustomNodeRegistry` entry
 * below. A lookup by an authored `type` string goes through the string-keyed
 * view {@link toDashboardNodeType} reads.
 */
export const DASHBOARD_NODE_TYPES = {
  metric: 'plugin-dashboard:metric',
  'metric-card': 'plugin-dashboard:metric-card',
} as const;

/** {@link DASHBOARD_NODE_TYPES} read by an arbitrary `type` string. */
const NODE_TYPE_BY_WIDGET_TYPE: Readonly<Record<string, string>> = DASHBOARD_NODE_TYPES;

/**
 * The `plugin-dashboard:metric` node: what both dashboard surfaces hand
 * `SchemaRenderer` for a `metric` widget drawn inline, and what the `metric`
 * registration (`skipFallback: true`) mounts as `MetricWidget`.
 *
 * Declared in `@object-ui/types`' `CustomNodeRegistry` (objectui#11466, as
 * objectui#11479's Q1 A ruled), the registry an application augments for the
 * node types it registers that `@object-ui/types` does not declare. So the
 * producers name a declared node type, and `SchemaRenderer` takes the node
 * with no cast. The key is this package's: `@object-ui/types` cannot name a
 * plugin's namespace.
 *
 * Its keys are the ones `MetricWidget` reads off the node, typed by that
 * component's props so the two cannot disagree. Host state (`loading`,
 * `error`) and the `onClick` handler are props, ⛔ not node keys.
 */
export interface DashboardMetricNodeSchema extends BaseSchema {
  type: typeof DASHBOARD_NODE_TYPES.metric;
  label: MetricWidgetProps['label'];
  value: MetricWidgetProps['value'];
  description?: MetricWidgetProps['description'];
  trend?: MetricWidgetProps['trend'];
  /** A Lucide icon name. A React element is a host prop, never a node key. */
  icon?: string;
  colorVariant?: MetricWidgetProps['colorVariant'];
  format?: MetricWidgetProps['format'];
  currency?: MetricWidgetProps['currency'];
  prefix?: MetricWidgetProps['prefix'];
  suffix?: MetricWidgetProps['suffix'];
  variant?: MetricWidgetProps['variant'];
}

declare module '@object-ui/types' {
  interface CustomNodeRegistry {
    'plugin-dashboard:metric': DashboardMetricNodeSchema;
  }
}

/**
 * A stored inline metric widget's `options`, without the retired sub-caption
 * key `description` (objectui#11389, ruling C).
 *
 * Both surfaces' metric arms spread a dataset-less widget's `options` onto the
 * {@link DashboardMetricNodeSchema} node, and `MetricWidget` draws the node's
 * `description` as the line under the value. So the spread alone would keep
 * drawing a stored `options.description` as a sub-caption after every read that
 * named it was removed. Both arms drop it here, so the two surfaces cannot
 * disagree about it. The node's own `description` member stays: it is
 * `MetricWidget`'s prop, which a node sets directly, not a key of a dashboard
 * widget's options bag.
 */
export function withoutRetiredSubCaption<T extends Record<string, unknown>>(options: T): Omit<T, 'description'> {
  const { description: _retiredSubCaption, ...rest } = options;
  return rest;
}

/**
 * `node` with its `type` moved onto the namespaced key {@link
 * DASHBOARD_NODE_TYPES} names, or `node` itself when the type has no row.
 *
 * Applied where a surface forwards a node it did not build: the slot-component
 * passthrough (`{ type: 'metric-card', ... }` directly in `widgets[]`) and an
 * author-supplied `widget.component`. Both are widget-vocabulary positions,
 * which keep their spelling; this is the boundary where the widget becomes a
 * node.
 */
export function toDashboardNodeType<T>(node: T): T {
  if (!node || typeof node !== 'object') return node;
  const type = (node as { type?: unknown }).type;
  const moved = typeof type === 'string' ? NODE_TYPE_BY_WIDGET_TYPE[type] : undefined;
  return moved ? { ...node, type: moved } : node;
}
