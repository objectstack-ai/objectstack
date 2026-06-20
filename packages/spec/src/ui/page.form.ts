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
        { field: 'icon', widget: 'icon', colSpan: 1, helpText: 'Icon for navigation menu' },
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
      description: 'Interface mode (Airtable parity): the page defines its own data surface directly — columns, filters, visualizations and toolbar — no inheriting from a separate view.',
      collapsible: true,
      // Primary content for a list page — open by default (still collapsible).
      collapsed: false,
      visibleOn: "data.type == 'list'",
      fields: [
        {
          field: 'interfaceConfig',
          type: 'composite',
          helpText:
            'The page IS the view: source picks the object, columns/filterBy are defined directly here; appearance.allowedVisualizations whitelists renderers (one entry = locked); userActions toggles the toolbar.',
          // Order: common authoring controls first, rarely-used ones last.
          // Explicit sub-fields so `userFilters` can use the dedicated
          // filter-mode selector (None / Tabs / Dropdown, ADR-0047 §3.4a).
          // None maps to ABSENCE of userFilters — the protocol stores
          // "no filter bar" as omission, not a literal element: 'none'.
          // (`element: 'toggle'` stays valid but deprecated — not offered.)
          // Keep this list in sync with InterfacePageConfigSchema.
          fields: [
            // ── Data ── the page defines its own data surface directly.
            { field: 'source', widget: 'ref:object', helpText: 'Object this page reads from' },
            // Columns are defined ON the page (no view inheritance). `dependsOn:
            // 'source'` tells the picker which object's fields to offer.
            { field: 'columns', widget: 'field-multi', dependsOn: 'source', helpText: 'Columns to show — defined directly on the page (blank = all object fields)' },
            { field: 'filterBy', type: 'repeater', helpText: 'Always-on base filter for the page' },
            { field: 'levels', helpText: 'Hierarchy levels to display (tree-like sources)' },
            // ── Appearance ──
            { field: 'appearance', type: 'composite', disclosure: 'popover', helpText: 'Allowed visualizations (Grid / Kanban / Calendar / …) and description visibility' },
            // ── User filters ──
            {
              field: 'userFilters',
              widget: 'filter-mode',
              helpText: 'End-user filter bar: None (no bar) / Tabs (named presets) / Dropdown (per-field). None removes the config.',
            },
            // ── User actions ──
            { field: 'userActions', type: 'composite', disclosure: 'popover', helpText: 'Toolbar toggles (search, sort, filter, row height)' },
            { field: 'addRecord', type: 'composite', disclosure: 'popover', helpText: 'Add-record entry point' },
            // Buttons ARE object actions — pick from the source object's actions.
            { field: 'buttons', widget: 'action-multi', dependsOn: 'source', helpText: "Toolbar buttons — pick from this object's actions" },
            {
              field: 'recordAction',
              options: [
                { label: 'Drawer (right-side peek)', value: 'drawer' },
                { label: 'Full page', value: 'page' },
                { label: 'Modal', value: 'modal' },
                { label: 'Not clickable', value: 'none' },
              ],
              helpText: 'How clicking a record opens its detail',
            },
            { field: 'showRecordCount', helpText: 'Show the record count bar' },
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
