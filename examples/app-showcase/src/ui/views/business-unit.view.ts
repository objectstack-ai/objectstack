// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'showcase_business_unit' };

/**
 * Business Unit views — a flat grid plus an Organization Chart that uses the
 * `tree` view type to nest records by their self-referencing `parent` field.
 */
export const BusinessUnitViews = defineView({
  list: {
    label: 'All Units',
    type: 'grid',
    data,
    columns: [
      { field: 'name' },
      { field: 'kind' },
      { field: 'manager' },
      { field: 'headcount' },
      { field: 'parent' },
    ],
  },
  listViews: {
    org_chart: {
      label: 'Organization Chart',
      type: 'tree',
      data,
      columns: ['name', 'kind', 'manager', 'headcount'],
      tree: {
        parentField: 'parent',
        labelField: 'name',
        fields: ['kind', 'manager', 'headcount'],
        // Roots + one level expanded by default; deeper teams expand on click.
        defaultExpandedDepth: 1,
      },
    },
  },
  formViews: {
    // `edit`, not `default`: the main `list` implicitly claims `<object>.default`
    // in the shared view namespace, so a `default` form key collides (build-time
    // view-ref lint, framework #2554).
    edit: {
      type: 'simple',
      data,
      sections: [
        { name: 'unit', label: 'Unit', columns: 2, fields: ['name', 'parent', 'kind', 'manager', 'headcount'] },
      ],
    },
  },
});
