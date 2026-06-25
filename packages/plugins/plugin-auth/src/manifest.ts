// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical plugin-auth manifest source.
 *
 * Both `objectstack.config.ts` (compile-time) and `auth-plugin.ts`
 * (runtime `manifest.register`) import from this file so the two
 * registration paths cannot drift (D7).
 */

import {
  SysAccount,
  SysApiKey,
  SysDeviceCode,
  SysInvitation,
  SysMember,
  SysJwks,
  SysOauthAccessToken,
  SysOauthApplication,
  SysOauthConsent,
  SysOauthRefreshToken,
  SysOrganization,
  SysSession,
  SysSsoProvider,
  SysTeam,
  SysTeamMember,
  SysTwoFactor,
  SysUser,
  SysUserPreference,
  SysVerification,
} from '@objectstack/platform-objects/identity';

export const AUTH_PLUGIN_ID = 'com.objectstack.plugin-auth';
export const AUTH_PLUGIN_VERSION = '3.0.1';

/** Identity objects owned by plugin-auth. */
export const authIdentityObjects: any[] = [
  SysUser,
  SysSession,
  SysAccount,
  SysVerification,
  SysOrganization,
  SysMember,
  SysInvitation,
  SysTeam,
  SysTeamMember,
  SysApiKey,
  SysTwoFactor,
  SysUserPreference,
  SysOauthApplication,
  SysOauthAccessToken,
  SysOauthRefreshToken,
  SysOauthConsent,
  SysJwks,
  SysDeviceCode,
  SysSsoProvider,
];

/** Manifest header shared by compile-time config and runtime registration. */
export const authPluginManifestHeader = {
  id: AUTH_PLUGIN_ID,
  namespace: 'sys',
  version: AUTH_PLUGIN_VERSION,
  type: 'plugin' as const,
  scope: 'system' as const,
  defaultDatasource: 'cloud',
  name: 'Authentication & Identity Plugin',
  description: 'Core authentication objects for ObjectStack (User, Session, Account, Verification)',
};
