// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Dashboard } from '@objectstack/spec/ui';

/**
 * System Overview Dashboard
 *
 * Unified sysadmin landing dashboard. Replaces the previous
 * `system_overview` + `security_overview` split — the two dashboards
 * had significant widget overlap (sys_audit_log pies, sys_session
 * counts, recent-events tables) and the security cut did not justify
 * a separate nav entry.
 *
 * Layout (4 rows on a 12-col grid):
 *   1. Platform KPIs       — users / orgs / sessions / packages
 *   2. Security KPIs       — login / permission / config audit counts
 *   3. Distribution charts — audit events by action + by user
 *   4. Recent audit events table
 */
export const SystemOverviewDashboard = Dashboard.create({
  name: 'system_overview',
  label: 'System Overview',
  description: 'Platform health, security activity, and recent audit events',

  // 12-column grid matches the widget `w` values below.
  columns: 12,
  gap: 4,

  widgets: [
    // ── Row 1: Platform KPIs ────────────────────────────────────────
    {
      id: 'widget_total_users',
      dataset: 'sys_user_metrics', values: ['user_count'],
      title: 'Total Users',
      type: 'metric',
      layout: { x: 0, y: 0, w: 3, h: 2 },
      colorVariant: 'teal',
      description: 'Total registered users in the system',
    },
    {
      id: 'widget_organizations',
      dataset: 'sys_organization_metrics', values: ['org_count'],
      title: 'Organizations',
      type: 'metric',
      layout: { x: 3, y: 0, w: 3, h: 2 },
      colorVariant: 'orange',
      description: 'Total organizations on the platform',
    },
    {
      id: 'widget_active_sessions',
      dataset: 'sys_session_metrics', values: ['session_count'],
      title: 'Active Sessions',
      type: 'metric',
      layout: { x: 6, y: 0, w: 3, h: 2 },
      colorVariant: 'blue',
      description: 'Number of currently active user sessions',
    },
    {
      id: 'widget_packages_installed',
      dataset: 'sys_package_installation_metrics', values: ['package_count'],
      title: 'Packages Installed',
      type: 'metric',
      // Cloud-only object — only registered when service-tenant is loaded.
      // Hide this widget gracefully in single-environment runtimes.
      requiresObject: 'sys_package_installation',
      layout: { x: 9, y: 0, w: 3, h: 2 },
      filter: { status: 'installed' },
      colorVariant: 'success',
      description: 'Active package installations across projects',
    },

    // ── Row 2: Security KPIs ────────────────────────────────────────
    // The `sys_audit_log.action` enum doesn't distinguish failed vs
    // successful logins (both fold into `action='login'`). Surfacing a
    // total Login Events count is honest; a "Failed Logins" widget will
    // need a richer enum or a separate detail field first.
    {
      id: 'widget_login_events',
      dataset: 'sys_audit_log_metrics', values: ['event_count'],
      title: 'Login Events',
      type: 'metric',
      layout: { x: 0, y: 2, w: 4, h: 2 },
      filter: { action: 'login' },
      colorVariant: 'blue',
      description: 'Authentication events recorded by the audit log',
    },
    {
      id: 'widget_permission_changes',
      dataset: 'sys_audit_log_metrics', values: ['event_count'],
      title: 'Permission Changes',
      type: 'metric',
      layout: { x: 4, y: 2, w: 4, h: 2 },
      filter: { action: 'permission_change' },
      colorVariant: 'warning',
      description: 'Recent permission and role modifications',
    },
    {
      id: 'widget_config_changes',
      dataset: 'sys_audit_log_metrics', values: ['event_count'],
      title: 'Config Changes',
      type: 'metric',
      layout: { x: 8, y: 2, w: 4, h: 2 },
      filter: { action: 'config_change' },
      colorVariant: 'blue',
      description: 'System configuration modifications',
    },

    // ── Row 3: Distribution charts ──────────────────────────────────
    // Note: relative date filters like `NOW() - INTERVAL 7 DAY` are not
    // currently substituted by the analytics layer (see
    // service-analytics/strategies/filter-normalizer.ts). The dashboard's
    // `globalFilters` date-range bar at the bottom is the supported way
    // to scope these widgets.
    {
      id: 'widget_events_by_type',
      dataset: 'sys_audit_log_metrics', dimensions: ['action'], values: ['event_count'],
      title: 'Audit Events by Action',
      description: 'Distribution of audit events by action type',
      type: 'pie',
      layout: { x: 0, y: 4, w: 6, h: 4 },
    },
    {
      id: 'widget_events_by_user',
      dataset: 'sys_audit_log_metrics', dimensions: ['user_id'], values: ['event_count'],
      title: 'Events by User',
      description: 'Activity distribution across users',
      type: 'bar',
      layout: { x: 6, y: 4, w: 6, h: 4 },
    },

    // ── Row 4: Audit events by action ───────────────────────────────
    // ADR-0021 single-form: a dataset-bound breakdown of events by action.
    // (The raw recent-events record list belongs in a ListView on
    // sys_audit_log — a row-level lens, not a dashboard analytics widget.)
    {
      id: 'widget_recent_events',
      title: 'Audit Events by Action',
      description: 'Event volume grouped by action (login, permission, config, …)',
      type: 'table',
      dataset: 'sys_audit_log_metrics',
      dimensions: ['action'],
      values: ['event_count'],
      layout: { x: 0, y: 8, w: 12, h: 4 },
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
