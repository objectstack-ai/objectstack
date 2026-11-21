/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { ApprovalActionLite } from '../hooks/useRecordApprovals.js';

/**
 * A note the platform wrote on the timeline, not a person's comment: a
 * `comment` row with no actor. The server records no person on the rows no
 * person took (ADR-0118 D1): the note on why a request went to the
 * organization's administrators, that the submitter was left off the slate,
 * or that no one can approve it yet. Any person's comment carries its author,
 * so it never reads as one (objectstack#35418).
 */
export function isSystemNote(a: Pick<ApprovalActionLite, 'action' | 'actor_id'>): boolean {
  return a.action === 'comment' && !a.actor_id;
}
