// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from './view.zod';

/**
 * Page Metadata Form
 * 
 * Form layout for creating/editing page metadata definitions.
 */
export const pageForm = defineForm({
  schemaId: 'page',
  type: 'simple',
  sections: [
    {
      label: 'Basics',
      description: 'Page identity and template.',
      columns: 2,
      fields: [
        { field: 'name', required: true, colSpan: 1, helpText: 'Unique identifier (snake_case)' },
        { field: 'label', required: true, colSpan: 1, helpText: 'Page title shown to users' },
        { field: 'icon', colSpan: 1, helpText: 'Icon for navigation menu' },
        { field: 'type', colSpan: 1, helpText: 'Page type (record, home, app, dashboard, etc.)' },
        { field: 'template', colSpan: 2, helpText: 'Layout template (e.g., "header-sidebar-main")' },
        { field: 'description', widget: 'textarea', colSpan: 2, helpText: 'Page description for navigation' },
      ],
    },
    {
      label: 'Data Context',
      description: 'Record binding and page-local state.',
      fields: [
        { field: 'object', widget: 'ref:object', helpText: 'Bound object (for Record pages)' },
        { field: 'variables', type: 'repeater', helpText: 'Local page state variables' },
      ],
    },
    {
      label: 'Layout',
      description: 'Page regions and components placed within them.',
      fields: [
        { field: 'regions', type: 'repeater', required: true, helpText: 'Layout regions (header, main, sidebar, footer) with components' },
      ],
    },
    {
      label: 'Interface (list pages)',
      description: 'ADR-0047 interface mode: bind a source view and curate the end-user surface — quick filters, locked visualizations, toolbar actions (Airtable Interfaces parity).',
      collapsible: true,
      collapsed: true,
      visibleOn: "data.type == 'list'",
      fields: [
        {
          field: 'interfaceConfig',
          type: 'composite',
          helpText:
            'source/sourceView bind the object view (columns, base filter and sort are inherited — the iron rule); userFilters picks the element style (dropdown / tabs / toggle) and exposed fields; appearance.allowedVisualizations whitelists renderers (one entry = locked); userActions toggles the toolbar.',
        },
      ],
    },
    {
      label: 'Advanced',
      description: 'Activation, audience, and accessibility.',
      collapsible: true,
      collapsed: true,
      fields: [
        { field: 'isDefault', helpText: 'Set as default page for this page type' },
        { field: 'kind', helpText: 'Page override mode: full or slotted (for record pages)' },
        { field: 'assignedProfiles', widget: 'string-tags', helpText: 'Profiles that can access this page' },
        { field: 'aria', type: 'composite', helpText: 'Accessibility attributes (ARIA labels, roles)' },
      ],
    },
  ],
});
