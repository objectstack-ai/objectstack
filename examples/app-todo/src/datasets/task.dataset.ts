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
  // Each member carries `synonyms` (ADR-0149 D1): the words a person types in
  // a question, every language in the one list; they are matched, never
  // translated.
  dimensions: [
    {
      name: 'status',
      label: 'Status',
      field: 'status',
      type: 'string',
      synonyms: ['task status', 'task state', '任务状态', '状态'],
    },
    {
      name: 'priority',
      label: 'Priority',
      field: 'priority',
      type: 'string',
      synonyms: ['urgency', 'importance', '优先级', '紧急程度'],
    },
    {
      name: 'category',
      label: 'Category',
      field: 'category',
      type: 'string',
      synonyms: ['task type', 'kind of task', '分类', '任务类别'],
    },
    {
      name: 'owner',
      label: 'Assigned To',
      field: 'owner',
      type: 'lookup',
      synonyms: ['assignee', 'responsible person', '负责人', '指派给'],
    },
    {
      name: 'due_date',
      label: 'Due Date',
      field: 'due_date',
      type: 'date',
      synonyms: ['deadline', 'due day', '截止日期', '到期日'],
    },
    {
      name: 'completed_date',
      label: 'Completed Date',
      field: 'completed_date',
      type: 'date',
      synonyms: ['completion date', 'finished date', '完成日期', '完成时间'],
    },
  ],

  // Aggregatable values — defined ONCE here; every presentation references by name.
  measures: [
    {
      name: 'task_count',
      label: 'Tasks',
      aggregate: 'count',
      synonyms: ['number of tasks', 'task total', '任务数', '任务数量'],
    },
    {
      name: 'est_hours',
      label: 'Estimated Hours',
      aggregate: 'sum',
      field: 'estimated_hours',
      format: '0.0',
      synonyms: ['planned hours', 'estimated effort', '预估工时', '预计工时'],
    },
    {
      name: 'actual_hours',
      label: 'Actual Hours',
      aggregate: 'sum',
      field: 'actual_hours',
      format: '0.0',
      synonyms: ['hours spent', 'time spent', '实际工时', '已用工时'],
    },
  ],
});
