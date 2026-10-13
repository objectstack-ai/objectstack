// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Test scaffolding: the TABLE shape of the retired `sys_permission_set` row
 * object (ADR-0131 D3; retired from plugin-security by C3 stage 8), for a suite
 * that models an EXISTING database whose platform-bucket rows
 * (`legacy-catalog-rows.testkit.ts`) outlive the object declaration until the
 * organization-ownership migration (ADR-0131 D10) takes them.
 *
 * The columns are the ones those rows carry, as the last release that declared
 * the object stored them. A test-only copy of plugin-security's
 * `src/__tests__/legacy-catalog-objects.testkit.ts` shape rather than an import
 * of it: that file is no export of the package, and a relative import out of
 * this package would make a test read another package's source.
 */

import { ObjectSchema, Field } from '@objectstack/spec/data';

export const SysPermissionSet = ObjectSchema.create({
  name: 'sys_permission_set',
  label: 'Permission Set',
  pluralLabel: 'Permission Sets',
  isSystem: true,
  managedBy: 'config',
  displayNameField: 'label',
  nameField: 'label',
  fields: {
    label: Field.text({ label: 'Display Name', required: true, maxLength: 255 }),
    name: Field.text({ label: 'API Name', required: true, maxLength: 100 }),
    description: Field.textarea({ label: 'Description', required: false }),
    object_permissions: Field.textarea({ label: 'Object Permissions', required: false }),
    field_permissions: Field.textarea({ label: 'Field Permissions', required: false }),
    system_permissions: Field.textarea({ label: 'System Permissions', required: false }),
    row_level_security: Field.textarea({ label: 'Row-Level Security', required: false }),
    tab_permissions: Field.textarea({ label: 'Tab Permissions', required: false }),
    admin_scope: Field.textarea({ label: 'Admin Scope', required: false }),
    active: Field.boolean({ label: 'Active', defaultValue: true }),
    package_id: Field.text({ label: 'Owning Package', required: false, maxLength: 255 }),
    managed_by: Field.select({
      label: 'Managed By',
      required: false,
      defaultValue: 'admin',
      options: [
        { value: 'platform', label: 'Platform' },
        { value: 'package', label: 'Package' },
        { value: 'admin', label: 'Admin' },
      ],
    }),
    customized: Field.boolean({ label: 'Customized', defaultValue: false }),
    id: Field.text({ label: 'Permission Set ID', required: true, readonly: true }),
    created_at: Field.datetime({ label: 'Created At', defaultValue: 'NOW()', readonly: true }),
    updated_at: Field.datetime({ label: 'Updated At', defaultValue: 'NOW()', readonly: true }),
  },
  indexes: [
    { fields: ['name'], unique: 'organization' },
    { fields: ['active'] },
    { fields: ['package_id'] },
  ],
});

/**
 * `objects` plus the retired `sys_permission_set` table when it does not
 * already declare one — for a suite that boots the security plugin's objects
 * AND models an existing database's bucket rows, whether or not the plugin
 * still declares the table.
 */
export function withLegacyPermissionSetTable(objects: readonly unknown[]): unknown[] {
  const declared = objects.some((o) => (o as { name?: unknown } | null | undefined)?.name === SysPermissionSet.name);
  return declared ? [...objects] : [...objects, SysPermissionSet];
}
