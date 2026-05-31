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
        { id: 'nav_charts', type: 'dashboard', dashboardName: 'showcase_chart_gallery', label: 'Chart Gallery', icon: 'layout-dashboard' },
        { id: 'nav_report_tabular', type: 'report', reportName: 'showcase_task_list', label: 'Task List', icon: 'table' },
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
        { id: 'nav_gallery', type: 'page', pageName: 'showcase_component_gallery', label: 'Component Gallery', icon: 'layout-template' },
      ],
    },
  ],
});
