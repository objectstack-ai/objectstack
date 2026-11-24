// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_note — a note, built into the platform (step 1: no links to records).
 *
 * A title and a rich-text body. A note needs no record: it is content of its
 * own, listed, searched and given views like any object. It is an ordinary
 * customizable object — an organization adds fields and views — and comments
 * and attachments work on it as on any record.
 *
 * ## The heading a list shows
 *
 * The title is optional. A list and a record header show `heading`, which the
 * platform keeps equal to the title, or to the body's first line when the
 * title is empty (`work/hooks.ts`). It is read-only: what a person edits is the
 * title and the body.
 *
 * ## Who sees a note
 *
 * Its creator: `sharingModel: 'private'` over `owner_id`, which the security
 * plugin stamps with the creating user. Anyone else reads a note only through
 * the existing sharing and permission-set machinery. A `sys_*` object is never
 * given the injected ownership column, so it is declared here.
 */
export const SysNote = ObjectSchema.create({
  name: 'sys_note',
  label: 'Note',
  pluralLabel: 'Notes',
  icon: 'notebook-pen',
  description: 'Notes: a title and a formatted body.',
  nameField: 'heading',
  highlightFields: ['owner_id', 'updated_at'],
  sharingModel: 'private',

  listViews: {
    mine: {
      type: 'grid',
      name: 'mine',
      label: 'My Notes',
      data: { provider: 'object', object: 'sys_note' },
      columns: ['heading', 'updated_at'],
      filter: [{ field: 'owner_id', operator: 'equals', value: '{current_user_id}' }],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 50 },
      emptyState: { title: 'No notes yet', message: 'Notes you write appear here.' },
    },
    all: {
      type: 'grid',
      name: 'all',
      label: 'All Notes',
      data: { provider: 'object', object: 'sys_note' },
      columns: ['heading', 'owner_id', 'updated_at'],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    title: Field.text({
      label: 'Title',
      maxLength: 255,
      searchable: true,
    }),

    body: Field.richtext({
      label: 'Body',
      searchable: true,
    }),

    heading: Field.text({
      label: 'Heading',
      maxLength: 255,
      readonly: true,
      description: 'The title, or the first line of the body when the title is empty. Kept by the platform.',
    }),

    // The owner anchor `sharingModel: 'private'` reads (see the docblock).
    owner_id: Field.lookup('sys_user', {
      label: 'Owner',
    }),
  },

  indexes: [
    { fields: ['owner_id'] },
  ],

  enable: {
    files: true,
  },
});
