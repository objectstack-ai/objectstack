// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * Business Unit — a self-referencing org-chart hierarchy. `parent` points back
 * at the same object, so the tree has arbitrary depth (company → division →
 * department → team). This is the canonical case for the `tree` view type:
 * fixed-depth grouping can't express an unbounded self-referencing hierarchy.
 */
export const BusinessUnit = ObjectSchema.create({
  name: 'showcase_business_unit',
  // [ADR-0090 D1] Explicit grandfather stamp: record isolation for this demo
  // object is RLS-owned / intentionally public; without this the new secure
  // default (unset OWD => private) would owner-filter it.
  sharingModel: 'public_read_write',
  label: 'Business Unit',
  pluralLabel: 'Business Units',
  icon: 'network',
  description: 'Org-chart hierarchy — demonstrates the tree / tree-grid view over a self-referencing object.',

  fields: {
    name: Field.text({ label: 'Name', required: true, searchable: true, maxLength: 120 }),
    // A lookup back to this object, so a unit's record page lists its child
    // units. Without a title of its own that list would be headed by this
    // object's own label ("Business Units") beside the unit itself; the title
    // is translated at `objects.showcase_business_unit.fields.parent.relatedListTitle`.
    parent: Field.lookup('showcase_business_unit', { label: 'Parent Unit', allowCreate: true, relatedListTitle: 'Sub-units' }),
    kind: Field.select({
      label: 'Type',
      options: [
        { label: 'Company', value: 'company' },
        { label: 'Division', value: 'division' },
        { label: 'Department', value: 'department' },
        { label: 'Team', value: 'team' },
      ],
      defaultValue: 'department',
    }),
    manager: Field.text({ label: 'Manager', maxLength: 120 }),
    headcount: Field.number({ label: 'Headcount', min: 0, defaultValue: 0 }),
  },
});
