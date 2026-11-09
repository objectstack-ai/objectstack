// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineDataset } from '@objectstack/spec/ui';

/**
 * Task analytics dataset (ADR-0021).
 *
 * The single semantic source of truth for every task metric surfaced on the
 * Task Overview dashboard and reports. `report` / `dashboard` widgets bind to
 * this dataset and select dimensions / measures BY NAME — no inline
 * `object` + `categoryField` + `valueField` + `aggregate` query — so the
 * numbers stay consistent across every surface.
 *
 * Single-object dataset (no `include`): all dimensions/measures live on
 * `todo_task` itself, so it compiles to a plain `groupBy` + `aggregations`
 * query with no joins.
 */
export const TaskDataset = defineDataset({
  name: 'todo_task_metrics',
  label: 'Task Metrics',
  description: 'Semantic layer for task counts and time-tracking measures',
  object: 'todo_task',

  // Groupable axes — referenced by report rows/columns and widget dimensions.
  dimensions: [
    { name: 'status', label: 'Status', field: 'status', type: 'string' },
    { name: 'priority', label: 'Priority', field: 'priority', type: 'string' },
    { name: 'category', label: 'Category', field: 'category', type: 'string' },
    { name: 'owner', label: 'Assigned To', field: 'owner', type: 'lookup' },
    { name: 'due_date', label: 'Due Date', field: 'due_date', type: 'date' },
    { name: 'completed_date', label: 'Completed Date', field: 'completed_date', type: 'date' },
  ],

  // Aggregatable values — defined ONCE here; every presentation references by name.
  measures: [
    { name: 'task_count', label: 'Tasks', aggregate: 'count' },
    { name: 'est_hours', label: 'Estimated Hours', aggregate: 'sum', field: 'estimated_hours', format: '0.0' },
    { name: 'actual_hours', label: 'Actual Hours', aggregate: 'sum', field: 'actual_hours', format: '0.0' },
  ],
});
