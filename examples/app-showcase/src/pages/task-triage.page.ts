// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Page } from '@objectstack/spec/ui';

/**
 * Task Triage — interface page demonstrating the **tabs** user-filter element
 * (Airtable "User filters" → Elements: Tabs). Counterpart to Task Workbench,
 * which demonstrates **dropdowns**: same source view, but end users switch a
 * single preset tab instead of combining per-field dropdowns.
 *
 * Tabs and dropdowns are the two mutually-exclusive Elements of one
 * `userFilters` config (ADR-0053). A tab is a pure filter preset
 * (`{ name, label, filter }`) — it never switches the view form; that is the
 * separate "Visualizations" axis (locked to grid here).
 */
export const TaskTriagePage: Page = {
  name: 'showcase_task_triage',
  label: 'Task Triage',
  type: 'list',
  object: 'showcase_task',
  kind: 'full',
  template: 'default',
  isDefault: false,
  regions: [],
  interfaceConfig: {
    source: 'showcase_task',
    // Inherit columns/filter/sort from the object's default view (ADR-0047).
    sourceView: 'default',

    // End-user filter element: a row of preset tabs. `showAllRecords` adds the
    // leading unfiltered "All" tab automatically.
    userFilters: {
      element: 'tabs',
      showAllRecords: true,
      tabs: [
        { name: 'in_progress', label: 'In Progress', filter: [{ field: 'status', operator: 'equals', value: 'in_progress' }] },
        { name: 'urgent', label: 'Urgent', icon: 'flame', filter: [{ field: 'priority', operator: 'equals', value: 'urgent' }] },
        { name: 'in_review', label: 'In Review', filter: [{ field: 'status', operator: 'equals', value: 'in_review' }] },
        { name: 'done', label: 'Done', filter: [{ field: 'status', operator: 'equals', value: 'done' }] },
      ],
    },

    // Locked visualization (single-entry whitelist renders no form switcher).
    appearance: {
      showDescription: true,
      allowedVisualizations: ['grid'],
    },

    userActions: {
      sort: true,
      search: true,
      filter: false,
      rowHeight: false,
      addRecordForm: false,
    },

    showRecordCount: true,
  },
};
