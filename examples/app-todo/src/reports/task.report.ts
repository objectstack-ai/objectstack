// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineReport } from '@objectstack/spec/ui';

// ADR-0021 single-form: each report binds the `task_metrics` dataset
// (`dataset` + `rows` + `values`, measures referenced BY NAME). The dual-form
// migration window is over — the legacy inline query form is gone, and the
// former `overdue_tasks` report now lives as a ListView lens on the task
// object (src/views/task.view.ts).

/** Tasks by Status Report */
export const TasksByStatusReport = defineReport({
  name: 'tasks_by_status',
  label: 'Tasks by Status',
  description: 'Summary of tasks grouped by status',
  type: 'summary',
  dataset: 'task_metrics',
  rows: ['status'],
  values: ['task_count'],
});

/** Tasks by Priority Report */
export const TasksByPriorityReport = defineReport({
  name: 'tasks_by_priority',
  label: 'Tasks by Priority',
  description: 'Summary of tasks grouped by priority level',
  type: 'summary',
  dataset: 'task_metrics',
  rows: ['priority'],
  values: ['task_count'],
  runtimeFilter: { status: { $ne: 'completed' } },
});

/** Tasks by Owner Report */
export const TasksByOwnerReport = defineReport({
  name: 'tasks_by_owner',
  label: 'Tasks by Owner',
  description: 'Task summary by assignee',
  type: 'summary',
  dataset: 'task_metrics',
  rows: ['owner'],
  values: ['est_hours', 'actual_hours'],
  runtimeFilter: { status: { $ne: 'completed' } },
});

// ADR-0021 Phase 2: the former `OverdueTasksReport` (a flat record list, no
// grouping/aggregation) is now the `overdue` ListView on todo_task — see
// src/views/task.view.ts. A flat record list is an object-bound row lens
// (ADR-0017), not a dataset report.

/** Completed Tasks Report */
export const CompletedTasksReport = defineReport({
  name: 'completed_tasks',
  label: 'Completed Tasks',
  description: 'All completed tasks with time tracking',
  type: 'summary',
  dataset: 'task_metrics',
  rows: ['category'],
  values: ['est_hours', 'actual_hours'],
  runtimeFilter: { status: 'completed' },
});

/** Time Tracking Report */
export const TimeTrackingReport = defineReport({
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
  runtimeFilter: { status: 'completed' },
});
