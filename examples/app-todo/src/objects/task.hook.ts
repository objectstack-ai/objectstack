// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { HookContext, Hook } from '@objectstack/spec/data';

/**
 * Lifecycle logic for `todo_task` — insert defaults and the completion stamp.
 *
 * ## `ctx.input` is an ENVELOPE, not the record (#7036)
 *
 * The engine builds one context shape per event and the record is always a
 * slot inside it, never the context's own keys:
 *
 *   - `beforeInsert`  → `{ data, options }`          (one context per row)
 *   - `beforeUpdate`  → `{ id, data, options }`
 *   - `afterUpdate`   → `{ id, data, options }`
 *
 * (the contract table on `HookContextSchema.input`, pinned against the real
 * engine in `packages/objectql/src/hook-input-shape-contract.test.ts`). So the
 * record lives at `ctx.input.data`; writing `ctx.input.priority` sets a key on
 * the envelope that no write path ever reads.
 *
 * ## Why the completion stamp is written HERE, and unconditionally
 *
 * `completed_date` is `readonly: true` — a server-owned column. On the update
 * path the engine strips a non-system caller's write to such a column, and
 * `todo_task`'s own `completed_date_required` rule then refused the write for
 * missing exactly the value it had just dropped. That made "Complete task"
 * impossible for an ordinary user (#7036).
 *
 * A hook stamp is the platform's answer, and it works because the strip is
 * deliberately narrow: it runs AFTER the before-hooks and only deletes a key
 * that both (a) the caller supplied and (b) still holds *the caller's own
 * value* (#2948 + #5591 — `stripReadonlyFields`). A value a hook wrote is a
 * platform value and survives.
 *
 * That is also why the stamp below is UNCONDITIONAL rather than
 * `data.completed_date ??= …`: if a caller supplied the key and the hook left
 * it alone, the value would still be the caller's, the strip would delete it,
 * and the rule would refuse the write again — the original bug, restored. The
 * server owning the column means the server writes it on every transition.
 *
 * ## Leaving `completed` clears the stamp
 *
 * Reopening a completed task (completed → in_progress, …) nulls
 * `completed_date`. The field means "when this task was completed", so a task
 * that is not completed must not carry one; retaining it would leave a stale
 * timestamp that every report and list view reads as fact. The same
 * `readonly`/strip reasoning applies — only a hook can write the clear.
 */
const taskHook: Hook = {
  name: 'task_logic',
  object: 'todo_task',
  events: ['beforeInsert', 'beforeUpdate', 'afterUpdate'],
  handler: async (ctx: HookContext) => {
    const data = (ctx.input as { data?: Record<string, unknown> }).data;
    const previous = ctx.previous as Record<string, unknown> | undefined;
    if (!data) return;

    if (ctx.event === 'beforeInsert') {
      // Default priority
      if (!data.priority) {
        data.priority = 'normal';
      }
      // Default status
      if (!data.status) {
        data.status = 'not_started';
      }
      // Validation
      if (typeof data.subject === 'string' && data.subject.includes('spam')) {
        throw new Error('Spam tasks are not allowed');
      }
    }

    if (ctx.event === 'beforeUpdate') {
      // The transition INTO completed — `previous` is the engine's pre-update
      // snapshot, bound before this hook runs, so "is this a transition?" is
      // answerable here without a read of our own.
      if (data.status === 'completed' && previous?.status !== 'completed') {
        data.completed_date = new Date().toISOString();
      }
      // ...and the transition back OUT of it. Guarded on `status` actually
      // being part of this write: an unrelated edit of a completed task
      // (`{ progress_percent: 100 }`) carries no `status` and must not be read
      // as a reopen.
      else if (
        data.status !== undefined &&
        data.status !== 'completed' &&
        previous?.status === 'completed'
      ) {
        data.completed_date = null;
      }
    }

    if (ctx.event === 'afterUpdate') {
      // The kernel's logger, reached through the engine handle the context
      // carries. Not `console`: a hook runs inside the server, so its output
      // belongs on the platform logger, which honours the kernel's configured
      // level (a test booting `{ logger: { level: 'silent' } }` stays silent).
      // `ctx.ql` is declared `unknown` on `HookContextSchema`, hence the cast.
      const logger = (ctx.ql as { logger?: { info?: (message: string) => void } } | undefined)?.logger;

      // Check if completed
      if (data.status === 'completed' && previous && previous.status !== 'completed') {
        logger?.info?.(`Task ${ctx.input.id} completed by ${ctx.session?.userId || 'unknown'}`);
        // Could trigger notifications or integrations here
      }

      // Check if task became overdue
      if (data.is_overdue && previous && !previous.is_overdue) {
        logger?.info?.(`Task ${ctx.input.id} is now overdue`);
      }
    }
  }
};

export default taskHook;
