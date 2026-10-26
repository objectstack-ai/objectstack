/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { ApprovalRequestLite } from '../../hooks/useRecordApprovals.js';

/**
 * How many approvers may still decide a pending request: the number of
 * distinct principals in the slate the server served (objectui#12781). It is
 * the figure `DecisionProgressIndicator` draws as "N eligible approver(s)"
 * beside the tally, and both of its callers hand it this count.
 *
 * `pending_approvers` lists slots, not people. The approvals service keeps one
 * slot per resolved approver entry, so a person who holds two of a node's
 * positions fills two slots under the same address. Counting slots drew
 * "3 eligible approvers" beside a single "Dev Admin ×3" chip on the stock
 * showcase's committee quorum. Each slot carries its principal's address as
 * the server stores it (a user id, an email, a `position:` reference), so the
 * count here is the number of distinct addresses.
 *
 * Nothing is resolved here: no position, team or group is looked up and no
 * second read is made. Two addresses the server left distinct (an email and a
 * user id for one person, say) count as two, because the slate is the
 * server's answer and the console does not re-derive it. The server's tally
 * (`decision_progress.got` / `need`) is not read or changed.
 *
 * Module-internal: no export from the package entry.
 */
export function eligibleApproverCount(
  request: Pick<ApprovalRequestLite, 'pending_approvers'> | null | undefined,
): number {
  return new Set(request?.pending_approvers || []).size;
}
