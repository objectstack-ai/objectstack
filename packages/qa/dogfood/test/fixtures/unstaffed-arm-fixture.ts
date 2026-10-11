// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Minimal booted-app fixture for the #22725 pin: the approvals inbox's
// `unstaffed` arm, read through the REST door on a real boot.
//
// Two objects, each with one autolaunched `approval` flow that fires on insert:
//
//   - `unstaffed_arm_stuck` routes to a POSITION nothing in this fixture ever
//     staffs. Its node declares no `onEmptyApprovers`, so the default,
//     `admin_rescue`, opens the request on the literal `position:<p>` slot:
//     decidable only by a privileged admin, and before #22725 in nobody's
//     queue.
//   - `unstaffed_arm_staffed` routes to one named user, by email. Its slate
//     names a person, so it is the CONTROL: the arm must never claim it, and
//     its approver's queue must read the same with the arm and without it.
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
export const UNSTAFFED_POSITION = 'unstaffed_arm_nobody';

/** The one person the staffed flow routes to (by email, the slot it stores). */
export const STAFFED_APPROVER_EMAIL = 'unstaffed-arm-approver@example.com';

export const UnstaffedArmStuck = ObjectSchema.create({
  name: 'unstaffed_arm_stuck',
  label: 'Unstaffed Arm Stuck',
  pluralLabel: 'Unstaffed Arm Stuck',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

export const UnstaffedArmStaffed = ObjectSchema.create({
  name: 'unstaffed_arm_staffed',
  label: 'Unstaffed Arm Staffed',
  pluralLabel: 'Unstaffed Arm Staffed',
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

export const unstaffedArmStack = defineStack({
  manifest: {
    id: 'com.dogfood.unstaffed-arm',
    namespace: 'unstaffed_arm',
    version: '0.0.0',
    type: 'app',
    name: 'Unstaffed Arm Fixture',
    description: 'One request routed to a position nobody holds, one routed to a named user.',
  },
  // ADR-0097: the flows' `record-after-create` start nodes need the trigger
  // capability, and `defineStack` refuses `triggers` without `automation`.
  requires: ['automation', 'triggers'],
  objects: [UnstaffedArmStuck, UnstaffedArmStaffed],
  flows: [
    approvalFlow('unstaffed_arm_stuck_flow', 'unstaffed_arm_stuck', { type: 'position', value: UNSTAFFED_POSITION }),
    approvalFlow('unstaffed_arm_staffed_flow', 'unstaffed_arm_staffed', { type: 'user', value: STAFFED_APPROVER_EMAIL }),
  ],
});

const FIXTURE_SUBMITTER_SET = 'unstaffed_arm_submitter';

/**
 * The fallback set a fresh member resolves to: create + read on both objects,
 * and nothing that confers override standing. So the submitter is a plain
 * member, which is what the "it does not appear for a member" half needs.
 */
export const unstaffedArmSubmitterSet: PermissionSet = PermissionSetSchema.parse({
  name: FIXTURE_SUBMITTER_SET,
  label: 'Unstaffed Arm Submitter — create + read on the two fixture objects only',
  objects: {
    unstaffed_arm_stuck: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false },
    unstaffed_arm_staffed: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false },
  },
});

/** SecurityPlugin whose fresh-member fallback is the submitter-only set above. */
export function unstaffedArmSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, unstaffedArmSubmitterSet],
    fallbackPermissionSet: unstaffedArmSubmitterSet.name,
  });
}
