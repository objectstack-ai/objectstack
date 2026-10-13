// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysUserPermissionSet, SysUserPosition, defaultPermissionSets } from './index.js';

/**
 * RBAC object + default-permission-set assertions. Moved here with the objects
 * from `@objectstack/platform-objects` (ADR-0029 K2) — the plugin that owns the
 * data owns its tests.
 */
describe('default permission sets', () => {
  it('exposes the canonical platform permission sets + the ADR-0090 D10 agent ceilings', () => {
    const names = defaultPermissionSets.map((p) => p.name).sort();
    expect(names).toEqual([
      'admin_full_access',
      // [ADR-0090 D10] MCP agent capability ceilings (scope-derived; one side
      // of the agent∩user intersection). Never bound to a position/anchor.
      'mcp_agent_data_read',
      'mcp_agent_data_write',
      'mcp_agent_restricted',
      'member_default',
      'organization_admin',
      // [ADR-0105 D4] The wall-less variant of `organization_admin`, DERIVED
      // from it by dropping the wildcard viewAllRecords/modifyAllRecords bits.
      // Granted by `auto-org-admin-grant` when the posture enforces no
      // organization wall, where nothing would bound them (finding F2).
      'organization_admin_no_bypass',
      'viewer_readonly',
    ]);
  });

  it('the MCP agent ceiling sets carry pure CRUD bits and NO row-level security', () => {
    const read = defaultPermissionSets.find((p) => p.name === 'mcp_agent_data_read')!;
    const write = defaultPermissionSets.find((p) => p.name === 'mcp_agent_data_write')!;
    const restricted = defaultPermissionSets.find((p) => p.name === 'mcp_agent_restricted')!;
    expect(read.rowLevelSecurity ?? []).toEqual([]);
    expect(write.rowLevelSecurity ?? []).toEqual([]);
    // Read-only: read yes, write no.
    expect(read.objects?.['*']?.allowRead).toBe(true);
    expect(read.objects?.['*']?.allowEdit ?? false).toBe(false);
    expect(read.objects?.['*']?.allowCreate ?? false).toBe(false);
    // Write ceiling: full CRUD on the wildcard.
    expect(write.objects?.['*']?.allowEdit).toBe(true);
    expect(write.objects?.['*']?.allowDelete).toBe(true);
    // Restricted floor: no wildcard object grant at all (fail-closed).
    expect(restricted.objects?.['*']).toBeUndefined();
    // None of the agent ceilings carry high-privilege system permissions.
    for (const s of [read, write, restricted]) {
      expect(s.systemPermissions ?? []).toEqual([]);
    }
  });

  it('organization_admin has setup.access but not studio.access / manage_metadata / manage_platform_settings', () => {
    const orgAdmin = defaultPermissionSets.find((p) => p.name === 'organization_admin')!;
    const sys = orgAdmin.systemPermissions ?? [];
    expect(sys).toContain('setup.access');
    expect(sys).toContain('manage_org_users');
    expect(sys).not.toContain('studio.access');
    expect(sys).not.toContain('manage_metadata');
    expect(sys).not.toContain('manage_platform_settings');
  });

  it('organization_admin is read-only on global RBAC tables to prevent privilege escalation', () => {
    const orgAdmin = defaultPermissionSets.find((p) => p.name === 'organization_admin')!;
    // [C3 stage 8] The catalog row objects are retired (ADR-0131 D3); the
    // assignment and grant tables are what is left to protect.
    for (const obj of [
      'sys_user_permission_set',
      'sys_user_position',
    ]) {
      const perms = (orgAdmin.objects as any)[obj];
      expect(perms, `${obj} explicit perms missing`).toBeDefined();
      expect(perms.allowRead).toBe(true);
      expect(perms.allowCreate).toBe(false);
      expect(perms.allowEdit).toBe(false);
      expect(perms.allowDelete).toBe(false);
    }
  });

  it('admin_full_access grants wildcard CRUD with viewAll/modifyAll', () => {
    const admin = defaultPermissionSets.find((p) => p.name === 'admin_full_access')!;
    const wildcard = admin.objects['*'];
    expect(wildcard).toBeDefined();
    expect(wildcard.allowRead).toBe(true);
    expect(wildcard.allowCreate).toBe(true);
    expect(wildcard.allowEdit).toBe(true);
    expect(wildcard.allowDelete).toBe(true);
    expect(wildcard.viewAllRecords).toBe(true);
    expect(wildcard.modifyAllRecords).toBe(true);
  });

  it('member_default ships owner + better-auth self RLS policies; tenant wall is Layer 0 (ADR-0095 D1)', () => {
    const member = defaultPermissionSets.find((p) => p.name === 'member_default')!;
    const policyNames = (member.rowLevelSecurity ?? []).map((p) => p.name).sort();
    // [ADR-0095 D1] `tenant_isolation` RETIRED from the seed — the tenant wall is
    // now Layer 0 (`tenant-layer.ts`), not an OR-merged RLS policy. The remaining
    // policies are business RLS: owner-scoped writes + better-auth `_self` carve-outs.
    expect(policyNames).toEqual([
      'owner_only_deletes',
      'owner_only_writes',
      'sys_account_self',
      'sys_api_key_self',
      // [ADR-0131 D7] The compliance ledger's organization scope on its
      // attribution field `tenant_id`: the ledger has no tenant column, so
      // Layer 0 is inert on it and this is the row scope for a ledger read any
      // set grants. Behaviour is pinned end to end in
      // `sys-audit-log-row-scope.test.ts`; this list only records presence.
      'sys_audit_log_org',
      // [commit c25b2d52a] The one DELETE-class per-object policy, and the only entry here
      // that widens rather than narrows. `owner_only_deletes` above is a
      // parent-blind second implementation of "who may remove this row", and on
      // `sys_comment` it was answering ahead of plugin-audit's
      // author-or-parent-editor gate — killing comment moderation in every
      // org-bound deployment. This contributes the alternate match; the gate
      // still decides. Maintainer-approved widening (2026-08-15), scoped to this
      // object: the wildcard floor above is deliberately unchanged.
      'sys_comment_moderation',
      'sys_device_code_self',
      // [#7344] The personal-inbox pair — not better-auth tables, but the same
      // `_self` shape for the same reason: no `organization_id`, so Layer 0 is
      // inert and these policies are the row scoping for their read grants.
      'sys_inbox_message_self',
      // [#8095] The invitation ledger's row scope. Keyed on `email`, not
      // `user_id`, because an invitation predates the account it invites — the
      // addressee is identified by address. Its object DOES carry
      // `organization_id`, so unlike the two above this is not "Layer 0 is
      // inert here": Layer 0 was engaged and correctly org-scoped, and the org
      // is precisely the audience the row must be hidden from.
      //
      // [#8240] `sys_invitation_issuer` is its sibling and the ONE entry in this
      // list that is not a `_self` shape: it keys on the OTHER end of the row
      // (`inviter_id`), so a `delegated_admin` can review the invitations it
      // issued. It sorts ahead of `_self` alphabetically; the pair is
      // deliberate, not a duplicate to be collapsed.
      'sys_invitation_issuer',
      'sys_invitation_self',
      // [#20027] The credential tables' row scope (`id == null`, no row) —
      // re-judged here, not a drift. `sys_jwks` and `sys_verification` declare
      // `access: private` and "DENY for non-admins", but the managed-object
      // blanket's EXPLICIT read entry opened them to every set holding it.
      // Behaviour is pinned end to end in `private-credential-row-scope.test.ts`;
      // this list only records presence (its twin is last in the list).
      'sys_jwks_none',
      'sys_notification_receipt_self',
      'sys_oauth_access_token_self',
      'sys_oauth_application_self',
      'sys_oauth_consent_self',
      'sys_oauth_refresh_token_self',
      'sys_organization_self',
      // [#20001] The SCIM projection tables' row scope — re-judged here, not a
      // drift: none of the seven carries a tenant column, so Layer 0 is inert
      // on them and the managed-object blanket read every organization's rows.
      // `_self` on the four that name a user; `_none` (`id == null`, no row) on
      // the three that name none. Their behaviour is pinned end to end in
      // `scim-projection-row-scope.test.ts`; this list only records presence.
      'sys_scim_connection_binding_none',
      'sys_scim_group_member_none',
      'sys_scim_group_none',
      'sys_scim_identity_tombstone_self',
      'sys_scim_projection_grant_self',
      'sys_scim_subject_self',
      'sys_scim_user_self',
      'sys_session_self',
      'sys_team_member_self',
      'sys_two_factor_self',
      'sys_user_org_members',
      'sys_user_preference_self',
      'sys_user_self',
      'sys_verification_none',
    ]);
    expect(policyNames).not.toContain('tenant_isolation');
    const orgSelf = (member.rowLevelSecurity ?? []).find((p) => p.name === 'sys_organization_self')!;
    expect(orgSelf.object).toBe('sys_organization');
    expect(orgSelf.using).toBe('id == current_user.organization_id');
    const sessionSelf = (member.rowLevelSecurity ?? []).find((p) => p.name === 'sys_session_self')!;
    expect(sessionSelf.object).toBe('sys_session');
    expect(sessionSelf.using).toBe('user_id == current_user.id');
  });

  it('viewer_readonly denies writes', () => {
    const viewer = defaultPermissionSets.find((p) => p.name === 'viewer_readonly')!;
    const wildcard = viewer.objects['*'];
    expect(wildcard.allowRead).toBe(true);
    expect(wildcard.allowCreate).toBe(false);
    expect(wildcard.allowEdit).toBe(false);
    expect(wildcard.allowDelete).toBe(false);
  });
});

describe('sys_user_permission_set — `delegated_from` is retired (#9730, ADR-0049)', () => {
  it('no longer declares `delegated_from` — the runtime delegation gate never read it here', () => {
    // Maintainer ruling 2026-08-18 (REMOVE): the delegation gate's
    // `isDelegationWrite` is structurally scoped to `sys_user_position`, so on
    // this object the column was declared and data-door-writable while no
    // runtime consumer read it — authoring-lint-only enforcement on a security
    // object. Re-declaring the key here without a runtime reader in the same
    // change is the exact defect the ruling removed; this pin makes that
    // re-growth loud.
    expect(SysUserPermissionSet.fields).not.toHaveProperty('delegated_from');
  });

  it('the ADR-0091 D3 declaration on the sibling `sys_user_position` is untouched', () => {
    // The ruling removes the UNENFORCED half only. Position-table delegation
    // stays declared AND enforced (delegated-admin gate, explain engine, lint).
    const f: any = (SysUserPosition.fields as any).delegated_from;
    expect(f).toBeDefined();
    expect(f.type).toBe('lookup');
    expect(f.reference).toBe('sys_user');
  });
});
