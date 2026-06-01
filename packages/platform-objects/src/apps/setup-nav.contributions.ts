// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup App navigation contributions owned by `@objectstack/platform-objects`
 * (ADR-0029 D7).
 *
 * The Setup App (`setup.app.ts`) is a shell of empty group anchors; these
 * contributions fill the groups with the entries for objects that still live
 * in `@objectstack/platform-objects`. They are registered alongside
 * `SETUP_APP` (via `plugin-auth`'s `manifest.register`).
 *
 * Some groups are intentionally **absent** here because a capability plugin
 * owns them and contributes their entries:
 *   - `group_integrations` → `@objectstack/plugin-webhooks` (ADR-0029 K2.a)
 *   - `group_approvals`     → `@objectstack/plugin-approvals` (ADR-0029 K2.b)
 * As each remaining domain moves to its capability plugin, its entries move out
 * of this file into that plugin the same way.
 *
 * Priority 100 keeps platform-objects base entries ahead of later
 * contributions in the same group (mirrors object owner priority).
 */

import type { NavigationContribution } from '@objectstack/spec/ui';

const BASE_PRIORITY = 100;

export const SETUP_NAV_CONTRIBUTIONS: NavigationContribution[] = [
  {
    app: 'setup',
    group: 'group_overview',
    priority: BASE_PRIORITY,
    items: [
      { id: 'nav_system_overview', type: 'dashboard', label: 'System Overview', dashboardName: 'system_overview', icon: 'activity' },
    ],
  },
  {
    app: 'setup',
    group: 'group_apps',
    priority: BASE_PRIORITY,
    items: [
      { id: 'nav_marketplace_browse', type: 'url', label: 'Browse Marketplace', url: '/apps/setup/system/marketplace', icon: 'store' },
      { id: 'nav_marketplace_installed', type: 'url', label: 'Installed Apps', url: '/apps/setup/system/marketplace/installed', icon: 'package-check', requiresObject: 'sys_package_installation' },
    ],
  },
  {
    app: 'setup',
    group: 'group_people_org',
    priority: BASE_PRIORITY,
    items: [
      { id: 'nav_users', type: 'object', label: 'Users', objectName: 'sys_user', icon: 'user' },
      { id: 'nav_departments', type: 'object', label: 'Departments', objectName: 'sys_department', icon: 'building', requiresObject: 'sys_department' },
      { id: 'nav_teams', type: 'object', label: 'Teams', objectName: 'sys_team', icon: 'users-round' },
      { id: 'nav_organizations', type: 'object', label: 'Organizations', objectName: 'sys_organization', icon: 'building-2' },
      { id: 'nav_invitations', type: 'object', label: 'Invitations', objectName: 'sys_invitation', icon: 'mail' },
    ],
  },
  {
    app: 'setup',
    group: 'group_access_control',
    priority: BASE_PRIORITY,
    items: [
      { id: 'nav_roles', type: 'object', label: 'Roles', objectName: 'sys_role', icon: 'shield-check' },
      { id: 'nav_permission_sets', type: 'object', label: 'Permission Sets', objectName: 'sys_permission_set', icon: 'lock' },
      { id: 'nav_sharing_rules', type: 'object', label: 'Sharing Rules', objectName: 'sys_sharing_rule', icon: 'share-2', requiresObject: 'sys_sharing_rule', requiredPermissions: ['manage_platform_settings'] },
      { id: 'nav_record_shares', type: 'object', label: 'Record Shares', objectName: 'sys_record_share', icon: 'link', requiresObject: 'sys_record_share', requiredPermissions: ['manage_platform_settings'] },
      { id: 'nav_api_keys', type: 'object', label: 'API Keys', objectName: 'sys_api_key', icon: 'key', requiredPermissions: ['manage_platform_settings'] },
    ],
  },
  // group_approvals is contributed by @objectstack/plugin-approvals, which owns
  // sys_approval_request / sys_approval_action (ADR-0029 K2.b).
  {
    app: 'setup',
    group: 'group_configuration',
    priority: BASE_PRIORITY,
    items: [
      { id: 'nav_settings_hub', type: 'url', label: 'All Settings', url: '/apps/setup/system/settings', icon: 'settings-2', requiredPermissions: ['manage_platform_settings'] },
      { id: 'nav_settings_branding', type: 'url', label: 'Branding', url: '/apps/setup/system/settings/branding', icon: 'palette' },
      { id: 'nav_settings_mail', type: 'url', label: 'Email', url: '/apps/setup/system/settings/mail', icon: 'mail', requiredPermissions: ['manage_platform_settings'] },
      { id: 'nav_settings_storage', type: 'url', label: 'File Storage', url: '/apps/setup/system/settings/storage', icon: 'hard-drive', requiredPermissions: ['manage_platform_settings'] },
      { id: 'nav_settings_ai', type: 'url', label: 'AI & Embedder', url: '/apps/setup/system/settings/ai', icon: 'sparkles', requiredPermissions: ['manage_platform_settings'] },
      { id: 'nav_settings_knowledge', type: 'url', label: 'Knowledge', url: '/apps/setup/system/settings/knowledge', icon: 'book-open', requiredPermissions: ['manage_platform_settings'] },
      { id: 'nav_settings_feature_flags', type: 'url', label: 'Feature Flags', url: '/apps/setup/system/settings/feature_flags', icon: 'flag' },
    ],
  },
  {
    app: 'setup',
    group: 'group_diagnostics',
    priority: BASE_PRIORITY,
    items: [
      { id: 'nav_sessions', type: 'object', label: 'Sessions', objectName: 'sys_session', icon: 'monitor' },
      { id: 'nav_audit_logs', type: 'object', label: 'Audit Logs', objectName: 'sys_audit_log', icon: 'scroll-text' },
      { id: 'nav_notifications', type: 'object', label: 'Notification Events', objectName: 'sys_notification', viewName: 'recent', icon: 'bell', requiresObject: 'sys_notification' },
    ],
  },
  {
    app: 'setup',
    group: 'group_advanced',
    priority: BASE_PRIORITY,
    items: [
      { id: 'nav_oauth_apps', type: 'object', label: 'OAuth Applications', objectName: 'sys_oauth_application', icon: 'app-window' },
      { id: 'nav_jwks', type: 'object', label: 'Signing Keys (JWKS)', objectName: 'sys_jwks', icon: 'key-round' },
      { id: 'nav_verifications', type: 'object', label: 'Verifications', objectName: 'sys_verification', icon: 'mail-check' },
      { id: 'nav_two_factor', type: 'object', label: 'Two-Factor', objectName: 'sys_two_factor', icon: 'smartphone' },
      { id: 'nav_device_codes', type: 'object', label: 'Device Codes', objectName: 'sys_device_code', icon: 'qr-code' },
      { id: 'nav_accounts', type: 'object', label: 'Identity Links', objectName: 'sys_account', icon: 'link-2' },
      { id: 'nav_user_preferences', type: 'object', label: 'User Preferences', objectName: 'sys_user_preference', icon: 'sliders' },
    ],
  },
];
