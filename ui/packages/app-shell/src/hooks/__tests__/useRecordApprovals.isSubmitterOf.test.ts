/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { isSubmitterOf, type ApprovalRequestLite } from '../useRecordApprovals';

/**
 * `isSubmitterOf` — the ONE derivation of "did this viewer submit this
 * approval" (objectui#6464).
 *
 * Two surfaces gate on the answer: the approvals panel's Remind button and the
 * record band's Recall button. Both are server-authorized on submitter
 * identity, so two client-side copies of the derivation would be two
 * definitions of who submitted — the drift `utils/approverIdentity` already
 * exists to prevent on the display side.
 *
 * What the cells below actually protect is the SOURCE ORDER. The server's
 * `viewer.is_submitter` (framework#3310) is the resolution the endpoint will
 * enforce; the id comparison exists only for backends that predate the `viewer`
 * block. Joining them with `||` instead of `??` would look identical on every
 * agreeing row and quietly overturn the server on the one row where it says no.
 */

const row = (over: Partial<ApprovalRequestLite> = {}): ApprovalRequestLite => ({
  id: 'req_1',
  process_name: 'flow:budget_review',
  object_name: 'budget',
  record_id: 'B1',
  status: 'pending',
  submitter_id: 'u_alice',
  ...over,
});

describe('isSubmitterOf — server-resolved first (objectui#6464)', () => {
  it('believes the server when it says the viewer IS the submitter', () => {
    expect(isSubmitterOf(row({ viewer: { can_act: false, is_submitter: true } }), 'u_bob')).toBe(true);
  });

  it('believes the server when it says the viewer is NOT the submitter', () => {
    expect(isSubmitterOf(row({ viewer: { can_act: false, is_submitter: false } }), 'u_bob')).toBe(false);
  });

  /**
   * The cell that separates `??` from `||`. The server resolved `false` while
   * the raw `submitter_id` matches the signed-in id — a real shape whenever the
   * server's answer accounts for something the bare column does not (a
   * delegated or system-rewritten submission). `||` would re-litigate the
   * server's refusal client-side and return `true`, lighting a lever the recall
   * endpoint then rejects: the very defect this gate exists to close.
   */
  it('does not let a matching submitter_id overturn a server `false`', () => {
    expect(
      isSubmitterOf(row({ submitter_id: 'u_alice', viewer: { can_act: false, is_submitter: false } }), 'u_alice'),
    ).toBe(false);
  });
});

describe('isSubmitterOf — the id fallback for pre-`viewer` backends', () => {
  it('matches the submitter by id when the server sends no viewer block', () => {
    expect(isSubmitterOf(row({ submitter_id: 'u_alice' }), 'u_alice')).toBe(true);
  });

  it('rejects a non-submitter by id when the server sends no viewer block', () => {
    expect(isSubmitterOf(row({ submitter_id: 'u_alice' }), 'u_bob')).toBe(false);
  });

  /**
   * Fallback-also-absent: an older server AND no signed-in id to compare
   * against. This resolves to a definite `false`, NOT to "unknown" — the
   * authoritative row is in hand and nothing in it identifies this viewer as
   * the submitter. It is also the same answer the Remind gate has always given
   * in this shape, which is the point of there being one derivation.
   */
  it('resolves to false when there is no id to compare against', () => {
    expect(isSubmitterOf(row({ submitter_id: 'u_alice' }), undefined)).toBe(false);
    expect(isSubmitterOf(row({ submitter_id: 'u_alice' }), null)).toBe(false);
    expect(isSubmitterOf(row({ submitter_id: 'u_alice' }), '')).toBe(false);
  });

  it('resolves to false when the row itself names no submitter', () => {
    // Both sides absent must not collapse into `undefined === undefined`.
    expect(isSubmitterOf(row({ submitter_id: null }), undefined)).toBe(false);
    expect(isSubmitterOf(row({ submitter_id: undefined }), undefined)).toBe(false);
  });
});

describe('isSubmitterOf — "unknown" is its own answer', () => {
  /**
   * No request to consult is NOT a denial. Callers feeding a feedback gate keep
   * their prior behaviour on `undefined`; collapsing it to `false` here would
   * hide the affordance on every backend that exposes no approvals API at all.
   * Asserted with `toBeUndefined`, since `toBeFalsy` passes for both.
   */
  it('returns undefined — not false — with no request', () => {
    expect(isSubmitterOf(null, 'u_alice')).toBeUndefined();
    expect(isSubmitterOf(undefined, 'u_alice')).toBeUndefined();
  });
});
