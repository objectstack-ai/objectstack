// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Page } from '@objectstack/spec/ui';

/**
 * Task Workbench — the canonical **interface page** example (ADR-0047).
 *
 * Demonstrates the second run mode for object UI: where the object nav
 * entry ("Tasks") shows every list view as switcher tabs and lets users
 * create their own views (data mode), this page is an author-curated
 * surface (interface mode):
 *
 *   • it REFERENCES the object's default list view (`sourceView` —
 *     columns/filter/sort are inherited, never restated here);
 *   • end users get exactly the quick filters the author enabled
 *     (status + priority dropdowns) — nothing else;
 *   • the visualization is locked to grid (no switcher);
 *   • view creation / advanced filtering are not offered.
 *
 * Mirrors Airtable's Interfaces right panel: Data (source), User filters
 * (Elements: dropdowns), Appearance (Visualizations), User actions.
 */
export const TaskWorkbenchPage: Page = {
  name: 'showcase_task_workbench',
  label: 'Task Workbench',
  type: 'list',
  object: 'showcase_task',
  kind: 'full',
  template: 'default',
  isDefault: false,
  // Interface pages carry no regions — the list surface is generated from
  // `interfaceConfig` (ADR-0047), not composed from components.
  regions: [],
  interfaceConfig: {
    source: 'showcase_task',

    // ADR-0047 iron rule: the page inherits columns/filter/sort from the
    // referenced view and adds presentation policy only.
    sourceView: 'default',

    // End-user quick filters — the only filtering surface on this page.
    userFilters: {
      element: 'dropdown',
      fields: [
        { field: 'status' },
        { field: 'priority', showCount: true },
      ],
    },

    // Locked visualization: a single-entry whitelist renders no switcher.
    appearance: {
      showDescription: true,
      allowedVisualizations: ['grid'],
    },

    userActions: {
      sort: true,
      search: true,
      filter: false,      // no advanced filter builder on a curated page
      rowHeight: false,
      addRecordForm: false,
    },

    showRecordCount: true,
  },
};
