// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22559] The read gate on `sys_approval_request` at the GENERIC data door: a
 * read there returns only the requests the approvals door would serve the same
 * caller.
 *
 * ## The defect this closes
 *
 * The object declares `enable.apiMethods: ['get', 'list']`, so once an app
 * grants read on it — the natural way to put a record's approval history on
 * its page — the generic door served every request of the organization, the
 * payload snapshots of records the caller cannot open included. The approvals
 * door (`ApprovalService.listRequests` / `getRequest`) never did: it serves a
 * request to its participants, to the override actor, and — where a
 * deployment opted in per object — read-only to a reader of the record it is
 * about (#8652).
 *
 * ## One rule, two doors
 *
 * ⛔ Nothing here decides who may see a request. The answer is the approvals
 * service's own: {@link RequestVisibilitySource}, which the plugin reaches
 * with `requestVisibilitySourceOf(service)` (`approval-service.ts`, in-package
 * only) and which IS the approvals door's private `visibleRequestIds`: the
 * participant set (submitter, current approver, past actor), the override
 * actor's unrestricted view, and the record-reader tier, which stays default
 * OFF. This module only reads which record a query names, hands that to the
 * service, and ANDs the answer into the read.
 *
 * ⛔ This is deliberately NOT `plugin-audit`'s parent-record read gate (the
 * activity stream's shape), which keeps a row whenever its parent record is
 * readable. Here that would switch the record-reader tier on for every object,
 * against the ruling's default OFF.
 *
 * ## Which record a read names
 *
 * As on the approvals door, the record-reader tier answers only where a record
 * is named, and the gate reads the name off the query's conjunctive pins
 * ({@link pinnedEquality}):
 *
 *  - `object_name` and `record_id` both pinned — a record page's related list —
 *    is `listRequests` with `object` + `recordId`;
 *  - `id` pinned — `GET /data/sys_approval_request/ID` — is a request loaded by
 *    id, which carries its own anchor (`getRequest`);
 *  - anything else is untargeted, the participant set alone: the inbox's
 *    answer. A pin under `$or` / `$not` names nothing, so it reads untargeted —
 *    narrower, never wider.
 *
 * ## The narrowing
 *
 * Added as a conjunct of `ast.where` on `find`, `findOne`, `count` and
 * `aggregate`, so a list's `total` and a grouped count are narrowed exactly
 * like its rows. It is always a constraint on `id` built from the ids the
 * service returned, so it can only keep rows the service named:
 *
 *  - the unrestricted answer (`null`) adds nothing — Setup's all-requests list
 *    for an administrator is unchanged, and so is every read the approval
 *    engine makes as the system;
 *  - a read pinned to one id keeps that id when it is visible and nothing
 *    otherwise, so a by-id read never carries the caller's whole set;
 *  - any other read keeps `id` among the visible set; an empty set keeps
 *    nothing.
 *
 * Fails CLOSED: a failed visibility answer denies the read (logged), and a
 * row with no participant and no admitted record is simply not in the set.
 * A context-less programmatic call on a bare kernel is not narrowed, as for
 * the sibling read seams: every real transport carries a context.
 *
 * ## What it composes with
 *
 * The other seams on this object stay as they were: the snapshot redaction
 * (`payload-redaction-middleware.ts`) narrows what a served row's
 * `payload_json` holds, and the snapshot query guard
 * (`payload-predicate-guard.ts`) refuses a query over it. The per-caller
 * `viewer` block declared under `attachedOnRead` is attached by the approvals
 * door only; a row served here never carries it, so every decision action's
 * `visible` predicate fails closed on this door, and a record reader admitted
 * by the tier is served the row read-only on both doors.
 */

import type { ExecutionContext } from '@objectstack/spec/kernel';
import { pinnedEquality } from './payload-predicate-guard.js';
import { APPROVAL_REQUEST_OBJECT, type MiddlewareEngine } from './payload-redaction-middleware.js';

/** The engine reads this gate narrows. */
export const REQUEST_READ_OPS: ReadonlySet<string> = new Set(['find', 'findOne', 'count', 'aggregate']);

/** No real row matches it: the fail-closed conjunct. */
export const REQUEST_READ_DENY_ALL: Readonly<Record<string, unknown>> = Object.freeze({
  id: '__approval_request_not_visible__',
});

/** The record a read names, in the approvals door's two spellings. */
export interface RequestReadTarget {
  object?: string;
  recordId?: string;
  requestId?: string;
}

/**
 * The one visibility definition the gate reads: the approvals service's,
 * written by `ApprovalService`'s constructor and reached through
 * `requestVisibilitySourceOf`. `null` is "every request in scope"; a set is the
 * ids the approvals door would serve the caller for a read naming `target`.
 */
export interface RequestVisibilitySource {
  visibleRequestIdsFor(
    context: ExecutionContext,
    target?: { object?: string | null; recordId?: string | null; requestId?: string | null },
  ): Promise<Set<string> | null>;
}

/**
 * The record a read of `sys_approval_request` names, read off its `where`:
 * `object` + `recordId` when both are pinned, `requestId` when only the id is,
 * `undefined` when the read is untargeted.
 */
export function requestReadTarget(where: unknown): RequestReadTarget | undefined {
  const object = pinnedEquality(where, 'object_name');
  const recordId = pinnedEquality(where, 'record_id');
  if (object !== null && recordId !== null) return { object, recordId };
  const requestId = pinnedEquality(where, 'id');
  if (requestId !== null) return { requestId };
  return undefined;
}

/**
 * The conjunct that confines a read to `visible`, or `null` to add none.
 * `pinnedId` is the one id the read is already pinned to, if any.
 */
export function requestVisibilityFilter(
  visible: ReadonlySet<string> | null,
  pinnedId: string | null,
): Readonly<Record<string, unknown>> | null {
  if (visible === null) return null;
  if (pinnedId !== null) return visible.has(pinnedId) ? { id: pinnedId } : REQUEST_READ_DENY_ALL;
  if (visible.size === 0) return REQUEST_READ_DENY_ALL;
  const ids = [...visible];
  return { id: ids.length === 1 ? ids[0] : { $in: ids } };
}

/**
 * Register the gate on `sys_approval_request`. `source` is the approvals
 * service the plugin started.
 */
export function bindRequestReadGate(
  engine: MiddlewareEngine,
  source: RequestVisibilitySource,
  logger?: { warn?: (msg: string, meta?: Record<string, any>) => void },
): void {
  engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
    const ast = opCtx?.ast as { where?: unknown } | undefined;
    const context = opCtx?.context;
    if (!REQUEST_READ_OPS.has(opCtx?.operation) || !ast || !context) return next();
    let filter: Readonly<Record<string, unknown>> | null;
    try {
      const visible = await source.visibleRequestIdsFor(context, requestReadTarget(ast.where));
      filter = requestVisibilityFilter(visible, pinnedEquality(ast.where, 'id'));
    } catch (err: any) {
      logger?.warn?.('[approvals] request read gate could not resolve which approval requests the caller may see — the read is denied (fail closed)', {
        operation: opCtx.operation, error: err?.message ?? String(err),
      });
      filter = REQUEST_READ_DENY_ALL;
    }
    if (filter) ast.where = ast.where ? { $and: [ast.where, filter] } : filter;
    return next();
  }, { object: APPROVAL_REQUEST_OBJECT });
}
