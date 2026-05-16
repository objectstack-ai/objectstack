// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  SysAccount,
  SysApiKey,
  SysInvitation,
  SysMember,
  SysOrganization,
  SysSession,
  SysTeam,
  SysTeamMember,
  SysTwoFactor,
  SysUser,
  SysUserPreference,
  SysVerification,
} from './identity/index.js';
import {
  SysPermissionSet,
  SysRole,
  SysUserPermissionSet,
  SysRolePermissionSet,
  defaultPermissionSets,
} from './security/index.js';
import { SysAuditLog, SysPresence } from './audit/index.js';
import {
  SysApp,
  SysPackage,
  SysPackageInstallation,
  SysPackageVersion,
  SysProject,
  SysProjectCredential,
  SysProjectMember,
} from './tenant/index.js';
import {
  SysMetadata,
  SysMetadataHistoryObject,
} from './metadata/index.js';

const systemObjects = [
  ['SysUser', SysUser, 'sys_user'],
  ['SysSession', SysSession, 'sys_session'],
  ['SysAccount', SysAccount, 'sys_account'],
  ['SysVerification', SysVerification, 'sys_verification'],
  ['SysOrganization', SysOrganization, 'sys_organization'],
  ['SysMember', SysMember, 'sys_member'],
  ['SysInvitation', SysInvitation, 'sys_invitation'],
  ['SysTeam', SysTeam, 'sys_team'],
  ['SysTeamMember', SysTeamMember, 'sys_team_member'],
  ['SysApiKey', SysApiKey, 'sys_api_key'],
  ['SysTwoFactor', SysTwoFactor, 'sys_two_factor'],
  ['SysUserPreference', SysUserPreference, 'sys_user_preference'],
  ['SysRole', SysRole, 'sys_role'],
  ['SysPermissionSet', SysPermissionSet, 'sys_permission_set'],
  ['SysUserPermissionSet', SysUserPermissionSet, 'sys_user_permission_set'],
  ['SysRolePermissionSet', SysRolePermissionSet, 'sys_role_permission_set'],
  ['SysAuditLog', SysAuditLog, 'sys_audit_log'],
  ['SysPresence', SysPresence, 'sys_presence'],
  ['SysProject', SysProject, 'sys_project'],
  ['SysProjectCredential', SysProjectCredential, 'sys_project_credential'],
  ['SysProjectMember', SysProjectMember, 'sys_project_member'],
  ['SysApp', SysApp, 'sys_app'],
  ['SysPackage', SysPackage, 'sys_package'],
  ['SysPackageVersion', SysPackageVersion, 'sys_package_version'],
  ['SysPackageInstallation', SysPackageInstallation, 'sys_package_installation'],
  ['SysMetadata', SysMetadata, 'sys_metadata'],
  ['SysMetadataHistoryObject', SysMetadataHistoryObject, 'sys_metadata_history'],
] as const;

describe('@objectstack/platform-objects', () => {
  it.each(systemObjects)('%s uses a canonical sys_ short name', (_exportName, object, name) => {
    expect(object.name).toBe(name);
  });

  it.each(systemObjects)('%s is marked as a system object', (_exportName, object) => {
    expect(object.isSystem).toBe(true);
  });

  it.each(systemObjects)('%s does not use deprecated storage identity fields', (_exportName, object) => {
    expect((object as any).namespace).toBeUndefined();
    expect((object as any).tableName).toBeUndefined();
  });

  describe('default permission sets', () => {
    it('exposes the three canonical platform permission sets', () => {
      const names = defaultPermissionSets.map((p) => p.name).sort();
      expect(names).toEqual(['admin_full_access', 'member_default', 'viewer_readonly']);
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
        'sys_organization_self',
        'sys_user_self',
        'tenant_isolation',
      ]);
      const tenantPolicy = (member.rowLevelSecurity ?? []).find((p) => p.name === 'tenant_isolation')!;
      expect(tenantPolicy.using).toBe('organization_id = current_user.organization_id');
      const orgSelf = (member.rowLevelSecurity ?? []).find((p) => p.name === 'sys_organization_self')!;
      expect(orgSelf.object).toBe('sys_organization');
      expect(orgSelf.using).toBe('id = current_user.organization_id');
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
});
