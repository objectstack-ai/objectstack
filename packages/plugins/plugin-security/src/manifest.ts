// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical plugin-security manifest source.
 *
 * Both `objectstack.config.ts` (compile-time) and `security-plugin.ts`
 * (runtime `manifest.register`) import from this file so the two
 * registration paths cannot drift (D7).
 */

import {
  SysUserPermissionSet,
  SysUserPosition,
  SysAudienceBindingSuggestion,
  defaultPermissionSets,
} from './objects/index.js';

export const SECURITY_PLUGIN_ID = 'com.objectstack.plugin-security';
export const SECURITY_PLUGIN_VERSION = '1.0.0';

/**
 * Security objects owned by plugin-security.
 *
 * [ADR-0131 D3] The catalog itself — positions, permission sets, capabilities
 * and the position → set binding — is no object: it lives in the security
 * catalog (the environment registry). What stays here are the assignments and
 * grants that name catalog items, and the audience-binding suggestions.
 */
export const securityObjects = [
  SysUserPermissionSet,
  SysUserPosition,
  SysAudienceBindingSuggestion,
];

/** Default platform permission sets (admin / member / viewer). */
export const securityDefaultPermissionSets = defaultPermissionSets;

/** Manifest header shared by compile-time config and runtime registration. */
export const securityPluginManifestHeader = {
  id: SECURITY_PLUGIN_ID,
  namespace: 'sys',
  version: SECURITY_PLUGIN_VERSION,
  type: 'plugin' as const,
  scope: 'system' as const,
  defaultDatasource: 'cloud',
  name: 'Security Plugin',
  description: 'RBAC positions and permission sets for ObjectStack (Position, PermissionSet)',
};
