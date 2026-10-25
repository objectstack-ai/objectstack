/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { recordLockedByApproval, type ApprovalRequestLite } from './useRecordApprovals';

/**
 * Record-lock policy of a pending approval (objectui#2902).
 *
 * "A pending approval request exists" and "the record is locked" are different
 * facts: an approval node declares `lockRecord`, and the server's record-lock
 * hook lets writes through for the whole time a `lockRecord: false` node waits.
 * The console used to equate them, which disabled inline editing and showed a
 * "Locked for approval" badge on records the server would have let the user
 * edit — exactly the single-approver steps the flag exists for.
 */

const req = (over: Partial<ApprovalRequestLite> = {}): ApprovalRequestLite => ({
  id: 'r1',
  process_name: 'flow:budget_approval',
  object_name: 'showcase_project',
  record_id: 'p1',
  status: 'pending',
  ...over,
});

describe('recordLockedByApproval (objectui#2902)', () => {
  it('is not locked with no pending request', () => {
    expect(recordLockedByApproval(null)).toBe(false);
    expect(recordLockedByApproval(undefined)).toBe(false);
  });

  it('is locked when the pending node declares lockRecord', () => {
    expect(recordLockedByApproval(req({ lock_record: true }))).toBe(true);
  });

  it('is NOT locked when the pending node opted out — the #2902 regression', () => {
    expect(recordLockedByApproval(req({ lock_record: false }))).toBe(false);
  });

  it('fails closed when the backend does not report the policy', () => {
    // Pre-framework#3814: the flag was never sent. Assuming "unlocked" there
    // would offer an edit the server rejects with RECORD_LOCKED, so the
    // unknown must read as locked.
    expect(recordLockedByApproval(req())).toBe(true);
  });

  it('reads each node independently as a flow advances', () => {
    // The issue's repro: node A unlocked, node B locked. One request per node,
    // each carrying its own policy — the band must change between them.
    const nodeA = req({ id: 'rA', current_step: 'manager_review', lock_record: false });
    const nodeB = req({ id: 'rB', current_step: 'exec_review', lock_record: true });
    expect(recordLockedByApproval(nodeA)).toBe(false);
    expect(recordLockedByApproval(nodeB)).toBe(true);
  });
});
