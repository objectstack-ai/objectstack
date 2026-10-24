/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { resolveApprovalLock } from '../InlineEditContext';

/**
 * The record surface's ONE approval-lock rule (objectui#12220).
 *
 * A composition without the approvals service answers the approvals read
 * `200 { data: [] }` and enforces no lock (`PATCH` answers 200). A record whose
 * `approval_status` column read `pending` still opened locked, with Edit
 * disabled and a recall lever that had nothing to recall, because the column
 * fallback fired whenever no pending request was FOUND rather than only when
 * no read ANSWERED. The record page host and the DetailView band both call
 * this function, so these pins cover both sites' decision; each site's own
 * suite pins that it calls it with the right inputs.
 */
describe('resolveApprovalLock (objectui#12220)', () => {
  it('a `pending` record whose approvals read answered empty is neither pending nor locked', () => {
    expect(
      resolveApprovalLock({ readAnswered: true, openApproval: null, recordStatus: 'pending' }),
    ).toEqual({ pending: false, locked: false });
    expect(
      resolveApprovalLock({ readAnswered: true, openApproval: null, recordStatus: 'in_approval' }),
    ).toEqual({ pending: false, locked: false });
  });

  it('a record with an open request that locks stays locked', () => {
    expect(
      resolveApprovalLock({ readAnswered: true, openApproval: { locked: true }, recordStatus: 'pending' }),
    ).toEqual({ pending: true, locked: true });
  });

  it('with no answered read, the column fallback still locks', () => {
    expect(
      resolveApprovalLock({ readAnswered: false, openApproval: null, recordStatus: 'pending' }),
    ).toEqual({ pending: true, locked: true });
    expect(
      resolveApprovalLock({ readAnswered: false, openApproval: null, recordStatus: 'in_approval' }),
    ).toEqual({ pending: true, locked: true });
  });

  it('control (objectui#2902): an open `lockRecord: false` request reads pending and editable, whatever the column says', () => {
    expect(
      resolveApprovalLock({ readAnswered: true, openApproval: { locked: false }, recordStatus: 'pending' }),
    ).toEqual({ pending: true, locked: false });
    expect(
      resolveApprovalLock({ readAnswered: false, openApproval: { locked: false }, recordStatus: 'pending' }),
    ).toEqual({ pending: true, locked: false });
  });

  it('with no answered read and a column that is not pending, nothing is running', () => {
    for (const recordStatus of ['draft', 'approved', 'recalled', undefined, null]) {
      expect(
        resolveApprovalLock({ readAnswered: false, openApproval: null, recordStatus }),
      ).toEqual({ pending: false, locked: false });
    }
  });
});
