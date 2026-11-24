// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The owner-anchor INSERT stamp: who an inserted row's empty `owner_id` names.
 *
 * One rule, read at two places in the authorization middleware:
 *
 *  1. Step 3.5 (the ownership gate), for every write the middleware judges: an
 *     empty owner is stamped to the acting user, the grant holder's park
 *     (`owner_id` supplied empty beside a supplied queue, ADR-0142 D3) leaves
 *     it unset, and the guest (ADR-0138 D1) is stamped with nothing.
 *  2. An action body's insert ({@link stampActionBodyInsertOwners}), read
 *     ahead of the `isSystem` bypass that skips step 3.5. An action body's
 *     `ctx.api` / `ctx.engine` run the invoker's envelope elevated with
 *     `isSystem: true` and the `'action'` app-automation elevation mark
 *     (`buildActionExecutionContext`, runtime). Without this, the body's insert
 *     landed with `owner_id` null while `created_by` named the invoker, so on a
 *     private object the invoker could neither read nor update the row its own
 *     action had just created.
 *
 * ## What the action-body stamp is, and what it is not
 *
 * - It keys on the `'action'` mark ONLY. A flow run (`isSystem` with a
 *   `flowRunId`, which wins over a mark the way the identity-write refusal reads
 *   it), a hook's `runAs: 'system'` (the `'hook'` mark), seed / boot / import
 *   system writes and a bare `{ isSystem: true }` are unchanged: they still land
 *   the owner they wrote, or none.
 * - It stamps the SAME principal step 3.5 stamps for a direct create under the
 *   same envelope: the envelope's own `userId` (under ADR-0090 D10 delegation,
 *   the acting principal, exactly as step 3.5 reads it), never a value from
 *   the payload. The envelope is the caller's server-built one, spread into
 *   the elevated context by the action door; the mark is a symbol key
 *   (`APP_AUTOMATION_ELEVATION`, `@objectstack/core`), which no request body,
 *   query string or stored row can spell, so no client can claim it.
 * - It fills only an EMPTY owner. An `owner_id` the body sets itself is left
 *   alone: the body is trusted, elevated code, and the forge / transfer guard
 *   step 3.5 runs for a user's write is not run on it.
 * - A queue the body names parks the row exactly as step 3.5 parks it for a
 *   trusted writer (the grant holder): an `owner_id` supplied empty beside the
 *   queue leaves the owner unset; an absent owner is stamped, and the queue is
 *   the row's home queue.
 * - Batch inserts: every row with an empty owner.
 */

import { appAutomationElevationOf } from '@objectstack/core';
import { QUEUE_FIELD, writesQueue } from './ownership-queue-gate.js';

/** The row-ownership anchor column (`applySystemFields`, objectql). */
export const OWNER_FIELD = 'owner_id';

/**
 * Does `row` carry `owner_id` as an own property — the change-set SUPPLIES the
 * anchor? Own-property only: a polluted `Object.prototype.owner_id` must not
 * make an ordinary row look like it names an owner.
 */
export function writesOwner(row: unknown): row is Record<string, unknown> {
  return !!row && typeof row === 'object' && !Array.isArray(row) &&
    Object.prototype.hasOwnProperty.call(row, OWNER_FIELD);
}

/** Is the row's owner EMPTY — absent, `null`, `undefined` or `''`? */
export function hasEmptyOwner(row: Record<string, unknown>): boolean {
  return !writesOwner(row) || row.owner_id == null || row.owner_id === '';
}

/** Who the stamp names, and the two cases in which it names nobody. */
export interface EmptyOwnerStamp {
  /** The acting principal's id, from the operation's own envelope. */
  userId: unknown;
  /** The anonymous principal (`isGuestEnvelope`): stamped with nothing (ADR-0138 D1). */
  guest: boolean;
  /** The trusted writer's park: `owner_id` supplied empty beside a supplied queue (ADR-0142 D3). */
  park: boolean;
}

/**
 * Stamp `row`'s EMPTY owner (the caller checks {@link hasEmptyOwner} first):
 * unset for a park, the acting user when there is one, and for a guest nothing
 * at all, its empty string normalised to unset (an empty string would land in
 * the anchor as a value that is neither an owner nor none).
 */
export function stampEmptyOwner(row: Record<string, unknown>, stamp: EmptyOwnerStamp): void {
  if (stamp.park) row.owner_id = null;
  // Batch rows included: the single-record-only stamp left bulk-inserted rows
  // NULL-owned and invisible to their creator.
  else if (stamp.userId) row.owner_id = stamp.userId;
  // [ADR-0138 D1 item 5]
  else if (stamp.guest && row.owner_id === '') row.owner_id = null;
}

/**
 * Is `context` an action body's elevation — `isSystem` with the `'action'`
 * mark and no flow run? The flow run wins over a mark, as the identity-write
 * refusal's source reading has it (`flow-system-identity-write-refusal.ts`).
 */
export function isActionBodyElevation(context: { isSystem?: unknown; flowRunId?: unknown } | null | undefined): boolean {
  return !!context?.isSystem && !context.flowRunId && appAutomationElevationOf(context) === 'action';
}

/**
 * The action-body half of the stamp (see the module header): every row of the
 * insert whose owner is empty is stamped as step 3.5 stamps a trusted writer's
 * row under the same envelope. The caller has established that the operation
 * is an insert under an action body's elevation, onto an object that carries
 * `owner_id`; `hasQueue` says whether it carries the queue column too.
 */
export function stampActionBodyInsertOwners(
  data: unknown,
  context: { userId?: unknown } | null | undefined,
  guest: boolean,
  hasQueue: boolean,
): void {
  if (!data || typeof data !== 'object') return;
  const rows = (Array.isArray(data) ? data : [data]) as unknown[];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    if (!hasEmptyOwner(r)) continue;
    const park = hasQueue && writesQueue(r) && r[QUEUE_FIELD] != null && r[QUEUE_FIELD] !== '' && writesOwner(r);
    stampEmptyOwner(r, { userId: context?.userId, guest, park });
  }
}
