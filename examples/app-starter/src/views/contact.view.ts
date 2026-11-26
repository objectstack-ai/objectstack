// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

/**
 * Contact list views: a grid of every contact and a board by influence.
 *
 * No `form` here, for the reason `company.view.ts` gives: the form is the
 * object's `fieldGroups`.
 */
export const ContactViews = defineView({
  list: {
    label: 'All Contacts',
    type: 'grid',
    data: { provider: 'object', object: 'starter_contact' },
    columns: [
      { field: 'name' },
      { field: 'company' },
      { field: 'title' },
      { field: 'influence' },
      { field: 'email' },
      { field: 'phone' },
    ],
  },
  listViews: {
    all: {
      label: 'All Contacts',
      type: 'grid',
      data: { provider: 'object', object: 'starter_contact' },
      columns: [
        { field: 'name' },
        { field: 'company' },
        { field: 'title' },
        { field: 'influence' },
        { field: 'email' },
        { field: 'phone' },
      ],
    },
    by_influence: {
      label: 'Contacts by Influence',
      type: 'kanban',
      data: { provider: 'object', object: 'starter_contact' },
      columns: ['name', 'company', 'title'],
      kanban: {
        groupByField: 'influence',
        columns: ['name', 'company', 'title'],
      },
    },
  },
});
