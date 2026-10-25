// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Catalog of Dashboard widget types — the same set @objectstack/spec
 * publishes for `DashboardWidgetSchema.type`. Used by the Dashboard
 * designer's "Add widget" picker so authors can choose a chart kind
 * up front instead of always starting from `metric` and rebinding.
 *
 * ## Two readers of a type's name (objectui#10804, objectui#10805 folded in)
 *
 * - `labelKey` is what the picker SHOWS: a designer catalogue row
 *   (`engine.widgetPicker.type.*`), read in the designer locale. Its en row is
 *   the English `label` below, word for word.
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
  Database,
  Donut,
  Filter,
  Hash,
  LineChart,
  PieChart,
  ScatterChart,
  Table2,
  TrendingDown,
  type LucideIcon,
} from 'lucide-react';

export type WidgetCategory = 'kpi' | 'chart' | 'data';

export interface WidgetTypeMeta {
  id: string;
  /** English name the stored default `New TYPE` title is written from — never displayed by the picker. */
  label: string;
  /** Designer catalogue key of the name the picker displays (`engine.widgetPicker.type.*`). */
  labelKey: string;
  category: WidgetCategory;
  icon: LucideIcon;
  /** Sensible defaults applied when this widget is added. */
  defaults?: Record<string, unknown>;
}

export const WIDGET_TYPE_META: Record<string, WidgetTypeMeta> = {
  metric: { id: 'metric', label: 'Metric (KPI)', labelKey: 'engine.widgetPicker.type.metric', category: 'kpi', icon: Hash },
  bar: { id: 'bar', label: 'Bar chart', labelKey: 'engine.widgetPicker.type.bar', category: 'chart', icon: BarChart },
  'horizontal-bar': {
    id: 'horizontal-bar',
    label: 'Horizontal bar',
    labelKey: 'engine.widgetPicker.type.horizontalBar',
    category: 'chart',
    icon: BarChart2,
  },
  line: { id: 'line', label: 'Line chart', labelKey: 'engine.widgetPicker.type.line', category: 'chart', icon: LineChart },
  area: { id: 'area', label: 'Area chart', labelKey: 'engine.widgetPicker.type.area', category: 'chart', icon: AreaChart },
  pie: { id: 'pie', label: 'Pie chart', labelKey: 'engine.widgetPicker.type.pie', category: 'chart', icon: PieChart },
  donut: { id: 'donut', label: 'Donut chart', labelKey: 'engine.widgetPicker.type.donut', category: 'chart', icon: Donut },
  scatter: {
    id: 'scatter',
    label: 'Scatter plot',
    labelKey: 'engine.widgetPicker.type.scatter',
    category: 'chart',
    icon: ScatterChart,
  },
  funnel: { id: 'funnel', label: 'Funnel', labelKey: 'engine.widgetPicker.type.funnel', category: 'chart', icon: TrendingDown },
  table: { id: 'table', label: 'Data table', labelKey: 'engine.widgetPicker.type.table', category: 'data', icon: Table2 },
  pivot: { id: 'pivot', label: 'Pivot table', labelKey: 'engine.widgetPicker.type.pivot', category: 'data', icon: Database },
  // NOTE: `list` and `custom` are intentionally absent — they are not members
  // of @objectstack/spec ChartTypeSchema, so a widget authored with them can
  // never publish (framework#3251). Keep this catalog in lockstep with the spec
  // enum so the "Add widget" picker only offers publishable types.
};

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
