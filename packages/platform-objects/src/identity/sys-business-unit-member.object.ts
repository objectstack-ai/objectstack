// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

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
  titleFormat: '{user_id} in {business_unit_id}',
  highlightFields: ['user_id', 'business_unit_id', 'function_in_business_unit', 'is_primary'],

  fields: {
    id: Field.text({
      label: 'Member ID',
      required: true,
      readonly: true,
      group: 'System',
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
