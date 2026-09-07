// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical @objectstack/organizations manifest source — imported by the
 * plugin's runtime `manifest.register` (and any compile-time config) so the
 * registration paths cannot drift.
 */

export const ORGANIZATIONS_PLUGIN_ID = 'com.objectstack.organizations';
export const ORGANIZATIONS_PLUGIN_VERSION = '1.0.0';

/** This plugin owns no `sys_*` objects — Organization itself lives in `@objectstack/platform-objects`. */
export const organizationsObjects = [] as const;

/** Manifest header shared by compile-time config and runtime registration. */
export const organizationsPluginManifestHeader = {
  id: ORGANIZATIONS_PLUGIN_ID,
  namespace: 'sys',
  version: ORGANIZATIONS_PLUGIN_VERSION,
  type: 'plugin' as const,
  scope: 'system' as const,
  defaultDatasource: 'cloud',
  name: 'Organizations',
  description:
    'Multi-organization runtime: row-level Organization isolation (auto-stamps ' +
    '`organization_id` on insert from `ExecutionContext.tenantId`), per-org seed replay, and the ' +
    'multi-org default-organization bootstrap.',
};
