// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineMetadataForm } from './view.zod';
import { defaultPeriodOptions } from './default-period-options';

export const dashboardForm = defineMetadataForm({
  schemaId: 'dashboard',
  type: 'simple',
  sections: [
    {
      label: 'Basics',
      description: 'Dashboard identity and description.',
      columns: 2,
      fields: [
        { field: 'name', type: 'text', required: true, colSpan: 1, helpText: 'A unique internal name for this dashboard: lowercase letters, numbers and underscores, starting with a letter (for example sales_overview).' },
        { field: 'label', type: 'text', required: true, colSpan: 1, helpText: 'The title people see for this dashboard.' },
        { field: 'description', type: 'textarea', colSpan: 2 },
      ],
    },
    {
      label: 'Layout',
      description: 'Grid sizing and refresh cadence.',
      columns: 3,
      fields: [
        { field: 'columns', type: 'number', colSpan: 1, helpText: 'How many columns the widgets are laid out on, from 1 to 24. Leave it empty and the dashboard picks a width that fits its widgets.' },
        { field: 'gap', type: 'number', colSpan: 1, helpText: 'How much space to leave between widgets. Larger numbers spread them further apart; leave it empty for the standard spacing.' },
        { field: 'refreshIntervalSeconds', type: 'number', colSpan: 1, helpText: 'How often the dashboard reloads its data, in seconds. Leave it empty or enter 0 to turn automatic reloading off.' },
        {
          field: 'header',
          type: 'composite',
          colSpan: 3,
          helpText: 'What shows at the top of the dashboard: its title, its description and action buttons.',
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
        {
          field: 'widgets',
          type: 'repeater',
          required: true,
          helpText: 'The charts, numbers and tables on this dashboard, and where each one sits.',
          // Row-property names (#17508): every authorable row property, `label`
          // equal to the item schema's `.meta({ title })`, so `os i18n extract`
          // emits a catalog key per column and the panel keeps its schema-derived
          // widgets (no `type` here).
          fields: [
            { field: 'id', label: 'Widget ID' },
            { field: 'title', label: 'Title' },
            { field: 'description', label: 'Description' },
            { field: 'type', label: 'Visualization Type' },
            { field: 'chartConfig', label: 'Chart Configuration' },
            { field: 'colorVariant', label: 'Color Variant' },
            { field: 'requiresObject', label: 'Requires Object' },
            { field: 'requiresService', label: 'Requires Service' },
            { field: 'filter', label: 'Filter' },
            { field: 'compareTo', label: 'Compare To' },
            { field: 'dataset', label: 'Dataset' },
            { field: 'dimensions', label: 'Dimensions' },
            { field: 'values', label: 'Values' },
            { field: 'layout', label: 'Layout' },
            { field: 'options', label: 'Options' },
            { field: 'filterBindings', label: 'Filter Bindings' },
            { field: 'suppressWarnings', label: 'Suppress Warnings' },
          ],
        },
      ],
    },
    {
      label: 'Filters',
      description: 'Default and global filters applied across widgets.',
      collapsible: true,
      collapsed: true,
      fields: [
        {
          field: 'dateRange',
          type: 'composite',
          helpText: 'The period the dashboard opens with, and whether viewers may pick their own dates.',
          // The children are ENUMERATED, all three (the console prefers a
          // declared `fields` list over the schema-derived one), so the
          // Default Period row can name its choices: with no options a select
          // names them by their stored values. The options are the report
          // form's (`defaultPeriodOptions`), so both forms name a period alike.
          fields: [
            { field: 'field', label: 'Date Field', helpText: 'The date field the period filters on. Leave it empty to use the creation date.' },
            {
              field: 'defaultRange',
              type: 'select',
              label: 'Default Period',
              helpText: 'The period the dashboard opens with.',
              options: defaultPeriodOptions(),
            },
            { field: 'allowCustomRange', label: 'Allow Custom Range', helpText: 'Let viewers pick their own start and end dates.' },
          ],
        },
        {
          field: 'globalFilters',
          type: 'repeater',
          helpText: 'Filters viewers can use to narrow every widget at once, or only the widgets you choose.',
          // Row-property names (#17508): every authorable row property, `label`
          // equal to the item schema's `.meta({ title })`, so `os i18n extract`
          // emits a catalog key per column and the panel keeps its schema-derived
          // widgets (no `type` here).
          fields: [
            { field: 'name', label: 'Name' },
            { field: 'field', label: 'Field' },
            { field: 'object', label: 'Object' },
            { field: 'label', label: 'Label' },
            { field: 'type', label: 'Input Type' },
            { field: 'options', label: 'Options' },
            { field: 'optionsFrom', label: 'Options From' },
            { field: 'defaultValue', label: 'Default Value' },
            { field: 'scope', label: 'Scope' },
            { field: 'targetWidgets', label: 'Target Widgets' },
          ],
        },
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
