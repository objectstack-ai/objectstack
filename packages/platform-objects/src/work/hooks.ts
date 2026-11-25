// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { TASK_DONE_STATUS } from './sys-task.object.js';

/**
 * The platform-owned columns of `sys_task` and `sys_note`, kept by
 * before-write hooks that `PlatformObjectsPlugin` installs on the engine.
 *
 *  - `sys_task.completed_at` — when the task became done: written when
 *    `status` becomes `done`, cleared when `status` leaves `done`.
 *  - `sys_note.heading` — what a list shows: the title, or the body's first
 *    line when the title is empty.
 *
 * ## Why a hook, and why the value is ASSIGNED over the writer's
 *
 * Both columns are `readonly`. On an update the engine strips a non-system
 * caller's write to such a column, but only while the value is still the
 * caller's own (`stripReadonlyFields`): a value a before-hook assigned is the
 * platform's and survives. On an insert the engine's static-`readonly` strip
 * leaves a `sys_*` object to its own guards, so these hooks ARE the guard on a
 * create: they assign the platform's value over whatever the client sent.
 *
 * `ctx.input` is an envelope: the record is `ctx.input.data` (`{ data }` on
 * `beforeInsert`, `{ id, data }` on `beforeUpdate`), and `ctx.previous` is the
 * engine's pre-update snapshot on an update by id.
 */

/** The task's completion stamp for one row being written. Mutates `data` in place. */
export function stampTaskCompletion(
  event: 'beforeInsert' | 'beforeUpdate',
  data: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
  now: () => string = () => new Date().toISOString(),
): void {
  if (event === 'beforeInsert') {
    // A new task is done only if it is created done; anything a client sent
    // for the column is replaced (an insert is not stripped on a `sys_*` object).
    data.completed_at = data.status === TASK_DONE_STATUS ? now() : null;
    return;
  }
  // An update that does not write `status` leaves the stamp alone: an edit of a
  // done task's title is not a reopen, and a caller's own `completed_at` is
  // stripped by the engine as a read-only write.
  if (!Object.prototype.hasOwnProperty.call(data, 'status')) return;
  if (data.status === TASK_DONE_STATUS) {
    // Into done. A task already done keeps the time it was first completed (a
    // caller's own value for the column is stripped as a read-only write); a
    // predicate update has no snapshot to ask, so it stamps the time of this write.
    if (previous?.status === TASK_DONE_STATUS) return;
    data.completed_at = now();
    return;
  }
  // Out of done (or a write of any other status): a task that is not done has
  // no completion time.
  data.completed_at = null;
}

/** Longest heading kept — the column's own `maxLength`. */
const HEADING_MAX_LENGTH = 255;

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

/**
 * The first line of a rich-text body, as plain text: block boundaries become
 * line breaks, markup is dropped, and a leading Markdown marker (heading,
 * bullet, quote) is not part of the line. `null` when the body has no text.
 */
export function firstLineOf(body: unknown): string | null {
  if (typeof body !== 'string' || body.length === 0) return null;
  const text = body
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|h[1-6]|li|blockquote|pre|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, (entity) => ENTITIES[entity] ?? entity);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s*)/, '').trim();
    if (line.length > 0) return [...line].slice(0, HEADING_MAX_LENGTH).join('');
  }
  return null;
}

function nonEmptyTitle(title: unknown): string | null {
  if (typeof title !== 'string') return null;
  const trimmed = title.trim();
  return trimmed.length > 0 ? [...trimmed].slice(0, HEADING_MAX_LENGTH).join('') : null;
}

/** The note's heading for one row being written. Mutates `data` in place. */
export function stampNoteHeading(
  event: 'beforeInsert' | 'beforeUpdate',
  data: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
): void {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(data, key);
  if (event === 'beforeUpdate' && !has('title') && !has('body')) return;
  // On a predicate update there is no snapshot: a side the write leaves out is
  // unknown there, so the heading is only restamped from what the write carries.
  if (event === 'beforeUpdate' && !previous && !(has('title') && has('body'))) {
    if (has('title') && nonEmptyTitle(data.title)) data.heading = nonEmptyTitle(data.title);
    return;
  }
  const title = has('title') ? data.title : previous?.title;
  const body = has('body') ? data.body : previous?.body;
  data.heading = nonEmptyTitle(title) ?? firstLineOf(body);
}

/** The engine slice the hooks register on. */
export interface WorkHookEngine {
  registerHook(
    event: string,
    handler: (ctx: any) => void | Promise<void>,
    options?: { object?: string; packageId?: string },
  ): void;
}

function rowsOf(ctx: any): Record<string, unknown>[] {
  const data = ctx?.input?.data;
  const rows = Array.isArray(data) ? data : [data];
  return rows.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row));
}

/**
 * Install the `sys_task` completion stamp and the `sys_note` heading on the
 * engine, under `packageId` (so an uninstall or a re-bind removes them with
 * the package's other hooks).
 */
export function installWorkObjectHooks(engine: WorkHookEngine, packageId: string): void {
  for (const event of ['beforeInsert', 'beforeUpdate'] as const) {
    engine.registerHook(
      event,
      (ctx: any) => {
        const previous = ctx?.previous && typeof ctx.previous === 'object' ? ctx.previous : undefined;
        for (const row of rowsOf(ctx)) stampTaskCompletion(event, row, previous);
      },
      { object: 'sys_task', packageId },
    );
    engine.registerHook(
      event,
      (ctx: any) => {
        const previous = ctx?.previous && typeof ctx.previous === 'object' ? ctx.previous : undefined;
        for (const row of rowsOf(ctx)) stampNoteHeading(event, row, previous);
      },
      { object: 'sys_note', packageId },
    );
  }
}
