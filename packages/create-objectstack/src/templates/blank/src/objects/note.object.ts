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
    body: Field.longText({
      label: 'Body',
    }),
  },

  enable: {
    apiEnabled: true,
    searchable: true,
  },
});
