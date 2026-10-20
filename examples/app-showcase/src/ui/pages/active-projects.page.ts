// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * Active Projects — interface page demonstrating the deeper list config:
 *   • `filterBy` — an ALWAYS-ON base filter (hide completed) the end user
 *     cannot remove (distinct from userFilters, which they toggle).
 *   • `sort` — a default sort order defined on the page (budget, high → low).
 *   • `addRecord` — a toolbar "add" entry point that opens the create form.
 *   • dropdown user-filters layered on top of the base filter.
 */
export const ActiveProjectsPage = definePage({
  name: 'showcase_active_projects',
  label: 'Active Projects',
  type: 'list',
  object: 'showcase_project',
  kind: 'full',
  template: 'default',
  isDefault: false,
  regions: [],
  interfaceConfig: {
    source: 'showcase_project',
    columns: ['name', 'account', 'status', 'health', 'budget', 'end_date'],
    // Always-on base filter — completed projects never show here.
    filterBy: [{ field: 'status', operator: 'not_equals', value: 'completed' }],
    // Default sort: biggest budgets first.
    sort: [{ field: 'budget', order: 'desc' }],
    appearance: { showDescription: true, allowedVisualizations: ['grid', 'kanban'] },
    userFilters: {
      element: 'dropdown',
      fields: [{ field: 'health', showCount: true }, { field: 'status' }],
    },
    userActions: { sort: true, search: true, filter: true, rowHeight: false, addRecordForm: false },
    // Add-record entry point: a toolbar button that opens the create form.
    addRecord: { enabled: true, position: 'top' },
    showRecordCount: true,
  },
});
