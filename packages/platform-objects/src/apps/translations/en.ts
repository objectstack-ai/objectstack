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
        nav_account_two_factor: { label: 'Two-Factor Authentication' },
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
        group_diagnostics: { label: 'Diagnostics' },
        group_advanced: { label: 'Advanced' },

        // Overview
        nav_system_overview: { label: 'System Overview' },

        // Apps / Marketplace
        nav_marketplace_browse: { label: 'Browse Marketplace' },
        nav_marketplace_installed: { label: 'Installed Apps' },

        // People & Organization
        nav_users: { label: 'Users' },
        nav_departments: { label: 'Departments' },
        nav_teams: { label: 'Teams' },
        nav_organizations: { label: 'Organizations' },
        nav_invitations: { label: 'Invitations' },

        // Access Control
        nav_roles: { label: 'Roles' },
        nav_permission_sets: { label: 'Permission Sets' },
        nav_sharing_rules: { label: 'Sharing Rules' },
        nav_record_shares: { label: 'Record Shares' },
        nav_api_keys: { label: 'API Keys' },

        // Approvals
        nav_approval_processes: { label: 'Processes' },
        nav_approval_requests: { label: 'Requests' },
        nav_approval_actions: { label: 'Action History' },

        // Configuration
        nav_settings_hub: { label: 'All Settings' },
        nav_settings_mail: { label: 'Email' },
        nav_settings_branding: { label: 'Branding' },
        nav_settings_feature_flags: { label: 'Feature Flags' },

        // Diagnostics
        nav_sessions: { label: 'Sessions' },
        nav_audit_logs: { label: 'Audit Logs' },
        nav_notifications: { label: 'Notifications' },

        // Advanced
        nav_oauth_apps: { label: 'OAuth Applications' },
        nav_jwks: { label: 'Signing Keys (JWKS)' },
        nav_verifications: { label: 'Verifications' },
        nav_two_factor: { label: 'Two-Factor' },
        nav_device_codes: { label: 'Device Codes' },
        nav_accounts: { label: 'Identity Links' },
        nav_user_preferences: { label: 'User Preferences' },
        nav_metadata: { label: 'All Metadata' },
      },
    },
    studio: {
      label: 'Studio',
      description: 'Metadata workbench for developers, analysts, and implementers',
      navigation: {
        group_overview: { label: 'Overview' },
        nav_metadata_directory: { label: 'All Metadata Types' },
        group_data_model: { label: 'Data Model' },
        nav_objects: { label: 'Objects' },
        nav_validations: { label: 'Validations' },
        group_ux: { label: 'User Experience' },
        nav_apps: { label: 'Apps' },
        nav_views: { label: 'Views' },
        nav_pages: { label: 'Pages' },
        nav_dashboards: { label: 'Dashboards' },
        nav_reports: { label: 'Reports' },
        group_logic: { label: 'Logic' },
        nav_actions: { label: 'Actions' },
        nav_hooks: { label: 'Hooks' },
        group_automation: { label: 'Automation' },
        nav_flows: { label: 'Flows' },
        nav_workflows: { label: 'Workflow Rules' },
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
};
