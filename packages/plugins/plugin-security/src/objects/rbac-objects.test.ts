// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysPosition, SysPermissionSet, SysCapability, SysUserPermissionSet, SysUserPosition, defaultPermissionSets } from './index.js';

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
    for (const obj of [
      'sys_position',
      'sys_permission_set',
      'sys_position_permission_set',
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
      // [#8839] The one DELETE-class per-object policy, and the only entry here
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
      'sys_notification_receipt_self',
      'sys_oauth_access_token_self',
      'sys_oauth_application_self',
      'sys_oauth_consent_self',
      'sys_oauth_refresh_token_self',
      'sys_organization_self',
      'sys_session_self',
      'sys_team_member_self',
      'sys_two_factor_self',
      'sys_user_org_members',
      'sys_user_preference_self',
      'sys_user_self',
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

describe('RBAC object canonical names + row actions', () => {
  it('SysPosition / SysPermissionSet use their canonical sys_ short names and are system objects', () => {
    expect(SysPosition.name).toBe('sys_position');
    expect(SysPermissionSet.name).toBe('sys_permission_set');
    expect(SysPosition.isSystem).toBe(true);
    expect(SysPermissionSet.isSystem).toBe(true);
  });

  it('SysPosition exposes activate/deactivate/clone/set-default row actions (ADR-0090 D3 vocabulary)', () => {
    const names = (SysPosition.actions ?? []).map((a) => a.name).sort();
    expect(names).toEqual(['activate_position', 'clone_position', 'deactivate_position', 'set_default_position']);
  });

  it('SysPermissionSet exposes activate/deactivate/clone row actions', () => {
    const names = (SysPermissionSet.actions ?? []).map((a) => a.name).sort();
    expect(names).toEqual(['activate_permission_set', 'clone_permission_set', 'deactivate_permission_set']);
  });

  it('[A4 #2920] SysPermissionSet.managed_by is a select on the unified platform/package/admin vocab', () => {
    const f: any = (SysPermissionSet.fields as any).managed_by;
    expect(f, 'managed_by field exists').toBeDefined();
    expect(f.type).toBe('select');
    expect(f.readonly).toBe(true);
    const opts = (f.options ?? []).map((o: any) => o.value).sort();
    expect(opts).toEqual(['admin', 'package', 'platform']);
  });

  it('[A4 #2920] SysPosition.managed_by is a select on the unified vocab and appears in every list view', () => {
    const f: any = (SysPosition.fields as any).managed_by;
    expect(f, 'managed_by field exists').toBeDefined();
    expect(f.type).toBe('select');
    expect(f.readonly).toBe(true);
    const opts = (f.options ?? []).map((o: any) => o.value).sort();
    expect(opts).toEqual(['admin', 'package', 'platform']);
    // The provenance column is surfaced in all four position list views.
    const views: any = SysPosition.listViews;
    for (const v of ['active', 'default_positions', 'custom', 'all_positions']) {
      expect(views[v].columns, `${v} view shows managed_by`).toContain('managed_by');
    }
  });

  it('[A4 #2920] all three RBAC catalogs share the identical managed_by vocabulary', () => {
    const vocab = (schema: any) =>
      ((schema.fields.managed_by.options ?? []) as any[]).map((o) => o.value).sort();
    const cap = vocab(SysCapability);
    expect(cap).toEqual(['admin', 'package', 'platform']);
    expect(vocab(SysPermissionSet)).toEqual(cap);
    expect(vocab(SysPosition)).toEqual(cap);
  });

  it('[ADR-0094] declares a readonly `customized` provenance flag surfaced in the All list view', () => {
    const f: any = (SysPermissionSet.fields as any).customized;
    expect(f, 'customized field exists').toBeDefined();
    expect(f.type).toBe('boolean');
    expect(f.readonly).toBe(true);
    const allView: any = (SysPermissionSet.listViews as any).all_permsets;
    expect(allView.columns).toContain('customized');
    expect(allView.columns).toContain('managed_by');
  });

  it('[ADR-0094] locks the API name after creation (readonly on edit, editable on create)', () => {
    // The name is the metadata identity the record projects from — renaming
    // through the data door is rejected (400); this is the matching UI lock.
    const nameField: any = (SysPermissionSet.fields as any).name;
    expect(nameField.readonlyWhen, 'name carries a readonlyWhen lock').toBeTruthy();
    // The predicate keys off the server-assigned id: absent on create, present
    // on edit — so create stays editable and edit is locked.
    const pred = JSON.stringify(nameField.readonlyWhen);
    expect(pred).toContain('record.id');
    // The static readonly flag is NOT set (that would block create too).
    expect(nameField.readonly ?? false).toBe(false);
  });
});


describe('sys_capability — ADR-0066 D1 capability registry', () => {
  it('is a system config object with the canonical name', () => {
    expect(SysCapability.name).toBe('sys_capability');
    expect(SysCapability.isSystem).toBe(true);
    expect(SysCapability.managedBy).toBe('config');
  });

  it('declares name/label/scope/managed_by fields', () => {
    const f: any = SysCapability.fields;
    expect(f.name).toBeDefined();
    expect(f.label).toBeDefined();
    expect(f.scope).toBeDefined();
    expect(f.managed_by).toBeDefined();
    // scope + managed_by are constrained selects
    const scopeOpts = (f.scope.options ?? []).map((o: any) => o.value).sort();
    expect(scopeOpts).toEqual(['org', 'platform']);
    const mbOpts = (f.managed_by.options ?? []).map((o: any) => o.value).sort();
    expect(mbOpts).toEqual(['admin', 'package', 'platform']);
  });

  it('enforces a unique index on name, scoped per organization', () => {
    const nameIdx = (SysCapability.indexes ?? []).find((i: any) => Array.isArray(i.fields) && i.fields.includes('name'));
    // [#8323] Was `toBe(true)`. On a DECLARED index bare `true` is the
    // positional spelling of `'global'` — the listed columns verbatim — which
    // made `name` an installation-wide key on a tenant-scoped object and turned
    // its 409 into a cross-tenant existence oracle. The assertion is respelled
    // rather than relaxed: a truthiness check here would accept the very
    // spelling that was the defect. Full contract in
    // `sys-capability.organization-unique.test.ts`.
    expect(nameIdx?.unique).toBe('organization');
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

describe('sys_position — `permissions` is retired (#9885, ADR-0049)', () => {
  it('no longer declares `permissions` — nothing ever wrote or read it', () => {
    // Maintainer ruling 2026-08-20 (REMOVE): the object-scoped census read
    // every sys_position-naming file — the bootstrap writers set label /
    // description / managed_by / active / is_default only, and position→grant
    // resolution consults `sys_position_permission_set` rows plus the position
    // `name`, never a `permissions` column. A free-text grant catalogue no
    // runtime enforces tells an author that direct position-level grants
    // exist; they do not. Re-declaring the key here without a runtime reader
    // in the same change is the exact defect the ruling removed; this pin
    // makes that re-growth loud.
    expect(SysPosition.fields).not.toHaveProperty('permissions');
  });

  it('clone_position no longer copies the retired column (defaultFromRow itself survives)', () => {
    const clone: any = (SysPosition.actions ?? []).find((a: any) => a.name === 'clone_position');
    expect(clone, 'clone_position action still declared').toBeDefined();
    const copied = ((clone.params ?? []) as any[])
      .filter((p) => typeof p.field === 'string')
      .map((p) => p.field);
    // Positive control first: the copy mechanism is untouched — only the
    // retired column left it. A clone that stopped copying `description`
    // would be a different regression, not this retirement.
    expect(copied).toContain('description');
    expect(copied).not.toContain('permissions');
  });
});
