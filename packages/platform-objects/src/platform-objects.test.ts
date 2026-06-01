// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  SysAccount,
  SysApiKey,
  SysInvitation,
  SysMember,
  SysOauthApplication,
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
// sys_webhook moved to @objectstack/plugin-webhooks per ADR-0029 (K2.a).
import {
  SysMetadata,
  SysMetadataHistoryObject,
} from './metadata/index.js';
import { SysSetting } from './system/index.js';
import { SETUP_APP, SETUP_NAV_CONTRIBUTIONS } from './apps/index.js';
import { AppSchema } from '@objectstack/spec/ui';

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
  ['SysMetadata', SysMetadata, 'sys_metadata'],
  ['SysMetadataHistoryObject', SysMetadataHistoryObject, 'sys_metadata_history'],
  ['SysSetting', SysSetting, 'sys_setting'],
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
      expect(tenantPolicy.using).toBe('organization_id = current_user.organization_id');
      const orgSelf = (member.rowLevelSecurity ?? []).find((p) => p.name === 'sys_organization_self')!;
      expect(orgSelf.object).toBe('sys_organization');
      expect(orgSelf.using).toBe('id = current_user.organization_id');
      // The user_id-keyed better-auth tables (sys_session etc.) get
      // per-object carve-outs because the wildcard tenant_isolation
      // policy would otherwise DENY them (they lack organization_id).
      const sessionSelf = (member.rowLevelSecurity ?? []).find((p) => p.name === 'sys_session_self')!;
      expect(sessionSelf.object).toBe('sys_session');
      expect(sessionSelf.using).toBe('user_id = current_user.id');
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

  describe('sysadmin row actions', () => {
    // Setup-App admins must be able to drive the access-control lifecycle
    // without dropping to SQL. These assertions lock in the high-traffic
    // affordances (activate/deactivate/clone for RBAC objects; unlink
    // for identity links) so they cannot silently regress.
    it('SysRole exposes activate/deactivate/clone/set-default row actions', () => {
      const names = (SysRole.actions ?? []).map((a) => a.name).sort();
      expect(names).toEqual(['activate_role', 'clone_role', 'deactivate_role', 'set_default_role']);
    });

    it('SysPermissionSet exposes activate/deactivate/clone row actions', () => {
      const names = (SysPermissionSet.actions ?? []).map((a) => a.name).sort();
      expect(names).toEqual(['activate_permission_set', 'clone_permission_set', 'deactivate_permission_set']);
    });

    it('SysAccount exposes an unlink-account row action wired to better-auth', () => {
      const unlink = (SysAccount.actions ?? []).find((a) => a.name === 'unlink_account');
      expect(unlink).toBeDefined();
      expect(unlink?.target).toBe('/api/v1/auth/unlink-account');
      const paramNames = (unlink?.params ?? []).map((p) => p.name);
      expect(paramNames).toEqual(['providerId', 'accountId']);
    });

    it('SysOauthApplication routes all mutations through better-auth, not the data layer', () => {
      const actions = SysOauthApplication.actions ?? [];
      const names = actions.map((a) => a.name).sort();
      expect(names).toEqual([
        'create_oauth_application',
        'delete_oauth_application',
        'disable_oauth_application',
        'enable_oauth_application',
        'rotate_client_secret',
      ]);

      const create = actions.find((a) => a.name === 'create_oauth_application');
      expect(create?.target).toBe('/api/v1/auth/sys-oauth-application/register');
      expect(create?.method).toBe('POST');
      expect(create?.mode).toBe('create');
      expect(create?.resultDialog?.fields?.map((f) => f.path)).toEqual([
        'client.client_id',
        'client.client_secret',
      ]);

      const rotate = actions.find((a) => a.name === 'rotate_client_secret');
      const del = actions.find((a) => a.name === 'delete_oauth_application');
      const disable = actions.find((a) => a.name === 'disable_oauth_application');
      const enable = actions.find((a) => a.name === 'enable_oauth_application');

      expect(rotate?.target).toBe('/api/v1/auth/oauth2/client/rotate-secret');
      expect(rotate?.method).toBe('POST');
      expect((rotate?.params ?? []).map((p) => p.field)).toEqual(['client_id']);

      expect(del?.target).toBe('/api/v1/auth/oauth2/delete-client');
      expect(del?.method).toBe('POST');
      expect(del?.mode).toBe('delete');

      // Enable/disable both hit the ObjectStack-added bridge route on
      // /api/v1/auth (since better-auth 1.6.11's stock admin endpoint
      // does not accept `disabled` in its update schema). They differ
      // only in the static `disabled` body field and the visibility
      // predicate, so exactly one is active at any time.
      expect(disable?.target).toBe('/api/v1/auth/admin/oauth2/toggle-disabled');
      expect(disable?.bodyExtra).toEqual({ disabled: true });
      expect((disable?.visible as any)?.source).toBe('!record.disabled');
      expect(enable?.target).toBe('/api/v1/auth/admin/oauth2/toggle-disabled');
      expect(enable?.bodyExtra).toEqual({ disabled: false });
      expect((enable?.visible as any)?.source).toBe('record.disabled');

      // Generic CRUD must NOT expose mutating methods — all writes are
      // reserved for better-auth wrappers above so OAuth-specific
      // invariants (token revocation on delete, consent invalidation,
      // disabled checks at runtime) always run.
      expect(SysOauthApplication.enable?.apiMethods).not.toContain('delete');
      expect(SysOauthApplication.enable?.apiMethods).not.toContain('update');
      expect(SysOauthApplication.enable?.apiMethods).not.toContain('create');
    });
  });

  describe('SETUP_APP (ADR-0029 D7 shell)', () => {
    it('parses cleanly through AppSchema', () => {
      expect(() => AppSchema.parse(SETUP_APP)).not.toThrow();
    });

    it('is a shell of group anchors with no enumerated objects', () => {
      const nav = SETUP_APP.navigation ?? [];
      expect(nav.length).toBeGreaterThan(0);
      for (const item of nav) {
        expect(item.type).toBe('group');
        // Shell groups carry no children — entries come from contributions.
        expect((item as { children?: unknown[] }).children).toEqual([]);
      }
    });

    it('keeps the group_integrations anchor (filled by plugin-webhooks contribution)', () => {
      const group = SETUP_APP.navigation?.find((n) => n.id === 'group_integrations');
      expect(group).toBeDefined();
      expect(group?.type).toBe('group');
      // The webhooks entries are no longer static here — plugin-webhooks
      // contributes them into this slot (ADR-0029 D7 / K2.a).
      expect((group as { children?: unknown[] }).children).toEqual([]);
    });
  });

  describe('SETUP_NAV_CONTRIBUTIONS (ADR-0029 D7)', () => {
    const shellGroupIds = new Set(
      (SETUP_APP.navigation ?? []).map((n) => n.id),
    );

    it('all target the setup app and an existing shell group', () => {
      expect(SETUP_NAV_CONTRIBUTIONS.length).toBeGreaterThan(0);
      for (const c of SETUP_NAV_CONTRIBUTIONS) {
        expect(c.app).toBe('setup');
        expect(c.group).toBeDefined();
        expect(shellGroupIds.has(c.group!)).toBe(true);
        expect(Array.isArray(c.items)).toBe(true);
        expect(c.items.length).toBeGreaterThan(0);
      }
    });

    it('does not contribute slots owned by capability plugins', () => {
      // group_integrations → @objectstack/plugin-webhooks (K2.a)
      // group_approvals    → @objectstack/plugin-approvals (K2.b)
      for (const ownedSlot of ['group_integrations', 'group_approvals']) {
        const contrib = SETUP_NAV_CONTRIBUTIONS.find((c) => c.group === ownedSlot);
        expect(contrib).toBeUndefined();
      }
    });
  });
});
