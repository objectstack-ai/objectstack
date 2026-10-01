// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * sys_activity READ visibility: an activity row is readable when the record it
 * is about is readable.
 *
 * `sys_activity` names its parent record in two columns, `object_name` and
 * `record_id` (the ADR-0052 §5 ActivityPointer pair), and the CRUD mirror in
 * `audit-writers.ts` stamps them with the record each mutation touched. The
 * object is public, has no owner column, and the parent is a different object
 * on every row, so neither OWD/sharing nor RLS can narrow it: before this
 * module a principal holding object-level `sys_activity` read read every row
 * of its environment, including rows about records it cannot open.
 *
 * This is `installCommentReadVisibility` (`comment-access-hooks.ts`) applied to
 * the activity stream, and the two gates share ONE answer to "can this caller
 * read that record": {@link resolveReadableParentIds}, a caller-scoped engine
 * read per parent object, so the parent's own OWD/sharing, RLS and object-level
 * CRUD decide. ⛔ Nothing here derives readability a second way.
 *
 * Mechanism, as for comments: a data middleware (not a find-hook) on `find`,
 * `findOne`, `count` and `aggregate`, so a list's `total` and a grouped count
 * are narrowed exactly like its rows. For each read it pre-scans the parent
 * pairs the query would touch under SYSTEM context, asks which of those parents
 * the caller can read (one read per parent object, never one per row), and ANDs
 * one branch per parent object into `ctx.ast.where`:
 *
 *     { $or: [ { object_name: OBJECT, record_id: { $in: READABLE_IDS } }, ... ] }
 *
 * Everything fails CLOSED, row classes exactly as the comment gate treats its
 * threads:
 *  - a row naming no parent (no `object_name` or no `record_id`, or an
 *    `object_name` that is not a machine name) is excluded;
 *  - a row whose parent record no longer exists is excluded: the parent read
 *    finds nothing, so there is nothing to judge readability on;
 *  - a row whose parent object the caller cannot read, or that the engine does
 *    not know, is excluded: that parent read refuses or throws;
 *  - a row naming `sys_activity` itself is excluded: probing it would re-enter
 *    this gate.
 * A platform object is a parent like any other: its rows are kept exactly when
 * the caller can read that platform record.
 *
 * System-context reads (the audit writer, engine self-reads) and context-less
 * programmatic calls on bare kernels are not narrowed, as for comments: every
 * real transport carries a context.
 */

import {
  resolveReadableParentIds,
  type CommentAccessEngine,
  type CommentAccessLogger,
  type CommentReadMiddlewareCtx,
} from './comment-access-hooks.js';

const ACTIVITY_OBJECT = 'sys_activity';
const SYSTEM_CTX = { isSystem: true } as const;
const READ_OPS = new Set(['find', 'findOne', 'count', 'aggregate']);

/** Bound on the per-read candidate pre-scan — the comment gate's bound. Beyond
 * it the filter fails CLOSED (the un-scanned rows are excluded, never leaked). */
const READ_SCAN_LIMIT = 2_000;

/** No real row matches — the fail-closed sentinel (the comment gate's shape). */
const READ_DENY_ALL = { id: '__activity_parent_denied__' } as const;

/** Object machine-name shape (`ObjectSchema.name` in packages/spec). */
const OBJECT_NAME_RE = /^[a-z_][a-z0-9_]*$/;

/** The record an activity row is about. */
export interface ActivityParent {
  object: string;
  recordId: string;
}

/** The engine slice a `sys_activity` read middleware needs (this gate and the
 * field redaction in `activity-field-redaction.ts`). */
export interface ActivityMiddlewareEngine {
  registerMiddleware?(
    fn: (
      ctx: CommentReadMiddlewareCtx & { ast?: Record<string, unknown>; result?: unknown },
      next: () => Promise<void>,
    ) => Promise<void>,
    options?: { object?: string },
  ): void;
}

/**
 * The parent OBJECT an activity row names, or `null` when it names none this
 * gate can authorize. One definition for both read seams over the stream.
 */
export function parseActivityParentObject(row: Record<string, unknown> | null | undefined): string | null {
  const object = row?.object_name;
  if (typeof object !== 'string' || !OBJECT_NAME_RE.test(object)) return null;
  if (object === ACTIVITY_OBJECT) return null;
  return object;
}

/**
 * Read the parent record an activity row names, or `null` when it names none
 * this gate can authorize — which every caller here treats as DENY.
 */
export function parseActivityParent(row: Record<string, unknown> | null | undefined): ActivityParent | null {
  const object = parseActivityParentObject(row);
  const recordId = row?.record_id;
  if (object === null) return null;
  if (typeof recordId !== 'string' && typeof recordId !== 'number') return null;
  if (String(recordId) === '') return null;
  return { object, recordId: String(recordId) };
}

/**
 * Install the `sys_activity` read-visibility middleware.
 *
 * Inert on an engine without the middleware seam; `AuditPlugin` says so out
 * loud when that happens.
 */
export function installActivityReadVisibility(
  engine: CommentAccessEngine,
  logger: CommentAccessLogger,
): void {
  if (typeof engine.registerMiddleware !== 'function') return;
  const andIn = (ctx: CommentReadMiddlewareCtx, filter: unknown) => {
    if (!ctx.ast) return;
    ctx.ast.where = ctx.ast.where ? { $and: [ctx.ast.where, filter] } : filter;
  };

  engine.registerMiddleware(
    async (ctx, next) => {
      // Only reads carry an `ast` to constrain; the object is append-only and
      // `apiMethods: ['get', 'list']`. System / context-less reads are internal.
      if (!READ_OPS.has(ctx.operation) || !ctx.ast || !ctx.context || ctx.context.isSystem) {
        return next();
      }
      try {
        const filter = await computeActivityVisibilityFilter(engine, ctx, logger);
        if (filter) andIn(ctx, filter);
      } catch (err) {
        // A filter-compute failure must never fall open into a leak.
        logger.warn(
          `[audit] activity read visibility: filter failed, denying all (${(err as Error)?.message ?? err})`,
        );
        andIn(ctx, READ_DENY_ALL);
      }
      return next();
    },
    { object: ACTIVITY_OBJECT },
  );
}

/**
 * Resolve the parent-visibility WHERE predicate for one `sys_activity` read.
 * Returns `null` when the query matches no rows (nothing to narrow), one
 * `$in` branch per parent object holding the readable ids, or the deny-all
 * sentinel.
 */
async function computeActivityVisibilityFilter(
  engine: CommentAccessEngine,
  ctx: CommentReadMiddlewareCtx,
  logger: CommentAccessLogger,
): Promise<unknown | null> {
  // 1. The parent pairs the query would touch, read under SYSTEM context (the
  //    caller may not see the rows yet; that is what is being decided). The
  //    caller's own order rides along, so on a table larger than the scan
  //    bound the window scanned is the window the caller pages through — the
  //    newest rows of a feed sorted by `timestamp`, not an arbitrary 2,000.
  const orderBy = (ctx.ast as { orderBy?: unknown } | undefined)?.orderBy;
  const candidates = await engine.find(ACTIVITY_OBJECT, {
    where: (ctx.ast?.where as Record<string, unknown>) ?? {},
    fields: ['object_name', 'record_id'],
    ...(Array.isArray(orderBy) && orderBy.length > 0 ? { orderBy } : {}),
    limit: READ_SCAN_LIMIT,
    context: { ...SYSTEM_CTX },
  });
  if (!candidates.length) return null;
  if (candidates.length >= READ_SCAN_LIMIT) {
    // Not silent (fail-closed truncation): rows beyond the scan window are
    // excluded, so a very broad read may omit rows the caller could see. A
    // record timeline scopes by `object_name` + `record_id` and never hits it.
    logger.warn(
      `[audit] activity read visibility: candidate pre-scan hit the ${READ_SCAN_LIMIT}-row cap; ` +
        'the visibility filter for this broad read is fail-closed and may omit visible rows — ' +
        'scope the query by object_name and record_id',
    );
  }

  /** parent object → (record id as compared → the value as STORED). The stored
   * value is what the emitted filter carries, so it can only match rows the
   * pre-scan actually saw spelled that way. */
  const byObject = new Map<string, Map<string, unknown>>();
  for (const row of candidates) {
    const parent = parseActivityParent(row);
    if (!parent) continue;
    let ids = byObject.get(parent.object);
    if (!ids) byObject.set(parent.object, (ids = new Map()));
    if (!ids.has(parent.recordId)) ids.set(parent.recordId, row.record_id);
  }
  if (byObject.size === 0) return READ_DENY_ALL;

  // 2. The SAME readability answer the comment gate asks — one caller-scoped
  //    read per parent object.
  const idSets = new Map<string, Set<string>>();
  for (const [object, ids] of byObject) idSets.set(object, new Set(ids.keys()));
  const readable = await resolveReadableParentIds(engine, ctx.context, idSets);

  // 3. One branch per parent object that kept at least one readable record.
  const branches: Array<Record<string, unknown>> = [];
  for (const [object, ids] of byObject) {
    const visible = readable.get(object);
    if (!visible) continue;
    const kept: unknown[] = [];
    for (const [recordId, stored] of ids) if (visible.has(recordId)) kept.push(stored);
    if (kept.length) branches.push({ object_name: object, record_id: { $in: kept } });
  }
  if (branches.length === 0) return READ_DENY_ALL;
  return branches.length === 1 ? branches[0] : { $or: branches };
}
