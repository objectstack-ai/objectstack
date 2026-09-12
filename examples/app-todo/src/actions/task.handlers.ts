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

import type { ActionHandlerContext } from '@objectstack/spec/ui';

// ─── Handler Context ─────────────────────────────────────
//
// `ActionHandlerContext` (`@objectstack/spec/ui`) is the PUBLISHED contract for
// what an action body reads as `ctx` — `record`, `params`, `user`, `session` and
// the trusted `engine` facade.
//
// What the contract asks for in its own words is `ActionHandler`. That is a
// FUNCTION type, and the handlers below are function DECLARATIONS, which cannot
// carry one; rebinding them as `const cloneTask: ActionHandler = ...` would also
// erase their return types, because `ActionHandler` returns `unknown`. Annotating
// the ctx parameter with `ActionHandlerContext` — the type `ActionHandler` is
// defined in terms of — is the same contract, reached the way this file is
// written.
//
// This file used to declare a local simplified copy of that context instead,
// and the copy drifted: its `find` still took an ObjectQL-shaped `query` bag
// long after the contract had settled on a FILTER (#14175). It existed because
// `ActionEngineFacade.delete` was declared as a single id while the runtime had
// always accepted an id array too, so `deleteCompletedTasks` below could not be
// written against the published type at all. The declaration now says
// `string | string[]` (#15117), so the copy is gone and this example
// type-checks against exactly the types a real app gets.

/**
 * Mark a single task as complete.
 *
 * [#7036] `status` only — and the reason is the opposite of the intuitive one,
 * so read it before copying this handler.
 *
 * `completed_date` is `readonly` on `todo_task` — server-owned — but a
 * handler's `ctx.engine` runs **elevated**: `buildActionExecutionContext`
 * forces `isSystem: true` on every call it makes (#3914), and the engine's
 * read-only strip is gated on *not* being a system write. So on a handler's
 * write the strip never runs at all: **what a handler names, lands**. A
 * server-owned field is therefore MORE dangerous here than in a form PUT, not
 * less — the protection an ordinary caller gets is the one thing a handler
 * does not have.
 *
 * Adding `completed_date: new Date().toISOString()` to the write below looks
 * harmless, and on the transition into `completed` it is: the `beforeUpdate`
 * leg of `src/objects/task.hook.ts` stamps the column and overwrites it. But a
 * completion write that is NOT a transition — re-completing a task that is
 * already `completed`, which is exactly what {@link massCompleteTasks} does to
 * an already-finished row in a bulk selection — is not stamped, and nothing
 * strips the handler's value either. It does not fail: there is no refusal and
 * no dropped-field report, the write simply lands, and the real completion
 * timestamp is silently replaced with "now".
 *
 * Hence `status` alone: let the hook own the column it owns.
 */
export async function completeTask(ctx: ActionHandlerContext): Promise<void> {
  const { record, engine } = ctx;
  await engine.update('todo_task', record.id as string, {
    status: 'completed',
  });
}

/** Mark a task as in-progress */
export async function startTask(ctx: ActionHandlerContext): Promise<void> {
  const { record, engine } = ctx;
  await engine.update('todo_task', record.id as string, {
    status: 'in_progress',
  });
}

/** Clone a task (duplicate with reset status) */
export async function cloneTask(ctx: ActionHandlerContext): Promise<{ id: string }> {
  const { record, engine } = ctx;
  const { id, created_at, updated_at, completed_date, ...fields } = record as Record<string, unknown>;
  return engine.insert('todo_task', {
    ...fields,
    status: 'not_started',
    subject: `Copy of ${fields.subject ?? 'Untitled'}`,
  });
}

/** Mark all selected tasks as complete (bulk) — same `status`-only rule as {@link completeTask} (#7036) */
export async function massCompleteTasks(ctx: ActionHandlerContext): Promise<void> {
  const { params, engine } = ctx;
  const ids = (params?.selectedIds ?? []) as string[];
  for (const id of ids) {
    await engine.update('todo_task', id, {
      status: 'completed',
    });
  }
}

/** Delete all completed tasks */
export async function deleteCompletedTasks(ctx: ActionHandlerContext): Promise<void> {
  const { engine } = ctx;
  const completed = await engine.find('todo_task', { status: 'completed' });
  const ids = completed.map((r) => r.id as string);
  if (ids.length > 0) {
    await engine.delete('todo_task', ids);
  }
}

/** Defer a task by updating its due date (params collected by the action dialog) */
export async function deferTask(ctx: ActionHandlerContext): Promise<void> {
  const { record, engine, params } = ctx;
  await engine.update('todo_task', record.id as string, {
    due_date: params?.new_due_date ? String(params.new_due_date) : null,
    defer_reason: params?.reason ? String(params.reason) : null,
    status: 'waiting',
  });
}

/** Set a reminder on a task (params collected by the action dialog) */
export async function setReminder(ctx: ActionHandlerContext): Promise<void> {
  const { record, engine, params } = ctx;
  await engine.update('todo_task', record.id as string, {
    reminder_date: params?.reminder_date ? String(params.reminder_date) : null,
    has_reminder: true,
  });
}

/** Export tasks to CSV format */
export async function exportTasksToCSV(ctx: ActionHandlerContext): Promise<string> {
  const { engine } = ctx;
  const tasks = await engine.find('todo_task', {});
  const header = 'subject,status,priority,category,due_date';
  const rows = tasks.map((t) =>
    [t.subject, t.status, t.priority, t.category, t.due_date ?? ''].join(','),
  );
  return [header, ...rows].join('\n');
}
