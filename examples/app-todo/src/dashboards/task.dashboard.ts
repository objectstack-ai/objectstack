// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Dashboard } from '@objectstack/spec/ui';

/**
 * Task Overview dashboard.
 *
 * ADR-0021 single-form: every widget is bound to the `task_metrics` dataset
 * (`dataset` + `dimensions` + `values`, measures/dimensions referenced BY
 * NAME) so the numbers stay consistent with every other surface. The
 * dual-form migration window is over — no widget carries the legacy inline
 * query form. The widget `filter` doubles as the dataset-bound
 * `runtimeFilter` (presentation scope).
 */
export const TaskDashboard: Dashboard = {
  name: 'task_dashboard',
  label: 'Task Overview',
  description: 'Key task metrics and productivity overview',

  widgets: [
    // Row 1: Key Metrics
    {
      id: 'total_tasks',
      title: 'Total Tasks',
      type: 'metric',
      dataset: 'task_metrics',
      values: ['task_count'],
      layout: { x: 0, y: 0, w: 3, h: 2 },
      options: { color: '#3B82F6' }
    },
    {
      id: 'completed_today',
      title: 'Completed Today',
      type: 'metric',
      filter: { status: 'completed', completed_date: { $gte: '{today}' } },
      dataset: 'task_metrics',
      values: ['task_count'],
      layout: { x: 3, y: 0, w: 3, h: 2 },
      options: { color: '#10B981' }
    },
    {
      id: 'overdue_tasks',
      title: 'Overdue Tasks',
      type: 'metric',
      filter: { due_date: { $lt: '{today}' }, status: { $ne: 'completed' } },
      dataset: 'task_metrics',
      values: ['task_count'],
      layout: { x: 6, y: 0, w: 3, h: 2 },
      options: { color: '#EF4444' }
    },
    {
      id: 'completion_rate',
      title: 'Completion Rate',
      type: 'metric',
      filter: { created_at: { $gte: '{current_week_start}' } },
      dataset: 'task_metrics',
      values: ['task_count'],
      layout: { x: 9, y: 0, w: 3, h: 2 },
      options: { suffix: '%', color: '#8B5CF6' }
    },

    // Row 2: Task Distribution
    // chartConfig axis fields name the dataset's dimension/measure — query
    // rows are keyed by measure NAME post-cutover (issue #1721).
    {
      id: 'tasks_by_status',
      title: 'Tasks by Status',
      type: 'pie',
      filter: { status: { $ne: 'completed' } },
      dataset: 'task_metrics',
      dimensions: ['status'],
      values: ['task_count'],
      chartConfig: { type: 'pie', xAxis: { field: 'status', showGridLines: true, logarithmic: false }, yAxis: [{ field: 'task_count', showGridLines: true, logarithmic: false }], showLegend: true, showDataLabels: false },
      layout: { x: 0, y: 2, w: 6, h: 4 },
      options: { showLegend: true }
    },
    {
      id: 'tasks_by_priority',
      title: 'Tasks by Priority',
      type: 'bar',
      filter: { status: { $ne: 'completed' } },
      dataset: 'task_metrics',
      dimensions: ['priority'],
      values: ['task_count'],
      chartConfig: { type: 'bar', xAxis: { field: 'priority', showGridLines: true, logarithmic: false }, yAxis: [{ field: 'task_count', showGridLines: true, logarithmic: false }], showLegend: true, showDataLabels: false },
      layout: { x: 6, y: 2, w: 6, h: 4 },
      options: { horizontal: true }
    },

    // Row 3: Trends
    {
      id: 'weekly_task_completion',
      title: 'Weekly Task Completion',
      type: 'line',
      filter: { status: 'completed', completed_date: { $gte: '{4_weeks_ago}' } },
      dataset: 'task_metrics',
      dimensions: ['completed_date'],
      values: ['task_count'],
      chartConfig: { type: 'line', xAxis: { field: 'completed_date', showGridLines: true, logarithmic: false }, yAxis: [{ field: 'task_count', showGridLines: true, logarithmic: false }], showLegend: true, showDataLabels: false },
      layout: { x: 0, y: 6, w: 8, h: 4 },
      options: { showDataLabels: true }
    },
    {
      id: 'tasks_by_category',
      title: 'Tasks by Category',
      type: 'donut',
      filter: { status: { $ne: 'completed' } },
      dataset: 'task_metrics',
      dimensions: ['category'],
      values: ['task_count'],
      chartConfig: { type: 'donut', xAxis: { field: 'category', showGridLines: true, logarithmic: false }, yAxis: [{ field: 'task_count', showGridLines: true, logarithmic: false }], showLegend: true, showDataLabels: false },
      layout: { x: 8, y: 6, w: 4, h: 4 },
      options: { showLegend: true }
    },

    // The former Row 4 count-only `table` widgets (`overdue_tasks_table`,
    // `due_today`) rendered a single summary row, not the record listing
    // they intended (#1719). Those listings live as ListViews on
    // `todo_task` (`overdue`, `due_today` — ADR-0017), reachable from the
    // app navigation; the `overdue_tasks` / `completed_today` metric
    // widgets above keep the counts.
  ],
};
