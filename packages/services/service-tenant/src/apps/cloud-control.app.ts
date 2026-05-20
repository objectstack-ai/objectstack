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

  // Curated, end-user-focused menu. Cloud Control is the multi-tenant
  // project control plane; org/user/role/audit/oauth/session management
  // lives in the Setup App and is intentionally NOT duplicated here.
  //
  // Internal operator surfaces (Revisions, Credentials, Package Versions,
  // Registered Apps) remain accessible via direct URL but are hidden from
  // the navigation to keep the App focused on real user tasks.
  navigation: [
    {
      id: 'group_environments',
      type: 'group',
      label: 'Environments',
      icon: 'globe',
      children: [
        { id: 'nav_environments', type: 'object', label: 'Environments', objectName: 'sys_project', icon: 'globe' },
        { id: 'nav_env_branches', type: 'object', label: 'Branches', objectName: 'sys_project_branch', icon: 'git-branch' },
        { id: 'nav_env_members', type: 'object', label: 'Members', objectName: 'sys_project_member', icon: 'user-cog' },
      ],
    },
    {
      id: 'group_marketplace',
      type: 'group',
      label: 'Marketplace',
      icon: 'package',
      children: [
        { id: 'nav_packages', type: 'object', label: 'Packages', objectName: 'sys_package', icon: 'package' },
        { id: 'nav_package_installations', type: 'object', label: 'Installations', objectName: 'sys_package_installation', icon: 'box' },
      ],
    },
    // NOTE: Integrations group (Webhooks) will be re-added once `sys_webhook`
    // is shipped. Hidden for now to avoid an empty group in the nav.
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
  ],
};
