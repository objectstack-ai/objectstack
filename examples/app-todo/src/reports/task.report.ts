// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ReportInput } from '@objectstack/spec/ui';

// ADR-0021 Phase 2: each report below carries a `task_metrics` dataset binding
// (`dataset` + `rows` + `values`, measures referenced BY NAME) alongside the
// legacy inline query during the dual-form window. The reconciliation harness
// asserts both forms return identical numbers (scripts/analytics-reconcile).
// When the inline form is removed, the detail columns move to a click-through
// drilldown (per the migration decision); `overdue_tasks` becomes a ListView.

/** Tasks by Status Report */
export const TasksByStatusReport: ReportInput = {
  name: 'tasks_by_status',
  label: 'Tasks by Status',
  description: 'Summary of tasks grouped by status',
  type: 'summary',
  dataset: 'task_metrics',
  rows: ['status'],
  values: ['task_count'],
};

/** Tasks by Priority Report */
export const TasksByPriorityReport: ReportInput = {
  name: 'tasks_by_priority',
  label: 'Tasks by Priority',
  description: 'Summary of tasks grouped by priority level',
  type: 'summary',
  dataset: 'task_metrics',
  rows: ['priority'],
  values: ['task_count'],
  runtimeFilter: { is_completed: false },
};

/** Tasks by Owner Report */
export const TasksByOwnerReport: ReportInput = {
  name: 'tasks_by_owner',
  label: 'Tasks by Owner',
  description: 'Task summary by assignee',
  type: 'summary',
  dataset: 'task_metrics',
  rows: ['owner'],
  values: ['est_hours', 'actual_hours'],
  runtimeFilter: { is_completed: false },
};

// ADR-0021 Phase 2: the former `OverdueTasksReport` (a flat record list, no
// grouping/aggregation) is now the `overdue` ListView on todo_task — see
// src/views/task.view.ts. A flat record list is an object-bound row lens
// (ADR-0017), not a dataset report.

/** Completed Tasks Report */
export const CompletedTasksReport: ReportInput = {
  name: 'completed_tasks',
  label: 'Completed Tasks',
  description: 'All completed tasks with time tracking',
  type: 'summary',
  dataset: 'task_metrics',
  rows: ['category'],
  values: ['est_hours', 'actual_hours'],
  runtimeFilter: { is_completed: true },
};

/** Time Tracking Report */
export const TimeTrackingReport: ReportInput = {
  name: 'time_tracking',
  label: 'Time Tracking Report',
  description: 'Estimated vs actual hours analysis',
  type: 'matrix',
  // Matrix: the dataset form flattens rows+across into `rows` for now (cell
  // values are identical); a dataset-bound `columns`/across dimension is a
  // follow-up before single-form convergence.
  dataset: 'task_metrics',
  rows: ['owner', 'category'],
  values: ['est_hours', 'actual_hours'],
  runtimeFilter: { is_completed: true },
};
