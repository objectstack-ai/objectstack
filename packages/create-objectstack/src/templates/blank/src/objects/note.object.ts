// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

export const Note = ObjectSchema.create({
  name: 'blank_note',
  label: 'Note',
  pluralLabel: 'Notes',
  icon: 'sticky-note',
  description: 'A short note — the starter object for a blank environment.',

  // Field groups: the sections a note's form and detail page draw, top to
  // bottom in this order. A field joins one by naming its `key` in `group`.
  // That placement is what displays `body`. `objectstack validate` and
  // `objectstack lint` report a field that nothing displays or reads
  // (`field-no-consumers`) once the project holds a view, flow, dashboard or
  // anything else that could read it, so give each field you add a `group`
  // as well. Field groups versus a view's own form sections:
  // https://objectstack.ai/docs/ui/field-grouping-and-order
  fieldGroups: [
    { key: 'details', label: 'Details' },
  ],

  fields: {
    title: Field.text({
      label: 'Title',
      required: true,
      searchable: true,
      maxLength: 200,
      group: 'details',
    }),
    body: Field.textarea({
      label: 'Body',
      group: 'details',
    }),
  },

  // Org-wide default (OWD): who can see records they don't own. `private` is
  // owner-only until access is widened by a permission grant or a sharing rule.
  // Declaring it is required, deliberately: `objectstack build` refuses an
  // object that declares no OWD, so the baseline is always an authored decision
  // rather than an accident. The other values, and how to widen access safely:
  // https://objectstack.ai/docs/permissions/sharing-rules
  sharingModel: 'private',

  enable: {
    apiEnabled: true,
    searchable: true,
  },
});
