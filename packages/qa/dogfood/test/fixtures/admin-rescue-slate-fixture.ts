// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Minimal booted-app fixture for the #22824 pin: an approval step whose
// approvers resolve to no one opens, under the default
// `onEmptyApprovers: 'admin_rescue'`, on the organization's administrators,
// read through the REST door on a real boot.
//
// Two objects, each with one autolaunched `approval` flow that fires on insert:
//
//   - `admin_rescue_stuck` routes to a POSITION nothing in this fixture ever
//     staffs. Its node declares no `onEmptyApprovers`, so the default,
//     `admin_rescue`, opens the request on the organization's administrators.
//   - `admin_rescue_staffed` routes to one named user, by email. Its slate
//     names a person, so it is the CONTROL: no administrator is added to it.
//
// Two objects rather than two flows on one: one pending request per record,
// and a record that started both flows would refuse the second.
//
// Purpose-built for the reason `override-composite-fixture.ts` gives:
// showcase's `onEnable` staffs its own approval positions on every boot, and
// "nobody holds the position" has to be a precondition this pin owns.

import { defineStack, defineFlow } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

/** A position nothing in this fixture ever staffs. */
export const UNSTAFFED_POSITION = 'admin_rescue_nobody';

/** The one person the staffed flow routes to (by email, the slot it stores). */
export const STAFFED_APPROVER_EMAIL = 'admin-rescue-approver@example.com';

export const AdminRescueStuck = ObjectSchema.create({
  name: 'admin_rescue_stuck',
  label: 'Admin Rescue Stuck',
  pluralLabel: 'Admin Rescue Stuck',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

export const AdminRescueStaffed = ObjectSchema.create({
  name: 'admin_rescue_staffed',
  label: 'Admin Rescue Staffed',
  pluralLabel: 'Admin Rescue Staffed',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

function approvalFlow(name: string, objectName: string, approver: { type: 'position' | 'user'; value: string }) {
  return defineFlow({
    name,
    label: name,
    description: `Fires on insert of ${objectName} and opens one approval step.`,
    type: 'autolaunched',
    status: 'active',
    nodes: [
      {
        id: 'start',
        type: 'start',
        label: 'On Create',
        config: { objectName, triggerType: 'record-after-create' },
      },
      {
        id: 'gate',
        type: 'approval',
        label: 'Gate',
        config: { approvers: [approver], behavior: 'first_response', lockRecord: true },
      },
      { id: 'approved', type: 'end', label: 'Approved' },
      { id: 'rejected', type: 'end', label: 'Rejected' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'gate' },
      { id: 'e2', source: 'gate', target: 'approved', label: 'approve' },
      { id: 'e3', source: 'gate', target: 'rejected', label: 'reject' },
    ],
  });
}

export const adminRescueStack = defineStack({
  manifest: {
    id: 'com.dogfood.admin-rescue-slate',
    namespace: 'admin_rescue',
    version: '0.0.0',
    type: 'app',
    name: 'Admin Rescue Slate Fixture',
    description: 'One request routed to a position nobody holds, one routed to a named user.',
  },
  // ADR-0097: the flows' `record-after-create` start nodes need the trigger
  // capability, and `defineStack` refuses `triggers` without `automation`.
  requires: ['automation', 'triggers'],
  objects: [AdminRescueStuck, AdminRescueStaffed],
  flows: [
    approvalFlow('admin_rescue_stuck_flow', 'admin_rescue_stuck', { type: 'position', value: UNSTAFFED_POSITION }),
    approvalFlow('admin_rescue_staffed_flow', 'admin_rescue_staffed', { type: 'user', value: STAFFED_APPROVER_EMAIL }),
  ],
});

const FIXTURE_SUBMITTER_SET = 'admin_rescue_submitter';

/**
 * The fallback set a fresh member resolves to: create + read on both objects,
 * and nothing that confers administrator standing. So a fresh sign-up is a
 * plain member, which is what the "a member sees nothing" half needs.
 */
export const adminRescueSubmitterSet: PermissionSet = PermissionSetSchema.parse({
  name: FIXTURE_SUBMITTER_SET,
  label: 'Admin Rescue Submitter — create + read on the two fixture objects only',
  objects: {
    admin_rescue_stuck: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false },
    admin_rescue_staffed: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false },
  },
});

/** SecurityPlugin whose fresh-member fallback is the submitter-only set above. */
export function adminRescueSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, adminRescueSubmitterSet],
    fallbackPermissionSet: adminRescueSubmitterSet.name,
  });
}
