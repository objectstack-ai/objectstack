// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { App } from '@objectstack/spec/ui';

/**
 * Showcase app — navigation organized to TEACH page authoring.
 *
 * "Capability Map" is the default landing (first nav item): one card per
 * protocol domain, indexing every demo. "Page Authoring" (Start Here) is the
 * page-authoring teaching index: it explains the two axes every page has —
 * `type` (the surface role) and `kind` (the authoring model) — and links to the
 * canonical example of each kind. The first three groups (Workspace / Data Model
 * / Analytics) are the app *working* like a real product. The "Authoring · *"
 * groups are the page-authoring gallery, split BY KIND so a learner can see
 * which model fits which scenario:
 *   • Structured (full/slotted) — declarative regions, no code (the default)
 *   • Visualizations           — one list/interface page per record view-type
 *   • HTML                     — constrained JSX, composed, parsed-never-executed
 *   • React                    — real React, executed, interactive (trusted tier)
 */
export const ShowcaseApp = App.create({
  name: 'showcase_app',
  label: 'Showcase',
  icon: 'sparkles',
  branding: { primaryColor: '#7C3AED' },

  navigation: [
    // First item = the app's landing surface (the delivered convention; the
    // spec's homePageId has no console consumer yet).
    { id: 'nav_capability_map', type: 'page', pageName: 'showcase_capability_map', label: 'Capability Map', icon: 'map' },
    { id: 'nav_start_here', type: 'page', pageName: 'showcase_start_here', label: 'Page Authoring', icon: 'compass' },
    {
      id: 'grp_workspace',
      type: 'group',
      label: 'Workspace',
      icon: 'briefcase',
      children: [
        { id: 'nav_my_work', type: 'page', pageName: 'showcase_my_work', label: 'My Work', icon: 'home' },
        { id: 'nav_review_queue', type: 'page', pageName: 'showcase_review_queue', label: 'Approvals', icon: 'check-check' },
        { id: 'nav_new_project_wizard', type: 'page', pageName: 'showcase_new_project_wizard', label: 'New Project (Wizard)', icon: 'wand-2' },
        { id: 'nav_settings', type: 'object', objectName: 'showcase_preference', label: 'Settings', icon: 'settings' },
      ],
    },
    {
      id: 'grp_data',
      type: 'group',
      label: 'Data Model',
      icon: 'database',
      children: [
        { id: 'nav_projects', type: 'object', objectName: 'showcase_project', label: 'Projects', icon: 'folder-kanban' },
        { id: 'nav_tasks', type: 'object', objectName: 'showcase_task', label: 'Tasks', icon: 'check-square' },
        { id: 'nav_accounts', type: 'object', objectName: 'showcase_account', label: 'Accounts', icon: 'building' },
        { id: 'nav_contacts', type: 'object', objectName: 'showcase_contact', label: 'Contacts', icon: 'user' },
        { id: 'nav_invoices', type: 'object', objectName: 'showcase_invoice', label: 'Invoices', icon: 'receipt' },
        { id: 'nav_products', type: 'object', objectName: 'showcase_product', label: 'Products', icon: 'package' },
        { id: 'nav_teams', type: 'object', objectName: 'showcase_team', label: 'Teams', icon: 'users' },
        { id: 'nav_categories', type: 'object', objectName: 'showcase_category', label: 'Categories', icon: 'list-tree' },
        { id: 'nav_business_units', type: 'object', objectName: 'showcase_business_unit', label: 'Business Units', icon: 'network' },
        { id: 'nav_field_zoo', type: 'object', objectName: 'showcase_field_zoo', label: 'Field Zoo', icon: 'shapes' },
        // B3 (#1583) dynamic-options fixture: country → province cascade + a
        // role-gated tier, enforced server-side by the objectql rule path.
        { id: 'nav_cascade', type: 'object', objectName: 'showcase_cascade', label: 'Cascading Select', icon: 'git-fork' },
      ],
    },
    {
      // ObjectNavItem.filters (#2626) — declarative slices on the bare data
      // surface (`/:objectName/data`, objectui ADR-0055 / #2255). Each item
      // targets the SAME object as `nav_tasks` above but pre-applies URL
      // filter[<field>]=<value> conditions instead of a saved view; the shell
      // renders them as removable chips. `filters` is mutually exclusive with
      // `recordId`/`viewName` — the app.zod superRefine guard rejects mixing
      // them at build time (#2630), so these three stay filter-only.
      id: 'grp_slices',
      type: 'group',
      label: 'Data Slices (filters)',
      icon: 'filter',
      children: [
        { id: 'nav_slice_in_progress', type: 'object', objectName: 'showcase_task', filters: { status: 'in_progress' }, label: 'In-Progress Tasks', icon: 'loader' },
        { id: 'nav_slice_urgent', type: 'object', objectName: 'showcase_task', filters: { priority: 'urgent' }, label: 'Urgent Tasks', icon: 'flame' },
        { id: 'nav_slice_review', type: 'object', objectName: 'showcase_task', filters: { status: 'in_review' }, label: 'In-Review Tasks', icon: 'eye' },
      ],
    },
    {
      id: 'grp_analytics',
      type: 'group',
      label: 'Analytics',
      icon: 'chart-bar',
      children: [
        { id: 'nav_command_center', type: 'page', pageName: 'showcase_command_center', label: 'Command Center (大屏)', icon: 'monitor-dot' },
        { id: 'nav_ops', type: 'dashboard', dashboardName: 'showcase_ops_dashboard', label: 'Delivery Operations', icon: 'gauge' },
        { id: 'nav_revenue_pulse', type: 'dashboard', dashboardName: 'showcase_revenue_pulse', label: 'Revenue Pulse (filtered)', icon: 'sliders-horizontal' },
        { id: 'nav_charts', type: 'dashboard', dashboardName: 'showcase_chart_gallery', label: 'Chart Gallery', icon: 'layout-dashboard' },
        { id: 'nav_report_tabular', type: 'object', objectName: 'showcase_task', viewName: 'tabular', label: 'Task List', icon: 'table' },
        { id: 'nav_report_summary', type: 'report', reportName: 'showcase_hours_by_status', label: 'Hours by Status', icon: 'sigma' },
        { id: 'nav_report_matrix', type: 'report', reportName: 'showcase_status_priority_matrix', label: 'Status × Priority', icon: 'grid-3x3' },
        { id: 'nav_report_joined', type: 'report', reportName: 'showcase_task_overview', label: 'Task Overview', icon: 'layers' },
      ],
    },
    {
      id: 'grp_auth_structured',
      type: 'group',
      label: 'Authoring · Structured',
      icon: 'layout-template',
      children: [
        { id: 'nav_gallery', type: 'page', pageName: 'showcase_component_gallery', label: 'Component Gallery', icon: 'layout-template' },
        { id: 'nav_styling_gallery', type: 'page', pageName: 'showcase_styling_gallery', label: 'Styling (ADR-0065)', icon: 'palette' },
        { id: 'nav_page_variables', type: 'page', pageName: 'showcase_page_variables', label: 'Page Variables', icon: 'mouse-pointer-click' },
        { id: 'nav_contact_form', type: 'page', pageName: 'showcase_contact_form', label: 'Contact Form', icon: 'mail-plus' },
        { id: 'nav_project_workspace', type: 'page', pageName: 'showcase_project_workspace', label: 'New Project + Tasks', icon: 'folder-plus' },
        // ADR-0047 interface mode: same object as nav_tasks, curated surface.
        { id: 'nav_task_workbench', type: 'page', pageName: 'showcase_task_workbench', label: 'Task Workbench', icon: 'sliders-horizontal' },
        { id: 'nav_task_triage', type: 'page', pageName: 'showcase_task_triage', label: 'Task Triage (Tabs)', icon: 'layout-list' },
        { id: 'nav_active_projects', type: 'page', pageName: 'showcase_active_projects', label: 'Active Projects', icon: 'folder-kanban' },
      ],
    },
    {
      id: 'grp_auth_viz',
      type: 'group',
      label: 'Authoring · Visualizations',
      icon: 'layout-grid',
      children: [
        { id: 'nav_task_all_views', type: 'page', pageName: 'showcase_task_all_views', label: 'All Views', icon: 'layout-grid' },
        { id: 'nav_task_board', type: 'page', pageName: 'showcase_task_board', label: 'Task Board', icon: 'columns-3' },
        { id: 'nav_task_calendar', type: 'page', pageName: 'showcase_task_calendar', label: 'Task Calendar', icon: 'calendar' },
        { id: 'nav_task_gallery', type: 'page', pageName: 'showcase_task_gallery', label: 'Task Gallery', icon: 'layout-grid' },
        { id: 'nav_task_schedule', type: 'page', pageName: 'showcase_task_schedule', label: 'Team Schedule', icon: 'gantt-chart' },
        { id: 'nav_task_timeline', type: 'page', pageName: 'showcase_task_timeline', label: 'Activity Timeline', icon: 'activity' },
        { id: 'nav_task_map', type: 'page', pageName: 'showcase_task_map', label: 'Work Map', icon: 'map-pin' },
      ],
    },
    {
      id: 'grp_auth_html',
      type: 'group',
      label: 'Authoring · HTML',
      icon: 'code',
      children: [
        { id: 'nav_command_center_jsx', type: 'page', pageName: 'showcase_command_center_jsx', label: 'Command Center', icon: 'code' },
      ],
    },
    {
      id: 'grp_auth_react',
      type: 'group',
      label: 'Authoring · React',
      icon: 'zap',
      children: [
        { id: 'nav_crm_workbench', type: 'page', pageName: 'showcase_crm_workbench', label: 'CRM Workbench · master/detail', icon: 'layout-dashboard' },
        { id: 'nav_task_desk', type: 'page', pageName: 'showcase_task_desk', label: 'Task Desk · drawer & modal', icon: 'panel-right-open' },
        { id: 'nav_renewals_pipeline', type: 'page', pageName: 'showcase_renewals_pipeline', label: 'Renewals Pipeline · rollups & blocks', icon: 'refresh-cw' },
      ],
    },
  ],
});
