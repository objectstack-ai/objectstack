// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/** The `status` value that means the task is finished — the completion stamp's trigger. */
export const TASK_DONE_STATUS = 'done';

/**
 * sys_task — a task, built into the platform (step 1: no links to records).
 *
 * Every environment carries it, whichever application is installed, so an app
 * puts tasks in its menu with a `type: 'object'` navigation entry naming
 * `sys_task` instead of declaring its own task object:
 * `{ type: 'object', objectName: 'sys_task', requiresObject: 'sys_task' }`.
 * The entry needs `requiresObject` — `defineStack` refuses a menu entry for an
 * object the stack does not declare unless the entry says the object comes
 * from elsewhere. It is an ordinary
 * customizable object: an organization adds fields and views to it, and
 * comments and attachments work on it as on any record (`enable.files` is on;
 * the comment feed is on by default).
 *
 * ## Fields — deliberately few
 *
 * Title, description, status, due time, assignee, and the completion time the
 * platform writes. No priority, recurrence or subtasks: an application that
 * needs one adds the field. There is no link to another record in this step —
 * no target column, no related list — so a task neither grants nor derives
 * access to anything else.
 *
 * ## Who sees a task
 *
 * The object's own sharing, and nothing else:
 *
 *  - `sharingModel: 'private'` over `owner_id` — the creator. The security
 *    plugin stamps an empty `owner_id` with the creating user on insert, so the
 *    creator is the owner unless an owner transfer says otherwise. A `sys_*`
 *    object is never given the injected ownership column, so it is declared
 *    here, in the injected column's shape.
 *  - the assignee, through the `sys_task_assignee` sharing rule this package
 *    declares beside the object (`work/sharing-rules.ts`): a `field` recipient
 *    naming `assignee_id`, so the share follows the assignee when it changes.
 *
 * Anyone else reads a task only through the existing sharing and permission-set
 * machinery (a manual share, an organization's own sharing rule, a set with
 * view-all on the object).
 *
 * ## The completion stamp
 *
 * `completed_at` is read-only and the platform's: `PlatformObjectsPlugin`
 * installs the hook (`work/hooks.ts`) that writes it when `status` becomes
 * `done` and clears it when `status` leaves `done`.
 */
export const SysTask = ObjectSchema.create({
  name: 'sys_task',
  label: 'Task',
  pluralLabel: 'Tasks',
  icon: 'square-check',
  description: 'Things to do, with an assignee and a due time.',
  nameField: 'title',
  highlightFields: ['status', 'due_at', 'assignee_id', 'completed_at'],
  sharingModel: 'private',

  listViews: {
    assigned_to_me: {
      type: 'grid',
      name: 'assigned_to_me',
      label: 'Assigned to Me',
      data: { provider: 'object', object: 'sys_task' },
      columns: ['title', 'status', 'due_at', 'owner_id'],
      filter: [
        { field: 'assignee_id', operator: 'equals', value: '{current_user_id}' },
        { field: 'status', operator: 'not_equals', value: TASK_DONE_STATUS },
      ],
      sort: [{ field: 'due_at', order: 'asc' }],
      pagination: { pageSize: 50 },
      emptyState: { title: 'Nothing assigned to you', message: 'Open tasks assigned to you appear here.' },
    },
    created_by_me: {
      type: 'grid',
      name: 'created_by_me',
      label: 'Created by Me',
      data: { provider: 'object', object: 'sys_task' },
      columns: ['title', 'status', 'due_at', 'assignee_id'],
      filter: [{ field: 'created_by', operator: 'equals', value: '{current_user_id}' }],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
      emptyState: { title: 'No tasks yet', message: 'Tasks you create appear here.' },
    },
    all: {
      type: 'kanban',
      name: 'all',
      label: 'All Tasks',
      data: { provider: 'object', object: 'sys_task' },
      columns: ['title', 'due_at', 'assignee_id'],
      kanban: {
        groupByField: 'status',
        columns: ['title', 'due_at', 'assignee_id'],
      },
    },
  },

  fields: {
    title: Field.text({
      label: 'Title',
      required: true,
      maxLength: 255,
      searchable: true,
    }),

    description: Field.richtext({
      label: 'Description',
    }),

    status: Field.select({
      label: 'Status',
      required: true,
      defaultValue: 'todo',
      options: [
        { label: 'To Do', value: 'todo' },
        { label: 'In Progress', value: 'in_progress', color: 'blue' },
        { label: 'Done', value: TASK_DONE_STATUS, color: 'green' },
      ],
    }),

    due_at: Field.datetime({
      label: 'Due',
    }),

    assignee_id: Field.user({
      label: 'Assignee',
      defaultValue: 'current_user',
    }),

    completed_at: Field.datetime({
      label: 'Completed At',
      readonly: true,
      description: 'Written by the platform when the status becomes Done, and cleared when it leaves Done.',
    }),

    // The owner anchor `sharingModel: 'private'` reads. Declared because a
    // `sys_*` object is never given the injected one; same shape as the
    // injected column (a reassignable lookup to `sys_user`).
    owner_id: Field.lookup('sys_user', {
      label: 'Owner',
    }),
  },

  indexes: [
    { fields: ['assignee_id', 'status'] },
    { fields: ['owner_id'] },
  ],

  enable: {
    files: true,
  },
});
