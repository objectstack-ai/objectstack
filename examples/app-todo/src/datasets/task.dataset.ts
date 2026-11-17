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
  // Each member carries its ADR-0149 D1 business vocabulary. `synonyms` are the
  // words a person types in a question, every language in the one list; they
  // are matched, never translated. `description` is a plain business
  // definition of the member, not an instruction to a model, and IS translated
  // at `datasets.todo_task_metrics.{dimensions,measures}.<member>.description`.
  dimensions: [
    {
      name: 'status',
      label: 'Status',
      field: 'status',
      type: 'string',
      description:
        'Where the task stands in its lifecycle: Not Started, In Progress, Waiting, Completed or Deferred.',
      synonyms: ['task status', 'task state', '任务状态', '状态'],
    },
    {
      name: 'priority',
      label: 'Priority',
      field: 'priority',
      type: 'string',
      description: 'How urgent the task is: Low, Normal, High or Urgent.',
      synonyms: ['urgency', 'importance', '优先级', '紧急程度'],
    },
    {
      name: 'category',
      label: 'Category',
      field: 'category',
      type: 'string',
      description:
        'The area of life the task belongs to: Personal, Work, Shopping, Health, Finance or Other.',
      synonyms: ['task type', 'kind of task', '分类', '任务类别'],
    },
    {
      name: 'owner',
      label: 'Assigned To',
      field: 'owner',
      type: 'lookup',
      description: 'The person the task is assigned to; results show the person by name.',
      synonyms: ['assignee', 'responsible person', '负责人', '指派给'],
    },
    {
      name: 'due_date',
      label: 'Due Date',
      field: 'due_date',
      type: 'date',
      description:
        'The day the task is due; a task that is still not completed after this day is overdue.',
      synonyms: ['deadline', 'due day', '截止日期', '到期日'],
    },
    {
      name: 'completed_date',
      label: 'Completed Date',
      field: 'completed_date',
      type: 'date',
      description:
        'When the task was marked Completed, stamped automatically; it is empty for a task that is not '
        + 'completed and is cleared again when a completed task is reopened.',
      synonyms: ['completion date', 'finished date', '完成日期', '完成时间'],
    },
  ],

  // Aggregatable values — defined ONCE here; every presentation references by name.
  measures: [
    {
      name: 'task_count',
      label: 'Tasks',
      aggregate: 'count',
      description:
        'How many tasks there are, whatever their status: completed and deferred tasks are counted too.',
      synonyms: ['number of tasks', 'task total', '任务数', '任务数量'],
    },
    {
      name: 'est_hours',
      label: 'Estimated Hours',
      aggregate: 'sum',
      field: 'estimated_hours',
      format: '0.0',
      description:
        'The sum of the hours planned for the tasks in Estimated Hours; a task with no estimate adds nothing.',
      synonyms: ['planned hours', 'estimated effort', '预估工时', '预计工时'],
    },
    {
      name: 'actual_hours',
      label: 'Actual Hours',
      aggregate: 'sum',
      field: 'actual_hours',
      format: '0.0',
      description:
        'The sum of the hours actually spent on the tasks, as entered in Actual Hours; a task with no hours '
        + 'entered adds nothing.',
      synonyms: ['hours spent', 'time spent', '实际工时', '已用工时'],
    },
  ],
});
