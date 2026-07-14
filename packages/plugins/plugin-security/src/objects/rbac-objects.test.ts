// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysPosition, SysPermissionSet, SysCapability, defaultPermissionSets } from './index.js';

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

  it('member_default ships tenant + owner RLS policies plus better-auth system table guards', () => {
    const member = defaultPermissionSets.find((p) => p.name === 'member_default')!;
    const policyNames = (member.rowLevelSecurity ?? []).map((p) => p.name).sort();
    expect(policyNames).toEqual([
      'owner_only_deletes',
      'owner_only_writes',
      'sys_account_self',
      'sys_api_key_self',
      'sys_device_code_self',
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
      'tenant_isolation',
    ]);
    const tenantPolicy = (member.rowLevelSecurity ?? []).find((p) => p.name === 'tenant_isolation')!;
    expect(tenantPolicy.using).toBe('organization_id == current_user.organization_id');
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

  it('enforces a unique index on name', () => {
    const nameIdx = (SysCapability.indexes ?? []).find((i: any) => Array.isArray(i.fields) && i.fields.includes('name'));
    expect(nameIdx?.unique).toBe(true);
  });
});
