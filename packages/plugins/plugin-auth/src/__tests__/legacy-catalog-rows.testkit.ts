// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Test scaffolding: the organization-less `sys_permission_set` rows an EARLIER
 * release's platform-admin bootstrap seeded for the platform's default sets
 * (the "platform bucket").
 *
 * [C3 stage 6b-2] No boot writes these rows any more (ADR-0131 D3: the sets are
 * served from the security catalog, and a grant names its set). A suite that
 * models an EXISTING database — a grant written before the name column, whose
 * `permission_set_id` points at one of these rows; an organization's copy cloned
 * from the bucket — writes them itself, here, in the shape the retired seeder
 * wrote: `managed_by: 'platform'`, active, the set's facets as JSON columns.
 * Idempotent: a name that already has an organization-less row is left alone.
 *
 * The plugin-auth copy of plugin-security's testkit of the same name, in the
 * same shape: a test-only helper is not exported across the package boundary.
 */

import type { PermissionSet } from '@objectstack/spec/security';

const SYS = { isSystem: true } as const;

/** The legacy row id for a default set — stable, so a fixture can point a grant at it. */
export function legacyBucketRowId(name: string): string {
  return `ps_bucket_${name}`;
}

/** Write the legacy platform-bucket row for each set; returns `name → id`. */
export async function seedLegacyPlatformBucket(
  engine: { find: (...args: any[]) => Promise<any>; insert: (...args: any[]) => Promise<any> },
  sets: readonly PermissionSet[],
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const ps of sets) {
    if (!ps.name) continue;
    const existing = ((await engine.find('sys_permission_set', { where: { name: ps.name }, context: SYS })) ?? []) as any[];
    const own = existing.find((r) => !r.organization_id);
    if (own?.id) {
      ids[ps.name] = String(own.id);
      continue;
    }
    const id = legacyBucketRowId(ps.name);
    await engine.insert('sys_permission_set', {
      id,
      name: ps.name,
      label: ps.label ?? ps.name,
      description: (ps as any).description ?? null,
      object_permissions: JSON.stringify(ps.objects ?? {}),
      field_permissions: JSON.stringify(ps.fields ?? {}),
      system_permissions: JSON.stringify(ps.systemPermissions ?? []),
      row_level_security: JSON.stringify(ps.rowLevelSecurity ?? []),
      tab_permissions: JSON.stringify(ps.tabPermissions ?? {}),
      admin_scope: (ps as any).adminScope ? JSON.stringify((ps as any).adminScope) : null,
      active: true,
      managed_by: 'platform',
    }, { context: SYS });
    ids[ps.name] = id;
  }
  return ids;
}
