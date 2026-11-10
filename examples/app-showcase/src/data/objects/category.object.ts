// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * Category — a self-referencing hierarchy (tree). `parent` points back at
 * the same object, exercising recursive/hierarchical relationships.
 */
export const Category = ObjectSchema.create({
  name: 'showcase_category',
  // [ADR-0090 D1] Explicit grandfather stamp: record isolation for this demo
  // object is RLS-owned / intentionally public; without this the new secure
  // default (unset OWD => private) would owner-filter it.
  sharingModel: 'public_read_write',
  label: 'Category',
  pluralLabel: 'Categories',
  icon: 'list-tree',
  description: 'Hierarchical tagging tree — demonstrates self-referencing relations.',

  fields: {
    name: Field.text({ label: 'Name', required: true, searchable: true, maxLength: 120, group: 'category' }),
    parent: Field.lookup('showcase_category', { label: 'Parent Category', allowCreate: true, group: 'category' }),
    color: Field.color({ label: 'Color', group: 'display' }),
    sort_order: Field.number({ label: 'Sort Order', min: 0, defaultValue: 0, group: 'display' }),
  },

  // ADR-0085 §5: the form, detail and drawer layout is derived from these
  // groups, so each field is placed in a named section rather than left to the
  // untitled fallback, which the field-no-consumers rule credits to no one (#32168).
  fieldGroups: [
    { key: 'category', label: 'Category' },
    { key: 'display', label: 'Display' },
  ],
});
