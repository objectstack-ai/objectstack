// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { F } from '@objectstack/spec/shared';

/**
 * sys_business_unit_member — User ↔ Business Unit Assignment
 *
 * Many-to-many between `sys_user` and `sys_business_unit`. A user can belong
 * to multiple business units (matrix orgs) but exactly one is marked
 * `is_primary` to drive the default reporting view.
 *
 * Effective-dated so that historical reports & audits can reconstruct
 * who reported to which unit at any point in time.
 *
 * @namespace sys
 */
export const SysBusinessUnitMember = ObjectSchema.create({
  name: 'sys_business_unit_member',
  label: 'Business Unit Member',
  pluralLabel: 'Business Unit Members',
  icon: 'user-cog',
  isSystem: true,
  managedBy: 'platform',
  description: 'User assignment to a business unit (matrix-org friendly, effective-dated).',
  // [ADR-0079] The record title is `display_title`, a text formula over the
  // columns `titleFormat` names. With no pointer declared, the registry's
  // designate-only pass stamped `nameField: 'id'` (the first title-eligible
  // field), so a renderer honouring ADR-0079's order (an explicit `nameField`
  // wins over `titleFormat`) drew the raw id as the record page's H1.
  // `titleFormat` stays for renderers that still read it first, and is the
  // rung below the pointer where the title has no value: the console draws a
  // lookup placeholder by the related record's name (else its email), so over
  // an expanded row it renders the same text the formula does.
  // `identity-display-title.test.ts` holds the two to the same text;
  // `plugin-security/src/business-unit-member-title.test.ts` pins the title a
  // read serves.
  displayNameField: 'display_title',
  nameField: 'display_title', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{user_id} in {business_unit_id}',
  highlightFields: ['user_id', 'business_unit_id', 'function_in_business_unit', 'is_primary'],

  fields: {
    id: Field.text({
      label: 'Member ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    // [ADR-0079] The record title (`nameField` above). A formula is computed on
    // read and has no stored column, so a renamed user or unit is named anew on
    // the next read. It names the PERSON and the UNIT, not the stored ids: the
    // user's `name`, or their `email` where the name is blank (the platform's
    // `name || email` rule for a person's handle), and the unit's `name`, each
    // read ONE hop through its lookup (ADR-0079 addendum, 2026-10-18), as
    // `sys_user_permission_set`'s title does. Both hops are read under the
    // READER's own authority: a user or unit the reader may not read, or one
    // that no longer exists, leaves the title null, never a value computed in
    // its place. Neither lookup is read bare beside its hop (refused,
    // `traversal-bare-and-traversed`). Both lookups are required, and both
    // related `name` columns are required stored text (no second hop).
    display_title: Field.formula({
      label: 'Title',
      returnType: 'text',
      expression: F`(isBlank(trim(record.user_id.name)) ? record.user_id.email : record.user_id.name) + ' in ' + record.business_unit_id.name`,
      description: 'Record title: the user and the business unit they are assigned to (computed on read)',
      group: 'Assignment',
    }),

    business_unit_id: Field.lookup('sys_business_unit', {
      label: 'Business Unit',
      required: true,
      group: 'Assignment',
    }),

    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: true,
      group: 'Assignment',
    }),

    function_in_business_unit: Field.select(
      ['member', 'lead', 'deputy'],
      {
        label: 'Function in Business Unit',
        required: false,
        defaultValue: 'member',
        description: '`lead` is the day-to-day head; `deputy` may stand in for the lead in approval routing.',
        group: 'Assignment',
      },
    ),

    is_primary: Field.boolean({
      label: 'Primary Assignment',
      required: false,
      defaultValue: true,
      description: 'When the user is in multiple business units, this marks the canonical one for reporting.',
      group: 'Assignment',
    }),

    effective_from: Field.datetime({
      label: 'Effective From',
      required: false,
      group: 'Lifecycle',
    }),

    effective_to: Field.datetime({
      label: 'Effective To',
      required: false,
      group: 'Lifecycle',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),
  },

  indexes: [
    { fields: ['business_unit_id', 'user_id'], unique: 'global' },
    { fields: ['user_id'] },
    { fields: ['is_primary'] },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    // No `apiMethods` — default-open (#3543 audit). Memberships ride the same
    // HRIS org-tree sync as sys_business_unit (#3025/#3392) and need every
    // primitive; a whitelist naming all six is equivalent to no whitelist while
    // NOT tracking future primitives. The P1 explicit `import`/`export` entries
    // were reclaimed — both derive (import ⊆ create∨update, export ⊆ list).
  },
});
