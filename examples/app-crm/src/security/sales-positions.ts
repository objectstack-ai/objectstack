// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePosition } from '@objectstack/spec/identity';
import { definePermissionSet } from '@objectstack/spec/security';

/**
 * Example positions — flat distribution groups for a small sales team
 * (positions carry no hierarchy — ADR-0090 D3). Each names the permission sets
 * it distributes in `permissionSets` (ADR-0131 D3/D4), which is what the
 * authorization resolver reads.
 */
export const SalesRepPosition = definePosition({
  name: 'sales_rep',
  label: 'Sales Representative',
  description: 'Front-line sales representative.',
  permissionSets: ['crm_sales_user'],
});

export const SalesManagerPosition = definePosition({
  name: 'sales_manager',
  label: 'Sales Manager',
  description: 'Manages a team of sales reps.',
  permissionSets: ['crm_sales_user'],
});

/**
 * Registered in `objectstack.config.ts` (`positions`) and distributing the
 * `crm_sales_user` permission set, alongside `sales_rep` and `sales_manager`.
 * This app models no approval flow; the worked approval flows live in
 * `examples/app-showcase/src/automation/flows/`.
 */
export const FinanceApproverPosition = definePosition({
  name: 'finance_approver',
  label: 'Finance Approver',
  description: 'Finance team member authorised to approve discounts above 30%.',
  permissionSets: ['crm_sales_user'],
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
    crm_account: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
    crm_contact: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
    crm_opportunity: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
    // [#8164] crm_opportunity_line_item is a master-detail CHILD of
    // crm_opportunity (sharingModel: 'controlled_by_parent') — its RECORD
    // scope always follows the parent (ADR-0055), but object-level CRUD is a
    // SEPARATE gate that is never derived (security-master-detail-ungranted).
    // Grant shape matches the master exactly: same set, same bits, so the
    // line-item grid on the Opportunity form (inlineEdit: 'grid') opens for
    // the same users who can already work the parent record.
    crm_opportunity_line_item: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
    crm_lead: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
    crm_activity: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
  },
});

/**
 * The `guest_portal` permission set — the name the public form doors' submit
 * context requests. ADR-0138 records this declaration as the reference for that
 * name (fate: keep), which is why the example keeps it.
 *
 * It does NOT authorize the public Web-to-Lead form (lead.view.ts
 * `web_to_lead`). That form's own declaration does: the submit route derives a
 * `publicFormGrant` on `crm_lead` (create + read-back on that object only,
 * ADR-0056 Option A), and the SecurityPlugin admits on that grant before any
 * permission set resolves. The form works the same without this set.
 *
 * What the name reaches: the submit's context carries
 * `permissions: ['guest_portal']`, so a set registered under this name is the
 * one the grant's result masker reads over what the grant hands back, through
 * its `fields` and the capabilities it holds against a field's
 * `requiredPermissions`. Its `objects` bits are not read on that path. This
 * declaration has object bits only, so on the form path it changes nothing, and
 * the submit answers the created id only.
 */
export const GuestPortalProfile = definePermissionSet({
  name: 'guest_portal',
  label: 'Guest (Public Forms)',
  objects: {
    crm_lead: { allowRead: false, allowCreate: true, allowEdit: false, allowDelete: false },
  },
});
