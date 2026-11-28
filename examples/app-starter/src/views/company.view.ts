// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

/**
 * Company list views: a grid of every company and a board by type.
 *
 * No `form` here: the Console's create and edit form lays a record out by the
 * object's `fieldGroups` (`company.object.ts`), and a declared default form is
 * not loaded there.
 */
export const CompanyViews = defineView({
  list: {
    label: 'All Companies',
    type: 'grid',
    data: { provider: 'object', object: 'starter_company' },
    columns: [
      { field: 'name' },
      { field: 'type' },
      { field: 'industry' },
      { field: 'phone' },
      { field: 'website' },
      { field: 'owner_id' },
    ],
  },
  listViews: {
    all: {
      label: 'All Companies',
      type: 'grid',
      data: { provider: 'object', object: 'starter_company' },
      columns: [
        { field: 'name' },
        { field: 'type' },
        { field: 'industry' },
        { field: 'phone' },
        { field: 'website' },
        { field: 'owner_id' },
      ],
    },
    by_type: {
      label: 'Companies by Type',
      type: 'kanban',
      data: { provider: 'object', object: 'starter_company' },
      columns: ['name', 'industry', 'phone'],
      kanban: {
        groupByField: 'type',
        columns: ['name', 'industry', 'phone'],
      },
    },
  },
});
