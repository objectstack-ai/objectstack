// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Minimal booted-app fixture for the reassign-own-slot pin: one object whose
// autolaunched `approval` flow opens ONE multi-approver step on insert — two
// named users, by email, behaviour `unanimous` — so a request carries two
// required slots, each held by a different person.
//
// Purpose-built for the reason `override-composite-fixture.ts` gives: the pin
// needs a slate it owns, with two plain members on it and no administrator.

import { defineStack, defineFlow } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

/** The two required approvers, by email (the slot address each one stores). */
export const FIRST_APPROVER_EMAIL = 'reassign-own-slot-first@example.com';
export const SECOND_APPROVER_EMAIL = 'reassign-own-slot-second@example.com';

export const ReassignOwnSlot = ObjectSchema.create({
  name: 'reassign_own_slot',
  label: 'Reassign Own Slot',
  pluralLabel: 'Reassign Own Slot',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

const reassignOwnSlotFlow = defineFlow({
  name: 'reassign_own_slot_flow',
  label: 'reassign_own_slot_flow',
  description: 'Fires on insert of reassign_own_slot and opens one unanimous step on two named users.',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Create',
      config: { objectName: 'reassign_own_slot', triggerType: 'record-after-create' },
    },
    {
      id: 'gate',
      type: 'approval',
      label: 'Gate',
      config: {
        approvers: [
          { type: 'user', value: FIRST_APPROVER_EMAIL },
          { type: 'user', value: SECOND_APPROVER_EMAIL },
        ],
        behavior: 'unanimous',
        lockRecord: true,
      },
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

export const reassignOwnSlotStack = defineStack({
  manifest: {
    id: 'com.dogfood.reassign-own-slot',
    namespace: 'reassign_own',
    version: '0.0.0',
    type: 'app',
    name: 'Reassign Own Slot Fixture',
    description: 'One unanimous approval step on two named users.',
  },
  // ADR-0097: the flow's `record-after-create` start node needs the trigger
  // capability, and `defineStack` refuses `triggers` without `automation`.
  requires: ['automation', 'triggers'],
  objects: [ReassignOwnSlot],
  flows: [reassignOwnSlotFlow],
});

const FIXTURE_MEMBER_SET = 'reassign_own_slot_member';

/**
 * The fallback set a fresh member resolves to: create + read on the fixture
 * object, and nothing that confers administrator standing — so every sign-up
 * is a plain member, and only the dev admin holds the override.
 */
export const reassignOwnSlotMemberSet: PermissionSet = PermissionSetSchema.parse({
  name: FIXTURE_MEMBER_SET,
  label: 'Reassign Own Slot Member — create + read on the fixture object only',
  objects: {
    reassign_own_slot: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false },
  },
});

/** SecurityPlugin whose fresh-member fallback is the member-only set above. */
export function reassignOwnSlotSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, reassignOwnSlotMemberSet],
    fallbackPermissionSet: reassignOwnSlotMemberSet.name,
  });
}
