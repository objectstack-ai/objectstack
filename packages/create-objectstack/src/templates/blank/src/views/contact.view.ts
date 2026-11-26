// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

/**
 * Contact list views: a grid of every contact and a board by influence, the same
 * views as the platform's Starter app. The menu's Contacts entry
 * (`src/apps/main.app.ts`) opens the grid, and the board is a second view of
 * the same list.
 *
 * No `form` here: the Console's create and edit form lays a record out by the
 * object's `fieldGroups` (`src/objects/contact.object.ts`), and a declared
 * default form is not loaded there.
 */
const ContactViews = defineView({
  list: {
    label: 'All Contacts',
    type: 'grid',
    data: { provider: 'object', object: 'blank_contact' },
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
      data: { provider: 'object', object: 'blank_contact' },
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
      data: { provider: 'object', object: 'blank_contact' },
      columns: ['name', 'company', 'title'],
      kanban: {
        groupByField: 'influence',
        columns: ['name', 'company', 'title'],
      },
    },
  },
});

export default ContactViews;
