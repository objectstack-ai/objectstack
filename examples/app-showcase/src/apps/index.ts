// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { App } from '@objectstack/spec/ui';

/**
 * Showcase app — navigation that links to every surface so a human can click
 * through the whole gallery: the data objects, the Task view gallery, the
 * Chart Gallery dashboard, the reports, and the component-gallery home page.
 */
export const ShowcaseApp = App.create({
  name: 'showcase_app',
  label: 'Showcase',
  icon: 'sparkles',
  branding: { primaryColor: '#7C3AED' },

  navigation: [
    {
      id: 'grp_data',
      type: 'group',
      label: 'Data Model',
      icon: 'database',
      children: [
        { id: 'nav_projects', type: 'object', objectName: 'showcase_project', label: 'Projects', icon: 'folder-kanban' },
        { id: 'nav_tasks', type: 'object', objectName: 'showcase_task', label: 'Tasks', icon: 'check-square' },
        { id: 'nav_accounts', type: 'object', objectName: 'showcase_account', label: 'Accounts', icon: 'building' },
        { id: 'nav_invoices', type: 'object', objectName: 'showcase_invoice', label: 'Invoices', icon: 'receipt' },
        { id: 'nav_products', type: 'object', objectName: 'showcase_product', label: 'Products', icon: 'package' },
        { id: 'nav_teams', type: 'object', objectName: 'showcase_team', label: 'Teams', icon: 'users' },
        { id: 'nav_categories', type: 'object', objectName: 'showcase_category', label: 'Categories', icon: 'list-tree' },
        { id: 'nav_field_zoo', type: 'object', objectName: 'showcase_field_zoo', label: 'Field Zoo', icon: 'shapes' },
      ],
    },
    {
      id: 'grp_analytics',
      type: 'group',
      label: 'Analytics',
      icon: 'chart-bar',
      children: [
        { id: 'nav_ops', type: 'dashboard', dashboardName: 'showcase_ops_dashboard', label: 'Delivery Operations', icon: 'gauge' },
        { id: 'nav_charts', type: 'dashboard', dashboardName: 'showcase_chart_gallery', label: 'Chart Gallery', icon: 'layout-dashboard' },
        { id: 'nav_report_tabular', type: 'object', objectName: 'showcase_task', viewName: 'tabular', label: 'Task List', icon: 'table' },
        { id: 'nav_report_summary', type: 'report', reportName: 'showcase_hours_by_status', label: 'Hours by Status', icon: 'sigma' },
        { id: 'nav_report_matrix', type: 'report', reportName: 'showcase_status_priority_matrix', label: 'Status × Priority', icon: 'grid-3x3' },
        { id: 'nav_report_joined', type: 'report', reportName: 'showcase_task_overview', label: 'Task Overview', icon: 'layers' },
      ],
    },
    {
      id: 'grp_pages',
      type: 'group',
      label: 'Pages',
      icon: 'layout',
      children: [
        { id: 'nav_my_work', type: 'page', pageName: 'showcase_my_work', label: 'My Work', icon: 'home' },
        { id: 'nav_review_queue', type: 'page', pageName: 'showcase_review_queue', label: 'Approvals', icon: 'check-check' },
        { id: 'nav_new_project_wizard', type: 'page', pageName: 'showcase_new_project_wizard', label: 'New Project (Wizard)', icon: 'wand-2' },
        { id: 'nav_settings', type: 'object', objectName: 'showcase_preference', label: 'Settings', icon: 'settings' },
        { id: 'nav_gallery', type: 'page', pageName: 'showcase_component_gallery', label: 'Component Gallery', icon: 'layout-template' },
        { id: 'nav_project_workspace', type: 'page', pageName: 'showcase_project_workspace', label: 'New Project + Tasks', icon: 'folder-plus' },
        // ADR-0047 interface mode: same object as nav_tasks, curated surface.
        { id: 'nav_task_workbench', type: 'page', pageName: 'showcase_task_workbench', label: 'Task Workbench', icon: 'sliders-horizontal' },
        { id: 'nav_task_triage', type: 'page', pageName: 'showcase_task_triage', label: 'Task Triage (Tabs)', icon: 'layout-list' },
        { id: 'nav_active_projects', type: 'page', pageName: 'showcase_active_projects', label: 'Active Projects', icon: 'folder-kanban' },
        { id: 'nav_task_all_views', type: 'page', pageName: 'showcase_task_all_views', label: 'All Views', icon: 'layout-grid' },
        { id: 'nav_task_board', type: 'page', pageName: 'showcase_task_board', label: 'Task Board', icon: 'columns-3' },
        { id: 'nav_task_calendar', type: 'page', pageName: 'showcase_task_calendar', label: 'Task Calendar', icon: 'calendar' },
        { id: 'nav_task_gallery', type: 'page', pageName: 'showcase_task_gallery', label: 'Task Gallery', icon: 'layout-grid' },
        { id: 'nav_task_schedule', type: 'page', pageName: 'showcase_task_schedule', label: 'Team Schedule', icon: 'gantt-chart' },
        { id: 'nav_task_timeline', type: 'page', pageName: 'showcase_task_timeline', label: 'Activity Timeline', icon: 'activity' },
        { id: 'nav_task_map', type: 'page', pageName: 'showcase_task_map', label: 'Work Map', icon: 'map-pin' },
      ],
    },
  ],
});
