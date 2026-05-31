// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Budget Approval — a two-step approval that locks a project when its budget
 * exceeds a threshold: manager first, then executive for very large budgets.
 * Validated (and its string criteria coerced to expressions) by `defineStack`.
 */
export const BudgetApprovalProcess = {
  name: 'showcase_budget_approval',
  label: 'Project Budget Approval',
  object: 'showcase_project',
  active: true,
  description: 'Two-step approval for projects above budget thresholds.',
  entryCriteria: 'record.budget > 100000',
  lockRecord: true,
  steps: [
    {
      name: 'manager_review',
      label: 'Manager Review',
      description: 'Project manager reviews the budget.',
      approvers: [{ type: 'role' as const, value: 'manager' }],
      behavior: 'first_response' as const,
      rejectionBehavior: 'reject_process' as const,
    },
    {
      name: 'exec_review',
      label: 'Executive Review',
      description: 'Executive signs off on budgets above $500k.',
      entryCriteria: 'record.budget > 500000',
      approvers: [{ type: 'role' as const, value: 'exec' }],
      behavior: 'unanimous' as const,
      rejectionBehavior: 'back_to_previous' as const,
    },
  ],
};

export const allApprovals = [BudgetApprovalProcess];
