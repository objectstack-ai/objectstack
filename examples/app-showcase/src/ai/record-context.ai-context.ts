// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { AiContext } from '@objectstack/spec/ai';

/**
 * [ADR-0160] Context packs — what `get_record_context` hands an assistant
 * about one record, read as the caller.
 *
 * `showcase_project_brief` is the full shape: the project's own fields (one
 * of them a lookup, so the account's display name is read through it), and
 * its open tasks as a related list: filtered (`where`, on the task's own
 * fields), ordered by due date and cut at ten (`limit`), all inside the one
 * child query read as the caller. `showcase_task_notes`
 * adds a body: a long `notes` text comes back whole, or as an outline whose
 * sections are read one at a time by anchor.
 *
 * A pack never widens a read: a field the caller may not read is left out
 * and the answer says so, a related object the caller may not read
 * refuses the whole call, and a `where` grants nothing — the caller's row
 * rules still decide which rows arrive.
 */
export const ShowcaseProjectBriefContext: AiContext = {
  name: 'showcase_project_brief',
  label: 'Project brief',
  object: 'showcase_project',
  fields: ['name', 'account', 'status', 'health', 'budget', 'spent', 'end_date', 'owner'],
  related: [
    {
      object: 'showcase_task',
      field: 'project',
      fields: ['title', 'status', 'priority', 'due_date', 'assignee'],
      where: { status: { $ne: 'done' } },
      orderBy: [{ field: 'due_date', order: 'asc' }],
      limit: 10,
    },
  ],
};

export const ShowcaseTaskNotesContext: AiContext = {
  name: 'showcase_task_notes',
  label: 'Task with notes',
  object: 'showcase_task',
  fields: ['title', 'project', 'status', 'priority', 'due_date', 'assignee'],
  body: { field: 'notes' },
};
