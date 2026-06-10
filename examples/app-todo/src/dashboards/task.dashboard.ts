// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Dashboard } from '@objectstack/spec/ui';

/**
 * Task Overview dashboard.
 *
 * ADR-0021 Phase 2: every widget is bound to the `task_metrics` dataset
 * (`dataset` + `dimensions` + `values`, measures/dimensions referenced BY NAME)
 * so the numbers stay consistent with every other surface. The legacy inline
 * query (`object` + `categoryField` + `valueField` + `aggregate` + `filter`) is
 * retained side-by-side during the dual-form window — the reconciliation
 * harness asserts the two forms return identical numbers before the inline
 * form is removed (see scripts/analytics-reconcile). The widget `filter`
 * doubles as the dataset-bound `runtimeFilter` (presentation scope).
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
      filter: { is_completed: true, completed_date: { $gte: '{today}' } },
      dataset: 'task_metrics',
      values: ['task_count'],
      layout: { x: 3, y: 0, w: 3, h: 2 },
      options: { color: '#10B981' }
    },
    {
      id: 'overdue_tasks',
      title: 'Overdue Tasks',
      type: 'metric',
      filter: { is_overdue: true, is_completed: false },
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
    {
      id: 'tasks_by_status',
      title: 'Tasks by Status',
      type: 'pie',
      filter: { is_completed: false },
      dataset: 'task_metrics',
      dimensions: ['status'],
      values: ['task_count'],
      layout: { x: 0, y: 2, w: 6, h: 4 },
      options: { showLegend: true }
    },
    {
      id: 'tasks_by_priority',
      title: 'Tasks by Priority',
      type: 'bar',
      filter: { is_completed: false },
      dataset: 'task_metrics',
      dimensions: ['priority'],
      values: ['task_count'],
      layout: { x: 6, y: 2, w: 6, h: 4 },
      options: { horizontal: true }
    },

    // Row 3: Trends
    {
      id: 'weekly_task_completion',
      title: 'Weekly Task Completion',
      type: 'line',
      filter: { is_completed: true, completed_date: { $gte: '{4_weeks_ago}' } },
      dataset: 'task_metrics',
      dimensions: ['completed_date'],
      values: ['task_count'],
      layout: { x: 0, y: 6, w: 8, h: 4 },
      options: { showDataLabels: true }
    },
    {
      id: 'tasks_by_category',
      title: 'Tasks by Category',
      type: 'donut',
      filter: { is_completed: false },
      dataset: 'task_metrics',
      dimensions: ['category'],
      values: ['task_count'],
      layout: { x: 8, y: 6, w: 4, h: 4 },
      options: { showLegend: true }
    },

    // Row 4: Tables
    {
      id: 'overdue_tasks_table',
      title: 'Overdue Tasks',
      type: 'table',
      filter: { is_overdue: true, is_completed: false },
      dataset: 'task_metrics',
      values: ['task_count'],
      layout: { x: 0, y: 10, w: 6, h: 4 },
    },
    {
      id: 'due_today',
      title: 'Due Today',
      type: 'table',
      filter: { due_date: '{today}', is_completed: false },
      dataset: 'task_metrics',
      values: ['task_count'],
      layout: { x: 6, y: 10, w: 6, h: 4 },
    },
  ],
};
