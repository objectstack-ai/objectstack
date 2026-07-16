// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Owner-isolated RLS fixture — the live, revert-provable #1994 gate.
//
// The example apps and hotcrm boot single-tenant, where the wildcard
// `organization_id` tenant policy is stripped and a fresh member falls back to
// `member_default` (broad read). Result: every object reports `member-visible`,
// so the #1994 cross-owner write invariant ("a user who cannot READ a record
// must not be able to WRITE it") is never actually exercised.
//
// This fixture creates the missing precondition with ZERO dependence on
// org-scoping: a single object `rls_note` whose member permission set carries an
// OWNER policy keyed on `created_by` (`RLS.ownerPolicy`). `created_by` is stamped
// on every record by the engine and the predicate references `current_user.id`
// (not `current_user.organization_id`), so it survives single-tenant stripping.
// A fresh member therefore genuinely CANNOT read a note the admin created — the
// exact cross-owner scenario the runner needs.
//
// Two member permission sets, identical except for the scope of the owner
// policy, drive the green gate and the automated red proof:
//
//   ownerScopedMemberSet   (operation: 'all')    → reads AND writes owner-scoped.
//       The #1994 pre-image check enforces the by-id write → `rls-consistent`.
//   readOnlyScopedMemberSet (operation: 'select') → reads owner-scoped, but NO
//       write policy applies, so the pre-image check has nothing to enforce and
//       the by-id write lands → `rls-hole`. This reproduces the #1994 hole CLASS
//       at the policy layer ("can't read, yet can write") without touching
//       engine code, so the gate's red path is proven on every CI run.

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, RLS, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

/** The one object under test: a private note, owner-scoped via `created_by`. */
export const RlsNote = ObjectSchema.create({
  name: 'rls_note',
  // [ADR-0090 D1] grandfather stamp: this fixture's gate under test is
  // permission-set RLS / flow scoping, not owner-sharing.
  sharingModel: 'public_read_write',
  label: 'RLS Note',
  pluralLabel: 'RLS Notes',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    body: Field.text({ label: 'Body' }),
  },
});

/** A minimal, self-contained app config the dogfood harness can boot. */
export const rlsFixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.rls_fixture',
    namespace: 'rls',
    version: '0.0.0',
    type: 'app',
    name: 'RLS Owner Fixture',
    description: 'Owner-isolated single-object app exercising the #1994 by-id-write invariant.',
  },
  objects: [RlsNote],
});

/**
 * The fallback permission set a fresh member resolves to. Both variants grant
 * CRUD on `rls_note` (so the request reaches the RLS layer rather than being
 * denied by RBAC) and carry an owner RLS policy keyed on `created_by`. They
 * SHARE a name so each can be the `fallbackPermissionSet` of its own boot.
 */
const FIXTURE_MEMBER_SET = 'rls_fixture_member';

const noteCrud = {
  rls_note: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
} as const;

/**
 * GREEN. Owner policy on ALL operations — reads and writes are both
 * owner-scoped. A member cannot read another user's note, and the #1994
 * pre-image check (security-plugin.ts) re-reads the target row under the
 * write-op owner filter before a by-id update/delete, so the write is denied.
 * Expected runner verdict: `rls-consistent`.
 */
export const ownerScopedMemberSet: PermissionSet = PermissionSetSchema.parse({
  name: FIXTURE_MEMBER_SET,
  label: 'RLS Fixture Member — owner-scoped (all ops)',
  objects: noteCrud,
  rowLevelSecurity: [RLS.ownerPolicy('rls_note', 'created_by')],
});

/**
 * RED. Owner policy on SELECT only — reads stay owner-scoped (member still
 * can't see others' notes) but no UPDATE/DELETE policy applies, so
 * `computeRlsFilter` returns null for the write op and the pre-image check is
 * skipped → the by-id write lands. The member mutated a row it could not read:
 * the #1994 hole class. Expected runner verdict: `rls-hole`.
 */
export const readOnlyScopedMemberSet: PermissionSet = PermissionSetSchema.parse({
  name: FIXTURE_MEMBER_SET,
  label: 'RLS Fixture Member — owner-scoped reads only (#1994 hole)',
  objects: noteCrud,
  rowLevelSecurity: [{ ...RLS.ownerPolicy('rls_note', 'created_by'), operation: 'select' }],
});

/**
 * Build a SecurityPlugin whose fallback (for a fresh, grant-less member) is the
 * given fixture permission set, layered on top of the real platform defaults so
 * the seeded admin keeps `admin_full_access`.
 */
export function rlsFixtureSecurity(memberSet: PermissionSet): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, memberSet],
    fallbackPermissionSet: memberSet.name,
  });
}
