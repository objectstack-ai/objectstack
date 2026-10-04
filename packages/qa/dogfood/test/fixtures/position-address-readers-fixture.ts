// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Minimal booted-app fixture for the slot-address readers pin (#21379).
//
// Two objects, each with one autolaunched `approval` flow:
//
//   - `pa_position_request` routes to a POSITION nobody holds when the request
//     opens, so its slate is the literal `position:<p>` slot — the shape a
//     HotCRM approval carries when its approver position is staffed only after
//     submission (the #21350 fixture's precondition, owned by this pin);
//   - `pa_email_request` routes to a `user` approver authored as an EMAIL, so
//     its slate is the email itself.
//
// Purpose-built for the reason `my-pending-position-fixture.ts` gives: the
// preconditions ("nobody holds the position at open time", "the slot is an
// email") have to be explicit and owned by the pin.

import { defineStack, defineFlow } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

/** The position the position-routed request goes to; staffed only AFTER it opens. */
export const ROUTED_POSITION = 'pa_reviewer';

/** A position the bystander holds — never the routed one. */
export const OTHER_POSITION = 'pa_bystander';

/** The email the email-routed request's `user` approver is authored as. */
export const EMAIL_APPROVER = 'pa-email-reviewer@example.com';

const requestObject = (name: string, label: string) => ObjectSchema.create({
  name,
  label,
  pluralLabel: `${label}s`,
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

export const PositionRequest = requestObject('pa_position_request', 'Position Request');
export const EmailRequest = requestObject('pa_email_request', 'Email Request');

const routedFlow = (name: string, object: string, approver: { type: 'position' | 'user'; value: string }) =>
  defineFlow({
    name,
    label: name,
    description: `Fires on insert and routes to a ${approver.type} approver.`,
    type: 'autolaunched',
    status: 'active',
    nodes: [
      { id: 'start', type: 'start', label: 'On Create', config: { objectName: object, triggerType: 'record-after-create' } },
      {
        id: 'review',
        type: 'approval',
        label: 'Review',
        config: { approvers: [approver], behavior: 'first_response' },
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

export const positionAddressReadersStack = defineStack({
  manifest: {
    id: 'com.dogfood.position-address-readers',
    namespace: 'pa',
    version: '0.0.0',
    type: 'app',
    name: 'Position Address Readers Fixture',
    description: 'One position-routed and one email-routed approval flow.',
  },
  // ADR-0097: the `record-after-create` start node needs the trigger pair
  // declared; the pin mounts both explicitly (see override-composite-fixture).
  requires: ['automation', 'triggers'],
  objects: [PositionRequest, EmailRequest],
  flows: [
    routedFlow('pa_position_flow', 'pa_position_request', { type: 'position', value: ROUTED_POSITION }),
    routedFlow('pa_email_flow', 'pa_email_request', { type: 'user', value: EMAIL_APPROVER }),
  ],
});

const FIXTURE_MEMBER_SET = 'pa_member';

/**
 * The fallback set every fresh (non-admin) member resolves to: create + read on
 * the two request objects only, so no member sees a request through an
 * override.
 */
export const positionAddressReadersMemberSet: PermissionSet = PermissionSetSchema.parse({
  name: FIXTURE_MEMBER_SET,
  label: 'Position Address Readers Member — create + read on the request objects only',
  objects: {
    pa_position_request: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false },
    pa_email_request: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false },
  },
});

/** SecurityPlugin whose fresh-member fallback is the member set above. */
export function positionAddressReadersSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, positionAddressReadersMemberSet],
    fallbackPermissionSet: positionAddressReadersMemberSet.name,
  });
}
