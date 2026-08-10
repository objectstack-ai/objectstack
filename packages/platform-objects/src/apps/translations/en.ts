// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationData } from '@objectstack/spec/system';
import { enObjects } from './en.objects.generated.js';

/**
 * English (en) — Setup App Translations
 *
 * Per-locale file mirroring the CRM example convention (one file per
 * language, aggregated into a single `TranslationBundle` by
 * `setup.translation.ts`).
 *
 * Scope: the static Setup App metadata artifact owned by
 * `@objectstack/platform-objects/apps`:
 *   - `apps.setup.label` / `description`
 *   - `apps.setup.navigation.<id>.label` for every group AND leaf
 *   - `dashboards.system_overview.*`
 *
 * Object-level labels (Users, Roles, Audit Logs, …) are owned by the
 * sys_* object schemas themselves and translated separately.
 */
export const en: TranslationData = {
  objects: enObjects,
  apps: {
    account: {
      label: 'Account',
      description: 'Personal security and identity settings',
      navigation: {
        grp_account_inbox: { label: 'Inbox' },
        grp_account_security: { label: 'Security' },
        grp_account_developer: { label: 'Developer' },
        nav_account_profile: { label: 'Profile' },
        nav_account_notifications: { label: 'Notifications' },
        nav_account_approvals: { label: 'Approvals' },
        nav_account_memberships: { label: 'My Organizations' },
        nav_account_linked: { label: 'Linked Accounts' },
        nav_account_sessions: { label: 'Active Sessions' },
        nav_account_api_keys: { label: 'API Keys' },
        nav_account_oauth_apps: { label: 'OAuth Applications' },
      },
    },
    setup: {
      label: 'Setup',
      description: 'Platform settings and administration',
      navigation: {
        // Groups
        group_overview: { label: 'Overview' },
        group_apps: { label: 'Apps' },
        group_people_org: { label: 'People & Organization' },
        group_access_control: { label: 'Access Control' },
        group_approvals: { label: 'Approvals' },
        group_configuration: { label: 'Configuration' },
        group_integrations: { label: 'Integrations' },
        group_diagnostics: { label: 'Diagnostics' },
        group_advanced: { label: 'Advanced' },

        // Overview
        nav_system_overview: { label: 'System Overview' },

        // Apps / Marketplace
        // `nav_packages` is a SETUP entry (package administration is an
        // operator concern — ADR-0084), distinct from the same-id entry under
        // `apps.studio.navigation`. Two apps carrying one nav id is normal;
        // each app resolves its own subtree, so the studio copy never answers
        // for this one. Its absence here was #5750's first cause.
        nav_packages: { label: 'Packages' },
        nav_marketplace_browse: { label: 'Browse Marketplace' },
        nav_marketplace_installed: { label: 'Installed Apps' },
        nav_cloud_connection: { label: 'Cloud Connection' },

        // People & Organization
        nav_users: { label: 'Users' },
        nav_organization: { label: 'Organization' },
        nav_business_units: { label: 'Business Units' },
        nav_teams: { label: 'Teams' },
        nav_organizations: { label: 'Organizations' },
        nav_invitations: { label: 'Invitations' },

        // Access Control
        nav_positions: { label: 'Positions' },
        nav_capabilities: { label: 'Capabilities' },
        nav_permission_sets: { label: 'Permission Sets' },
        nav_sharing_rules: { label: 'Sharing Rules' },
        nav_record_shares: { label: 'Record Shares' },
        // `nav_sso_providers` is contributed by `@objectstack/plugin-auth` only
        // when the external-IdP RP is wired (`OS_SSO_ENABLED`, or the cloud
        // per-env `planAllowsSso`), so it is the one Setup entry
        // `pnpm check:app-nav-i18n` structurally cannot judge: that gate boots
        // ONE composition, and a contribution gated off in it is never merged
        // and therefore never checked (see the gate header's bound #1). Its
        // absence here was invisible for exactly that reason (#6659) — a
        // deployment with SSO wired showed `SSO Providers` in English inside an
        // otherwise translated menu. The pin that keeps this row honest lives
        // in `setup-nav-dead-key-tombstone.test.ts`. Wording follows the
        // object's own `pluralLabel` per locale (`sys_sso_provider`), since the
        // entry opens that object's list view.
        nav_sso_providers: { label: 'SSO Providers' },
        nav_api_keys: { label: 'API Keys' },
        nav_connect_agent: { label: 'Connect an Agent' },

        // Approvals. `nav_approvals_inbox` is the working surface (#7234); the
        // three below it are the engine's raw tables, kept as the admin view.
        nav_approvals_inbox: { label: 'Approvals Inbox' },
        nav_approval_requests: { label: 'Requests' },
        nav_approval_actions: { label: 'Action History' },
        nav_approval_delegations: { label: 'Delegations (OOO)' },

        // Configuration
        nav_settings_hub: { label: 'All Settings' },
        nav_settings_localization: { label: 'Localization' },
        nav_settings_company: { label: 'Company' },
        nav_settings_mail: { label: 'Email' },
        nav_settings_branding: { label: 'Branding' },
        nav_settings_auth: { label: 'Authentication' },
        nav_settings_storage: { label: 'File Storage' },
        nav_settings_ai: { label: 'AI & Embedder' },
        nav_settings_knowledge: { label: 'Knowledge' },
        nav_settings_feature_flags: { label: 'Feature Flags' },
        // Notifications (contributed by @objectstack/service-messaging)
        nav_notification_preferences: { label: 'Notification Preferences' },
        nav_notification_subscriptions: { label: 'Notification Subscriptions' },
        nav_notification_templates: { label: 'Notification Templates' },

        // Diagnostics
        nav_sessions: { label: 'Sessions' },
        nav_audit_logs: { label: 'Audit Logs' },
        nav_notifications: { label: 'Notifications' },

        // Integrations — every entry here is contributed at RUNTIME by the
        // capability plugin that owns the object (ADR-0029 K2), so it exists on
        // no static walk of SETUP_APP. `pnpm check:app-nav-i18n` is what keeps
        // this block honest; see that gate's header for why (#5750).
        nav_webhooks: { label: 'Webhooks' },
        nav_http_deliveries: { label: 'HTTP Deliveries' },
        nav_datasources: { label: 'Datasources' },

        // Advanced
        //
        // No `nav_verifications` / `nav_device_codes` here on purpose:
        // `sys_verification` and `sys_device_code` omit `list` from their
        // `apiMethods`, so `setup-nav.contributions.ts` deliberately declares
        // no browse entry for them (#2266). Nor `nav_metadata` — that entry
        // moved to Studio as `nav_metadata_directory`. Re-adding a label here
        // means re-adding the nav item first; the tombstone in
        // `setup-nav-dead-key-tombstone.test.ts` states the whole rule (#6660).
        nav_oauth_apps: { label: 'OAuth Applications' },
        nav_jwks: { label: 'Signing Keys (JWKS)' },
        nav_accounts: { label: 'Identity Links' },
        nav_user_preferences: { label: 'User Preferences' },
      },
    },
    studio: {
      label: 'Studio',
      description: 'Metadata workbench for developers, analysts, and implementers',
      navigation: {
        group_overview: { label: 'Overview' },
        nav_app_builder: { label: 'App Builder' },
        nav_metadata_directory: { label: 'All Metadata Types' },
        nav_packages: { label: 'Packages' },
        group_data_model: { label: 'Data Model' },
        nav_objects: { label: 'Objects' },
        group_ux: { label: 'User Experience' },
        nav_apps: { label: 'Apps' },
        nav_views: { label: 'Views' },
        nav_pages: { label: 'Pages' },
        nav_dashboards: { label: 'Dashboards' },
        nav_reports: { label: 'Reports' },
        nav_datasets: { label: 'Datasets' },
        group_logic: { label: 'Logic' },
        nav_actions: { label: 'Actions' },
        nav_hooks: { label: 'Hooks' },
        group_automation: { label: 'Automation' },
        nav_flows: { label: 'Flows' },
        group_ai: { label: 'AI' },
        nav_agents: { label: 'Agents' },
        nav_tools: { label: 'Tools' },
        nav_skills: { label: 'Skills' },
        group_developer: { label: 'Developer' },
        nav_api_console: { label: 'API Console' },
        nav_flow_runs: { label: 'Flow Runs' },
        nav_public_forms: { label: 'Public Forms' },
        group_integration: { label: 'Integration' },
        nav_email_templates: { label: 'Email Templates' },
      },
    },
  },

  dashboards: {
    system_overview: {
      label: 'System Overview',
      description: 'Platform health, security activity, and recent audit events',
      widgets: {
        widget_total_users: {
          title: 'Total Users',
          description: 'Total registered users in the system',
        },
        widget_organizations: {
          title: 'Organizations',
          description: 'Total organizations on the platform',
        },
        widget_active_sessions: {
          title: 'Active Sessions',
          description: 'Number of currently active user sessions',
        },
        widget_packages_installed: {
          title: 'Packages Installed',
          description: 'Active package installations across projects',
        },
        widget_login_events: {
          title: 'Login Events',
          description: 'Authentication events recorded by the audit log',
        },
        widget_permission_changes: {
          title: 'Permission Changes',
          description: 'Recent permission and role modifications',
        },
        widget_config_changes: {
          title: 'Config Changes',
          description: 'System configuration modifications',
        },
        widget_events_by_type: {
          title: 'Audit Events by Action',
          description: 'Distribution of audit events by action type',
        },
        widget_events_by_user: {
          title: 'Events by User',
          description: 'Activity distribution across users',
        },
        widget_recent_events: {
          title: 'Recent Audit Events',
          description: 'Latest platform events (login, permission, config, …)',
        },
      },
    },
  },

  // Setup pages contributed as metadata by capability plugins. The English
  // entries mirror the literals authored in the plugins' page metadata
  // (@objectstack/cloud-connection, @objectstack/mcp) and exist so the other
  // locales have a complete key set to translate against.
  pages: {
    marketplace_installed: {
      label: 'Installed Apps',
      subtitle: "Marketplace packages currently installed into this runtime's kernel.",
    },
    cloud_connection_settings: {
      label: 'Cloud Connection',
      subtitle:
        'Connect this runtime to an ObjectStack control plane to browse your '
        + "organization's private packages and install them here.",
    },
    connect_agent: {
      label: 'Connect an Agent',
      subtitle:
        'Give any MCP-capable AI client governed access to this environment — '
        + "every call runs under the caller's own permissions and row-level security.",
    },
  },
};
