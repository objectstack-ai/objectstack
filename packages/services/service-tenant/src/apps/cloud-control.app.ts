// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Cloud Control App — static metadata.
 *
 * Surfaces the control-plane in Studio / Console as a standard
 * metadata-driven App (same pattern as `SETUP_APP` in
 * `@objectstack/platform-objects/apps`). When `@objectstack/service-tenant`
 * is loaded — i.e. only in cloud mode — this app appears in the App
 * switcher and exposes every control-plane object: organizations,
 * projects, branches, members, invitations, API keys, packages,
 * installations, registered apps, audit logs, webhooks, billing.
 *
 * The corresponding standalone runtime (`apps/objectos`) does not load
 * service-tenant, so this app never registers there.
 *
 * Menu shape mirrors `SETUP_APP`: flat `navigation[]` of `type: 'group'`
 * categories whose `children` reference objects / dashboards directly.
 *
 * @see packages/platform-objects/src/apps/setup.app.ts
 */

import type { App } from '@objectstack/spec/ui';

export const CLOUD_CONTROL_APP: App = {
  name: 'cloud_control',
  label: 'Cloud Control',
  description: 'Multi-tenant control plane: organizations, projects, packages, billing.',
  icon: 'cloud',
  active: true,
  isDefault: true,
  branding: {
    primaryColor: '#2563eb', // Blue-600 — distinct from Setup's slate
  },
  // No App-level permission gate: any authenticated user can open the
  // Cloud Control App to create/manage their own organizations and
  // projects. Data-level isolation (which orgs/projects each user sees)
  // is enforced by sharing rules on sys_organization, sys_project, etc.

  navigation: [
    {
      id: 'group_overview',
      type: 'group',
      label: 'Overview',
      icon: 'layout-dashboard',
      children: [
        // Reuse the System Overview dashboard already shipped by plugin-auth
        // — it surfaces user/session/audit counts which are also useful for
        // a control-plane operator. Cloud-specific dashboards (active
        // projects, billing burn, quota breaches) land in a follow-up PR.
        { id: 'nav_system_overview', type: 'dashboard', label: 'System Overview', dashboardName: 'system_overview', icon: 'activity' },
      ],
    },
    {
      id: 'group_tenants',
      type: 'group',
      label: 'Tenants',
      icon: 'building-2',
      children: [
        { id: 'nav_organizations', type: 'object', label: 'Organizations', objectName: 'sys_organization', icon: 'building-2' },
        { id: 'nav_members', type: 'object', label: 'Members', objectName: 'sys_member', icon: 'users' },
        { id: 'nav_invitations', type: 'object', label: 'Invitations', objectName: 'sys_invitation', icon: 'mail' },
        { id: 'nav_teams', type: 'object', label: 'Teams', objectName: 'sys_team', icon: 'users-round' },
      ],
    },
    {
      id: 'group_projects',
      type: 'group',
      label: 'Projects',
      icon: 'layers',
      children: [
        { id: 'nav_projects', type: 'object', label: 'Projects', objectName: 'sys_project', icon: 'layers' },
        { id: 'nav_project_branches', type: 'object', label: 'Branches', objectName: 'sys_project_branch', icon: 'git-branch' },
        { id: 'nav_project_members', type: 'object', label: 'Project Members', objectName: 'sys_project_member', icon: 'user-cog' },
        { id: 'nav_project_revisions', type: 'object', label: 'Revisions', objectName: 'sys_project_revision', icon: 'history' },
        { id: 'nav_project_credentials', type: 'object', label: 'Credentials', objectName: 'sys_project_credential', icon: 'key-square' },
      ],
    },
    {
      id: 'group_packages',
      type: 'group',
      label: 'Packages & Apps',
      icon: 'package',
      children: [
        { id: 'nav_packages', type: 'object', label: 'Packages', objectName: 'sys_package', icon: 'package' },
        { id: 'nav_package_versions', type: 'object', label: 'Versions', objectName: 'sys_package_version', icon: 'git-commit' },
        { id: 'nav_package_installations', type: 'object', label: 'Installations', objectName: 'sys_package_installation', icon: 'box' },
        { id: 'nav_apps', type: 'object', label: 'Registered Apps', objectName: 'sys_app', icon: 'app-window' },
      ],
    },
    {
      id: 'group_access',
      type: 'group',
      label: 'Access & Integrations',
      icon: 'shield',
      children: [
        { id: 'nav_api_keys', type: 'object', label: 'API Keys', objectName: 'sys_api_key', icon: 'key' },
        { id: 'nav_webhooks', type: 'object', label: 'Webhooks', objectName: 'sys_webhook', icon: 'webhook', requiresObject: 'sys_webhook' },
        { id: 'nav_oauth_apps', type: 'object', label: 'OAuth Applications', objectName: 'sys_oauth_application', icon: 'app-window', requiresObject: 'sys_oauth_application' },
      ],
    },
    {
      id: 'group_billing',
      type: 'group',
      label: 'Billing',
      icon: 'receipt',
      children: [
        { id: 'nav_billing_periods', type: 'object', label: 'Billing Periods', objectName: 'sys_billing_period', icon: 'receipt' },
        { id: 'nav_quota_usage', type: 'object', label: 'Quota Usage', objectName: 'sys_quota_usage', icon: 'gauge' },
      ],
    },
    {
      id: 'group_diagnostics',
      type: 'group',
      label: 'Diagnostics',
      icon: 'stethoscope',
      children: [
        { id: 'nav_sessions', type: 'object', label: 'Sessions', objectName: 'sys_session', icon: 'monitor' },
        { id: 'nav_audit_logs', type: 'object', label: 'Audit Logs', objectName: 'sys_audit_log', icon: 'scroll-text' },
      ],
    },
  ],
};
