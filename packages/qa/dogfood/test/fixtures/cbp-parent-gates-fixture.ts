// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The `sys_attachment` and `sys_comment` parent gates on a `controlled_by_parent`
// parent (ADR-0055) — the fixture behind
// `cbp-parent-attachment-comment-gates.dogfood.test.ts`.
//
// A `controlled_by_parent` object authors no access of its own: plugin-sharing's
// `effectiveSharingModel` maps it to `public`, so `checkEdit` ABSTAINS on every
// one of its rows, and the security plugin's master-detail write check
// (`ISecurityService.checkControlledByParentWrite`) is what judges an edit of
// it. The objects below put that check on both sides of the gates:
//
//   cpg_account   — the MASTER. `public_read` with an `owner_id`: every member
//                   READS it, only its owner EDITS it (record sharing).
//   cpg_contract  — a `controlled_by_parent` DETAIL of `cpg_account`, with files
//                   and feeds on. A member reads it (its master is readable) and
//                   may edit it only where they may edit its master.
//   cpg_vault     — a second MASTER, `private` (the default) with an `owner_id`:
//                   a non-owner member cannot even read it.
//   cpg_vault_item— a `controlled_by_parent` DETAIL of `cpg_vault`, files on. A
//                   non-owner member cannot read it either (its master is hidden).
//   cpg_board     — the CONTROL: `public_read_write`. `checkEdit` abstains here
//                   too, and here abstention IS permission: no master exists.
//
// Every member falls back to the fixture's permissive baseline (read, create and
// edit on every object), so every refusal the suite measures is a RECORD-level
// answer, never the object gate. The domain set adds the delete bit on
// `sys_attachment` and `sys_comment`, the grant an app ships when it lets members
// manage files and moderate threads.

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

export const CpgAccount = ObjectSchema.create({
  name: 'cpg_account',
  label: 'Gate Account',
  pluralLabel: 'Gate Accounts',
  sharingModel: 'public_read',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    owner_id: Field.text({ label: 'Owner' }),
  },
});

export const CpgContract = ObjectSchema.create({
  name: 'cpg_contract',
  label: 'Gate Contract',
  pluralLabel: 'Gate Contracts',
  sharingModel: 'controlled_by_parent',
  enable: { files: true, feeds: true },
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    account: Field.masterDetail('cpg_account', { label: 'Account', required: true }),
  },
});

export const CpgVault = ObjectSchema.create({
  name: 'cpg_vault',
  label: 'Gate Vault',
  pluralLabel: 'Gate Vaults',
  // sharingModel omitted — a custom object defaults to PRIVATE (ADR-0090).
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    owner_id: Field.text({ label: 'Owner' }),
  },
});

export const CpgVaultItem = ObjectSchema.create({
  name: 'cpg_vault_item',
  label: 'Gate Vault Item',
  pluralLabel: 'Gate Vault Items',
  sharingModel: 'controlled_by_parent',
  enable: { files: true, feeds: true },
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    vault: Field.masterDetail('cpg_vault', { label: 'Vault', required: true }),
  },
});

export const CpgBoard = ObjectSchema.create({
  name: 'cpg_board',
  label: 'Gate Board',
  pluralLabel: 'Gate Boards',
  sharingModel: 'public_read_write',
  enable: { files: true, feeds: true },
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

/** The permissive baseline every member falls back to (read, create, edit everywhere; no delete). */
export const cpgBaselineSet: PermissionSet = PermissionSetSchema.parse({
  name: 'cpg_fixture_baseline',
  label: 'Parent-gate fixture baseline — record-level answers only',
  objects: {
    '*': { allowRead: true, allowCreate: true, allowEdit: true },
  },
});

/** The domain grant: manage attachments and moderate comments. */
export const cpgFilesAndThreadsSet: PermissionSet = PermissionSetSchema.parse({
  name: 'cpg_files_and_threads',
  label: 'Parent-gate fixture — attachment and comment manager',
  objects: {
    sys_attachment: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    sys_comment: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
});

export function cpgSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, cpgBaselineSet, cpgFilesAndThreadsSet],
    fallbackPermissionSet: cpgBaselineSet.name,
  });
}

export const cpgStack = defineStack({
  manifest: {
    id: 'com.dogfood.cbp-parent-gates-fixture',
    namespace: 'cpg',
    version: '0.0.0',
    type: 'app',
    name: 'Controlled-by-Parent Parent Gates Fixture',
    description:
      'Master-detail app exercising the sys_attachment and sys_comment parent gates on a controlled_by_parent parent.',
  },
  objects: [CpgAccount, CpgContract, CpgVault, CpgVaultItem, CpgBoard],
});
