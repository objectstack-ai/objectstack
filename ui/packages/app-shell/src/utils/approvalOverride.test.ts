/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Pins for the admin-override predicates (objectui#5178).
 *
 * The direction of every unknown is the point: an override that is not labelled
 * leaves today's behaviour, while an ordinary approval labelled as an override
 * is a false accusation on a surface people audit. So every "cannot tell" case
 * below asserts `false`, not `true`.
 */

import { describe, it, expect } from 'vitest';
import {
  isOverrideOnlyViewer,
  actionAdmittedByOverride,
  isOverrideDecision,
  bypassedApproverNames,
  isViaOverrideRow,
} from './approvalOverride';

/**
 * The `visible` gate `sys_approval_request` actually declares on approve /
 * reject / reassign, copied verbatim from `sys-approval-request.object.ts`
 * (framework#3424 + the #8990 sparse-face guards). Copied rather than
 * paraphrased: a paraphrase that still happened to contain `can_override`
 * would keep this file green while the real predicate drifted away.
 */
const DECISION_VISIBLE =
  'has(record.viewer) && has(record.viewer.can_act) && record.viewer.can_act == true' +
  ' || has(record.viewer) && has(record.viewer.can_override) && record.viewer.can_override == true';

/**
 * A submitter-only gate, no `can_override` term: `approval_resubmit` as
 * `sys-approval-request.object.ts` declares it, copied verbatim.
 */
const SUBMITTER_VISIBLE =
  'has(record.status) && record.status == "returned" && has(record.viewer)' +
  ' && has(record.viewer.is_submitter) && record.viewer.is_submitter == true';

/**
 * `approval_recall`'s gate, copied verbatim: the submitter arm OR the #3424
 * admin-override arm, which objectstack#12716 added spelled like the core
 * levers'. This file used to call recall submitter-only, which is how a
 * submitter-admin's own recall came to be labelled an override unnoticed
 * (objectui#13225).
 */
const RECALL_VISIBLE =
  'has(record.status) && (record.status == "pending" || record.status == "returned")' +
  ' && has(record.viewer) && has(record.viewer.is_submitter) && record.viewer.is_submitter == true' +
  ' || has(record.viewer) && has(record.viewer.can_override) && record.viewer.can_override == true';

describe('isOverrideOnlyViewer', () => {
  it('is true for the exact pair objectui#5178 names', () => {
    expect(isOverrideOnlyViewer({ viewer: { can_act: false, is_submitter: false, can_override: true } })).toBe(true);
  });

  it('is false for a designated approver, override rights or not', () => {
    expect(isOverrideOnlyViewer({ viewer: { can_act: true, is_submitter: false, can_override: false } })).toBe(false);
    // An admin who ALSO holds a slot acts as the slot holder: the server takes
    // the ordinary branch and writes `via_override: false`, so the console must
    // not warn about a bypass that is not happening.
    expect(isOverrideOnlyViewer({ viewer: { can_act: true, is_submitter: false, can_override: true } })).toBe(false);
  });

  it('is false for a bystander who cannot act at all', () => {
    expect(isOverrideOnlyViewer({ viewer: { can_act: false, is_submitter: false, can_override: false } })).toBe(false);
  });

  it('fails safe on every shape that cannot answer the question', () => {
    // A backend predating framework#3310 sends no `viewer` block at all.
    expect(isOverrideOnlyViewer({ pending_approvers: ['u1'] })).toBe(false);
    expect(isOverrideOnlyViewer({ viewer: undefined })).toBe(false);
    expect(isOverrideOnlyViewer({ viewer: null })).toBe(false);
    expect(isOverrideOnlyViewer({ viewer: {} })).toBe(false);
    expect(isOverrideOnlyViewer(null)).toBe(false);
    expect(isOverrideOnlyViewer(undefined)).toBe(false);
  });

  it('does not accept truthy stand-ins for the booleans', () => {
    // `can_act: 0` / `can_override: 1` are not the server's shape; reading them
    // loosely is how a wrong verdict would reach a privileged path.
    expect(isOverrideOnlyViewer({ viewer: { can_act: 0, can_override: 1 } })).toBe(false);
    expect(isOverrideOnlyViewer({ viewer: { can_act: null, can_override: true } })).toBe(false);
  });
});

describe('actionAdmittedByOverride', () => {
  it('matches the three core decision levers by their DECLARED predicate', () => {
    expect(actionAdmittedByOverride({ name: 'approval_approve', visible: DECISION_VISIBLE })).toBe(true);
    expect(actionAdmittedByOverride({ name: 'approval_reject', visible: DECISION_VISIBLE })).toBe(true);
    expect(actionAdmittedByOverride({ name: 'approval_reassign', visible: DECISION_VISIBLE })).toBe(true);
  });

  it('does not match a submitter-gated action', () => {
    expect(actionAdmittedByOverride({ name: 'approval_resubmit', visible: SUBMITTER_VISIBLE })).toBe(false);
  });

  it('matches recall, whose gate ORs in the override arm too (objectui#13225)', () => {
    // Admission alone does not make it an override: `isOverrideDecision` below
    // also asks whether the viewer holds the recall through its submitter arm.
    expect(actionAdmittedByOverride({ name: 'approval_recall', visible: RECALL_VISIBLE })).toBe(true);
  });

  it('reads the `{ dialect, source }` envelope spelling too', () => {
    expect(actionAdmittedByOverride({ visible: { dialect: 'cel', source: DECISION_VISIBLE } })).toBe(true);
    expect(actionAdmittedByOverride({ visible: { dialect: 'cel', source: SUBMITTER_VISIBLE } })).toBe(false);
  });

  it('is false when no predicate names a flag', () => {
    expect(actionAdmittedByOverride({ visible: true })).toBe(false);
    expect(actionAdmittedByOverride({ visible: undefined })).toBe(false);
    expect(actionAdmittedByOverride({})).toBe(false);
    expect(actionAdmittedByOverride(null)).toBe(false);
  });

  it('picks up a NEW decision action with no console code (the metadata contract)', () => {
    // The record page's premise is that a ninth decision action ships as
    // metadata alone. Anything keyed off a hard-coded action-name list would
    // return false here and re-open objectui#5178 for that action.
    expect(actionAdmittedByOverride({ name: 'approval_delegate_finalise', visible: DECISION_VISIBLE })).toBe(true);
  });
});

describe('isOverrideDecision', () => {
  const overrideViewer = { viewer: { can_act: false, is_submitter: false, can_override: true } };

  it('is true only when BOTH halves hold', () => {
    expect(isOverrideDecision({ visible: DECISION_VISIBLE }, overrideViewer)).toBe(true);
  });

  it('is false for a submitter-gated action even for an override-capable viewer', () => {
    expect(
      isOverrideDecision(
        { visible: SUBMITTER_VISIBLE },
        { viewer: { can_act: false, is_submitter: true, can_override: true } },
      ),
    ).toBe(false);
  });

  it('is false for the submitter\'s own recall, override rights or not (objectui#13225)', () => {
    // `can_act:false, is_submitter:true, can_override:true` — the shipped
    // recall gate admits this viewer through its submitter arm, so relabelling
    // it "Override Recall" would be a lie: they are withdrawing their own request.
    expect(
      isOverrideDecision(
        { visible: RECALL_VISIBLE },
        { viewer: { can_act: false, is_submitter: true, can_override: true } },
      ),
    ).toBe(false);
  });

  it('is true for a recall by an admin who did not submit the request (objectui#13225)', () => {
    expect(isOverrideDecision({ visible: RECALL_VISIBLE }, overrideViewer)).toBe(true);
    expect(isOverrideDecision({ visible: { dialect: 'cel', source: RECALL_VISIBLE } }, overrideViewer)).toBe(true);
  });

  it('fails safe on a recall when the submitter flag cannot answer', () => {
    // A gate that names `is_submitter` needs an explicit `false` to rule the
    // submitter arm out; absent or a truthy stand-in reads as "cannot tell".
    expect(isOverrideDecision({ visible: RECALL_VISIBLE }, { viewer: { can_act: false, can_override: true } })).toBe(false);
    expect(
      isOverrideDecision({ visible: RECALL_VISIBLE }, { viewer: { can_act: false, is_submitter: 0, can_override: true } }),
    ).toBe(false);
  });

  it('reads the submitter flag only for a lever whose gate names it — the control', () => {
    // Approve declares no submitter arm, so a submitter-admin approving their
    // own request is still admitted by the override flag alone, as before.
    expect(
      isOverrideDecision(
        { visible: DECISION_VISIBLE },
        { viewer: { can_act: false, is_submitter: true, can_override: true } },
      ),
    ).toBe(true);
  });

  it('is false for a designated approver running the same action', () => {
    expect(
      isOverrideDecision({ visible: DECISION_VISIBLE }, { viewer: { can_act: true, is_submitter: false, can_override: true } }),
    ).toBe(false);
  });
});

describe('bypassedApproverNames', () => {
  it('prefers the server-resolved display name', () => {
    expect(
      bypassedApproverNames({
        pending_approvers: ['u1', 'u2'],
        pending_approver_names: { u1: 'Alice Chen', u2: 'Bob Ray' },
      }),
    ).toEqual(['Alice Chen', 'Bob Ray']);
  });

  it('falls back to the caller formatter for an unresolved id', () => {
    expect(
      bypassedApproverNames(
        { pending_approvers: ['u1', 'role:sales_manager'], pending_approver_names: { u1: 'Alice Chen' } },
        (id) => `«${id}»`,
      ),
    ).toEqual(['Alice Chen', '«role:sales_manager»']);
  });

  it('returns empty for the unstaffed-position rescue case', () => {
    // The motivating case for the override path itself: nobody to name. The
    // caller owns the wording for this, which is why it is not an error here.
    expect(bypassedApproverNames({ pending_approvers: [] })).toEqual([]);
    expect(bypassedApproverNames({})).toEqual([]);
    expect(bypassedApproverNames(null)).toEqual([]);
  });

  it('skips non-string and empty entries rather than rendering blanks', () => {
    expect(bypassedApproverNames({ pending_approvers: ['u1', '', null, 7] })).toEqual(['u1']);
  });
});

describe('isViaOverrideRow', () => {
  it('marks only an explicit true', () => {
    expect(isViaOverrideRow({ action: 'approve', via_override: true })).toBe(true);
  });

  it('leaves a checked-and-not-override row unmarked', () => {
    expect(isViaOverrideRow({ action: 'approve', via_override: false })).toBe(false);
  });

  it('leaves a pre-column row unmarked — "not recorded" is not "not an override"', () => {
    expect(isViaOverrideRow({ action: 'approve' })).toBe(false);
    expect(isViaOverrideRow({ action: 'approve', via_override: null })).toBe(false);
  });
});
