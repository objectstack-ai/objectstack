// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Flow `runAs` identity-enforcement fixture — the live, revert-provable #1888 gate.
//
// `flow.runAs` declares the execution identity for a run's data operations:
//   • `system` → elevated, RLS-bypassing system principal (full access),
//   • `user`   → the triggering user (RLS-respecting; cannot exceed their grants).
// The bug (#1888): the engine IGNORED `runAs`. CRUD nodes passed no identity to
// ObjectQL at all, so the security middleware was skipped entirely — every flow
// ran effectively elevated regardless of `runAs`. A `runAs:'user'` flow did NOT
// de-elevate (a privilege-boundary surprise), and `runAs:'system'` did not
// *explicitly* elevate (it merely happened to be unscoped too).
//
// This fixture reproduces the boundary with ZERO dependence on org-scoping,
// mirroring rls-owner-fixture: one object `runas_note` whose member permission
// set carries an OWNER policy keyed on `created_by` (survives single-tenant
// stripping because the predicate references `current_user.id`). A fresh member
// therefore genuinely CANNOT read or write a note the admin created.
//
// Four flows over that object, each triggered by the RESTRICTED member, prove
// BOTH directions of the fix:
//   • runas_system_touch / runas_system_read (runAs:'system') — elevate: the
//     member-triggered run WRITES / READS the admin's note it cannot itself touch.
//   • runas_user_touch   / runas_user_read   (runAs:'user')   — de-elevate: the
//     same run is RLS-denied on the admin's note (write lands nowhere; read empty).
//
// Before the fix the user-mode flows wrongly succeed (security skipped) → RED.
// After the fix they are correctly denied while system-mode still succeeds → GREEN.

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, RLS, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

/** The one object under test: an owner-scoped note (isolated via `created_by`). */
export const RunAsNote = ObjectSchema.create({
  name: 'runas_note',
  // [ADR-0090 D1] grandfather stamp: this fixture's gate under test is
  // permission-set RLS / flow scoping, not owner-sharing.
  sharingModel: 'public_read_write',
  label: 'RunAs Note',
  pluralLabel: 'RunAs Notes',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    status: Field.text({ label: 'Status' }),
  },
});

/**
 * `runas_<mode>_touch` — start → update_record → end. Sets `status` on the note
 * whose id is passed as the `noteId` input variable. The two variants differ
 * ONLY in `runAs`, isolating the identity switch as the single variable.
 */
function touchFlow(name: string, runAs: 'system' | 'user', stamp: string) {
  return {
    name,
    label: `RunAs ${runAs} touch`,
    type: 'autolaunched',
    runAs,
    variables: [{ name: 'noteId', type: 'text', isInput: true }],
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      {
        id: 'touch',
        type: 'update_record',
        label: 'Touch note',
        config: { objectName: 'runas_note', filter: { id: '{noteId}' }, fields: { status: stamp } },
      },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'touch' },
      { id: 'e2', source: 'touch', target: 'end' },
    ],
  };
}

/**
 * `runas_<mode>_read` — start → get_record → end. Reads the note by id into the
 * `found` output variable, surfaced on the trigger response as
 * `data.output.found`. Under `system` the elevated read returns the record;
 * under `user` the RLS-scoped read returns null.
 */
function readFlow(name: string, runAs: 'system' | 'user') {
  return {
    name,
    label: `RunAs ${runAs} read`,
    type: 'autolaunched',
    runAs,
    variables: [
      { name: 'noteId', type: 'text', isInput: true },
      { name: 'found', type: 'text', isOutput: true },
    ],
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      {
        id: 'get',
        type: 'get_record',
        label: 'Get note',
        config: { objectName: 'runas_note', filter: { id: '{noteId}' }, outputVariable: 'found' },
      },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'get' },
      { id: 'e2', source: 'get', target: 'end' },
    ],
  };
}

export const runasSystemTouch = touchFlow('runas_system_touch', 'system', 'touched-system');
export const runasUserTouch = touchFlow('runas_user_touch', 'user', 'touched-user');
export const runasSystemRead = readFlow('runas_system_read', 'system');
export const runasUserRead = readFlow('runas_user_read', 'user');

/** A minimal, self-contained app config the dogfood harness can boot. */
export const runasFixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.runas_fixture',
    namespace: 'runas',
    version: '0.0.0',
    type: 'app',
    name: 'Flow runAs Fixture',
    description: 'Owner-isolated single-object app exercising flow.runAs identity enforcement (#1888).',
  },
  objects: [RunAsNote],
  flows: [runasSystemTouch, runasUserTouch, runasSystemRead, runasUserRead],
});

/**
 * The fallback permission set a fresh member resolves to: full CRUD on
 * `runas_note` (so the request reaches the RLS layer, not an RBAC wall) plus an
 * owner RLS policy on ALL operations keyed on `created_by`. A member can read
 * and write their OWN notes, but neither read nor write the admin's — the exact
 * cross-owner isolation the runAs proof needs on both directions.
 */
const FIXTURE_MEMBER_SET = 'runas_fixture_member';

export const runasMemberSet: PermissionSet = PermissionSetSchema.parse({
  name: FIXTURE_MEMBER_SET,
  label: 'RunAs Fixture Member — owner-scoped (all ops)',
  objects: {
    runas_note: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
  rowLevelSecurity: [RLS.ownerPolicy('runas_note', 'created_by')],
});

/**
 * Build a SecurityPlugin whose fallback (for a fresh, grant-less member) is the
 * owner-scoped fixture set, layered on the real platform defaults so the seeded
 * admin keeps `admin_full_access` (and can create the note + read everything).
 */
export function runasFixtureSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, runasMemberSet],
    fallbackPermissionSet: runasMemberSet.name,
  });
}
