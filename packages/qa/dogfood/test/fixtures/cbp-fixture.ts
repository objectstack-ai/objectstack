// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Master-detail "controlled by parent" fixture (ADR-0055 P2).
//
// A two-object app exercising derived access: `cbp_account` (the MASTER) is
// owner-scoped via RLS on `created_by`; `cbp_note` (the DETAIL) declares
// `sharingModel: 'controlled_by_parent'` with a required master_detail field
// pointing at the account. The detail carries NO authored RLS — its access is
// derived from the master by the security layer (read: `account IN (accessible
// account ids)`; write: requires master edit access).
//
// The proof then asserts both directions: a member who cannot read the admin's
// account cannot read OR by-id-write notes under it, but CAN read/write notes
// under an account they own.

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, RLS, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

/** MASTER — owner-scoped account. */
export const CbpAccount = ObjectSchema.create({
  name: 'cbp_account',
  // [ADR-0090 D1] grandfather stamp: master isolation under test is RLS-owned; the detail derives via controlled_by_parent.
  sharingModel: 'public_read_write',
  label: 'CBP Account',
  pluralLabel: 'CBP Accounts',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

/** DETAIL — note whose access is controlled by its parent account. */
export const CbpNote = ObjectSchema.create({
  name: 'cbp_note',
  label: 'CBP Note',
  pluralLabel: 'CBP Notes',
  sharingModel: 'controlled_by_parent',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    body: Field.text({ label: 'Body' }),
    account: Field.masterDetail('cbp_account', { label: 'Account', required: true }),
  },
});

export const cbpStack = defineStack({
  manifest: {
    id: 'com.dogfood.cbp_fixture',
    namespace: 'cbp',
    version: '0.0.0',
    type: 'app',
    name: 'Controlled-by-Parent Fixture',
    description: 'Master-detail app exercising controlled_by_parent derived access (ADR-0055).',
  },
  objects: [CbpAccount, CbpNote],
});

const FIXTURE_MEMBER_SET = 'cbp_fixture_member';

/**
 * The fallback permission set for a fresh member: full CRUD on both objects (so
 * requests reach the RLS layer rather than being denied by RBAC) and an OWNER
 * policy on the MASTER account. The detail `cbp_note` gets NO RLS — its scoping
 * is derived from the master by `sharingModel: 'controlled_by_parent'`.
 */
export const cbpMemberSet: PermissionSet = PermissionSetSchema.parse({
  name: FIXTURE_MEMBER_SET,
  label: 'CBP Fixture Member — owner-scoped account, controlled-by-parent notes',
  objects: {
    cbp_account: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    cbp_note: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
  rowLevelSecurity: [RLS.ownerPolicy('cbp_account', 'created_by')],
});

export function cbpSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, cbpMemberSet],
    fallbackPermissionSet: FIXTURE_MEMBER_SET,
  });
}
