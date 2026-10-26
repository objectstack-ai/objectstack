// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Flow screen file-intake fixture (#25801).
//
// The shape the card asks for: a wizard that collects everything first —
// including a file — and writes at the end. The record that will own the file
// does not exist while the screen is open, so the upload lands as a `sys_file`
// no record owns yet (ADR-0104 D3), the run resumes with that file's id, and
// the `create_record` after the screen writes the id into the record's `file`
// field — the write that claims the file for the record.
//
// The flow runs as the user (`runAs: 'user'`), so the claiming write is the
// caller's own and the claim is read-judged as #25692 asks; a member, not the
// seeded admin, drives it, so that judgement is a real one.

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import type { Flow } from '@objectstack/spec/automation';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

/** The record the end of the wizard writes, owning the file the screen collected. */
export const SfiContract = ObjectSchema.create({
  name: 'sfi_contract',
  // [ADR-0090 D1] grandfather stamp: the gate under test is the screen's file
  // intake and the claim, not owner-sharing.
  sharingModel: 'public_read_write',
  label: 'Contract',
  pluralLabel: 'Contracts',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    doc: Field.file({ label: 'Signed copy' }),
  },
});

/**
 * `sfi_contract_intake` — start → screen (name, file) → create_record → end.
 *
 * Nothing is written before the screen is answered: the record and the claim
 * both come from the one write after it.
 */
export const flowScreenFileIntake: Flow = {
  name: 'sfi_contract_intake',
  label: 'Contract intake',
  type: 'screen',
  status: 'active',
  runAs: 'user',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'ask',
      type: 'screen',
      label: 'New contract',
      config: {
        title: 'New contract',
        fields: [
          { name: 'contract_name', label: 'Name', type: 'text', required: true },
          { name: 'contract_file', label: 'Signed copy', type: 'file', required: true },
        ],
      },
    },
    {
      id: 'write',
      type: 'create_record',
      label: 'Create contract',
      config: {
        objectName: 'sfi_contract',
        fields: {
          name: { dialect: 'cel', source: 'contract_name' },
          doc: { dialect: 'cel', source: 'contract_file' },
        },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'ask' },
    { id: 'e2', source: 'ask', target: 'write' },
    { id: 'e3', source: 'write', target: 'end' },
  ],
};

/** What a fresh, grant-less member resolves to: create and read on the contract. */
export const sfiMemberSet: PermissionSet = PermissionSetSchema.parse({
  name: 'sfi_fixture_member',
  label: 'Screen file intake fixture member',
  objects: {
    sfi_contract: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
  },
});

/** The platform defaults (the seeded admin keeps full access) plus the member fallback above. */
export function screenFileFixtureSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, sfiMemberSet],
    fallbackPermissionSet: sfiMemberSet.name,
  });
}

export const screenFileStack = defineStack({
  manifest: {
    id: 'com.dogfood.flow-screen-file',
    namespace: 'sfi',
    version: '0.0.0',
    type: 'app',
    name: 'Flow Screen File Intake Fixture',
    description: 'A screen flow that collects a file before the record that owns it exists, then writes and claims it.',
  },
  objects: [SfiContract],
  flows: [flowScreenFileIntake],
});
