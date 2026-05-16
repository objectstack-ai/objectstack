// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Platform Setup App — static definition.
 *
 * Lists every `sys_*` administrative object as a left-hand navigation
 * entry in ObjectUI's "Setup" area. Lives here (alongside the object
 * schemas it references) instead of being assembled at runtime by
 * `@objectstack/plugin-setup` — that plugin existed only because the
 * referenced objects used to live in three different runtime plugins
 * (auth/security/audit). Now that all `sys_*` objects are centralized
 * in `@objectstack/platform-objects`, the Setup App is a fixed metadata
 * artifact too and can be exported as plain data.
 *
 * The runtime registration happens in `plugin-auth` (which is always
 * loaded alongside security + audit and already calls
 * `manifest.register({...})`).
 *
 * Menu shape: flat `navigation[]` with `type: 'group'` category nodes,
 * matching the convention used by the CRM example app
 * (`examples/app-crm/src/apps/crm.app.ts`). The legacy `areas[]` shape
 * was abandoned because it rendered poorly compared to the category
 * style ObjectUI is built around.
 */

import type { App } from '@objectstack/spec/ui';

export const SETUP_APP: App = {
  name: 'setup',
  label: 'Setup',
  description: 'Platform settings and administration',
  icon: 'settings',
  active: true,
  isDefault: false,
  branding: {
    primaryColor: '#475569', // Slate-600 — neutral admin palette
  },
  requiredPermissions: ['setup.access'],
  navigation: [
    {
      id: 'group_overview',
      type: 'group',
      label: 'Overview',
      icon: 'layout-dashboard',
      children: [
        { id: 'nav_system_overview', type: 'dashboard', label: 'System Overview', dashboardName: 'system_overview', icon: 'activity' },
        { id: 'nav_security_overview', type: 'dashboard', label: 'Security Overview', dashboardName: 'security_overview', icon: 'shield' },
      ],
    },
    {
      id: 'group_administration',
      type: 'group',
      label: 'Administration',
      icon: 'shield',
      children: [
        { id: 'nav_users', type: 'object', label: 'Users', objectName: 'sys_user', icon: 'users' },
        { id: 'nav_organizations', type: 'object', label: 'Organizations', objectName: 'sys_organization', icon: 'building-2' },
        { id: 'nav_teams', type: 'object', label: 'Teams', objectName: 'sys_team', icon: 'users-round' },
        { id: 'nav_api_keys', type: 'object', label: 'API Keys', objectName: 'sys_api_key', icon: 'key' },
        { id: 'nav_roles', type: 'object', label: 'Roles', objectName: 'sys_role', icon: 'shield-check' },
        { id: 'nav_permission_sets', type: 'object', label: 'Permission Sets', objectName: 'sys_permission_set', icon: 'lock' },
        { id: 'nav_user_permission_sets', type: 'object', label: 'User Permission Sets', objectName: 'sys_user_permission_set', icon: 'user-check' },
        { id: 'nav_role_permission_sets', type: 'object', label: 'Role Permission Sets', objectName: 'sys_role_permission_set', icon: 'shield-plus' },
        { id: 'nav_oauth_apps', type: 'object', label: 'OAuth Apps', objectName: 'sys_oauth_application', icon: 'app-window' },
        { id: 'nav_jwks', type: 'object', label: 'Signing Keys', objectName: 'sys_jwks', icon: 'key-round' },
      ],
    },
    {
      id: 'group_platform',
      type: 'group',
      label: 'Platform',
      icon: 'layers',
      children: [
        // `sys_app` / `sys_package` / `sys_package_installation` are
        // contributed by `@objectstack/service-tenant` (control-plane scope).
        // Single-project runtimes do not register them — the `requiresObject`
        // capability flag tells the frontend to hide these entries when the
        // backing object is not in the SchemaRegistry, avoiding the
        // 404-when-clicked trap.
        { id: 'nav_apps', type: 'object', label: 'Apps', objectName: 'sys_app', icon: 'layout-grid', requiresObject: 'sys_app' },
        { id: 'nav_packages', type: 'object', label: 'Packages', objectName: 'sys_package', icon: 'package', requiresObject: 'sys_package' },
        { id: 'nav_package_installations', type: 'object', label: 'Installations', objectName: 'sys_package_installation', icon: 'package-check', requiresObject: 'sys_package_installation' },
        { id: 'nav_metadata', type: 'object', label: 'All Metadata', objectName: 'sys_metadata', icon: 'file-cog' },
      ],
    },
    {
      id: 'group_system',
      type: 'group',
      label: 'System',
      icon: 'settings',
      children: [
        { id: 'nav_sessions', type: 'object', label: 'Sessions', objectName: 'sys_session', icon: 'monitor' },
        { id: 'nav_audit_logs', type: 'object', label: 'Audit Logs', objectName: 'sys_audit_log', icon: 'scroll-text' },
        { id: 'nav_activity', type: 'object', label: 'Activity', objectName: 'sys_activity', icon: 'activity' },
        { id: 'nav_comments', type: 'object', label: 'Comments', objectName: 'sys_comment', icon: 'message-square' },
      ],
    },
  ],
};
