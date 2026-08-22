// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

export const Note = ObjectSchema.create({
  name: 'blank_note',
  label: 'Note',
  pluralLabel: 'Notes',
  icon: 'sticky-note',
  description: 'A short note — the starter object for a blank environment.',

  fields: {
    title: Field.text({
      label: 'Title',
      required: true,
      searchable: true,
      maxLength: 200,
    }),
    body: Field.textarea({
      label: 'Body',
    }),
  },

  // Org-wide default (OWD): who can see records they don't own. `private` is
  // owner-only until access is widened by a permission grant or a sharing rule.
  // Declaring it is required, deliberately: `npm run build` refuses an object
  // with no OWD, so the baseline is always an authored decision rather than an
  // accident. The other values, and how to widen access safely:
  // https://objectstack.ai/docs/permissions/sharing-rules
  sharingModel: 'private',

  enable: {
    apiEnabled: true,
    searchable: true,
  },
});
