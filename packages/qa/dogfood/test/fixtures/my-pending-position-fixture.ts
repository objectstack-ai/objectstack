// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Minimal booted-app fixture for the "My Pending" position-address pin.
//
// One object, one autolaunched `approval` flow whose sole node routes to a
// POSITION that nobody holds when the request opens — so the request's slate
// is the literal `position:<p>` slot, exactly what a HotCRM approval carries
// when its approver position is staffed only after submission. The pin then
// staffs a user into that position and asks the approvals inbox's "My
// Pending" door for the request under both approver-address spellings.
//
// Purpose-built rather than borrowed from an example app for the reason
// `override-composite-fixture.ts` gives: showcase's `onEnable` staffs its own
// approval positions on every boot, and the precondition here ("nobody holds
// the position at open time, someone does afterwards") has to be explicit and
// owned by this pin, not incidental to another app's seed.

import { defineStack, defineFlow } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

/** The position the request routes to; staffed only AFTER the request opens. */
export const ROUTED_POSITION = 'my_pending_reviewer';

/** A position the negative-control user holds — never the routed one. */
export const OTHER_POSITION = 'my_pending_bystander';

export const MyPendingRequest = ObjectSchema.create({
  name: 'my_pending_request',
  label: 'My Pending Request',
  pluralLabel: 'My Pending Requests',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

export const MyPendingFlow = defineFlow({
  name: 'my_pending_flow',
  label: 'My Pending Flow',
  description: 'Fires on insert and routes to a position nobody holds yet.',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Create',
      config: { objectName: 'my_pending_request', triggerType: 'record-after-create' },
    },
    {
      id: 'review',
      type: 'approval',
      label: 'Review',
      config: {
        approvers: [{ type: 'position', value: ROUTED_POSITION }],
        behavior: 'first_response',
      },
    },
    { id: 'approved', type: 'end', label: 'Approved' },
    { id: 'rejected', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'review' },
    { id: 'e2', source: 'review', target: 'approved', label: 'approve' },
    { id: 'e3', source: 'review', target: 'rejected', label: 'reject' },
  ],
});

export const myPendingStack = defineStack({
  manifest: {
    id: 'com.dogfood.my-pending-position',
    namespace: 'my_pending',
    version: '0.0.0',
    type: 'app',
    name: 'My Pending Position Fixture',
    description: 'One object, one flow routed to a position staffed after submission.',
  },
  // ADR-0097: the `record-after-create` start node needs the trigger pair
  // declared; the pin mounts both explicitly (see override-composite-fixture).
  requires: ['automation', 'triggers'],
  objects: [MyPendingRequest],
  flows: [MyPendingFlow],
});

const FIXTURE_MEMBER_SET = 'my_pending_member';

/**
 * The fallback set every fresh (non-admin) member resolves to: create + read
 * on `my_pending_request` only. The submitter needs create; nobody needs more,
 * so no member is an admin and none can see the request through an override.
 */
export const myPendingMemberSet: PermissionSet = PermissionSetSchema.parse({
  name: FIXTURE_MEMBER_SET,
  label: 'My Pending Member — create + read on my_pending_request only',
  objects: {
    my_pending_request: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false },
  },
});

/** SecurityPlugin whose fresh-member fallback is the member set above. */
export function myPendingSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, myPendingMemberSet],
    fallbackPermissionSet: myPendingMemberSet.name,
  });
}
