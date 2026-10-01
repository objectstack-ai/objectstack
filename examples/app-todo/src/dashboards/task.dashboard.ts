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

  // No widget carries `options`: a dataset-bound widget reads only the keys the
  // spec declares there (`dateGranularity`, `sortBy`, `sortOrder`, `limit`,
  // `stageOrder`) plus the `description` sub-caption, so a presentation key in
  // the bag renders nothing. A tile accent is `colorVariant`, a chart's look is
  // `chartConfig`, and a number's face is the dataset measure's own `format`.
  widgets: [
    // Row 1: Key Metrics
    {
      id: 'total_tasks',
      title: 'Total Tasks',
      type: 'metric',
      dataset: 'task_metrics',
      values: ['task_count'],
      layout: { x: 0, y: 0, w: 3, h: 2 },
    },
    {
      id: 'completed_today',
      title: 'Completed Today',
      type: 'metric',
      filter: { status: 'completed', completed_date: { $gte: '{today}' } },
      dataset: 'task_metrics',
      values: ['task_count'],
      layout: { x: 3, y: 0, w: 3, h: 2 },
    },
    {
      id: 'overdue_tasks',
      title: 'Overdue Tasks',
      type: 'metric',
      filter: { due_date: { $lt: '{today}' }, status: { $ne: 'completed' } },
      dataset: 'task_metrics',
      values: ['task_count'],
      layout: { x: 6, y: 0, w: 3, h: 2 },
    },
    {
      id: 'completion_rate',
      title: 'Completion Rate',
      type: 'metric',
      filter: { created_at: { $gte: '{current_week_start}' } },
      dataset: 'task_metrics',
      values: ['task_count'],
      layout: { x: 9, y: 0, w: 3, h: 2 },
    },

    // Row 2: Task Distribution
    // The widget's `dimensions` / `values` ARE the axis binding: on a
    // dataset-bound widget the dataset decides which series exist and which
    // column each one reads (ADR-0021), so `chartConfig.xAxis` / `.yAxis` /
    // `.series` / `.type` are refused there and the `chartConfig` these
    // widgets carried — which restated those two names and then the schema
    // defaults — is gone.
    {
      id: 'tasks_by_status',
      title: 'Tasks by Status',
      type: 'pie',
      filter: { status: { $ne: 'completed' } },
      dataset: 'task_metrics',
      dimensions: ['status'],
      values: ['task_count'],
      layout: { x: 0, y: 2, w: 6, h: 4 },
    },
    {
      id: 'tasks_by_priority',
      title: 'Tasks by Priority',
      type: 'bar',
      filter: { status: { $ne: 'completed' } },
      dataset: 'task_metrics',
      dimensions: ['priority'],
      values: ['task_count'],
      layout: { x: 6, y: 2, w: 6, h: 4 },
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
      layout: { x: 0, y: 6, w: 8, h: 4 },
    },
    {
      id: 'tasks_by_category',
      title: 'Tasks by Category',
      type: 'donut',
      filter: { status: { $ne: 'completed' } },
      dataset: 'task_metrics',
      dimensions: ['category'],
      values: ['task_count'],
      layout: { x: 8, y: 6, w: 4, h: 4 },
    },

    // The former Row 4 count-only `table` widgets (`overdue_tasks_table`,
    // `due_today`) rendered a single summary row, not the record listing
    // they intended (#1719). Those listings live as ListViews on
    // `todo_task` (`overdue`, `due_today` — ADR-0017), reachable from the
    // app navigation; the `overdue_tasks` / `completed_today` metric
    // widgets above keep the counts.
  ],
};
