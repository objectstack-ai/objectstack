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
  // `titleFormat` stays for renderers that still read it first;
  // `identity-display-title.test.ts` holds the two to the same text.
  // `user_id` and `business_unit_id` are lookups, so the formula reads their stored
  // ids: a formula is evaluated on the stored row, before `$expand`, and
  // cannot reach a related record's own title.
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
    // read and has no stored column. Every source column is required, so the
    // expression needs no null guard.
    display_title: Field.formula({
      label: 'Title',
      returnType: 'text',
      expression: F`record.user_id + ' in ' + record.business_unit_id`,
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
    { fields: ['business_unit_id', 'user_id'], unique: true },
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
