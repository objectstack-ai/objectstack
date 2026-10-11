// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Minimal booted-app fixture for the #16679 composite pin.
//
// One object, one autolaunched `approval` flow whose sole node routes to a
// named approver who is not there to act — the "stranded" shape the #3424
// platform admin override exists to rescue (a slate no one present can decide,
// `lockRecord: true`, otherwise undecidable).
//
// [#22824] A named approver, not a position with no holder: under the default
// `onEmptyApprovers: 'admin_rescue'` a slate that names NO ONE now opens on the
// organization's administrators — the seeded admin among them — so it is no
// longer stranded, and the admin reading it back would hold a slot. The
// override stays break-glass for the slate that still names someone who left,
// which is this one.
//
// ## Why a purpose-built fixture rather than the showcase's own
//    `showcase_budget_approval` (the flow the #16679 measurement round drove)
//
// `@objectstack/example-showcase`'s `onEnable` unconditionally runs
// `registerShowcaseApprovalDemo`, which assigns the dev-seeded admin the
// `manager` / `finance` / `legal` / `exec` positions on EVERY boot
// (`ADMIN_APPROVAL_POSITIONS` in `seed-approval-demo.ts`) — i.e. it STAFFS
// exactly the position `showcase_budget_approval`'s second rung needs
// UNSTAFFED for the card's scene. A dogfood pin that re-booted showcase would
// either race that seed step or have to disable it, coupling this pin's
// stability to an app it does not own. A minimal object + flow answerable to
// no app's `onEnable` keeps the "nobody on the slate can act" precondition
// explicit and permanent instead of incidental.
//
// `record-after-create` (not `-after-update`) is the trigger: the record is
// born already routed to the gate, with no `previous` bookkeeping needed.

import { defineStack, defineFlow } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

/** A named approver no account in this fixture ever is — the stranded slate. */
export const DEPARTED_APPROVER = 'override-composite-departed@example.com';

export const OverrideCompositeRequest = ObjectSchema.create({
  name: 'override_composite_request',
  label: 'Override Composite Request',
  pluralLabel: 'Override Composite Requests',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    amount: Field.number({ label: 'Amount', required: false }),
  },
});

export const OverrideCompositeFlow = defineFlow({
  name: 'override_composite_flow',
  label: 'Override Composite Flow',
  // The stranded scene, in miniature (see the module header above).
  description: 'Fires on insert and routes straight to an approver who is not there to act.',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Create',
      config: { objectName: 'override_composite_request', triggerType: 'record-after-create' },
    },
    {
      id: 'gate',
      type: 'approval',
      label: 'Gate',
      config: {
        approvers: [{ type: 'user', value: DEPARTED_APPROVER }],
        behavior: 'first_response',
        // Locked, matching the card's own scene (`showcase_budget_approval`'s
        // `exec_review` rung) — the record must stay immovable while stuck.
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

export const overrideCompositeStack = defineStack({
  manifest: {
    id: 'com.dogfood.override-composite',
    namespace: 'override_composite',
    version: '0.0.0',
    type: 'app',
    name: 'Override Composite Fixture',
    // The gate-composite pin's fixture app (see the module header above).
    description: 'One object, one flow, one approver who never acts.',
  },
  // ADR-0097: a `record_change` trigger (the flow's `record-after-create`
  // start node) only registers when the app declares it needs the capability
  // — the PAIR, since the trigger installs into the automation service and
  // `defineStack` refuses `triggers` without `automation` (#20332). The pin
  // that boots this stack mounts both explicitly (`automation: true` plus the
  // trigger plugin); this line is the declaration that matches that boot.
  requires: ['automation', 'triggers'],
  objects: [OverrideCompositeRequest],
  flows: [OverrideCompositeFlow],
});

const FIXTURE_SUBMITTER_SET = 'override_composite_submitter';

/**
 * The fallback set a fresh (non-admin) member resolves to: create + read on
 * `override_composite_request` only. Needed so a plain member — never the
 * platform admin — can be the request's SUBMITTER, which is what makes
 * `viewer.is_submitter` false for the admin reading it back (the composite
 * pin needs `can_act: false, is_submitter: false, can_override: true`, the
 * exact triple #16679's measurement round read off the wire).
 */
export const overrideCompositeSubmitterSet: PermissionSet = PermissionSetSchema.parse({
  name: FIXTURE_SUBMITTER_SET,
  label: 'Override Composite Submitter — create + read on override_composite_request only',
  objects: {
    override_composite_request: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false },
  },
});

/** SecurityPlugin whose fresh-member fallback is the submitter-only set above. */
export function overrideCompositeSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, overrideCompositeSubmitterSet],
    fallbackPermissionSet: overrideCompositeSubmitterSet.name,
  });
}
