// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_saved_report — Reusable Report Definition
 *
 * A persisted query against a single object that can be re-executed
 * on demand or on a schedule. Acts as the bridge between ad-hoc
 * filtering in the UI and the structured report library administrators
 * curate.
 *
 * The query envelope (`query_json`) is the same shape ObjectQL accepts
 * — `{ filter, fields, orderBy, limit, groupBy }` — so a report can be
 * round-tripped between the list view and the report definition
 * without re-translation.
 *
 * Conventions:
 *  - `object_name` is the short object the report queries.
 *  - `format` controls how `IReportService.run()` renders the rows
 *    (`csv` for downloads, `html_table` for email digests, `json`
 *    for raw API consumption).
 *
 * @namespace sys
 */
export const SysSavedReport = ObjectSchema.create({
  name: 'sys_saved_report',
  label: 'Saved Report',
  pluralLabel: 'Saved Reports',
  icon: 'bar-chart',
  isSystem: true,
  managedBy: 'platform',
  description: 'Persisted ObjectQL report definition — re-runnable and schedulable',
  displayNameField: 'name',
  titleFormat: '{name}',
  compactLayout: ['name', 'object_name', 'format', 'owner_id', 'updated_at'],

  fields: {
    id: Field.text({
      label: 'Report ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    name: Field.text({
      label: 'Name',
      required: true,
      maxLength: 200,
      searchable: true,
      group: 'Definition',
    }),

    description: Field.textarea({
      label: 'Description',
      required: false,
      group: 'Definition',
    }),

    object_name: Field.text({
      label: 'Object',
      required: true,
      maxLength: 100,
      description: 'Short object name the report queries',
      group: 'Definition',
    }),

    query_json: Field.textarea({
      label: 'Query',
      required: true,
      description: 'ObjectQL query envelope — { filter, fields, orderBy, limit, groupBy }',
      group: 'Definition',
    }),

    format: Field.select(
      ['csv', 'json', 'html_table'],
      {
        label: 'Format',
        required: true,
        defaultValue: 'csv',
        description: 'Rendering used by IReportService.run() and email digests',
        group: 'Definition',
      },
    ),

    owner_id: Field.lookup('sys_user', {
      label: 'Owner',
      required: false,
      description: 'User that owns the report definition (drives sharing)',
      group: 'Provenance',
    }),

    last_run_at: Field.datetime({
      label: 'Last Run',
      required: false,
      description: 'Stamped by IReportService.run() on successful execution',
      group: 'State',
    }),

    last_row_count: Field.number({
      label: 'Last Row Count',
      required: false,
      group: 'State',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      required: false,
      group: 'System',
    }),
  },

  indexes: [
    { fields: ['object_name'] },
    { fields: ['owner_id'] },
    { fields: ['name'] },
  ],
});
