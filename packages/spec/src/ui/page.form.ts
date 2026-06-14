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
        {
          field: 'type',
          colSpan: 1,
          // The page KIND, not a visualization. Kanban/Calendar/Gallery/Timeline
          // are visualizations OF a List page (set under Interface →
          // Appearance → Allowed visualizations), not page types — so they are
          // deliberately absent here. Only kinds with a dedicated renderer are
          // offered; roadmap kinds (dashboard/form/record_detail/…) are valid in
          // the schema but hidden until they render distinctly.
          options: [
            { label: 'List / Interface page', value: 'list' },
            { label: 'Record page', value: 'record' },
            { label: 'Home page', value: 'home' },
            { label: 'App page', value: 'app' },
            { label: 'Utility panel', value: 'utility' },
          ],
          helpText: 'Page kind. "List / Interface" binds a source view into a curated surface — how it looks (grid / kanban / calendar / …) is a visualization set under Interface, not a page type.',
        },
        // A list/interface page renders via InterfaceListPage and ignores the
        // region template, so hide it there (same rationale as Data Context / Layout).
        { field: 'template', colSpan: 2, visibleOn: "data.type != 'list'", helpText: 'Layout template (e.g., "header-sidebar-main")' },
        { field: 'description', widget: 'textarea', colSpan: 2, helpText: 'Page description for navigation' },
      ],
    },
    {
      label: 'Data Context',
      description: 'Record binding and page-local state.',
      // Interface/list pages bind their data via the Interface section
      // (source/sourceView), not a page-level object — hide this to keep
      // the panel lean (the region/record machinery doesn't apply).
      visibleOn: "data.type != 'list'",
      fields: [
        { field: 'object', widget: 'ref:object', helpText: 'Bound object (for Record pages)' },
        { field: 'variables', type: 'repeater', helpText: 'Local page state variables' },
      ],
    },
    {
      label: 'Layout',
      description: 'Page regions and components placed within them.',
      // List pages render a curated list surface, not free-form regions —
      // the region designer is irrelevant here, so hide it for list pages.
      visibleOn: "data.type != 'list'",
      fields: [
        { field: 'regions', type: 'repeater', required: true, helpText: 'Layout regions (header, main, sidebar, footer) with components' },
      ],
    },
    {
      name: 'interface',
      label: 'Interface (list pages)',
      description: 'ADR-0047 interface mode: bind a source view and curate the end-user surface — quick filters, locked visualizations, toolbar actions (Airtable Interfaces parity).',
      collapsible: true,
      // Primary content for a list page — open by default (still collapsible).
      collapsed: false,
      visibleOn: "data.type == 'list'",
      fields: [
        {
          field: 'interfaceConfig',
          type: 'composite',
          helpText:
            'source/sourceView bind the object view (columns, base filter and sort are inherited — the iron rule); appearance.allowedVisualizations whitelists renderers (one entry = locked); userActions toggles the toolbar.',
          // Order: common authoring controls first, rarely-used ones last.
          // Explicit sub-fields so `userFilters` can use the dedicated
          // filter-mode selector (None / Tabs / Dropdown, ADR-0047 §3.4a).
          // None maps to ABSENCE of userFilters — the protocol stores
          // "no filter bar" as omission, not a literal element: 'none'.
          // (`element: 'toggle'` stays valid but deprecated — not offered.)
          // Keep this list in sync with InterfacePageConfigSchema.
          fields: [
            { field: 'source', widget: 'ref:object', helpText: 'Object this list reads from' },
            // Pick from the source object's views instead of typing a name.
            // `dependsOn: 'source'` tells the picker which object's views to list.
            { field: 'sourceView', widget: 'view-ref', dependsOn: 'source', helpText: 'Named list view to inherit columns/filter/sort from (blank = object default)' },
            { field: 'appearance', type: 'composite', helpText: 'Allowed visualizations (Grid / Kanban / Calendar / …) and description visibility' },
            {
              field: 'userFilters',
              widget: 'filter-mode',
              helpText: 'End-user filter bar: None (no bar) / Tabs (named presets) / Dropdown (per-field). None removes the config.',
            },
            { field: 'userActions', type: 'composite', helpText: 'Toolbar toggles (search, sort, filter, row height)' },
            { field: 'addRecord', type: 'composite', helpText: 'Add-record entry point' },
            { field: 'showRecordCount', helpText: 'Show the record count bar' },
            // Less-common — kept last.
            { field: 'filterBy', type: 'repeater', helpText: 'Always-on page filter (in addition to the source view)' },
            { field: 'levels', helpText: 'Hierarchy levels to display (tree-like sources)' },
            { field: 'allowPrinting', helpText: 'Allow users to print this page' },
          ],
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
