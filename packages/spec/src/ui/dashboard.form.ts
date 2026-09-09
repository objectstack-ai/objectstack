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
        { field: 'gap', type: 'number', colSpan: 1, helpText: 'Space between widgets, in steps of 0.25rem (4 = 1rem)' },
        { field: 'refreshIntervalSeconds', type: 'number', colSpan: 1, helpText: 'Auto-refresh (seconds)' },
        {
          field: 'header',
          type: 'composite',
          colSpan: 3,
          helpText: 'Dashboard header config (title, subtitle, actions)',
          // The children are ENUMERATED (#16458) so `os i18n extract` emits a
          // `metadataForms.dashboard.fields['header.<child>']` key for each one
          // and the platform catalogs can name them. All three — the console
          // prefers a declared `fields` list over the schema-derived one, so
          // naming two of three would drop the third from the panel.
          fields: [
            { field: 'showTitle', type: 'boolean', helpText: 'Show dashboard title in header' },
            { field: 'showDescription', type: 'boolean', helpText: 'Show dashboard description in header' },
            {
              field: 'actions',
              type: 'repeater',
              helpText: 'Header action buttons',
              // Item-level names. A row's columns are rendered from the JSON
              // Schema (`items.properties[k].title`), not from these specs, so
              // each `label` here MUST equal the `title` authored on
              // `DashboardHeaderActionSchema` — the extractor takes the English
              // source from here, the panel reads it from there, and
              // `dashboard.test.ts` pins the two equal. No `type`: the row
              // widgets stay schema-derived.
              fields: [
                { field: 'label', label: 'Label' },
                { field: 'actionUrl', label: 'Action URL' },
                { field: 'actionType', label: 'Action Type' },
                { field: 'icon', label: 'Icon' },
              ],
            },
          ],
        },
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
