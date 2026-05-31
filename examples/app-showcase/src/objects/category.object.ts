// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * Category — a self-referencing hierarchy (tree). `parent` points back at
 * the same object, exercising recursive/hierarchical relationships.
 */
export const Category = ObjectSchema.create({
  name: 'showcase_category',
  label: 'Category',
  pluralLabel: 'Categories',
  icon: 'list-tree',
  description: 'Hierarchical tagging tree — demonstrates self-referencing relations.',

  fields: {
    name: Field.text({ label: 'Name', required: true, searchable: true, maxLength: 120 }),
    parent: Field.lookup('showcase_category', { label: 'Parent Category' }),
    color: Field.color({ label: 'Color' }),
    sort_order: Field.number({ label: 'Sort Order', min: 0, defaultValue: 0 }),
  },
});
