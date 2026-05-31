// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Dashboard } from '@objectstack/spec/ui';

const task = 'showcase_task';
const project = 'showcase_project';

/**
 * Chart Gallery — one widget per chart family so the dashboard renderer can
 * be exercised against every visualisation type. `type` accepts the full
 * `ChartTypeSchema` taxonomy (38 members); this dashboard covers a
 * representative widget for each category (comparison, trend, distribution,
 * relationship, composition, performance, tabular).
 */
export const ChartGalleryDashboard: Dashboard = {
  name: 'showcase_chart_gallery',
  label: 'Chart Gallery',
  description: 'A representative widget for every chart family — visual coverage of the dashboard renderer.',
  columns: 12,
  widgets: [
    // ── Performance / KPI ────────────────────────────────────────────────
    { id: 'kpi_total_tasks', type: 'metric', title: 'Total Tasks', object: task, aggregate: 'count', layout: { x: 0, y: 0, w: 3, h: 2 } },
    { id: 'kpi_open_tasks', type: 'kpi', title: 'Open Tasks', object: task, aggregate: 'count', filter: { done: false }, layout: { x: 3, y: 0, w: 3, h: 2 } },
    { id: 'gauge_progress', type: 'gauge', title: 'Avg Progress', object: task, aggregate: 'avg', valueField: 'progress', layout: { x: 6, y: 0, w: 3, h: 2 } },
    { id: 'bullet_budget', type: 'bullet', title: 'Budget vs Spend', object: project, aggregate: 'sum', valueField: 'spent', layout: { x: 9, y: 0, w: 3, h: 2 } },

    // ── Comparison ───────────────────────────────────────────────────────
    { id: 'bar_by_status', type: 'bar', title: 'Tasks by Status', object: task, aggregate: 'count', categoryField: 'status', layout: { x: 0, y: 2, w: 4, h: 4 } },
    { id: 'column_by_priority', type: 'column', title: 'Tasks by Priority', object: task, aggregate: 'count', categoryField: 'priority', layout: { x: 4, y: 2, w: 4, h: 4 } },
    { id: 'hbar_hours', type: 'horizontal-bar', title: 'Hours by Status', object: task, aggregate: 'sum', valueField: 'estimate_hours', categoryField: 'status', layout: { x: 8, y: 2, w: 4, h: 4 } },
    { id: 'stacked_bar', type: 'stacked-bar', title: 'Status × Priority', object: task, aggregate: 'count', categoryField: 'status', layout: { x: 0, y: 6, w: 4, h: 4 } },
    { id: 'grouped_bar', type: 'grouped-bar', title: 'Grouped Status', object: task, aggregate: 'count', categoryField: 'status', layout: { x: 4, y: 6, w: 4, h: 4 } },

    // ── Trend ────────────────────────────────────────────────────────────
    { id: 'line_created', type: 'line', title: 'Tasks Created (monthly)', object: task, aggregate: 'count', categoryField: 'created_at', categoryGranularity: 'month', layout: { x: 8, y: 6, w: 4, h: 4 } },
    { id: 'area_created', type: 'area', title: 'Cumulative (area)', object: task, aggregate: 'count', categoryField: 'created_at', categoryGranularity: 'month', layout: { x: 0, y: 10, w: 4, h: 4 } },
    { id: 'stacked_area', type: 'stacked-area', title: 'Stacked Area', object: task, aggregate: 'count', categoryField: 'created_at', categoryGranularity: 'month', layout: { x: 4, y: 10, w: 4, h: 4 } },
    { id: 'spline_trend', type: 'spline', title: 'Smoothed Trend', object: task, aggregate: 'count', categoryField: 'created_at', categoryGranularity: 'week', layout: { x: 8, y: 10, w: 4, h: 4 } },

    // ── Distribution ─────────────────────────────────────────────────────
    { id: 'pie_status', type: 'pie', title: 'Status Split', object: task, aggregate: 'count', categoryField: 'status', layout: { x: 0, y: 14, w: 3, h: 4 } },
    { id: 'donut_priority', type: 'donut', title: 'Priority Split', object: task, aggregate: 'count', categoryField: 'priority', layout: { x: 3, y: 14, w: 3, h: 4 } },
    { id: 'funnel_pipeline', type: 'funnel', title: 'Task Funnel', object: task, aggregate: 'count', categoryField: 'status', layout: { x: 6, y: 14, w: 3, h: 4 } },
    { id: 'pyramid_priority', type: 'pyramid', title: 'Priority Pyramid', object: task, aggregate: 'count', categoryField: 'priority', layout: { x: 9, y: 14, w: 3, h: 4 } },

    // ── Relationship ─────────────────────────────────────────────────────
    { id: 'scatter_estimate', type: 'scatter', title: 'Estimate vs Progress', object: task, aggregate: 'avg', valueField: 'estimate_hours', categoryField: 'progress', layout: { x: 0, y: 18, w: 4, h: 4 } },
    { id: 'bubble_budget', type: 'bubble', title: 'Budget Bubble', object: project, aggregate: 'sum', valueField: 'budget', categoryField: 'account', layout: { x: 4, y: 18, w: 4, h: 4 } },
    { id: 'heatmap_load', type: 'heatmap', title: 'Load Heatmap', object: task, aggregate: 'count', categoryField: 'status', layout: { x: 8, y: 18, w: 4, h: 4 } },

    // ── Composition ──────────────────────────────────────────────────────
    { id: 'treemap_hours', type: 'treemap', title: 'Hours Treemap', object: task, aggregate: 'sum', valueField: 'estimate_hours', categoryField: 'status', layout: { x: 0, y: 22, w: 4, h: 4 } },
    { id: 'sunburst_status', type: 'sunburst', title: 'Status Sunburst', object: task, aggregate: 'count', categoryField: 'status', layout: { x: 4, y: 22, w: 4, h: 4 } },
    { id: 'sankey_flow', type: 'sankey', title: 'Status Flow (Sankey)', object: task, aggregate: 'count', categoryField: 'status', layout: { x: 8, y: 26, w: 4, h: 4 } },
    { id: 'radar_priority', type: 'radar', title: 'Priority Radar', object: task, aggregate: 'count', categoryField: 'priority', layout: { x: 8, y: 22, w: 4, h: 4 } },
    { id: 'waterfall_budget', type: 'waterfall', title: 'Budget Waterfall', object: project, aggregate: 'sum', valueField: 'budget', categoryField: 'status', layout: { x: 0, y: 26, w: 6, h: 4 } },

    // ── Tabular ──────────────────────────────────────────────────────────
    { id: 'table_projects', type: 'table', title: 'Projects Table', object: project, aggregate: 'count', layout: { x: 6, y: 26, w: 6, h: 4 } },
    { id: 'pivot_tasks', type: 'pivot', title: 'Tasks Pivot', object: task, aggregate: 'count', categoryField: 'status', layout: { x: 0, y: 30, w: 12, h: 4 } },

    // ── Remaining chart families (full ChartType coverage) ───────────────
    { id: 'bipolar_bar', type: 'bi-polar-bar', title: 'Bi-polar Bar', object: task, aggregate: 'count', categoryField: 'status', layout: { x: 0, y: 34, w: 3, h: 4 } },
    { id: 'step_line', type: 'step-line', title: 'Step Line', object: task, aggregate: 'count', categoryField: 'created_at', categoryGranularity: 'week', layout: { x: 3, y: 34, w: 3, h: 4 } },
    { id: 'solid_gauge', type: 'solid-gauge', title: 'Solid Gauge', object: task, aggregate: 'avg', valueField: 'progress', layout: { x: 6, y: 34, w: 3, h: 4 } },
    { id: 'word_cloud', type: 'word-cloud', title: 'Label Cloud', object: task, aggregate: 'count', categoryField: 'labels', layout: { x: 9, y: 34, w: 3, h: 4 } },
    { id: 'choropleth', type: 'choropleth', title: 'Choropleth', object: task, aggregate: 'count', categoryField: 'location', layout: { x: 0, y: 38, w: 4, h: 4 } },
    { id: 'bubble_map', type: 'bubble-map', title: 'Bubble Map', object: task, aggregate: 'count', categoryField: 'location', layout: { x: 4, y: 38, w: 4, h: 4 } },
    { id: 'gl_map', type: 'gl-map', title: 'GL Map', object: task, aggregate: 'count', categoryField: 'location', layout: { x: 8, y: 38, w: 4, h: 4 } },
    { id: 'box_plot', type: 'box-plot', title: 'Estimate Box Plot', object: task, aggregate: 'avg', valueField: 'estimate_hours', categoryField: 'status', layout: { x: 0, y: 42, w: 3, h: 4 } },
    { id: 'violin', type: 'violin', title: 'Estimate Violin', object: task, aggregate: 'avg', valueField: 'estimate_hours', categoryField: 'priority', layout: { x: 3, y: 42, w: 3, h: 4 } },
    { id: 'candlestick', type: 'candlestick', title: 'Budget Candlestick', object: project, aggregate: 'sum', valueField: 'budget', categoryField: 'start_date', categoryGranularity: 'month', layout: { x: 6, y: 42, w: 3, h: 4 } },
    { id: 'stock', type: 'stock', title: 'Spend Stock', object: project, aggregate: 'sum', valueField: 'spent', categoryField: 'start_date', categoryGranularity: 'month', layout: { x: 9, y: 42, w: 3, h: 4 } },
  ],
};
