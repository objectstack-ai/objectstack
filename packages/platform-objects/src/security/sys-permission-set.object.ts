// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_permission_set — System Permission Set Object
 *
 * Named groupings of fine-grained permissions.
 * Permission sets can be assigned to roles or directly to users
 * for granular access control.
 *
 * @namespace sys
 */
export const SysPermissionSet = ObjectSchema.create({
  name: 'sys_permission_set',
  label: 'Permission Set',
  pluralLabel: 'Permission Sets',
  icon: 'lock',
  isSystem: true,
  managedBy: 'config',
  description: 'Named permission groupings for fine-grained access control',
  displayNameField: 'label',
  titleFormat: '{label}',
  compactLayout: ['label', 'name', 'active'],

  fields: {
    // ── Identity ─────────────────────────────────────────────────
    label: Field.text({
      label: 'Display Name',
      required: true,
      searchable: true,
      maxLength: 255,
      group: 'Identity',
    }),

    name: Field.text({
      label: 'API Name',
      required: true,
      searchable: true,
      maxLength: 100,
      description: 'Unique machine name for the permission set',
      group: 'Identity',
    }),

    description: Field.textarea({
      label: 'Description',
      required: false,
      group: 'Identity',
    }),

    // ── Permissions ──────────────────────────────────────────────
    object_permissions: Field.textarea({
      label: 'Object Permissions',
      required: false,
      description: 'JSON-serialized object-level CRUD permissions',
      group: 'Permissions',
    }),

    field_permissions: Field.textarea({
      label: 'Field Permissions',
      required: false,
      description: 'JSON-serialized field-level read/write permissions',
      group: 'Permissions',
    }),

    // ── Status ───────────────────────────────────────────────────
    active: Field.boolean({
      label: 'Active',
      defaultValue: true,
      group: 'Status',
    }),

    // ── System ───────────────────────────────────────────────────
    id: Field.text({
      label: 'Permission Set ID',
      required: true,
      readonly: true,
      group: 'System',
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
    { fields: ['name'], unique: true },
    { fields: ['active'] },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete'],
    trash: true,
    mru: true,
  },
});
