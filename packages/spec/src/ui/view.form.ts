// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * View — canonical FormView layout.
 *
 * Views power most data surfaces (grid / kanban / calendar / gantt /
 * gallery / timeline / chart — and `page`, which mounts a published page
 * instead of drawing rows) and each surface has its own block of
 * options. We group fields by surface so the editor doesn't dump 30+
 * irrelevant knobs on the user.
 *
 * Visibility predicates use the `type` discriminator to reveal only
 * the surface-specific block.
 *
 * Composite children are spelled out, each with the hint the panel shows
 * (#30267). `os i18n extract` walks only DECLARED children, so a composite
 * left to the schema-derived list had no catalog key for any of its rows and
 * read English in every locale. A declared child's `helpText` is its schema
 * `.describe()` text, the hint the panel showed before it was declared;
 * `view-form-composite-children.test.ts` holds the two equal and holds each
 * child list equal to the schema's live keys, so a key added to a block
 * cannot go missing from the panel.
 */

import { defineForm } from './view.zod';

export const viewForm = defineForm({
  schemaId: 'view',
  type: 'simple',
  sections: [
    {
      name: 'basics',
      label: 'Basics',
      description: 'Identity and primary surface.',
      columns: 2,
      fields: [
        { field: 'name', type: 'text', required: true, colSpan: 1, helpText: 'snake_case, unique per environment' },
        { field: 'label', type: 'text', required: true, colSpan: 1 },
        { field: 'description', type: 'textarea', colSpan: 2 },
        { field: 'type', required: true, colSpan: 1, helpText: 'Primary view surface' },
        { field: 'data', widget: 'json', colSpan: 2, helpText: 'Data source — e.g. {"provider":"object","object":"task"}' },
      ],
    },
    {
      name: 'columns_filters',
      label: 'Columns & filters',
      description: 'What rows show and how users filter them.',
      fields: [
        {
          field: 'columns',
          type: 'repeater',
          required: true,
          helpText: 'Columns to display (field names from selected object)',
          // Row-property names (#17508): every authorable row property, `label`
          // equal to the item schema's `.meta({ title })`, so `os i18n extract`
          // emits a catalog key per column and the panel keeps its schema-derived
          // widgets (no `type` here).
          fields: [
            { field: 'field', label: 'Field' },
            { field: 'label', label: 'Label' },
            { field: 'width', label: 'Width (px)' },
            { field: 'align', label: 'Alignment' },
            { field: 'hidden', label: 'Hidden' },
            { field: 'sortable', label: 'Sortable' },
            { field: 'resizable', label: 'Resizable' },
            { field: 'wrap', label: 'Wrap Text' },
            { field: 'type', label: 'Renderer Type' },
            { field: 'pinned', label: 'Pinned' },
            { field: 'summary', label: 'Summary' },
            { field: 'prefix', label: 'Prefix' },
            { field: 'link', label: 'Primary Link' },
            { field: 'action', label: 'Click Action' },
          ],
        },
        { field: 'filter', widget: 'filter-builder', dependsOn: 'data.object', helpText: 'Filter conditions — same visual builder as the list toolbar, with field-type-aware operators and value inputs' },
        {
          field: 'sort',
          type: 'repeater',
          helpText: 'Default sort order',
          // Row-property names (#17508): every authorable row property, `label`
          // equal to the item schema's `.meta({ title })`, so `os i18n extract`
          // emits a catalog key per column and the panel keeps its schema-derived
          // widgets (no `type` here).
          fields: [
            { field: 'field', label: 'Field' },
            { field: 'order', label: 'Direction' },
          ],
        },
        { field: 'searchableFields', widget: 'string-tags', helpText: 'Field names available for quick search' },
        // [#24640] The `filterableFields` input was REMOVED with the key it
        // wrote — now a `retiredKey()` tombstone on `ListViewSchema` (ruled
        // retired with no replacement: the platform carries no per-view
        // Filter-panel whitelist). A form input for an unwritable key is the
        // false-compliant UI half of a retirement; a curated end-user filter
        // bar is `userFilters`, under End-user controls below.
      ],
    },
    {
      name: 'table_options',
      label: 'Table options',
      description: 'Grid-only display options.',
      visibleWhen: "data.type == 'grid' || data.type == null",
      collapsible: true,
      collapsed: true,
      columns: 2,
      fields: [
        { field: 'resizable', colSpan: 1, helpText: 'Enable column resizing' },
        // `striped` / `bordered` inputs removed with the keys (#7176 — pass-through-only, retired).
        { field: 'compactToolbar', colSpan: 1, helpText: 'Collapse Group/Color/Density/Hide-fields into a single View settings popover' },
        { field: 'rowHeight', colSpan: 1, helpText: 'Row height / density setting' },
        {
          field: 'selection',
          type: 'composite',
          colSpan: 2,
          helpText: 'Row selection configuration',
          fields: [{ field: 'type', helpText: 'Selection mode' }],
        },
      ],
    },
    // `pagination` is NOT grid-only: every view type accepts it, and
    // `pagination.pageSize` is the row bound every view type carries (maintainer
    // ruling D on #19228 makes it the direction for a view's row bound). Its own
    // section with no `visibleWhen` puts it in front of every type; inside
    // `table_options` a non-grid author could not reach it.
    {
      name: 'pagination',
      label: 'Pagination',
      description: 'Page size and page-size options — every view type accepts them, not only grids.',
      collapsible: true,
      collapsed: true,
      fields: [
        {
          field: 'pagination',
          type: 'composite',
          helpText: 'Pagination configuration',
          fields: [
            { field: 'pageSize', helpText: 'Number of records per page. On a view with no pager (kanban, gallery, timeline) it is the fetch ceiling, and the renderer owes two things: bound its fetch at this number, and, when the filtered set is larger than it, show a visible truncation signal saying what is on screen is not the whole set' },
            { field: 'pageSizeOptions', helpText: 'Available page size options' },
          ],
        },
      ],
    },
    {
      name: 'kanban',
      label: 'Kanban',
      description: 'Kanban-specific board configuration.',
      visibleWhen: "data.type == 'kanban'",
      fields: [{ field: 'kanban', type: 'composite' }],
    },
    {
      name: 'calendar',
      label: 'Calendar',
      description: 'Calendar-specific configuration.',
      visibleWhen: "data.type == 'calendar'",
      fields: [{ field: 'calendar', type: 'composite' }],
    },
    {
      name: 'gantt',
      label: 'Gantt',
      description: 'Gantt-specific configuration.',
      visibleWhen: "data.type == 'gantt'",
      fields: [{ field: 'gantt', type: 'composite' }],
    },
    {
      name: 'gallery',
      label: 'Gallery',
      description: 'Gallery-specific configuration.',
      visibleWhen: "data.type == 'gallery'",
      fields: [{ field: 'gallery', type: 'composite' }],
    },
    {
      name: 'timeline',
      label: 'Timeline',
      description: 'Timeline-specific configuration.',
      visibleWhen: "data.type == 'timeline'",
      fields: [{ field: 'timeline', type: 'composite' }],
    },
    {
      name: 'chart',
      label: 'Chart',
      description: 'Chart-specific configuration.',
      visibleWhen: "data.type == 'chart'",
      fields: [{ field: 'chart', type: 'composite' }],
    },
    // [#17063] The `page` section was REMOVED with the mount it configured
    // (ADR-0049 enforce-or-remove, maintainer ruling 2026-09-09 「撤」). It bound
    // the one input `pageName`, which is now a `retiredKey()` tombstone on
    // `ListViewSchema` — a form input for an unwritable key is the false-compliant
    // UI half of a retirement. To put a published page in front of users, author
    // an app navigation item instead.
    // The end-user controls are ADR-0047's Airtable Interface parity surface;
    // the record stays in this comment, out of the section description.
    {
      name: 'end_user_controls',
      label: 'End-user controls',
      description: 'What end users can do on this view — quick filters, filter tabs, visualization switching.',
      collapsible: true,
      collapsed: true,
      fields: [
        {
          field: 'userFilters',
          type: 'composite',
          helpText: 'Quick-filter bar: element style (dropdown / tabs / toggle) + exposed fields or tab presets',
          fields: [
            { field: 'element', helpText: 'Filter control style on object views: "dropdown" (per-field value chips). "toggle" is deprecated. "tabs" is page-only — use `listViews` for named presets.' },
            {
              field: 'fields',
              type: 'repeater',
              // `grid`: the inline table this array of objects rendered as
              // before it was enumerated (the panel's auto-detected
              // master-detail table), now with translatable column heads.
              widget: 'grid',
              helpText: 'Fields exposed as quick filters (dropdown/toggle elements)',
              // Row-property names: every authorable row property, `label`
              // equal to the item schema's `.meta({ title })`, as `columns`
              // above does.
              fields: [
                { field: 'field', label: 'Field', required: true },
                { field: 'label', label: 'Label' },
                { field: 'type', label: 'Type' },
                { field: 'options', label: 'Options' },
                { field: 'showCount', label: 'Show Count' },
                { field: 'defaultValues', label: 'Default Values' },
              ],
            },
          ],
        },
        // [#20301] The `tabs` repeater was REMOVED with the key it wrote — now a
        // `retiredKey()` tombstone on `ListViewSchema` (no renderer ever mounted a
        // tab bar for it). A form input for an unwritable key is the
        // false-compliant UI half of a retirement; named presets are `listViews`
        // entries, each a tab in the saved-view switcher.
        {
          field: 'appearance',
          type: 'composite',
          helpText: 'allowedVisualizations: which renderers users may switch between',
          fields: [
            { field: 'showDescription', helpText: 'Show the view description text' },
            { field: 'allowedVisualizations', helpText: 'Whitelist of visualization types users can switch between (e.g. ["grid", "gallery", "kanban"])' },
          ],
        },
        {
          field: 'userActions',
          type: 'composite',
          helpText: 'Toolbar toggles: sort / search / filter / row height',
          fields: [
            { field: 'sort', helpText: 'Allow users to sort records' },
            { field: 'search', helpText: 'Allow users to search records' },
            { field: 'filter', helpText: 'Allow users to filter records' },
            { field: 'refresh', helpText: 'Allow users to reload the view data from the backend without a full page reload' },
            { field: 'rowHeight', helpText: 'Allow users to toggle row height/density' },
            { field: 'group', helpText: 'Allow users to change record grouping from the toolbar. Toggle only — the grouping itself is configured in the view-level `grouping` block.' },
            { field: 'addRecordForm', helpText: 'Add records through a form instead of inline' },
            { field: 'editInline', helpText: 'Allow users to edit records inline. On by default: a user who may update the object edits a cell in place with the field\'s type-aware widget (the same control the form uses), under the permission gate that already decides whether the object is editable at all. Declare `editInline: false` to make the list read-only in place.' },
            { field: 'hideFields', helpText: 'Allow users to hide/show fields from the toolbar (the affordance behind the view-level `hiddenFields` list). Boolean toggle — distinct from the record-details component\'s `hideFields`, which is an array of field names to omit. On by default: a reader hides and shows columns for themselves; declare `hideFields: false` to withhold the control.' },
            { field: 'rowColor', helpText: 'Allow users to configure row colouring from the toolbar. Boolean toggle — the colour rules themselves live in the view-level `rowColor` block. Off by default: row colouring is opt-in.' },
            { field: 'buttons', helpText: 'Custom action button IDs to show in the toolbar' },
          ],
        },
        // [#24692] Spelled out so the form offers exactly the two live keys:
        // `mode` and `formView` are `retiredKey()` tombstones on
        // `AddRecordConfigSchema` (no renderer ever read them — the Add button
        // opens the create form, `formViews.create` when declared), and
        // `enabled` is required, so an Add-record block always says whether it
        // is on.
        {
          field: 'addRecord',
          type: 'composite',
          helpText: 'Add record entry point configuration',
          fields: [
            { field: 'enabled', helpText: 'Show the add record entry point — REQUIRED: `true` draws the Add button, `false` declares it off' },
            { field: 'position', helpText: 'Position of the add record button: `top` (the toolbar, the default), `bottom` (under the list) or `both`' },
          ],
        },
        { field: 'showRecordCount', helpText: 'Show record count at the bottom of the list' },
      ],
    },
    {
      name: 'navigation_sharing',
      label: 'Navigation & sharing',
      description: 'Where this view appears and who can see it.',
      collapsible: true,
      collapsed: true,
      fields: [
        // Children spelled out (#30267) so the i18n extractor emits a catalog
        // key per row, and so the form offers only the live keys:
        // `navigation.view` and `sharing.type` are `retiredKey()` tombstones
        // the schema-derived list used to render as editable rows.
        {
          field: 'navigation',
          type: 'composite',
          helpText: 'Configuration for item click navigation (drawer by default, page, new_window or none)',
          fields: [
            { field: 'mode' },
            { field: 'preventNavigation', helpText: 'Disable standard navigation entirely' },
            { field: 'openNewTab', helpText: 'Force open in new tab (applies to page mode)' },
            { field: 'size', helpText: 'Overlay size bucket for the drawer detail: \'auto\' (default — renderer derives from field count + viewport; AI writes nothing) or a coarse override sm/md/lg/xl/full. Prefer this over the pixel `width`; page mode ignores it.' },
            { field: 'width', helpText: '[DEPRECATED → size] Pixel/percent width of the drawer (e.g. "600px"). A pixel width cannot be chosen at authoring time without knowing the client viewport — use the `size` bucket.' },
          ],
        },
        {
          field: 'sharing',
          type: 'composite',
          helpText: 'View sharing configuration: who locked the view configuration',
          fields: [
            { field: 'lockedBy', helpText: 'User who locked the view configuration' },
          ],
        },
      ],
    },
  ],
});
