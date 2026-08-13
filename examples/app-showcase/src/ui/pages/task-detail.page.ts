// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * Task Detail — a record page that exercises the record-layout component set
 * beyond the basics:
 *   • `record:path`        — Salesforce-style status stepper across the task
 *                            lifecycle (Backlog → … → Done).
 *   • `record:alert`       — a conditional banner shown only while the task is
 *                            In Review (demonstrates `visible` expressions).
 *   • `record:quick_actions` — object Actions surfaced as inline buttons.
 *   • `record:highlights` + `record:details` — the standard compact + section
 *                            layout.
 * `kind: 'full'` — this page fully owns the record layout (vs the slotted
 * Project page which only overrides the tabs slot).
 */
export const TaskDetailPage = definePage({
  name: 'showcase_task_detail',
  label: 'Task',
  type: 'record',
  object: 'showcase_task',
  kind: 'full',
  template: 'default',
  isDefault: true,
  regions: [
    {
      name: 'main',
      width: 'full',
      components: [
        {
          type: 'record:path',
          properties: {
            statusField: 'status',
            stages: [
              { value: 'backlog', label: 'Backlog' },
              { value: 'todo', label: 'To Do' },
              { value: 'in_progress', label: 'In Progress' },
              { value: 'in_review', label: 'In Review' },
              { value: 'done', label: 'Done', terminal: 'won' },
            ],
          },
        },
        {
          type: 'record:alert',
          properties: {
            severity: 'warning',
            icon: 'eye',
            title: 'Awaiting review',
            body: 'This task is in review — confirm the work before marking it done.',
            visible: "record.status == 'in_review'",
            dismissible: true,
          },
        },
        {
          type: 'record:highlights',
          properties: { fields: ['project', 'assignee', 'priority', 'due_date', 'progress'] },
        },
        {
          type: 'record:quick_actions',
          properties: {
            location: 'record_section',
            align: 'start',
            // showcase_archive_task is the `disabled`-predicate specimen:
            // visible on every task, greyed until `record.done` (contrast with
            // showcase_mark_done's `visible`, which HIDES once done).
            actionNames: ['showcase_mark_done', 'showcase_log_time', 'showcase_archive_task'],
          },
        },
        {
          type: 'record:details',
          properties: {
            sections: [
              // Reuses `objects.showcase_task._sections.{overview,schedule,details}` —
              // the same three names `ui/views/task.view.ts`'s `tabbed` form
              // already declares and `system/translations/index.ts` already
              // translates, so this page's headings resolve in zh-CN with no
              // new bundle entries (#8231).
              { name: 'overview', label: 'Overview', columns: 2, fields: ['title', 'project', 'assignee', 'status', 'priority'] },
              { name: 'schedule', label: 'Schedule', columns: 2, fields: ['start_date', 'end_date', 'due_date', 'estimate_hours'] },
              { name: 'details', label: 'Details', columns: 1, fields: ['labels', 'location', 'notes'] },
            ],
          },
        },
      ],
    },
  ],
});
