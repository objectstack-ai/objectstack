// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Dashboard } from '@objectstack/spec/ui';

const task = 'showcase_task';
const project = 'showcase_project';
const taskDs = 'showcase_task_metrics';
const projectDs = 'showcase_project_metrics';

/**
 * Chart Gallery — one widget per chart family so the dashboard renderer can be
 * exercised against every visualisation type. Covers the full `ChartTypeSchema`
 * taxonomy (comparison, trend, distribution, relationship, composition,
 * performance, tabular) — every type here renders; the taxonomy intentionally
 * excludes families the renderer cannot draw (geo maps, OHLC, distributions).
 *
 * ADR-0021 Phase 2: every widget is bound to a semantic dataset
 * (`showcase_task_metrics` / `showcase_project_metrics`) and selects
 * dimensions/measures BY NAME, side-by-side with the legacy inline query during
 * the dual-form window. The reconciliation harness asserts both forms return
 * identical numbers (scripts/analytics-reconcile). Date-bucketed trend widgets
 * (`created_at` + `categoryGranularity`) stay inline-only for now — dataset
 * timeDimension reconciliation is deferred (see the CRM trend widget).
 */
export const ChartGalleryDashboard: Dashboard = {
  name: 'showcase_chart_gallery',
  label: 'Chart Gallery',
  description: 'A representative widget for every chart family — visual coverage of the dashboard renderer.',
  columns: 12,
  widgets: [
    // ── Performance / KPI ────────────────────────────────────────────────
    { id: 'kpi_total_tasks', type: 'metric', title: 'Total Tasks', dataset: taskDs, values: ['task_count'], layout: { x: 0, y: 0, w: 3, h: 2 } },
    { id: 'kpi_open_tasks', type: 'kpi', title: 'Open Tasks', filter: { done: false }, dataset: taskDs, values: ['task_count'], layout: { x: 3, y: 0, w: 3, h: 2 } },
    { id: 'gauge_progress', type: 'gauge', title: 'Avg Progress', dataset: taskDs, values: ['avg_progress'], layout: { x: 6, y: 0, w: 3, h: 2 } },
    { id: 'bullet_budget', type: 'bullet', title: 'Budget vs Spend', dataset: projectDs, values: ['spent_sum'], layout: { x: 9, y: 0, w: 3, h: 2 } },

    // ── Comparison ───────────────────────────────────────────────────────
    { id: 'bar_by_status', type: 'bar', title: 'Tasks by Status', dataset: taskDs, dimensions: ['status'], values: ['task_count'], layout: { x: 0, y: 2, w: 4, h: 4 } },
    { id: 'column_by_priority', type: 'column', title: 'Tasks by Priority', dataset: taskDs, dimensions: ['priority'], values: ['task_count'], layout: { x: 4, y: 2, w: 4, h: 4 } },
    { id: 'hbar_hours', type: 'horizontal-bar', title: 'Hours by Status', dataset: taskDs, dimensions: ['status'], values: ['est_hours'], layout: { x: 8, y: 2, w: 4, h: 4 } },
    { id: 'stacked_bar', type: 'stacked-bar', title: 'Status × Priority', dataset: taskDs, dimensions: ['status'], values: ['task_count'], layout: { x: 0, y: 6, w: 4, h: 4 } },
    { id: 'grouped_bar', type: 'grouped-bar', title: 'Grouped Status', dataset: taskDs, dimensions: ['status'], values: ['task_count'], layout: { x: 4, y: 6, w: 4, h: 4 } },

    // ── Trend (date-bucketed via timeDimension granularity) ──────────────
    { id: 'line_created', type: 'line', title: 'Tasks Created (monthly)', dataset: taskDs, dimensions: ['created_at'], values: ['task_count'], layout: { x: 8, y: 6, w: 4, h: 4 } },
    { id: 'area_created', type: 'area', title: 'Cumulative (area)', dataset: taskDs, dimensions: ['created_at'], values: ['task_count'], layout: { x: 0, y: 10, w: 4, h: 4 } },
    { id: 'stacked_area', type: 'stacked-area', title: 'Stacked Area', dataset: taskDs, dimensions: ['created_at'], values: ['task_count'], layout: { x: 4, y: 10, w: 4, h: 4 } },
    { id: 'spline_trend', type: 'spline', title: 'Smoothed Trend', dataset: taskDs, dimensions: ['created_at'], values: ['task_count'], layout: { x: 8, y: 10, w: 4, h: 4 } },

    // ── Distribution ─────────────────────────────────────────────────────
    { id: 'pie_status', type: 'pie', title: 'Status Split', dataset: taskDs, dimensions: ['status'], values: ['task_count'], layout: { x: 0, y: 14, w: 3, h: 4 } },
    { id: 'donut_priority', type: 'donut', title: 'Priority Split', dataset: taskDs, dimensions: ['priority'], values: ['task_count'], layout: { x: 3, y: 14, w: 3, h: 4 } },
    { id: 'funnel_pipeline', type: 'funnel', title: 'Task Funnel', dataset: taskDs, dimensions: ['status'], values: ['task_count'], layout: { x: 6, y: 14, w: 3, h: 4 } },
    { id: 'pyramid_priority', type: 'pyramid', title: 'Priority Pyramid', dataset: taskDs, dimensions: ['priority'], values: ['task_count'], layout: { x: 9, y: 14, w: 3, h: 4 } },

    // ── Relationship ─────────────────────────────────────────────────────
    { id: 'scatter_estimate', type: 'scatter', title: 'Estimate vs Progress', dataset: taskDs, dimensions: ['progress'], values: ['avg_estimate'], layout: { x: 0, y: 18, w: 4, h: 4 } },
    { id: 'bubble_budget', type: 'bubble', title: 'Budget Bubble', dataset: projectDs, dimensions: ['account'], values: ['budget_sum'], layout: { x: 4, y: 18, w: 4, h: 4 } },

    // ── Composition ──────────────────────────────────────────────────────
    { id: 'treemap_hours', type: 'treemap', title: 'Hours Treemap', dataset: taskDs, dimensions: ['status'], values: ['est_hours'], layout: { x: 8, y: 18, w: 4, h: 4 } },
    { id: 'sankey_flow', type: 'sankey', title: 'Status Flow (Sankey)', dataset: taskDs, dimensions: ['status'], values: ['task_count'], layout: { x: 0, y: 22, w: 4, h: 4 } },
    { id: 'radar_priority', type: 'radar', title: 'Priority Radar', dataset: taskDs, dimensions: ['priority'], values: ['task_count'], layout: { x: 4, y: 22, w: 4, h: 4 } },

    // ── Performance ──────────────────────────────────────────────────────
    { id: 'solid_gauge', type: 'solid-gauge', title: 'Solid Gauge', dataset: taskDs, values: ['avg_progress'], layout: { x: 8, y: 22, w: 4, h: 4 } },

    // ── Comparison / trend variants ──────────────────────────────────────
    { id: 'bipolar_bar', type: 'bi-polar-bar', title: 'Bi-polar Bar', dataset: taskDs, dimensions: ['status'], values: ['task_count'], layout: { x: 0, y: 26, w: 6, h: 4 } },
    { id: 'step_line', type: 'step-line', title: 'Step Line', dataset: taskDs, dimensions: ['created_at'], values: ['task_count'], layout: { x: 6, y: 26, w: 6, h: 4 } },

    // ── Tabular ──────────────────────────────────────────────────────────
    { id: 'table_projects', type: 'table', title: 'Projects Table', dataset: projectDs, values: ['project_count'], layout: { x: 0, y: 30, w: 6, h: 4 } },
    { id: 'pivot_tasks', type: 'pivot', title: 'Tasks Pivot', dataset: taskDs, dimensions: ['status'], values: ['task_count'], layout: { x: 6, y: 30, w: 6, h: 4 } },
  ],
};
