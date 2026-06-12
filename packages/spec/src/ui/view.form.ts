// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * View — canonical FormView layout.
 *
 * Views power most data surfaces (grid / kanban / calendar / gantt /
 * gallery / timeline / chart) and each surface has its own block of
 * options. We group fields by surface so the editor doesn't dump 30+
 * irrelevant knobs on the user.
 *
 * Visibility predicates use the `type` discriminator to reveal only
 * the surface-specific block.
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
        { field: 'columns', type: 'repeater', required: true, helpText: 'Columns to display (field names from selected object)' },
        { field: 'filter', type: 'repeater', helpText: 'Filter conditions' },
        { field: 'sort', type: 'repeater', helpText: 'Default sort order' },
        { field: 'searchableFields', widget: 'string-tags', helpText: 'Field names available for quick search' },
        { field: 'filterableFields', widget: 'string-tags', helpText: 'Field names available for filtering' },
      ],
    },
    {
      name: 'table_options',
      label: 'Table options',
      description: 'Grid-only display options.',
      visibleOn: "data.type == 'grid' || data.type == null",
      collapsible: true,
      collapsed: true,
      columns: 2,
      fields: [
        { field: 'resizable', colSpan: 1 },
        { field: 'striped', colSpan: 1 },
        { field: 'bordered', colSpan: 1 },
        { field: 'compactToolbar', colSpan: 1 },
        { field: 'rowHeight', colSpan: 1 },
        { field: 'selection', type: 'composite', colSpan: 2 },
        { field: 'pagination', type: 'composite', colSpan: 2 },
      ],
    },
    {
      name: 'kanban',
      label: 'Kanban',
      description: 'Kanban-specific board configuration.',
      visibleOn: "data.type == 'kanban'",
      fields: [{ field: 'kanban', type: 'composite' }],
    },
    {
      name: 'calendar',
      label: 'Calendar',
      description: 'Calendar-specific configuration.',
      visibleOn: "data.type == 'calendar'",
      fields: [{ field: 'calendar', type: 'composite' }],
    },
    {
      name: 'gantt',
      label: 'Gantt',
      description: 'Gantt-specific configuration.',
      visibleOn: "data.type == 'gantt'",
      fields: [{ field: 'gantt', type: 'composite' }],
    },
    {
      name: 'gallery',
      label: 'Gallery',
      description: 'Gallery-specific configuration.',
      visibleOn: "data.type == 'gallery'",
      fields: [{ field: 'gallery', type: 'composite' }],
    },
    {
      name: 'timeline',
      label: 'Timeline',
      description: 'Timeline-specific configuration.',
      visibleOn: "data.type == 'timeline'",
      fields: [{ field: 'timeline', type: 'composite' }],
    },
    {
      name: 'chart',
      label: 'Chart',
      description: 'Chart-specific configuration.',
      visibleOn: "data.type == 'chart'",
      fields: [{ field: 'chart', type: 'composite' }],
    },
    {
      name: 'end_user_controls',
      label: 'End-user controls',
      description: 'What end users can do on this view — quick filters, filter tabs, visualization switching (ADR-0047, Airtable Interface parity).',
      collapsible: true,
      collapsed: true,
      fields: [
        { field: 'userFilters', type: 'composite', helpText: 'Quick-filter bar: element style (dropdown / tabs / toggle) + exposed fields or tab presets' },
        { field: 'tabs', type: 'repeater', helpText: 'In-view filter tabs — each tab applies its own filter rules' },
        { field: 'appearance', type: 'composite', helpText: 'allowedVisualizations: which renderers users may switch between' },
        { field: 'userActions', type: 'composite', helpText: 'Toolbar toggles: sort / search / filter / row height' },
        { field: 'addRecord', type: 'composite' },
        { field: 'showRecordCount' },
      ],
    },
    {
      name: 'navigation_sharing',
      label: 'Navigation & sharing',
      description: 'Where this view appears and who can see it.',
      collapsible: true,
      collapsed: true,
      fields: [
        { field: 'navigation', type: 'composite' },
        { field: 'sharing', type: 'composite' },
      ],
    },
  ],
});
