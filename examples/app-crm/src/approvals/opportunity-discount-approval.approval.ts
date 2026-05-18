// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ApprovalProcess } from '@objectstack/spec/automation';

/**
 * Opportunity Discount Approval
 *
 * Multi-step approval for high-value opportunities. Triggered when an
 * opportunity amount exceeds 100,000. Sales manager reviews first, then
 * a sales director signs off. Either rejection rolls back to the previous
 * step so the submitter can re-justify.
 */
export const OpportunityDiscountApproval = ApprovalProcess.create({
  name: 'opportunity_discount_approval',
  label: 'Opportunity Discount Approval',
  object: 'opportunity',
  active: true,
  description:
    'High-value opportunities (amount > 100k) require manager + director sign-off.',

  entryCriteria: 'record.amount > 100000',
  lockRecord: true,

  steps: [
    {
      name: 'manager_review',
      label: 'Sales Manager Review',
      description: 'First-line review by the sales manager.',
      approvers: [
        { type: 'role', value: 'sales_manager' },
      ],
      behavior: 'first_response',
      rejectionBehavior: 'back_to_previous',
    },
    {
      name: 'director_signoff',
      label: 'Sales Director Sign-off',
      description: 'Final sign-off for the discounted deal.',
      approvers: [
        { type: 'role', value: 'sales_director' },
      ],
      behavior: 'first_response',
      rejectionBehavior: 'back_to_previous',
    },
  ],
});
