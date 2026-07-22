// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_user_permission_set — User ↔ PermissionSet assignment.
 *
 * Salesforce-style additive permission grant: a user may be assigned any
 * number of `sys_permission_set` rows, optionally scoped to a specific
 * organization. The runtime resolver (`resolveExecutionContext` in
 * `@objectstack/runtime`) reads this table when building the per-request
 * `ExecutionContext.permissions[]`.
 *
 * Uniqueness is `(user_id, permission_set_id, organization_id)` so the
 * same permission set can be granted independently in each org context
 * the user belongs to.
 *
 * @namespace sys
 */
export const SysUserPermissionSet = ObjectSchema.create({
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  pluralLabel: 'User Permission Sets',
  icon: 'user-check',
  isSystem: true,
  managedBy: 'system',
  // [ADR-0103] Admin/user-writable DATA on a platform-defined schema: delegated
  // `manageBindings` direct grants write this under the caller's context.
  // Affordance only — the DelegatedAdminGate is the authz.
  userActions: { create: true, edit: true, delete: true },
  description: 'Direct assignment of a permission set to a user (optionally scoped to an organization).',
  titleFormat: '{user_id} → {permission_set_id}',
  highlightFields: ['user_id', 'permission_set_id', 'organization_id'],

  fields: {
    id: Field.text({
      label: 'Assignment ID',
      required: true,
      readonly: true,
      description: 'UUID of the assignment.',
    }),

    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: true,
      description: 'Foreign key to sys_user.',
    }),

    permission_set_id: Field.lookup('sys_permission_set', {
      label: 'Permission Set',
      required: true,
      description: 'Foreign key to sys_permission_set.',
    }),

    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      description: 'Optional organization scope. NULL = applies in every org context.',
    }),

    granted_by: Field.lookup('sys_user', {
      label: 'Granted By',
      required: false,
      description: 'User who granted this permission set.',
    }),

    valid_from: Field.datetime({
      label: 'Valid From',
      required: false,
      description:
        '[ADR-0091 D1] Grant is inactive before this instant. Null = active immediately. ' +
        'Enforced fail-closed at resolution time (D2) — never by a background job.',
    }),

    valid_until: Field.datetime({
      label: 'Valid Until',
      required: false,
      description:
        '[ADR-0091 D1] Grant is inactive AT and AFTER this instant (half-open [from, until), UTC). ' +
        'Null = never expires. Mandatory on break-glass activations (D4) and agent grants (D6). ' +
        'Enforced at resolution time (D2).',
    }),

    reason: Field.text({
      label: 'Reason',
      required: false,
      maxLength: 500,
      description:
        '[ADR-0091 D1] Why this grant exists. Free text; REQUIRED on delegation (D3) and break-glass (D4) rows. ' +
        'Agent grants carry the task/run attribution here (D6).',
    }),

    delegated_from: Field.lookup('sys_user', {
      label: 'Delegated From',
      required: false,
      description:
        '[ADR-0091 D3] The delegator whose authority this row carries. ' +
        'A row with delegated_from set is not itself delegatable and not self-renewable.',
    }),

    last_certified_at: Field.datetime({
      label: 'Last Certified At',
      required: false,
      description:
        '[ADR-0091 D5] When this grant was last attested in a recertification review. Null = never certified.',
    }),

    certified_by: Field.lookup('sys_user', {
      label: 'Certified By',
      required: false,
      description: '[ADR-0091 D5] Reviewer who last attested this grant.',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      defaultValue: 'NOW()',
      readonly: true,
    }),
  },

  indexes: [
    { fields: ['user_id', 'permission_set_id', 'organization_id'], unique: true },
    { fields: ['user_id'] },
    { fields: ['organization_id'] },
    { fields: ['permission_set_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete'],
  },
});
