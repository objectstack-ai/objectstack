// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0021 (the dataset is the single author-facing analytics shape on the
// dashboard face) + ADR-0049 enforce-or-remove; maintainer ruling 2026-09-12,
// decision batch #121 item 1, verbatim 「同意」. On a dataset-bound widget the
// dataset decides which series exist and which column each one reads, and
// `chartConfig` carries appearance — so this structure key is tombstoned on the
// widget carrier. Each `yAxis[].field` named a plotted measure, which the
// widget's `values` selection already names; the array length also declared
// the secondary axis, which follows from the measures selected.
// Select the measures instead.
// ⚠️ Scoped to THIS carrier. The same key stays authorable on the base
// `ChartConfigSchema` (the react `<ObjectChart data={…}>` tier publishes it in
// that block's `dataProps`, and an inline-data chart has no dataset to derive
// it from) and `ReportChartSchema` keeps its own narrowed `xAxis`/`yAxis`. The
// tombstone therefore registers under `ui/DashboardWidgetChartConfig` only.
// D2: `dashboard-widget-chart-config-structure-removed`; D3 semantic:
// `dashboard-widget-chart-config-structure-refused`.
export const entry = 'ui/DashboardWidgetChartConfig:yAxis';
