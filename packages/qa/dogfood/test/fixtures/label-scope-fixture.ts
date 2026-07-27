// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Two-object fixture for the #3602 dimension-label leak (residual 1).
//
// A dataset that groups by a LOOKUP dimension resolves each grouped FK id to the
// related record's display NAME. That label read used to carry no read scope, so
// it revealed the referenced record's name even when the reader could not read
// that record — the leak fires whenever the base object's rows point at a
// referenced record the reader's RLS hides.
//
// This fixture reproduces exactly that with zero dependence on org-scoping:
//   • `lbl_vendor` — owner-scoped on `created_by`.
//   • `lbl_deal`   — owner-scoped on `created_by`, with a `vendor` lookup.
// A member owns a deal that points at a vendor OWNED BY THE ADMIN. The member can
// read their deal (owner match) but NOT the vendor (owned by someone else), so a
// deals-by-vendor dataset must show the vendor's raw id to the member and its
// display name only to the admin who owns it.

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, RLS, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

export const Vendor = ObjectSchema.create({
  name: 'lbl_vendor',
  // [ADR-0090 D1] grandfather stamp — the gate under test is permission-set RLS,
  // not owner-sharing.
  sharingModel: 'public_read_write',
  label: 'Vendor',
  pluralLabel: 'Vendors',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

export const Deal = ObjectSchema.create({
  name: 'lbl_deal',
  sharingModel: 'public_read_write',
  label: 'Deal',
  pluralLabel: 'Deals',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    amount: Field.number({ label: 'Amount' }),
    vendor: Field.lookup('lbl_vendor', { label: 'Vendor' }),
  },
});

export const labelScopeStack = defineStack({
  manifest: {
    id: 'com.dogfood.label_scope',
    namespace: 'lbl',
    version: '0.0.0',
    type: 'app',
    name: 'Label Scope Fixture',
    description: 'Deal → vendor lookup exercising the #3602 label read-scope leak.',
  },
  objects: [Vendor, Deal],
});

const MEMBER_SET = 'lbl_fixture_member';

/**
 * The fallback set a fresh member resolves to: CRUD on both objects (so requests
 * reach the RLS layer rather than being denied by RBAC) plus an OWNER policy on
 * each. The member therefore reads only rows they own — the precondition the
 * label leak needs (their deal points at the admin's vendor).
 */
export const memberSet: PermissionSet = PermissionSetSchema.parse({
  name: MEMBER_SET,
  label: 'Label Fixture Member — owner-scoped',
  objects: {
    lbl_deal: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    lbl_vendor: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
  rowLevelSecurity: [
    RLS.ownerPolicy('lbl_deal', 'created_by'),
    RLS.ownerPolicy('lbl_vendor', 'created_by'),
  ],
});

export function labelScopeSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, memberSet],
    fallbackPermissionSet: memberSet.name,
  });
}
