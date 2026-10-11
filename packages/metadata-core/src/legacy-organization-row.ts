// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6] A `sys_metadata` row stored in a legacy organization's layer:
 * its `organization_id` names an organization (neither absent, `null` nor the
 * empty string). No metadata read serves one and no boot loads one; the boot
 * report names them, and nothing deletes or rewrites them.
 *
 * Judged off the row in hand — `sys_metadata` is a platform table, never a
 * federated object. Sunk here because its readers outside the metadata door —
 * `@objectstack/objectql`'s authored hook and action binders, and
 * `@objectstack/service-datasource`'s runtime-datasource reads — share no other
 * common home, and a second spelling would let them disagree on which rows are
 * the environment's.
 */
export function isLegacyOrganizationRow(row: { organization_id?: unknown } | null | undefined): boolean {
  const organizationId = row?.organization_id;
  return organizationId !== null && organizationId !== undefined && organizationId !== '';
}
