// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A comment thread can be marked resolved, and reopened (#36071, phase 1 of
 * the comments redo #36062).
 *
 * A THREAD is one top-level comment (no `parent_id`) together with its
 * replies. Its resolution lives on the top-level row, as three columns
 * (`objects/sys-comment.object.ts`, "Platform-written: the resolution"):
 *
 *  - `is_resolved` — the one column a caller writes;
 *  - `resolved_by` / `resolved_at` — who resolved it and when, written by the
 *    platform ({@link stampCommentResolution}) and `readonly` to everyone else.
 *
 * What this module owns, and where each part is wired
 * (`installCommentAccessHooks` in `comment-access-hooks.ts` installs all of
 * them):
 *
 *  - **The stamp** ({@link stampCommentResolution}, `beforeUpdate`, every
 *    caller): `is_resolved` turning `true` records the session's user and the
 *    server clock; turning `false` clears both.
 *  - **Who may resolve** ({@link isResolutionOnlyUpdate}; maintainer ruling
 *    record 7063285032, option A): whoever may comment on the record may
 *    resolve and reopen its threads. An update that changes nothing but
 *    `is_resolved` is authorized by the rule that admits a new comment — the
 *    caller can read the record the thread is on — instead of the
 *    author-or-parent-editor rule every other update meets. It is a narrow,
 *    deliberate widening: a reader may flip `is_resolved` on another user's
 *    top-level comment and nothing else; an update that changes any other
 *    field beside it keeps the stricter rule.
 *  - **Only a thread is resolved** ({@link refuseResolutionOnReply}): an
 *    update naming `is_resolved` on a reply is refused, `VALIDATION_ERROR` /
 *    400, its author included.
 *  - **A reply reopens its thread** ({@link installCommentReplyReopens},
 *    `afterInsert`): a reply posted into a resolved thread sets the
 *    top-level comment back to unresolved, as the platform.
 *  - **"Involving me"** ({@link threadsInvolvingUser}): the rule the comment
 *    panel filters a record's loaded thread set by. There is no server-side
 *    query for it: the record page reads a record's whole thread in one read
 *    (`RecordPageDiscussionSchema`, no page size), and the query engine serves
 *    no condition that selects a parent row by its children, which "I replied
 *    to it" needs. A cross-record "involving me" query is its own decision.
 *
 * Resolving or reopening writes no entry on the record's activity tab: a
 * comment's own writes are recorded (audit ledger and an activity row whose
 * parent is the comment, per the maintainer ruling on #30213's comments
 * fork), and the record timeline never draws a row whose parent is a comment.
 */

import type { StandardErrorCode } from '@objectstack/spec/api';
import { parseCommentMentions } from './audit-writers.js';

/** The column a caller writes to resolve or reopen a thread. */
export const COMMENT_RESOLVED_FIELD = 'is_resolved';
/** Who resolved the thread: the platform's, `readonly`. */
export const COMMENT_RESOLVED_BY_FIELD = 'resolved_by';
/** When the thread was resolved: the platform's, `readonly`. */
export const COMMENT_RESOLVED_AT_FIELD = 'resolved_at';

/** The object a thread's comments are rows of. */
const COMMENT_OBJECT = 'sys_comment';

const SYSTEM_CTX = { isSystem: true } as const;

/** The catalog member for an update that names `is_resolved` on a reply (ADR-0112): the request's shape is refused. */
const RESOLUTION_ON_REPLY_CODE: StandardErrorCode = 'VALIDATION_ERROR';

/** How many `parent_id` hops a reply is followed up to find its thread's top-level comment. */
const THREAD_ROOT_MAX_HOPS = 16;

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Whether an update's payload names `is_resolved`. */
export function namesResolution(data: unknown): data is Record<string, unknown> {
  return !!data && typeof data === 'object' && !Array.isArray(data) && hasOwn(data, COMMENT_RESOLVED_FIELD);
}

/**
 * The keys an update may carry beside `is_resolved` and still be a
 * resolution-only update: the row's address and the platform's own stamps
 * (the engine's `updated_at` / `updated_by`, this module's `resolved_by` /
 * `resolved_at`). A caller's value for any of the stamps never lands either
 * way: the engine strips a non-system caller's `readonly` values.
 */
const RESOLUTION_ONLY_COMPANION_KEYS: ReadonlySet<string> = new Set([
  'id',
  'updated_at',
  'updated_by',
  COMMENT_RESOLVED_BY_FIELD,
  COMMENT_RESOLVED_AT_FIELD,
]);

/**
 * Whether an update changes nothing but a thread's resolution: it names
 * `is_resolved`, and every other key it carries is the row's address or a
 * platform stamp ({@link RESOLUTION_ONLY_COMPANION_KEYS}).
 */
export function isResolutionOnlyUpdate(data: unknown): boolean {
  if (!namesResolution(data)) return false;
  return Object.keys(data).every((k) => k === COMMENT_RESOLVED_FIELD || RESOLUTION_ONLY_COMPANION_KEYS.has(k));
}

/** Whether a stored comment row is a reply (it names a parent comment). */
export function isReplyRow(row: Record<string, unknown>): boolean {
  const parent = row.parent_id;
  return parent !== undefined && parent !== null && String(parent) !== '';
}

/**
 * Refuse an update naming `is_resolved` when any matched row is a reply:
 * a thread is resolved on its top-level comment, never on one reply.
 * `VALIDATION_ERROR` / 400, the ADR-0112 envelope.
 */
export function refuseResolutionOnReply(rows: ReadonlyArray<Record<string, unknown>>): void {
  const reply = rows.find(isReplyRow);
  if (!reply) return;
  const err = new Error(
    `Cannot change is_resolved on comment ${String(reply.id)}: it is a reply. A thread is resolved or reopened ` +
      'on its top-level comment (the one with no parent_id), which resolves every reply under it.',
  ) as Error & { code: string; statusCode: number; status: number; field: string };
  err.code = RESOLUTION_ON_REPLY_CODE;
  err.statusCode = 400;
  err.status = 400;
  err.field = COMMENT_RESOLVED_FIELD;
  throw err;
}

/**
 * The platform writes who resolved a thread and when (`beforeUpdate`, every
 * caller — the stamp records what happened, not who was allowed to do it; the
 * authorization handler is separate and exempts system callers).
 *
 * - `is_resolved` turning `true`: `resolved_by` = the session's user (`null`
 *   for a write with no user, such as a system one), `resolved_at` = the
 *   server clock.
 * - turning `false`: both cleared.
 * - unchanged (the stored row already carries that value): nothing stamped,
 *   so resolving an already-resolved thread keeps its first resolver.
 *
 * Why an assignment is enough: the engine hides a non-system caller's
 * `readonly` values from the hooks, strips them after, and keeps a value a
 * hook assigned. A `preserveAudit` write (a historical import) keeps values it
 * supplies. A predicate update whose rows disagree (some already resolved,
 * some not) is refused whole by the engine (`MULTI_UPDATE_HOOK_KEY_DIVERGENCE`,
 * 400), as the body-edit stamp's is: one SET clause cannot stamp some rows only.
 */
export async function stampCommentResolution(ctx: any): Promise<void> {
  const data: unknown = ctx?.input?.data;
  if (!namesResolution(data)) return;
  const next = data[COMMENT_RESOLVED_FIELD];
  if (typeof next !== 'boolean') return; // the record validator answers a non-boolean
  const previous: unknown = ctx?.previous;
  if (previous && typeof previous === 'object') {
    const stored = (previous as Record<string, unknown>)[COMMENT_RESOLVED_FIELD] === true;
    if (stored === next) return;
  }
  const preserve = ctx?.session?.preserveAudit === true;
  const assign = (key: string, value: unknown) => {
    if (preserve && data[key] !== undefined) return;
    data[key] = value;
  };
  if (next) {
    const userId: unknown = ctx?.session?.userId;
    assign(
      COMMENT_RESOLVED_BY_FIELD,
      (typeof userId === 'string' || typeof userId === 'number') && String(userId) !== '' ? String(userId) : null,
    );
    assign(COMMENT_RESOLVED_AT_FIELD, new Date().toISOString());
  } else {
    assign(COMMENT_RESOLVED_BY_FIELD, null);
    assign(COMMENT_RESOLVED_AT_FIELD, null);
  }
}

/**
 * A new comment is an unresolved one: the create-side counterpart of the
 * stamp, for a non-system create. The engine leaves a `sys_` object's
 * `readonly` columns to its own guards on create, so a client's
 * `resolved_by` / `resolved_at` are cleared here, and `is_resolved` is set to
 * `false` over a client's value. Only keys the client named are touched; an
 * absent one takes the column's default.
 */
export function clearClientResolution(data: Record<string, unknown>): void {
  if (hasOwn(data, COMMENT_RESOLVED_FIELD)) data[COMMENT_RESOLVED_FIELD] = false;
  if (hasOwn(data, COMMENT_RESOLVED_BY_FIELD)) data[COMMENT_RESOLVED_BY_FIELD] = null;
  if (hasOwn(data, COMMENT_RESOLVED_AT_FIELD)) data[COMMENT_RESOLVED_AT_FIELD] = null;
}

/** The engine surface the reopen hook reads and writes through. */
export interface CommentReopenEngine {
  registerHook(event: string, handler: (ctx: any) => void | Promise<void>, options?: { object?: string; packageId?: string }): void;
  findOne(object: string, options: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  update?(object: string, data: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown>;
}

/** The logger the reopen hook reports a failed reopen on. */
export interface CommentReopenLogger {
  warn(msg: string, meta?: unknown): void;
  error?(msg: string, meta?: unknown): void;
}

/**
 * The top-level comment of the thread a reply is in: `parent_id` followed up
 * (system reads, so the caller's read scope cannot hide the thread from the
 * platform's own bookkeeping) until a row with no parent. `null` when the
 * chain is broken (a parent that no longer exists) or longer than
 * {@link THREAD_ROOT_MAX_HOPS}.
 */
async function threadRootOf(
  engine: CommentReopenEngine,
  reply: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  let current: Record<string, unknown> = reply;
  for (let hop = 0; hop < THREAD_ROOT_MAX_HOPS; hop++) {
    if (!isReplyRow(current)) return current;
    const parent = await engine.findOne(COMMENT_OBJECT, { where: { id: current.parent_id }, context: { ...SYSTEM_CTX } });
    if (!parent) return null;
    current = parent;
  }
  return null;
}

/**
 * A reply reopens its thread: after a reply is written into a thread whose
 * top-level comment is resolved, the platform sets that comment back to
 * unresolved (a system update; the stamp clears `resolved_by` / `resolved_at`).
 * Every caller's reply reopens, except a `preserveAudit` write (a historical
 * import), which brings rows as they were.
 *
 * A reopen that fails leaves a reply stored under a thread that still reads
 * resolved, hidden from the default list, while the write answered success:
 * that is reported at `error` with the consequence and the fix. The reply
 * itself stands.
 */
export function installCommentReplyReopens(
  engine: CommentReopenEngine,
  logger: CommentReopenLogger,
  opts: { packageId: string },
): void {
  engine.registerHook(
    'afterInsert',
    async (ctx: any) => {
      if (ctx?.session?.preserveAudit === true) return;
      const row: unknown = ctx?.result;
      if (!row || typeof row !== 'object' || !isReplyRow(row as Record<string, unknown>)) return;
      let rootId: unknown;
      try {
        const root = await threadRootOf(engine, row as Record<string, unknown>);
        if (!root || root[COMMENT_RESOLVED_FIELD] !== true) return;
        rootId = root.id;
        if (typeof engine.update !== 'function') {
          throw new Error('the data engine composed here serves no update');
        }
        await engine.update(COMMENT_OBJECT, { [COMMENT_RESOLVED_FIELD]: false }, { where: { id: rootId }, context: { ...SYSTEM_CTX } });
      } catch (e) {
        const message =
          `[audit] comment resolution: reply ${String((row as Record<string, unknown>).id)} was stored, but its thread ` +
            `${rootId === undefined ? '' : `(comment ${String(rootId)}) `}could not be reopened and still reads resolved — ` +
            'it stays out of the default unresolved list until someone reopens it. Reopen it by setting is_resolved ' +
            `to false on the thread's top-level comment. Cause: ${e instanceof Error ? e.message : String(e)}`;
        if (logger.error) logger.error(message);
        else logger.warn(message);
      }
    },
    { object: COMMENT_OBJECT, packageId: opts.packageId },
  );
}

/**
 * "Involving me", the rule the comment panel filters a record's threads by
 * (#36071). Given the comments of ONE record's discussion as the reader
 * loaded them (top-level comments and replies), answer the ids of the
 * top-level comments whose thread involves `userId`. A thread involves a user
 * who:
 *
 *  1. started it — the top-level comment's `author_id` is the user;
 *  2. replied in it — some reply in the thread has `author_id` the user;
 *  3. is mentioned in it — the user's id is among the `mentions` of the
 *     top-level comment or of any reply in the thread (a raw id list or a list
 *     of `{ id }` objects, as `mentions` is stored), whether or not they ever
 *     wrote in it.
 *
 * A reply is placed in the thread of its top-level comment by following
 * `parent_id` through the loaded rows; a reply whose chain leaves the loaded
 * set is in no thread here. Resolution does not matter to this rule: the panel
 * composes it with the resolved filter.
 */
export function threadsInvolvingUser(rows: ReadonlyArray<Record<string, unknown>>, userId: string): Set<string> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) if (row.id !== undefined && row.id !== null) byId.set(String(row.id), row);
  const rootIdOf = (row: Record<string, unknown>): string | null => {
    let current = row;
    for (let hop = 0; hop < THREAD_ROOT_MAX_HOPS; hop++) {
      if (!isReplyRow(current)) return String(current.id);
      const parent = byId.get(String(current.parent_id));
      if (!parent) return null;
      current = parent;
    }
    return null;
  };
  const involved = new Set<string>();
  for (const row of rows) {
    const rootId = rootIdOf(row);
    if (rootId === null) continue;
    const wrote = row.author_id !== undefined && row.author_id !== null && String(row.author_id) === userId;
    if (wrote || parseCommentMentions(row.mentions).includes(userId)) involved.add(rootId);
  }
  return involved;
}
