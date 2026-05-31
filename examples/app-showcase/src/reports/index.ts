// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Report } from '@objectstack/spec/ui';

const task = 'showcase_task';

/** 1 ── Tabular: a flat list of records. */
export const TaskListReport: Report = {
  name: 'showcase_task_list',
  label: 'Task List (Tabular)',
  description: 'Flat list of all tasks.',
  objectName: task,
  type: 'tabular',
  columns: [
    { field: 'title', label: 'Title' },
    { field: 'project', label: 'Project' },
    { field: 'assignee', label: 'Assignee' },
    { field: 'status', label: 'Status' },
    { field: 'estimate_hours', label: 'Estimate' },
  ],
};

/** 2 ── Summary: grouped down by status with a sum. */
export const HoursByStatusReport: Report = {
  name: 'showcase_hours_by_status',
  label: 'Hours by Status (Summary)',
  description: 'Estimated hours grouped by task status.',
  objectName: task,
  type: 'summary',
  columns: [
    { field: 'status', label: 'Status' },
    { field: 'estimate_hours', label: 'Hours', aggregate: 'sum' },
  ],
  groupingsDown: [{ field: 'status', sortOrder: 'asc' }],
};

/** 3 ── Matrix: status (down) × priority (across) cross-tab. */
export const StatusPriorityMatrixReport: Report = {
  name: 'showcase_status_priority_matrix',
  label: 'Status × Priority (Matrix)',
  description: 'Task counts cross-tabulated by status and priority.',
  objectName: task,
  type: 'matrix',
  columns: [{ field: 'estimate_hours', label: 'Hours', aggregate: 'sum' }],
  groupingsDown: [{ field: 'status', sortOrder: 'asc' }],
  groupingsAcross: [{ field: 'priority', sortOrder: 'asc' }],
};

/** 4 ── Joined: multiple stacked blocks in one report. */
export const TaskOverviewReport: Report = {
  name: 'showcase_task_overview',
  label: 'Task Overview (Joined)',
  description: 'Multiple task sub-reports stacked into one joined view.',
  objectName: task,
  type: 'joined',
  columns: [],
  blocks: [
    {
      name: 'open_block',
      label: 'Open Tasks',
      type: 'summary',
      objectName: task,
      columns: [{ field: 'estimate_hours', label: 'Hours', aggregate: 'sum' }],
      groupingsDown: [{ field: 'status', sortOrder: 'asc' }],
      filter: { done: false },
    },
    {
      name: 'done_block',
      label: 'Completed Tasks',
      type: 'tabular',
      objectName: task,
      columns: [
        { field: 'title', label: 'Title' },
        { field: 'assignee', label: 'Assignee' },
      ],
      filter: { done: true },
    },
  ],
};

export const allReports = [
  TaskListReport,
  HoursByStatusReport,
  StatusPriorityMatrixReport,
  TaskOverviewReport,
];
