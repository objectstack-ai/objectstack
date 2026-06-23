// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysRole, SysPermissionSet, SysCapability, defaultPermissionSets } from './index.js';

/**
 * RBAC object + default-permission-set assertions. Moved here with the objects
 * from `@objectstack/platform-objects` (ADR-0029 K2) — the plugin that owns the
 * data owns its tests.
 */
describe('default permission sets', () => {
  it('exposes the four canonical platform permission sets', () => {
    const names = defaultPermissionSets.map((p) => p.name).sort();
    expect(names).toEqual([
      'admin_full_access',
      'member_default',
      'organization_admin',
      'viewer_readonly',
    ]);
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
      'sys_role',
      'sys_permission_set',
      'sys_role_permission_set',
      'sys_user_permission_set',
      'sys_user_role',
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
  it('SysRole / SysPermissionSet use their canonical sys_ short names and are system objects', () => {
    expect(SysRole.name).toBe('sys_role');
    expect(SysPermissionSet.name).toBe('sys_permission_set');
    expect(SysRole.isSystem).toBe(true);
    expect(SysPermissionSet.isSystem).toBe(true);
  });

  it('SysRole exposes activate/deactivate/clone/set-default row actions', () => {
    const names = (SysRole.actions ?? []).map((a) => a.name).sort();
    expect(names).toEqual(['activate_role', 'clone_role', 'deactivate_role', 'set_default_role']);
  });

  it('SysPermissionSet exposes activate/deactivate/clone row actions', () => {
    const names = (SysPermissionSet.actions ?? []).map((a) => a.name).sort();
    expect(names).toEqual(['activate_permission_set', 'clone_permission_set', 'deactivate_permission_set']);
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
