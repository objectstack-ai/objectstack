// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineFlow } from '@objectstack/spec';

/**
 * #3447 P2 dogfood: dynamic approver routing end to end.
 *
 * Two-stage approval where the FIRST approver picks the second stage's
 * approvers in their decision (`decisionOutputs`), and the second stage
 * resolves them at node entry from an `expression` approver over `vars.*` —
 * no record-field detour. Trigger: retitling an announcement (an otherwise
 * approval-free object, so this demo never collides with the expense/invoice/
 * project approval flows — the service dedupes pending requests per record).
 */
export const DynamicApprovalFlow = defineFlow({
  name: 'showcase_dynamic_approval',
  label: 'Announcement Dynamic Approval',
  description: 'Lead reviewer picks the co-signers in their decision; the co-sign step resolves them at entry.',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Announcement Retitled',
      config: {
        objectName: 'showcase_announcement',
        triggerType: 'record-after-update',
        condition: 'title != previous.title',
      },
    },
    {
      id: 'lead_review',
      type: 'approval',
      label: 'Lead Review',
      config: {
        // The seeded admin holds the org-membership `owner` tier, so the demo
        // routes stage 1 to them without hard-coding a user id.
        approvers: [{ type: 'org_membership_level', value: 'owner' }],
        behavior: 'first_response',
        lockRecord: true,
        // The lead hands the co-signers to the flow with their decision. The
        // TYPED declaration renders a multi-select sys_user picker in the
        // decision dialog (bare string keys render free text), and `required`
        // is enforced on approve — stage 2 declares `onEmptyApprovers: 'fail'`,
        // so a lead who skipped the field would kill the run.
        decisionOutputs: [{
          key: 'next_reviewers', label: 'Next Reviewers', type: 'user', multiple: true, required: true,
        }],
      },
    },
    {
      id: 'co_sign',
      type: 'approval',
      label: 'Co-sign',
      config: {
        // Resolved at node entry from the lead's decision outputs (#3447 P2).
        approvers: [{ type: 'expression', value: 'vars.lead_review.next_reviewers' }],
        behavior: 'unanimous',
        lockRecord: true,
        onEmptyApprovers: 'fail',
      },
    },
    { id: 'approved', type: 'end', label: 'Approved' },
    { id: 'rejected', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'lead_review' },
    { id: 'e2', source: 'lead_review', target: 'co_sign', label: 'approve' },
    { id: 'e3', source: 'lead_review', target: 'rejected', label: 'reject' },
    { id: 'e4', source: 'co_sign', target: 'approved', label: 'approve' },
    { id: 'e5', source: 'co_sign', target: 'rejected', label: 'reject' },
  ],
});
