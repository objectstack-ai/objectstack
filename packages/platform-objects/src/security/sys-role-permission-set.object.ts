// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_role_permission_set — Role ↔ PermissionSet binding.
 *
 * Allows administrators to compose a `sys_role` from one or more
 * `sys_permission_set` rows. At request time, the runtime resolver
 * (`resolveExecutionContext`) collects every permission set bound to
 * the user's roles via this table and injects their names into
 * `ExecutionContext.permissions[]` for downstream RBAC evaluation.
 *
 * @namespace sys
 */
export const SysRolePermissionSet = ObjectSchema.create({
  name: 'sys_role_permission_set',
  label: 'Role Permission Set',
  pluralLabel: 'Role Permission Sets',
  icon: 'shield-plus',
  isSystem: true,
  managedBy: 'system',
  description: 'Binds a permission set to a role.',
  titleFormat: '{role_id} → {permission_set_id}',
  compactLayout: ['role_id', 'permission_set_id'],

  fields: {
    id: Field.text({
      label: 'Binding ID',
      required: true,
      readonly: true,
      description: 'UUID of the role-permission-set binding.',
    }),

    role_id: Field.lookup('sys_role', {
      label: 'Role',
      required: true,
      description: 'Foreign key to sys_role.',
    }),

    permission_set_id: Field.lookup('sys_permission_set', {
      label: 'Permission Set',
      required: true,
      description: 'Foreign key to sys_permission_set.',
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
    { fields: ['role_id', 'permission_set_id'], unique: true },
    { fields: ['role_id'] },
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
