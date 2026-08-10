// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Task Action Handlers
 *
 * Example handler implementations for actions defined in task.actions.ts.
 * Each handler is registered via `engine.registerAction()` and referenced
 * by name through the action's `target` field.
 *
 * @example Registration (in a plugin or config bootstrap):
 * ```ts
 * engine.registerAction('todo_task', 'completeTask', completeTask);
 * engine.registerAction('todo_task', 'startTask', startTask);
 * ```
 */

// ─── Handler Context (simplified for example purposes) ──────────────
interface ActionContext {
  /** The record being acted upon */
  record: Record<string, unknown>;
  /** Current authenticated user */
  user: { id: string; name: string };
  /** Data engine for CRUD operations */
  engine: {
    update(object: string, id: string, data: Record<string, unknown>): Promise<void>;
    insert(object: string, data: Record<string, unknown>): Promise<{ id: string }>;
    find(object: string, query: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
    delete(object: string, ids: string[]): Promise<void>;
  };
  /** Action parameters (from user input / params) */
  params?: Record<string, unknown>;
}

/**
 * Mark a single task as complete.
 *
 * [#7036] `status` only. `completed_date` is `readonly` — server-owned — so a
 * caller's write to it is stripped from the payload before the record is
 * validated, and sending it here made this action refuse itself against
 * `todo_task`'s `completed_date_required` rule. The stamp belongs to the
 * `beforeUpdate` leg of `src/objects/task.hook.ts`, which runs on the
 * transition and whose write the strip lets through.
 */
export async function completeTask(ctx: ActionContext): Promise<void> {
  const { record, engine } = ctx;
  await engine.update('todo_task', record.id as string, {
    status: 'completed',
  });
}

/** Mark a task as in-progress */
export async function startTask(ctx: ActionContext): Promise<void> {
  const { record, engine } = ctx;
  await engine.update('todo_task', record.id as string, {
    status: 'in_progress',
  });
}

/** Clone a task (duplicate with reset status) */
export async function cloneTask(ctx: ActionContext): Promise<{ id: string }> {
  const { record, engine } = ctx;
  const { id, created_at, updated_at, completed_date, ...fields } = record as Record<string, unknown>;
  return engine.insert('todo_task', {
    ...fields,
    status: 'not_started',
    subject: `Copy of ${fields.subject ?? 'Untitled'}`,
  });
}

/** Mark all selected tasks as complete (bulk) — same `status`-only rule as {@link completeTask} (#7036) */
export async function massCompleteTasks(ctx: ActionContext): Promise<void> {
  const { params, engine } = ctx;
  const ids = (params?.selectedIds ?? []) as string[];
  for (const id of ids) {
    await engine.update('todo_task', id, {
      status: 'completed',
    });
  }
}

/** Delete all completed tasks */
export async function deleteCompletedTasks(ctx: ActionContext): Promise<void> {
  const { engine } = ctx;
  const completed = await engine.find('todo_task', { status: 'completed' });
  const ids = completed.map((r) => r.id as string);
  if (ids.length > 0) {
    await engine.delete('todo_task', ids);
  }
}

/** Defer a task by updating its due date (params collected by the action dialog) */
export async function deferTask(ctx: ActionContext): Promise<void> {
  const { record, engine, params } = ctx;
  await engine.update('todo_task', record.id as string, {
    due_date: params?.new_due_date ? String(params.new_due_date) : null,
    defer_reason: params?.reason ? String(params.reason) : null,
    status: 'waiting',
  });
}

/** Set a reminder on a task (params collected by the action dialog) */
export async function setReminder(ctx: ActionContext): Promise<void> {
  const { record, engine, params } = ctx;
  await engine.update('todo_task', record.id as string, {
    reminder_date: params?.reminder_date ? String(params.reminder_date) : null,
    has_reminder: true,
  });
}

/** Export tasks to CSV format */
export async function exportTasksToCSV(ctx: ActionContext): Promise<string> {
  const { engine } = ctx;
  const tasks = await engine.find('todo_task', {});
  const header = 'subject,status,priority,category,due_date';
  const rows = tasks.map((t) =>
    [t.subject, t.status, t.priority, t.category, t.due_date ?? ''].join(','),
  );
  return [header, ...rows].join('\n');
}
