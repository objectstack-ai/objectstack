// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE registry of the Dashboard widget types Studio offers. Both pickers
 * read it: the designer's "Add widget" menu (`AddWidgetPicker`) and the widget
 * inspector's Type select (`DashboardWidgetInspector`).
 *
 * ## Derived from the spec, never hand-kept (objectstack#26745)
 *
 * The offered SET is `@objectstack/spec`'s `ChartTypeSchema` vocabulary, read
 * at runtime ({@link WIDGET_TYPE_IDS}) — the closed set
 * `DashboardWidgetSchema.type` accepts. The two pickers used to keep their own
 * lists, and drifted: the Add menu offered 11 types, the Type select 10 (no
 * `scatter`) and the spec accepts 20, so nine types every dashboard surface
 * draws had no Studio entry at all.
 *
 * Every spec type is renderable: the spec lists only the chart families the
 * default renderer draws distinctly, and `@object-ui/plugin-dashboard`'s
 * `widget-dispatch-spec-parity.test.ts` refuses a spec type that its dispatch
 * does not route. `AddWidgetPicker.oneRegistry-26745.test.tsx` re-checks that
 * from this side, through the real `DashboardRenderer`.
 *
 * What stays per type is PRESENTATION — its names, category and icon — in
 * {@link WIDGET_TYPE_PRESENTATION}, which is checked against the spec type
 * with `satisfies`: a type the spec adds or retires fails the build here until
 * it is given (or loses) its row. `list` and `custom` are objectui-only widget
 * families with no `ChartTypeSchema` member (`DASHBOARD_WIDGET_TYPE_EXTENSIONS`
 * in `@object-ui/types`), so a widget authored with them can never publish
 * (framework#3251), and the pickers do not offer them.
 *
 * ## Readers of a type's name (objectui#10804, objectui#10805 folded in)
 *
 * - `labelKey` is what the Add menu SHOWS: a designer catalogue row
 *   (`engine.widgetPicker.type.*`), read in the designer locale. Its en row is
 *   the English `label` below, word for word.
 * - `selectLabelKey` is what the inspector's Type select shows
 *   (`engine.inspector.widget.type.*`, objectui#10748).
 * - `label` is what a new widget's default `New TYPE` title is WRITTEN from
 *   (`DashboardDefaultInspector`, `DashboardPreview`). That title is stored
 *   author data, left literal on purpose (the objectui#10678 / objectui#10651
 *   ruling), so `label` stays English in every locale and is never shown by
 *   the picker. The stored `type` is the `id`, which no locale moves.
 */

import {
  Activity,
  AreaChart,
  BarChart,
  BarChart2,
  ChartBarBig,
  ChartColumn,
  ChartNoAxesCombined,
  CircleGauge,
  Database,
  Donut,
  Filter,
  Gauge,
  Hash,
  LayoutGrid,
  LineChart,
  PieChart,
  Radar,
  ScatterChart,
  Table2,
  TrendingDown,
  TrendingUp,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { ChartTypeSchema, type ChartType } from '@objectstack/spec/ui';

export type WidgetCategory = 'kpi' | 'chart' | 'data';

export interface WidgetTypeMeta {
  id: ChartType;
  /** English name the stored default `New TYPE` title is written from — never displayed by the picker. */
  label: string;
  /** Designer catalogue key of the name the Add menu displays (`engine.widgetPicker.type.*`). */
  labelKey: string;
  /** Designer catalogue key of the name the inspector's Type select displays (`engine.inspector.widget.type.*`). */
  selectLabelKey: string;
  category: WidgetCategory;
  icon: LucideIcon;
  /** Sensible defaults applied when this widget is added. */
  defaults?: Record<string, unknown>;
}

/**
 * The widget types Studio offers, in the spec's own order: `ChartTypeSchema`'s
 * vocabulary, read at runtime so this file restates no list of names.
 */
export const WIDGET_TYPE_IDS: readonly ChartType[] = ChartTypeSchema.options;

/**
 * How each spec widget type is presented. Keyed by the spec's `ChartType` and
 * checked with `satisfies`, so it can neither miss a type the spec accepts nor
 * name one it does not.
 */
const WIDGET_TYPE_PRESENTATION = {
  bar: { label: 'Bar chart', labelKey: 'engine.widgetPicker.type.bar', selectLabelKey: 'engine.inspector.widget.type.bar', category: 'chart', icon: BarChart },
  'horizontal-bar': {
    label: 'Horizontal bar',
    labelKey: 'engine.widgetPicker.type.horizontalBar',
    selectLabelKey: 'engine.inspector.widget.type.horizontalBar',
    category: 'chart',
    icon: BarChart2,
  },
  column: { label: 'Column chart', labelKey: 'engine.widgetPicker.type.column', selectLabelKey: 'engine.inspector.widget.type.column', category: 'chart', icon: ChartColumn },
  line: { label: 'Line chart', labelKey: 'engine.widgetPicker.type.line', selectLabelKey: 'engine.inspector.widget.type.line', category: 'chart', icon: LineChart },
  area: { label: 'Area chart', labelKey: 'engine.widgetPicker.type.area', selectLabelKey: 'engine.inspector.widget.type.area', category: 'chart', icon: AreaChart },
  pie: { label: 'Pie chart', labelKey: 'engine.widgetPicker.type.pie', selectLabelKey: 'engine.inspector.widget.type.pie', category: 'chart', icon: PieChart },
  donut: { label: 'Donut chart', labelKey: 'engine.widgetPicker.type.donut', selectLabelKey: 'engine.inspector.widget.type.donut', category: 'chart', icon: Donut },
  funnel: { label: 'Funnel', labelKey: 'engine.widgetPicker.type.funnel', selectLabelKey: 'engine.inspector.widget.type.funnel', category: 'chart', icon: TrendingDown },
  scatter: { label: 'Scatter plot', labelKey: 'engine.widgetPicker.type.scatter', selectLabelKey: 'engine.inspector.widget.type.scatter', category: 'chart', icon: ScatterChart },
  treemap: { label: 'Treemap', labelKey: 'engine.widgetPicker.type.treemap', selectLabelKey: 'engine.inspector.widget.type.treemap', category: 'chart', icon: LayoutGrid },
  sankey: { label: 'Sankey diagram', labelKey: 'engine.widgetPicker.type.sankey', selectLabelKey: 'engine.inspector.widget.type.sankey', category: 'chart', icon: Workflow },
  combo: { label: 'Combo chart', labelKey: 'engine.widgetPicker.type.combo', selectLabelKey: 'engine.inspector.widget.type.combo', category: 'chart', icon: ChartNoAxesCombined },
  gauge: { label: 'Gauge', labelKey: 'engine.widgetPicker.type.gauge', selectLabelKey: 'engine.inspector.widget.type.gauge', category: 'kpi', icon: Gauge },
  'solid-gauge': {
    label: 'Solid gauge',
    labelKey: 'engine.widgetPicker.type.solidGauge',
    selectLabelKey: 'engine.inspector.widget.type.solidGauge',
    category: 'kpi',
    icon: CircleGauge,
  },
  metric: { label: 'Metric (KPI)', labelKey: 'engine.widgetPicker.type.metric', selectLabelKey: 'engine.inspector.widget.type.metric', category: 'kpi', icon: Hash },
  kpi: { label: 'KPI', labelKey: 'engine.widgetPicker.type.kpi', selectLabelKey: 'engine.inspector.widget.type.kpi', category: 'kpi', icon: TrendingUp },
  bullet: { label: 'Bullet chart', labelKey: 'engine.widgetPicker.type.bullet', selectLabelKey: 'engine.inspector.widget.type.bullet', category: 'kpi', icon: ChartBarBig },
  radar: { label: 'Radar chart', labelKey: 'engine.widgetPicker.type.radar', selectLabelKey: 'engine.inspector.widget.type.radar', category: 'chart', icon: Radar },
  table: { label: 'Data table', labelKey: 'engine.widgetPicker.type.table', selectLabelKey: 'engine.inspector.widget.type.table', category: 'data', icon: Table2 },
  pivot: { label: 'Pivot table', labelKey: 'engine.widgetPicker.type.pivot', selectLabelKey: 'engine.inspector.widget.type.pivot', category: 'data', icon: Database },
} satisfies Record<ChartType, Omit<WidgetTypeMeta, 'id'>>;

/** Each offered type's presentation, keyed by the stored `type`. */
export const WIDGET_TYPE_META: Record<string, WidgetTypeMeta> = Object.fromEntries(
  WIDGET_TYPE_IDS.map((id) => [id, { id, ...WIDGET_TYPE_PRESENTATION[id] }]),
);

/** Designer catalogue key of each category heading the picker displays. */
export const WIDGET_CATEGORY_LABEL_KEY: Record<WidgetCategory, string> = {
  kpi: 'engine.widgetPicker.category.kpi',
  chart: 'engine.widgetPicker.category.chart',
  data: 'engine.widgetPicker.category.data',
};

export const WIDGETS_BY_CATEGORY: Array<{ category: WidgetCategory; types: WidgetTypeMeta[] }> = (
  ['kpi', 'chart', 'data'] as WidgetCategory[]
).map((category) => ({
  category,
  types: Object.values(WIDGET_TYPE_META).filter((m) => m.category === category),
}));

export const UnknownWidgetIcon = Activity;
export const FilterIcon = Filter;
