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
  description: 'Direct assignment of a permission set to a user (optionally scoped to an organization).',
  titleFormat: '{user_id} → {permission_set_id}',
  compactLayout: ['user_id', 'permission_set_id', 'organization_id'],

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
    trash: true,
    mru: false,
  },
});
