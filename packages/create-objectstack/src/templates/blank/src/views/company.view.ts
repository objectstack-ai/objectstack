// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

/**
 * Company list views: a grid of every company and a board by type, the same
 * views as the platform's Starter app. The menu's Companies entry
 * (`src/apps/main.app.ts`) opens the grid, and the board is a second view of
 * the same list.
 *
 * No `form` here: the Console's create and edit form lays a record out by the
 * object's `fieldGroups` (`src/objects/company.object.ts`), and a declared
 * default form is not loaded there.
 */
const CompanyViews = defineView({
  list: {
    label: 'All Companies',
    type: 'grid',
    data: { provider: 'object', object: 'blank_company' },
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
      data: { provider: 'object', object: 'blank_company' },
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
      data: { provider: 'object', object: 'blank_company' },
      columns: ['name', 'industry', 'phone'],
      kanban: {
        groupByField: 'type',
        columns: ['name', 'industry', 'phone'],
      },
    },
  },
});

export default CompanyViews;
