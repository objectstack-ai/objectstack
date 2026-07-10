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
 * Some entries/groups are intentionally contributed by the capability plugin
 * that owns the underlying objects rather than living here (ADR-0029 K2):
 *   - `group_integrations` → `@objectstack/plugin-webhooks` (K2.a)
 *   - `group_approvals`     → `@objectstack/plugin-approvals` (K2.b)
 *   - `group_access_control` Positions / Permission Sets → `@objectstack/plugin-security`
 *   - `group_access_control` Sharing Rules / Record Shares → `@objectstack/plugin-sharing`
 * As each remaining domain moves to its capability plugin, its entries move out
 * of this file into that plugin the same way.
 *
 * Priority 100 keeps platform-objects base entries ahead of later
 * contributions in the same group (mirrors object owner priority).
 */

import type { NavigationContribution } from '@objectstack/spec/ui';

const BASE_PRIORITY = 100;

// Marketplace entries (browse / installed) moved to
// @objectstack/cloud-connection's marketplace plugins (cloud ADR-0009:
// the nav lives and dies with the capability — no plugin, no entry).
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
    // Package ADMINISTRATION is a platform/operator concern (ADR-0084:
    // packages are Operate, out of the builder) — so its home is Setup, not
    // the application builder. The console binds `developer:packages` to the
    // existing package-management page. Building/creating apps is a separate
    // journey (Home cover → /studio); this entry is for install/inspect/admin.
    app: 'setup',
    group: 'group_apps',
    priority: BASE_PRIORITY,
    items: [
      { id: 'nav_packages', type: 'component', label: 'Packages', componentRef: 'developer:packages', icon: 'package' },
    ],
  },
  {
    app: 'setup',
    group: 'group_people_org',
    priority: BASE_PRIORITY,
    items: [
      { id: 'nav_users', type: 'object', label: 'Users', objectName: 'sys_user', icon: 'user' },
      // The ACTIVE organization's record page (Members / Invitations / Teams
      // tabs with the better-auth row actions), rendered inside the app shell
      // (ADR-0081). `{current_org_id}` resolves from the session's active
      // organization; unresolved (e.g. org-less admin before bootstrap) it
      // falls back to the sys_organization list — one row in single-org.
      { id: 'nav_organization', type: 'object', label: 'Organization', objectName: 'sys_organization', recordId: '{current_org_id}', icon: 'building-2' },
      { id: 'nav_business_units', type: 'object', label: 'Business Units', objectName: 'sys_business_unit', icon: 'building', requiresObject: 'sys_business_unit' },
      // Teams / Invitations no longer gate on `org-scoping` (ADR-0081 D1):
      // the better-auth organization capability is always mounted, and
      // plugin-auth's single-org default-org bootstrap guarantees an org to
      // invite into — these are the OPEN member-management basics. Only the
      // org LIST below keeps the gate: browsing organizations is meaningful
      // only when more than one can exist (enterprise multi-org).
      { id: 'nav_teams', type: 'object', label: 'Teams', objectName: 'sys_team', icon: 'users-round' },
      { id: 'nav_organizations', type: 'object', label: 'Organizations', objectName: 'sys_organization', icon: 'building-2', requiresService: 'org-scoping' },
      { id: 'nav_invitations', type: 'object', label: 'Invitations', objectName: 'sys_invitation', icon: 'mail' },
    ],
  },
  {
    app: 'setup',
    group: 'group_access_control',
    // Priority 300 keeps API Keys after plugin-security's Positions / Permission
    // Sets (100) and plugin-sharing's Sharing Rules / Record Shares (200),
    // preserving the original menu order.
    priority: 300,
    items: [
      // Positions / Permission Sets are contributed by @objectstack/plugin-security
      // and Sharing Rules / Record Shares by @objectstack/plugin-sharing
      // (ADR-0029 K2). Only API Keys (sys_api_key, an identity object owned by
      // plugin-auth) remains a platform-objects base entry here.
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
      // Workspace identity first — Localization (order 2) and Company (order 3)
      // are the lowest-`order` settings manifests and the first thing a new
      // company admin configures. They ship as `service-settings` manifests
      // (tenant scope, read=`setup.access`) but were never pinned here, so they
      // were reachable only by drilling into the "All Settings" hub. Mainstream
      // admin consoles (Salesforce "Company Information", ServiceNow) surface
      // both directly. No `requiredPermissions` — matches Branding (read perm is
      // the app's base `setup.access`).
      { id: 'nav_settings_localization', type: 'url', label: 'Localization', url: '/apps/setup/system/settings/localization', icon: 'globe' },
      { id: 'nav_settings_company', type: 'url', label: 'Company', url: '/apps/setup/system/settings/company', icon: 'building-2' },
      { id: 'nav_settings_branding', type: 'url', label: 'Branding', url: '/apps/setup/system/settings/branding', icon: 'palette' },
      { id: 'nav_settings_auth', type: 'url', label: 'Authentication', url: '/apps/setup/system/settings/auth', icon: 'lock-keyhole', requiredPermissions: ['manage_platform_settings'] },
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
      // Audit Logs (sys_audit_log) is contributed by @objectstack/plugin-audit
      // which now owns it (ADR-0029 K2).
      { id: 'nav_sessions', type: 'object', label: 'Sessions', objectName: 'sys_session', icon: 'monitor' },
      { id: 'nav_notifications', type: 'object', label: 'Notification Events', objectName: 'sys_notification', viewName: 'recent', icon: 'bell', requiresObject: 'sys_notification' },
    ],
  },
  {
    app: 'setup',
    group: 'group_advanced',
    priority: BASE_PRIORITY,
    items: [
      { id: 'nav_oauth_apps', type: 'object', label: 'OAuth Applications', objectName: 'sys_oauth_application', icon: 'app-window' },
      // nav_jwks is capability-gated (like nav_api_keys): sys_jwks is
      // `access.default:'private'` (ADR-0066 ④ — signing keys), so a
      // non-admin's list request 403s server-side; gating the nav item keeps
      // the menu honest instead of showing an entry that can only error.
      { id: 'nav_jwks', type: 'object', label: 'Signing Keys (JWKS)', objectName: 'sys_jwks', icon: 'key-round', requiredPermissions: ['manage_platform_settings'] },
      // `sys_verification` (email/phone tokens) and `sys_device_code` (OAuth
      // device-grant codes) deliberately omit `list` from their `apiMethods`
      // (sensitive, ephemeral secrets — not browsable), so an object/list-view
      // nav entry for them can only ever render "failed to load". They're
      // reachable by id (get) when needed; no browse menu. (Re-adding requires
      // enabling `list` on the object — a security decision.)
      { id: 'nav_accounts', type: 'object', label: 'Identity Links', objectName: 'sys_account', icon: 'link-2' },
      { id: 'nav_user_preferences', type: 'object', label: 'User Preferences', objectName: 'sys_user_preference', icon: 'sliders' },
    ],
  },
];
