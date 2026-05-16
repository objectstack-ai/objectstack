// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Dashboard } from '@objectstack/spec/ui';

/**
 * System Overview Dashboard
 * 
 * Provides at-a-glance monitoring of platform health and key metrics:
 * - Active user sessions
 * - Audit activity (recent events)
 * - Package installation status
 * - Platform configuration
 */
export const SystemOverviewDashboard = Dashboard.create({
  name: 'system_overview',
  label: 'System Overview',
  description: 'Platform health, sessions, and audit activity',

  // 12-column grid matches the widget `w` values below (3, 6, 12). Without
  // this, the renderer falls back to a 4-column grid and `w: 3` becomes 75%
  // width per metric — so KPI cards stack vertically instead of forming a
  // 4-up row.
  columns: 12,
  gap: 4,

  widgets: [
    // ── Active Sessions Widget ──────────────────────────────────────
    {
      id: 'widget_active_sessions',
      title: 'Active Sessions',
      type: 'metric',
      object: 'sys_session',
      layout: {
        x: 0,
        y: 0,
        w: 3,
        h: 2,
      },
      aggregate: 'count',
      colorVariant: 'blue',
      description: 'Number of currently active user sessions',
    },

    // ── Total Users Widget ──────────────────────────────────────────
    {
      id: 'widget_total_users',
      title: 'Total Users',
      type: 'metric',
      object: 'sys_user',
      layout: {
        x: 3,
        y: 0,
        w: 3,
        h: 2,
      },
      aggregate: 'count',
      colorVariant: 'teal',
      description: 'Total registered users in the system',
    },

    // ── Organizations Widget ────────────────────────────────────────
    {
      id: 'widget_organizations',
      title: 'Organizations',
      type: 'metric',
      object: 'sys_organization',
      layout: {
        x: 6,
        y: 0,
        w: 3,
        h: 2,
      },
      aggregate: 'count',
      colorVariant: 'orange',
      description: 'Total organizations on the platform',
    },

    // ── Packages Installed Widget ───────────────────────────────────
    {
      id: 'widget_packages_installed',
      title: 'Packages Installed',
      type: 'metric',
      object: 'sys_package_installation',
      // Cloud-only object — only registered when service-tenant is loaded.
      // Hide this widget gracefully in single-project runtimes.
      requiresObject: 'sys_package_installation',
      layout: {
        x: 9,
        y: 0,
        w: 3,
        h: 2,
      },
      filter: {
        field: 'status',
        operator: 'equals',
        value: 'installed',
      },
      aggregate: 'count',
      colorVariant: 'success',
      description: 'Active package installations across projects',
    },

    // ── Audit Actions by Type (last 7 days) ─────────────────────────
    {
      id: 'widget_audit_actions',
      title: 'Audit Actions (7d)',
      description: 'Distribution of audit events by action type',
      type: 'pie',
      object: 'sys_audit_log',
      layout: {
        x: 0,
        y: 2,
        w: 6,
        h: 4,
      },
      categoryField: 'action',
      aggregate: 'count',
      filter: {
        field: 'created_at',
        operator: 'gte',
        value: 'NOW() - INTERVAL 7 DAY',
      },
    },

    // ── Session Status Overview ─────────────────────────────────────
    {
      id: 'widget_active_orgs',
      title: 'Sessions by Organization',
      description: 'Active sessions grouped by organization',
      type: 'bar',
      object: 'sys_session',
      layout: {
        x: 6,
        y: 2,
        w: 6,
        h: 4,
      },
      categoryField: 'active_organization_id',
      aggregate: 'count',
    },

    // ── Recent Audit Log (Table) ────────────────────────────────────
    {
      id: 'widget_recent_events',
      title: 'Recent Audit Events',
      description: 'Latest platform events',
      type: 'metric',
      object: 'sys_audit_log',
      layout: {
        x: 0,
        y: 6,
        w: 12,
        h: 3,
      },
      aggregate: 'count',
      colorVariant: 'default',
    },
  ],
  globalFilters: [
    {
      field: 'created_at',
      type: 'date',
      label: 'Date Range',
      scope: 'dashboard',
      defaultValue: 'last_7_days',
    },
  ],
});
