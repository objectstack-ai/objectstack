// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePosition } from '@objectstack/spec/identity';
import { definePermissionSet } from '@objectstack/spec/security';

/**
 * Example positions — flat distribution groups for a small sales team
 * (positions carry no hierarchy — ADR-0090 D3).
 */
export const SalesRepPosition = definePosition({
  name: 'sales_rep',
  label: 'Sales Representative',
  description: 'Front-line sales representative.',
});

export const SalesManagerPosition = definePosition({
  name: 'sales_manager',
  label: 'Sales Manager',
  description: 'Manages a team of sales reps.',
});

/** Referenced by the Discount Approval second step. */
export const FinanceApproverPosition = definePosition({
  name: 'finance_approver',
  label: 'Finance Approver',
  description: 'Finance team member authorised to approve discounts above 30%.',
});

/**
 * Example permission set — base permissions on CRM objects for sales users.
 *
 * Note: `objects` is a Record keyed by object name, not an array.
 */
export const SalesUserPermissionSet = definePermissionSet({
  name: 'crm_sales_user',
  label: 'CRM Sales User',
  objects: {
    crm_account:     { allowRead: true, allowCreate: true,  allowEdit: true,  allowDelete: false },
    crm_contact:     { allowRead: true, allowCreate: true,  allowEdit: true,  allowDelete: false },
    crm_opportunity: { allowRead: true, allowCreate: true,  allowEdit: true,  allowDelete: false },
    crm_lead:        { allowRead: true, allowCreate: true,  allowEdit: true,  allowDelete: false },
    crm_activity:    { allowRead: true, allowCreate: true,  allowEdit: true,  allowDelete: false },
  },
});

/**
 * Guest profile for the public Web-to-Lead form (lead.view.ts `web_to_lead`).
 *
 * Applied to anonymous (unauthenticated) visitors who POST the public form. The
 * anonymous permission path checks the FULL object name, so this MUST key
 * `crm_lead` (not a short `lead`). INSERT-only — guests can never read, edit, or
 * delete any record.
 */
export const GuestPortalProfile = definePermissionSet({
  name: 'guest_portal',
  label: 'Guest (Public Forms)',
  objects: {
    crm_lead: { allowRead: false, allowCreate: true, allowEdit: false, allowDelete: false },
  },
});
