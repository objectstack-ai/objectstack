// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Action Handler Registration — Todo App
 *
 * Demonstrates the complete lifecycle for wiring action handler functions
 * to their declarative action definitions. This is the bridge between:
 *
 * 1. **Action Definitions** (task.actions.ts) — declarative metadata with
 *    `target` string references (e.g., `target: 'completeTask'`).
 *
 * 2. **Handler Functions** (task.handlers.ts) — actual implementations that
 *    execute business logic (e.g., `async function completeTask(ctx) {...}`).
 *
 * 3. **Registration** (this file) — binds handler functions to the engine so
 *    the runtime can resolve `target` strings to executable code.
 *
 * ## How It Works
 *
 * ObjectStack separates action *declaration* (metadata) from action *execution*
 * (handler). The `defineStack()` config only includes declarative metadata.
 * Handlers are registered at runtime via the plugin lifecycle:
 *
 * ```
 * ┌─────────────────┐    ┌──────────────────┐    ┌────────────────────────┐
 * │ task.actions.ts  │    │ task.handlers.ts  │    │ register-handlers.ts   │
 * │ (metadata)       │    │ (implementation)  │    │ (wiring / lifecycle)   │
 * │                  │    │                   │    │                        │
 * │ target:          │───▶│ export function   │───▶│ engine.registerAction  │
 * │ 'completeTask'   │    │ completeTask()    │    │ ('task','completeTask',│
 * │                  │    │                   │    │  completeTask)         │
 * └─────────────────┘    └──────────────────┘    └────────────────────────┘
 * ```
 *
 * ## When Does Registration Happen?
 *
 * In the ObjectStack kernel lifecycle, the AppPlugin calls `onEnable(ctx)`
 * on each app bundle after the engine is ready. This is where you register
 * action handlers:
 *
 * ```ts
 * // objectstack.config.ts (runtime integration)
 * export const onEnable = (ctx) => registerTaskActionHandlers(ctx.ql);
 * ```
 *
 * @see task.actions.ts — Action metadata definitions
 * @see task.handlers.ts — Handler function implementations
 */

import {
  completeTask,
  startTask,
  cloneTask,
  deferTask,
  setReminder,
  massCompleteTasks,
  deleteCompletedTasks,
  exportTasksToCSV,
} from './task.handlers';

/**
 * Register all task action handlers on the ObjectQL engine.
 *
 * Called during the plugin `onEnable` lifecycle phase when the kernel
 * makes the data engine available to the app.
 *
 * @param engine - The ObjectQL engine instance (from `ctx.ql`)
 *
 * @example Usage in plugin lifecycle:
 * ```ts
 * import { registerTaskActionHandlers } from './src/actions/register-handlers';
 *
 * export const onEnable = async (ctx: { ql: ObjectQL }) => {
 *   registerTaskActionHandlers(ctx.ql);
 * };
 * ```
 */
export function registerTaskActionHandlers(engine: {
  registerAction(objectName: string, actionName: string, handler: (ctx: any) => unknown): void;
}): void {
  // ─── Script-type actions (server-side handlers) ────────────────────
  engine.registerAction('task', 'completeTask', completeTask);
  engine.registerAction('task', 'startTask', startTask);
  engine.registerAction('task', 'cloneTask', cloneTask);
  engine.registerAction('task', 'massCompleteTasks', massCompleteTasks);
  engine.registerAction('task', 'deleteCompletedTasks', deleteCompletedTasks);
  engine.registerAction('task', 'exportTasksToCSV', exportTasksToCSV);

  // ─── Modal-type actions (server-side form submission handlers) ─────
  // These process the params collected by the modal UI before the
  // engine updates the record. The modal target (e.g. 'defer_task_modal')
  // tells the UI which modal page to open; the handler below processes
  // the submitted form data.
  engine.registerAction('task', 'deferTask', deferTask);
  engine.registerAction('task', 'setReminder', setReminder);
}
