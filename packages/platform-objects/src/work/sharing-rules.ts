// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineSharingRule } from '@objectstack/spec/security';

/**
 * The sharing the platform declares for its built-in task object: a task is
 * shared with its assignee.
 *
 * `sys_task` is `sharingModel: 'private'`, so its owner (the creator) reads it;
 * this rule adds the assignee through the existing record-relative recipient
 * (`sharedWith.type: 'field'`): each task is shared with the user its
 * `assignee_id` names, and the share moves when the assignee changes. Edit
 * access, because the assignee is the person who moves the task along and
 * marks it done.
 *
 * The condition only says "a task with an assignee": a rule whose criteria
 * would match every record is refused by the sharing service, and an empty
 * assignee shares with nobody anyway.
 *
 * Nothing here reaches any other object: a task neither grants nor derives
 * access to another record.
 */
export const SYS_TASK_ASSIGNEE_SHARING_RULE = defineSharingRule({
  name: 'sys_task_assignee',
  label: 'Task assignee',
  description: 'Shares each task with its assignee, who can read and edit it.',
  object: 'sys_task',
  type: 'criteria',
  condition: 'record.assignee_id != null',
  sharedWith: { type: 'field', value: 'assignee_id' },
  accessLevel: 'edit',
});

/** Every sharing rule the work objects declare. */
export const WORK_OBJECT_SHARING_RULES = [SYS_TASK_ASSIGNEE_SHARING_RULE];
