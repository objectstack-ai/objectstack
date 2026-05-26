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
 * matching the convention used by the HotCRM reference app at
 * https://github.com/objectstack-ai/hotcrm (see `src/apps/crm.app.ts`).
 * The legacy `areas[]` shape was abandoned because it rendered poorly
 * compared to the category style ObjectUI is built around.
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
      id: 'group_people_org',
      type: 'group',
      label: 'People & Organization',
      icon: 'users',
      children: [
        // HR-shaped grouping: who exists, where they sit in the org chart,
        // and which tenants/teams they belong to. `sys_department` is the
        // platform-owned org skeleton (M10.17.1); `sys_team` is better-auth's
        // flat collaboration grouping.
        //
        // M10.30b: removed top-level Department Members / Team Members /
        // Org Members entries — they are M:N join tables and the natural
        // entry point is the parent record's detail page.
        { id: 'nav_users', type: 'object', label: 'Users', objectName: 'sys_user', icon: 'user' },
        { id: 'nav_departments', type: 'object', label: 'Departments', objectName: 'sys_department', icon: 'building', requiresObject: 'sys_department' },
        { id: 'nav_teams', type: 'object', label: 'Teams', objectName: 'sys_team', icon: 'users-round' },
        { id: 'nav_organizations', type: 'object', label: 'Organizations', objectName: 'sys_organization', icon: 'building-2' },
        { id: 'nav_invitations', type: 'object', label: 'Invitations', objectName: 'sys_invitation', icon: 'mail' },
      ],
    },
    {
      id: 'group_access_control',
      type: 'group',
      label: 'Access Control',
      icon: 'shield',
      children: [
        // M10.30b: removed top-level User Permission Sets / Role Permission
        // Sets entries — same M:N → parent-detail-tab argument as the
        // People & Org cleanup.
        { id: 'nav_roles', type: 'object', label: 'Roles', objectName: 'sys_role', icon: 'shield-check' },
        { id: 'nav_permission_sets', type: 'object', label: 'Permission Sets', objectName: 'sys_permission_set', icon: 'lock' },
        { id: 'nav_sharing_rules', type: 'object', label: 'Sharing Rules', objectName: 'sys_sharing_rule', icon: 'share-2', requiresObject: 'sys_sharing_rule' },
        { id: 'nav_record_shares', type: 'object', label: 'Record Shares', objectName: 'sys_record_share', icon: 'link', requiresObject: 'sys_record_share' },
        { id: 'nav_api_keys', type: 'object', label: 'API Keys', objectName: 'sys_api_key', icon: 'key' },
      ],
    },
    {
      id: 'group_approvals',
      type: 'group',
      label: 'Approvals',
      icon: 'check-circle',
      children: [
        { id: 'nav_approval_processes', type: 'object', label: 'Processes', objectName: 'sys_approval_process', icon: 'workflow', requiresObject: 'sys_approval_process' },
        { id: 'nav_approval_requests', type: 'object', label: 'Requests', objectName: 'sys_approval_request', icon: 'inbox', requiresObject: 'sys_approval_request' },
        { id: 'nav_approval_actions', type: 'object', label: 'Action History', objectName: 'sys_approval_action', icon: 'history', requiresObject: 'sys_approval_action' },
      ],
    },
    {
      id: 'group_configuration',
      type: 'group',
      label: 'Configuration',
      icon: 'sliders-horizontal',
      children: [
        // Metadata-driven settings hub. Each entry maps to a SettingsManifest
        // namespace exposed by @objectstack/service-settings. URL navigation
        // is used (not `object`) because settings are stored in a generic
        // K/V table (`sys_setting`) rather than per-namespace objects, and
        // the renderer is a dedicated <SettingsView> page in objectui.
        //
        // Order mirrors `builtinSettingsManifests` so left-nav order matches
        // the All-Settings index. AI groups chat + embedder under one entry
        // because operators reason about them together; Knowledge is its
        // own entry because the adapter selection is independent.
        { id: 'nav_settings_hub', type: 'url', label: 'All Settings', url: '/apps/setup/system/settings', icon: 'settings-2' },
        { id: 'nav_settings_branding', type: 'url', label: 'Branding', url: '/apps/setup/system/settings/branding', icon: 'palette' },
        { id: 'nav_settings_mail', type: 'url', label: 'Email', url: '/apps/setup/system/settings/mail', icon: 'mail' },
        { id: 'nav_settings_storage', type: 'url', label: 'File Storage', url: '/apps/setup/system/settings/storage', icon: 'hard-drive' },
        { id: 'nav_settings_ai', type: 'url', label: 'AI & Embedder', url: '/apps/setup/system/settings/ai', icon: 'sparkles' },
        { id: 'nav_settings_knowledge', type: 'url', label: 'Knowledge', url: '/apps/setup/system/settings/knowledge', icon: 'book-open' },
        { id: 'nav_settings_feature_flags', type: 'url', label: 'Feature Flags', url: '/apps/setup/system/settings/feature_flags', icon: 'flag' },
      ],
    },
    {
      id: 'group_diagnostics',
      type: 'group',
      label: 'Diagnostics',
      icon: 'stethoscope',
      children: [
        // Day-to-day observability surfaces. M10.30b removed `sys_activity`
        // and `sys_comment` — both are CRM operational data authored from
        // record pages, not platform admin surfaces.
        { id: 'nav_sessions', type: 'object', label: 'Sessions', objectName: 'sys_session', icon: 'monitor' },
        { id: 'nav_audit_logs', type: 'object', label: 'Audit Logs', objectName: 'sys_audit_log', icon: 'scroll-text' },
        { id: 'nav_notifications', type: 'object', label: 'Notifications', objectName: 'sys_notification', icon: 'bell', requiresObject: 'sys_notification' },
      ],
    },
    {
      id: 'group_integrations',
      type: 'group',
      label: 'Integrations',
      icon: 'plug',
      children: [
        // Outbound HTTP integrations. `sys_webhook` always ships with
        // platform-objects, so the Webhooks entry is always visible.
        // `sys_webhook_delivery` is the durable outbox row from
        // `@objectstack/plugin-webhooks/schema` — gated on `requiresObject`
        // so the Deliveries entry only renders when the plugin has been
        // wired into `defineStack({ objects: [SysWebhookDelivery, ...] })`.
        //
        // This is the canonical demonstration of "everything is an object":
        // managing webhooks (configuration) and inspecting deliveries
        // (operational telemetry) reuses the same generic ObjectView /
        // ObjectListView UI as any business object — no bespoke webhook
        // admin page.
        { id: 'nav_webhooks', type: 'object', label: 'Webhooks', objectName: 'sys_webhook', icon: 'webhook', requiresObject: 'sys_webhook' },
        { id: 'nav_webhook_deliveries', type: 'object', label: 'Webhook Deliveries', objectName: 'sys_webhook_delivery', icon: 'send', requiresObject: 'sys_webhook_delivery' },
      ],
    },
    {
      id: 'group_advanced',
      type: 'group',
      label: 'Advanced',
      icon: 'wrench',
      expanded: false,
      children: [
        // Better-auth internals — rarely useful for humans, but exposed
        // so support engineers can inspect token state without dropping
        // to SQL. The objectui sidebar collapses this group by default;
        // edits should hit the read-only banner since these are all
        // `managedBy: 'better-auth'`.
        //
        // M10.30b changes:
        //  - Removed the 3 OAuth satellite menus (access tokens / refresh
        //    tokens / consents). They live under their parent OAuth App.
        //  - Renamed "Linked Accounts" → "Identity Links" to distinguish
        //    from sys_user / org members.
        //  - Demoted "All Metadata" from the (now-deleted) Platform group
        //    to this Advanced/debug bucket.
        //  - The marketplace-only `sys_app` / `sys_package` /
        //    `sys_package_installation` menus have been removed entirely;
        //    they are contributed by `@objectstack/service-tenant`
        //    (control-plane) and are not present in single-environment runtimes.
        { id: 'nav_oauth_apps', type: 'object', label: 'OAuth Applications', objectName: 'sys_oauth_application', icon: 'app-window' },
        { id: 'nav_jwks', type: 'object', label: 'Signing Keys (JWKS)', objectName: 'sys_jwks', icon: 'key-round' },
        { id: 'nav_verifications', type: 'object', label: 'Verifications', objectName: 'sys_verification', icon: 'mail-check' },
        { id: 'nav_two_factor', type: 'object', label: 'Two-Factor', objectName: 'sys_two_factor', icon: 'smartphone' },
        { id: 'nav_device_codes', type: 'object', label: 'Device Codes', objectName: 'sys_device_code', icon: 'qr-code' },
        { id: 'nav_accounts', type: 'object', label: 'Identity Links', objectName: 'sys_account', icon: 'link-2' },
        { id: 'nav_user_preferences', type: 'object', label: 'User Preferences', objectName: 'sys_user_preference', icon: 'sliders' },
        { id: 'nav_metadata', type: 'object', label: 'All Metadata', objectName: 'sys_metadata', icon: 'file-cog' },
      ],
    },
  ],
};
