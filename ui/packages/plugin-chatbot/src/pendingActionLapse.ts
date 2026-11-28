/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A pending action that LAPSED: nobody decided it in time, or the person who
 * proposed it lost access (objectstack#34255, the console half of the ruling
 * on cloud#4608: a lapsed item reads "Expired", never as if a person rejected
 * it).
 *
 * There is no `expired` status on the wire. The server stores a lapsed item as
 * `status: 'rejected'` with `rejection_reason: 'lapsed'` and no `decided_by`,
 * and answers a decision on it with `409` whose `error.details.reason` is
 * `pending_action_lapsed`. Both readers live here, so the AI Approvals inbox
 * and the chat's inline approval card recognise a lapse by the same test.
 *
 * Kept off the package barrel: they are this package's readers of the wire,
 * not part of its API.
 *
 * @module
 */

import type { PendingActionRow } from '@objectstack/spec/contracts';

/** The `rejection_reason` the server stores on a lapsed item. */
export const LAPSED_REJECTION_REASON = 'lapsed';

/** The `error.details.reason` of the `409` a decision on a lapsed item gets. */
export const PENDING_ACTION_LAPSED_REASON = 'pending_action_lapsed';

/**
 * True for a row that lapsed. `decided_by` is what separates it from a
 * person's own rejection: a person who rejects is recorded, a lapse has no one
 * to record, so a row that names a decider stays "Rejected" whatever its
 * reason says.
 */
export function isLapsedPendingAction(
  row: Pick<PendingActionRow, 'status' | 'rejection_reason' | 'decided_by'>,
): boolean {
  return (
    row.status === 'rejected' &&
    row.rejection_reason === LAPSED_REJECTION_REASON &&
    !row.decided_by
  );
}

/**
 * True for the answer a decision on a lapsed item gets: HTTP `409` with
 * `error.details.reason === 'pending_action_lapsed'`. Any other `409` (an item
 * someone else already decided, say) is not a lapse and keeps its error.
 */
export function isPendingActionLapsedConflict(status: number | undefined, body: unknown): boolean {
  if (status !== 409 || body === null || typeof body !== 'object') return false;
  const error = (body as { error?: unknown }).error;
  if (error === null || typeof error !== 'object') return false;
  const details = (error as { details?: unknown }).details;
  if (details === null || typeof details !== 'object') return false;
  return (details as { reason?: unknown }).reason === PENDING_ACTION_LAPSED_REASON;
}
