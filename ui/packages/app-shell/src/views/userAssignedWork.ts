/**
 * The ban dialog's assigned-work vocabulary (objectstack#30205): the client's
 * two answers, typed off the adapter's own client, and the owned/assigned
 * split `UserAssignedWorkPanel` draws.
 */

import type { ObjectStackAdapter } from '@object-ui/data-objectstack';

type AssignedWorkApi = ReturnType<ObjectStackAdapter['getClient']>['security']['assignedWork'];
/** The count answer (`UserAssignedWorkSummary` of `@objectstack/client`). */
export type AssignedWorkSummary = Awaited<ReturnType<AssignedWorkApi['count']>>;
/** The hand-over answer (`UserWorkTransferReport` of `@objectstack/client`). */
export type AssignedWorkTransferReport = Awaited<ReturnType<AssignedWorkApi['transfer']>>;

/** The platform owner field: a record whose owner is the user is "owned". */
export const OWNER_FIELD = 'owner_id';

/** Owned and assigned totals of a count answer. */
export function splitAssignedWork(summary: AssignedWorkSummary): { owned: number; assigned: number } {
  let owned = 0;
  let assigned = 0;
  for (const row of summary.objects) {
    if (row.field === OWNER_FIELD) owned += row.count;
    else assigned += row.count;
  }
  return { owned, assigned };
}
