// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ChartConfig, ChartType, Dashboard } from '@objectstack/spec/ui';

const taskDs = 'showcase_task_metrics';
const projectDs = 'showcase_project_metrics';

/** Axis fields name the dataset's dimension/measure — query rows are keyed by
 *  measure NAME post-cutover, never the base column (issue #1721). */
const cfg = (type: ChartType, dimension: string, measure: string): ChartConfig => ({
  type,
  xAxis: { field: dimension, showGridLines: true, logarithmic: false },
  yAxis: [{ field: measure, showGridLines: true, logarithmic: false }],
  showLegend: true,
  showDataLabels: false,
});

/**
 * Chart Gallery — one widget per chart family the dashboard renderer can draw
 * DISTINCTLY, so the showcase honestly reflects what the platform implements.
 *
 * Every widget binds a semantic dataset (`showcase_task_metrics` /
 * `showcase_project_metrics`, ADR-0021) and selects dimensions/measures BY NAME;
 * the analytics layer resolves dimension display labels (select option labels,
 * lookup names, month-bucketed dates) and carries each measure's label + format.
 *
 * Only types with a real, distinct renderer are shown. The chart families that
 * currently fall back to a near-relative (grouped/stacked/bi-polar bars → bar,
 * stacked-area → area, step-line/spline → line, pyramid → funnel, bubble →
 * scatter) and the single-value performance variants without a dial
 * (gauge/solid-gauge/bullet, which render the same as `metric`) are intentionally
 * NOT duplicated here — advertising a type that renders as something else is
 * worse than not offering it. (Follow-up: trim those from `ChartTypeSchema`.)
 */
export const ChartGalleryDashboard: Dashboard = {
  name: 'showcase_chart_gallery',
  label: 'Chart Gallery',
  description: 'One widget per chart family the renderer draws distinctly — honest visual coverage.',
  columns: 12,
  widgets: [
    // ── Performance / KPI (one measure value; demonstrates label + format) ──
    { id: 'kpi_total_tasks', type: 'metric', title: 'Total Tasks', dataset: taskDs, values: ['task_count'], layout: { x: 0, y: 0, w: 4, h: 2 } },
    { id: 'kpi_avg_progress', type: 'metric', title: 'Avg Progress', dataset: taskDs, values: ['avg_progress'], layout: { x: 4, y: 0, w: 4, h: 2 } },
    { id: 'kpi_total_spent', type: 'metric', title: 'Total Spent', dataset: projectDs, values: ['spent_sum'], layout: { x: 8, y: 0, w: 4, h: 2 } },

    // ── Comparison ─────────────────────────────────────────────────────────
    { id: 'bar_by_status', type: 'bar', title: 'Tasks by Status', dataset: taskDs, dimensions: ['status'], values: ['task_count'], chartConfig: cfg('bar', 'status', 'task_count'), layout: { x: 0, y: 2, w: 4, h: 4 } },
    { id: 'column_by_priority', type: 'column', title: 'Tasks by Priority', dataset: taskDs, dimensions: ['priority'], values: ['task_count'], chartConfig: cfg('column', 'priority', 'task_count'), layout: { x: 4, y: 2, w: 4, h: 4 } },
    { id: 'hbar_hours', type: 'horizontal-bar', title: 'Hours by Status', dataset: taskDs, dimensions: ['status'], values: ['est_hours'], chartConfig: cfg('horizontal-bar', 'status', 'est_hours'), layout: { x: 8, y: 2, w: 4, h: 4 } },

    // ── Trend (month-bucketed via the dataset's created_at granularity) ──────
    { id: 'line_created', type: 'line', title: 'Tasks Created (monthly)', dataset: taskDs, dimensions: ['created_at'], values: ['task_count'], chartConfig: cfg('line', 'created_at', 'task_count'), layout: { x: 0, y: 6, w: 6, h: 4 } },
    { id: 'area_created', type: 'area', title: 'Tasks Created (area)', dataset: taskDs, dimensions: ['created_at'], values: ['task_count'], chartConfig: cfg('area', 'created_at', 'task_count'), layout: { x: 6, y: 6, w: 6, h: 4 } },

    // ── Mixed — the family `series[].type` and `series[].yAxis` exist for:
    //    a count as bars on the left axis, a rate as a line on the right. ──
    {
      id: 'combo_count_vs_progress',
      type: 'combo',
      title: 'Task Count vs Avg Progress',
      dataset: taskDs,
      dimensions: ['created_at'],
      values: ['task_count', 'avg_progress'],
      chartConfig: {
        type: 'combo',
        xAxis: { field: 'created_at', showGridLines: true, logarithmic: false },
        yAxis: [
          { field: 'task_count', showGridLines: true, logarithmic: false },
          { field: 'avg_progress', showGridLines: false, logarithmic: false },
        ],
        series: [
          { name: 'task_count', label: 'Tasks', type: 'bar', yAxis: 'left' },
          { name: 'avg_progress', label: 'Avg Progress', type: 'line', yAxis: 'right' },
        ],
        showLegend: true,
        showDataLabels: false,
      },
      layout: { x: 0, y: 10, w: 12, h: 4 },
    },

    // ── Distribution ─────────────────────────────────────────────────────────
    { id: 'pie_status', type: 'pie', title: 'Status Split', dataset: taskDs, dimensions: ['status'], values: ['task_count'], chartConfig: cfg('pie', 'status', 'task_count'), layout: { x: 0, y: 14, w: 4, h: 4 } },
    { id: 'donut_priority', type: 'donut', title: 'Priority Split', dataset: taskDs, dimensions: ['priority'], values: ['task_count'], chartConfig: cfg('donut', 'priority', 'task_count'), layout: { x: 4, y: 14, w: 4, h: 4 } },
    { id: 'funnel_status', type: 'funnel', title: 'Status Funnel', dataset: taskDs, dimensions: ['status'], values: ['task_count'], chartConfig: cfg('funnel', 'status', 'task_count'), layout: { x: 8, y: 14, w: 4, h: 4 } },

    // ── Relationship + Advanced ──────────────────────────────────────────────
    { id: 'scatter_estimate', type: 'scatter', title: 'Estimate vs Progress', dataset: taskDs, dimensions: ['progress'], values: ['avg_estimate'], chartConfig: cfg('scatter', 'progress', 'avg_estimate'), layout: { x: 0, y: 18, w: 6, h: 4 } },
    { id: 'radar_priority', type: 'radar', title: 'Priority Radar', dataset: taskDs, dimensions: ['priority'], values: ['task_count'], chartConfig: cfg('radar', 'priority', 'task_count'), layout: { x: 6, y: 18, w: 6, h: 4 } },

    // ── Composition ──────────────────────────────────────────────────────────
    { id: 'treemap_hours', type: 'treemap', title: 'Hours Treemap', dataset: taskDs, dimensions: ['status'], values: ['est_hours'], chartConfig: cfg('treemap', 'status', 'est_hours'), layout: { x: 0, y: 22, w: 6, h: 4 } },
    { id: 'sankey_flow', type: 'sankey', title: 'Status Flow (Sankey)', dataset: taskDs, dimensions: ['status'], values: ['task_count'], chartConfig: cfg('sankey', 'status', 'task_count'), layout: { x: 6, y: 22, w: 6, h: 4 } },

    // ── Tabular (real grouped tables, multiple measures) ─────────────────────
    { id: 'table_projects', type: 'table', title: 'Projects by Account', dataset: projectDs, dimensions: ['account'], values: ['project_count', 'budget_sum', 'spent_sum'], layout: { x: 0, y: 26, w: 6, h: 4 } },
    { id: 'pivot_tasks', type: 'pivot', title: 'Tasks by Status × Priority', dataset: taskDs, dimensions: ['status', 'priority'], values: ['task_count'], layout: { x: 6, y: 26, w: 6, h: 4 } },
  ],
};
