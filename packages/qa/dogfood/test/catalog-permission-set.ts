// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3, C3 stage 6b-2] Does the security catalog serve this permission
 * set — the fixture precondition that replaced "is its `sys_permission_set`
 * row seeded".
 *
 * No boot writes a `sys_permission_set` row any more: a set is served by name
 * from the registry, and a grant names its set. So a fixture that grants a set
 * asks the catalog the security plugin bound to its engine — the read the
 * authorization resolver itself uses — and gets the definition back, or
 * `undefined` when no reader holds the name.
 */

import { securityCatalogReaderOf } from '@objectstack/core';

export async function catalogPermissionSet(
  ql: unknown,
  name: string,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  const reader = securityCatalogReaderOf(ql);
  if (!reader) throw new Error('no security catalog is bound to this engine — is the SecurityPlugin booted?');
  return (await reader.resolve('permission', name))?.definition;
}

/**
 * The `sys_permission_set` row an EARLIER release's boot wrote for a declared
 * set, written here by a fixture that models an EXISTING database (the data
 * door's edit, reset and lock paths still run against such rows until the
 * object retires). The body is the catalog definition's, in the column shape
 * the retired seeders wrote; `managedBy` / `packageId` are the provenance they
 * stamped (`'package'` with the owning package, `'platform'` for a platform
 * default). Idempotent: an existing organization-less row is returned as is.
 */
export async function ensureLegacyPermissionSetRow(
  ql: any,
  name: string,
  provenance: { managedBy: 'package' | 'platform' },
): Promise<any> {
  const SYS = { isSystem: true };
  const existing = ((await ql.find('sys_permission_set', { where: { name } }, { context: SYS })) ?? []) as any[];
  const own = existing.find((r) => !r.organization_id);
  if (own) return own;
  const def: any = await catalogPermissionSet(ql, name);
  if (!def) throw new Error(`the security catalog serves no permission set '${name}'`);
  await ql.insert('sys_permission_set', {
    id: `ps_legacy_${name}`,
    name,
    label: def.label ?? name,
    description: def.description ?? null,
    object_permissions: JSON.stringify(def.objects ?? {}),
    field_permissions: JSON.stringify(def.fields ?? {}),
    system_permissions: JSON.stringify(def.systemPermissions ?? []),
    row_level_security: JSON.stringify(def.rowLevelSecurity ?? []),
    tab_permissions: JSON.stringify(def.tabPermissions ?? {}),
    admin_scope: def.adminScope ? JSON.stringify(def.adminScope) : null,
    active: true,
    managed_by: provenance.managedBy,
    ...(provenance.managedBy === 'package' && typeof def._packageId === 'string' ? { package_id: def._packageId } : {}),
  }, { context: SYS });
  return ((await ql.find('sys_permission_set', { where: { name } }, { context: SYS })) ?? [])
    .find((r: any) => !r.organization_id);
}
