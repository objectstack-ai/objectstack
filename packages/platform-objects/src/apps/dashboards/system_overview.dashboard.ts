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
 *   2. Security KPIs       — login / config audit counts
 *   3. Distribution charts — audit events by action + by user
 *   4. Event volume by action (table)
 *
 * This is a MIXED board, and the split decides who the date bar applies to
 * (#7531, #7613). Row 1 is INVENTORY — "how much of this exists right now" —
 * so a count there must not move when the date bar moves. Rows 2-4 are
 * ACTIVITY over `sys_audit_log`, which the date bar exists to scope (see the
 * Row 3 note). The `globalFilters` entry below is broadcast into EVERY
 * widget's analytics query (#2501), so an inventory tile has to say so: it
 * opts out with `filterBindings: { created_at: false }`. All four Row 1 tiles
 * now do — #7531 fixed the first two, #7613 the two that were left.
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
      // #7531 — a TOTAL must not move when the date bar moves. The dashboard's
      // `created_at` global filter is broadcast into every widget's analytics
      // query (#2501), so before this opt-out the tile reported "users created
      // in the last 7 days" under a label that says "Total". On a fresh
      // datastore the two coincide — every user IS recent — which is exactly
      // why it reads as correct in a demo and as catastrophic user loss on any
      // instance older than the window. The date bar belongs to the audit rows
      // below (see the Row 3 note); reaching `sys_user.created_at` was
      // bare-field fan-out, not this tile's intent.
      filterBindings: { created_at: false },
      colorVariant: 'teal',
      description: 'Total registered users in the system',
    },
    {
      id: 'widget_organizations',
      dataset: 'sys_organization_metrics', values: ['org_count'],
      title: 'Organizations',
      type: 'metric',
      // Organizations only exist under multi-tenant org-scoping. In a
      // single-tenant runtime the count is always 0 and the matching
      // nav entries (nav_organizations / nav_invitations) are hidden via
      // `requiresService: 'org-scoping'` — gate this KPI the same way so the
      // overview doesn't dangle a metric the admin can't act on.
      requiresService: 'org-scoping',
      layout: { x: 3, y: 0, w: 3, h: 2 },
      // #7613 — the same #2501 fan-out as Total Users above, on the same row.
      // `sys_organization.created_at` exists, so the date bar landed on it and
      // the tile reported "organizations created in the last 7 days" under a
      // description that says "Total organizations on the platform". An
      // organization founded last year has not stopped existing because the
      // date bar says `last_7_days`.
      filterBindings: { created_at: false },
      colorVariant: 'orange',
      description: 'Total organizations on the platform',
    },
    {
      id: 'widget_active_sessions',
      dataset: 'sys_session_metrics', values: ['session_count'],
      title: 'Active Sessions',
      type: 'metric',
      layout: { x: 6, y: 0, w: 3, h: 2 },
      // #7531 — "Active Sessions" counted EVERY `sys_session` row: the dataset
      // is a bare count and the widget carried no predicate, so a signed-out or
      // long-expired session was still reported as active. `sys_session` can
      // express "active" exactly (ADR-0069 D4): a session is live while it has
      // not been revoked and has not yet expired.
      //
      // `{now}` is a declared date macro (`date-macros.zod.ts`) resolved
      // per-request by `resolveFilterTokens`, which the analytics dataset
      // executor applies to a widget's `filter` (its `runtimeFilter`) — so this
      // is a live predicate, not the unsubstituted `NOW() - INTERVAL` shape the
      // Row 3 note warns about.
      filter: { revoked_at: null, expires_at: { $gt: '{now}' } },
      // …and "currently active" is a statement about NOW, not about a window:
      // an old session that is still live is still active. Same #2501 fan-out
      // as Total Users above — without this opt-out the tile would report
      // "sessions CREATED in the last 7 days that are active", which is neither
      // the old number nor the labelled one.
      filterBindings: { created_at: false },
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
      // Which installations count: the ones that are actually installed. This
      // predicate is the tile's own, and it is ORTHOGONAL to the opt-out below
      // — the two answer different questions and both stand.
      filter: { status: 'installed' },
      // #7613 — and how many of them count: all of them. Same #2501 fan-out as
      // the two tiles above; `sys_package_installation.created_at` exists, so
      // without this the tile reported installations CREATED in the last 7 days
      // that are installed, which is neither the labelled quantity nor a useful
      // one. "Active package installations across projects" is a stock, and a
      // package installed a year ago is still installed today.
      filterBindings: { created_at: false },
      colorVariant: 'success',
      description: 'Active package installations across projects',
    },

    // ── Row 2: Security KPIs ────────────────────────────────────────
    // The `sys_audit_log.action` enum doesn't distinguish failed vs
    // successful logins (both fold into `action='login'`). Surfacing a
    // total Login Events count is honest; a "Failed Logins" widget will
    // need a richer enum or a separate detail field first.
    //
    // This row carried a THIRD tile, "Permission Changes", filtering
    // `action: 'permission_change'`. It is gone, and no replacement tile takes
    // its place. The value had no writer anywhere in the repo — the only two
    // `sys_audit_log` writers are plugin-audit's generic hook (whose `actionFor`
    // maps afterInsert/Update/Delete to create/update/delete and nothing else)
    // and plugin-auth's admin user-import — so the tile read `0` on every
    // deployment that has ever existed, and then its action value was retired
    // from the enum outright, leaving a filter no row can ever match. An empty
    // widget on a COMPLIANCE surface is worse than a missing one: an auditor
    // reading "Permission Changes: 0" concludes the platform watched for them
    // and found none, which is false. 审计面宁窄勿谎 — a narrow audit surface
    // beats a lying one.
    //
    // Not replaced by a refiltered tile, deliberately: permission and role
    // edits ARE captured, as ordinary `create`/`update` rows on the permission
    // objects written by the generic hook, so the honest lens on them is
    // `object_name` on the audit list view — a row-level question, not a
    // single-number KPI. Inventing a tile that approximates it here would put
    // a second not-quite-true number on the same board.
    //
    // The two survivors split the 12-col row in half (the Row 3 shape) rather
    // than leaving a 4-col hole where the removed tile sat.
    {
      id: 'widget_login_events',
      dataset: 'sys_audit_log_metrics', values: ['event_count'],
      title: 'Login Events',
      type: 'metric',
      layout: { x: 0, y: 2, w: 6, h: 2 },
      filter: { action: 'login' },
      colorVariant: 'blue',
      description: 'Authentication events recorded by the audit log',
    },
    {
      id: 'widget_config_changes',
      dataset: 'sys_audit_log_metrics', values: ['event_count'],
      title: 'Config Changes',
      type: 'metric',
      layout: { x: 6, y: 2, w: 6, h: 2 },
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

    // ── Row 4: Event volume by action ───────────────────────────────
    // ADR-0021 single-form: a dataset-bound breakdown of events by action.
    // (The raw recent-events record list belongs in a ListView on
    // sys_audit_log — a row-level lens, not a dashboard analytics widget.)
    //
    // The title says "volume", not "events by action", because the Row 3 pie
    // (`widget_events_by_type`) breaks down the SAME dataset by the SAME
    // dimension and had the identical title until now — two tiles on one board
    // labelled `Audit Events by Action`. They read as distinct in a running
    // instance only because this one was serving a stale translation from
    // before the ADR-0021 conversion, so the duplicate was invisible in the UI
    // and visible only in the source. The pair now splits on what each adds:
    // the pie is the share picture, this table is the exact per-action count
    // (`values: ['event_count']`).
    //
    // The id stays `widget_recent_events` deliberately — it predates the
    // conversion, and renaming it would break every locale bundle's key and
    // any persisted per-widget state for a cosmetic gain.
    {
      id: 'widget_recent_events',
      title: 'Event Volume by Action',
      // The example actions named here have to be actions the platform can
      // actually emit — this string used to lead with `permission`, which
      // advertised the retired value from a second place on the same board.
      description: 'Event volume grouped by action (login, logout, config, …)',
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
