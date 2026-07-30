// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from './view.zod';

export const dashboardForm = defineForm({
  schemaId: 'dashboard',
  type: 'simple',
  sections: [
    {
      label: 'Basics',
      description: 'Dashboard identity and description.',
      columns: 2,
      fields: [
        { field: 'name', type: 'text', required: true, colSpan: 1, helpText: 'snake_case unique identifier' },
        { field: 'label', type: 'text', required: true, colSpan: 1, helpText: 'Display name' },
        { field: 'description', type: 'textarea', colSpan: 2 },
      ],
    },
    {
      label: 'Layout',
      description: 'Grid sizing and refresh cadence.',
      columns: 3,
      fields: [
        { field: 'columns', type: 'number', colSpan: 1, helpText: 'Grid columns (default 12)' },
        { field: 'gap', type: 'number', colSpan: 1, helpText: 'Grid gap (Tailwind units)' },
        { field: 'refreshInterval', type: 'number', colSpan: 1, helpText: 'Auto-refresh (seconds)' },
        { field: 'header', type: 'composite', colSpan: 3, helpText: 'Dashboard header config (title, subtitle, actions)' },
      ],
    },
    {
      label: 'Widgets',
      description: 'Cards and charts placed on the grid.',
      fields: [
        { field: 'widgets', type: 'repeater', required: true, helpText: 'Dashboard widgets with position and sizing' },
      ],
    },
    {
      label: 'Filters',
      description: 'Default and global filters applied across widgets.',
      collapsible: true,
      collapsed: true,
      fields: [
        { field: 'dateRange', type: 'composite', helpText: 'Default date range selector' },
        { field: 'globalFilters', type: 'repeater', helpText: 'Filters applied to all widgets' },
      ],
    },
    {
      label: 'Advanced',
      description: 'Accessibility and performance tuning.',
      collapsible: true,
      collapsed: true,
      fields: [
        // `aria` / `performance` inputs removed with the keys (#3896 close-out):
        // no dashboard renderer ever applied either.
      ],
    },
  ],
});
