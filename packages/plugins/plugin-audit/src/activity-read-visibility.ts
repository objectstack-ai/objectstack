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
 * Mechanism, as for comments, and shared with the compliance ledger's gate
 * (`audit-log-read-visibility.ts`) through `parent-record-read-gate.ts`: a data
 * middleware (not a find-hook) on `find`, `findOne`, `count` and `aggregate`,
 * so a list's `total` and a grouped count
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
 * the caller can read that platform record. The stream declares no row class
 * outside the gate: its one platform producer is the CRUD mirror, and every
 * row it writes is about a record.
 *
 * System-context reads (the audit writer, engine self-reads) and context-less
 * programmatic calls on bare kernels are not narrowed, as for comments: every
 * real transport carries a context.
 */

import type { CommentAccessEngine, CommentAccessLogger, CommentReadMiddlewareCtx } from './comment-access-hooks.js';
import {
  PARENT_GATE_READ_OPS,
  andIntoWhere,
  computeParentRecordFilter,
  parseParentObject,
  parseParentRecord,
  type ParentRecord,
  type ParentRecordGate,
} from './parent-record-read-gate.js';

const ACTIVITY_OBJECT = 'sys_activity';

/** The activity stream's gate: every row naming no parent is excluded. */
const ACTIVITY_GATE: ParentRecordGate = {
  object: ACTIVITY_OBJECT,
  seam: 'activity read visibility',
  denyAll: { id: '__activity_parent_denied__' },
};

/** The record an activity row is about. */
export type ActivityParent = ParentRecord;

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
  return parseParentObject(row, ACTIVITY_OBJECT);
}

/**
 * Read the parent record an activity row names, or `null` when it names none
 * this gate can authorize — which every caller here treats as DENY.
 */
export function parseActivityParent(row: Record<string, unknown> | null | undefined): ActivityParent | null {
  return parseParentRecord(row, ACTIVITY_OBJECT);
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

  engine.registerMiddleware(
    async (ctx, next) => {
      // Only reads carry an `ast` to constrain; the object is append-only and
      // `apiMethods: ['get', 'list']`. System / context-less reads are internal.
      if (!PARENT_GATE_READ_OPS.has(ctx.operation) || !ctx.ast || !ctx.context || ctx.context.isSystem) {
        return next();
      }
      try {
        const filter = await computeParentRecordFilter(engine, ctx, logger, ACTIVITY_GATE);
        if (filter) andIntoWhere(ctx, filter);
      } catch (err) {
        // A filter-compute failure must never fall open into a leak.
        logger.warn(
          `[audit] activity read visibility: filter failed, denying all (${(err as Error)?.message ?? err})`,
        );
        andIntoWhere(ctx, ACTIVITY_GATE.denyAll);
      }
      return next();
    },
    { object: ACTIVITY_OBJECT },
  );
}
