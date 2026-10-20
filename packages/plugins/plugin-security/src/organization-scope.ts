// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Organization scoping for the RBAC catalog's per-organization passes: the
 * system context one pass runs under and the one read that picks an
 * organization's own row out of a scoped read (the sweep and the reap guard
 * retired with their one caller, the seeder; #15204 stage 6b-2 — and the
 * organization-less residue it reported retired with the 18.0 ownership
 * ceremony, ADR-0131 D10, which attributes every such row before an upgraded
 * database boots).
 *
 * ## Why the catalog is materialized per organization
 *
 * `sys_position`, `sys_permission_set` and `sys_sharing_rule` all declare
 * `organization_id` with no tenancy opt-out, and both spell their name index
 * `{ fields: ['name'], unique: 'organization' }` — unique PER ORGANIZATION, not
 * globally. The seeders nevertheless upserted by bare `name` under a bare
 * `{ isSystem: true }` context, which stores `organization_id` NULL, so one row
 * stood for every tenant.
 *
 * Under a walled posture that row is invalid state. It was measured to be
 * unreadable by anyone: plugin-security's Layer 0 composes a STRICT
 * `organization_id = :tenant` and the middleware ANDs it over the driver's
 * `(organization_id = :tenant OR organization_id IS NULL)`, and the conjunction
 * of the two is the strict equality alone — so on a walled deployment every
 * principal, at every rung, listed ZERO positions, permission sets and sharing
 * rules while the tables held rows.
 *
 * The repair ruled for that measurement does not touch the wall at either
 * layer. It gives each organization its own row: upsert by
 * `(name, organization_id)`, one pass per organization, so the answer to "which
 * organization owns this row" is never NULL and never shared.
 *
 * ## The doctrine this file implements
 *
 * An organization-less row is INVALID STATE — never a platform-wide default.
 * The 18.0 ownership ceremony (ADR-0131 D10) attributes every one an earlier
 * release wrote before an upgraded database boots, and makes the column NOT
 * NULL; a fresh install that registers the organization object never writes
 * one (ADR-0131 D9: a system write with no organization of its own is stamped
 * with the derivable one, or refused). So
 * {@link resolveOwnOrganizationRow} answers one question — which row is this
 * organization's own — and a row of any other shape that a read happens to
 * return never answers for the organization.
 */

/**
 * How many organizations one boot-time seeding sweep enumerates.
 *
 * Bounded for the same reason #8617 bounds its own sweep: this runs on
 * `kernel:ready` and each organization costs a bounded number of reads. An
 * organization past the bound is not left unseeded — the organization-creation
 * hook covers every organization minted after this fix, and a redeploy re-runs
 * the sweep — but the bound IS reported rather than silently truncating.
 */
export const SEED_ORGANIZATION_SCAN_LIMIT = 500;

/**
 * The system context ONE seeding pass runs under.
 *
 * `organizationId` present ⇒ a tenant-scoped pass: reads route through
 * `SqlDriver.applyTenantScope` and writes are stamped with that organization.
 * `organizationId` absent is meaningful and correct in exactly one place — a
 * `single`-posture deployment, which has no organization for a row to belong
 * to — and is never a fallback for "we could not work out the organization".
 */
export function seedCtx(organizationId?: string): { isSystem: true; tenantId?: string } {
  return organizationId ? { isSystem: true, tenantId: organizationId } : { isSystem: true };
}

/** The organization a stored row belongs to, `null` for an organization-less one. */
export function rowOrganizationId(row: any): string | null {
  return (row?.organization_id ?? row?.organizationId) ?? null;
}

/**
 * Resolve THIS organization's own row for a name, out of what a tenant-scoped
 * read returned: the row stamped with `organizationId`, or `null`.
 *
 * Any other row the read returned — another organization's, from a driver with
 * no tenant scoping, or an organization-less one — is never the organization's
 * own and never answers for it. An organization-less row is invalid state
 * after the ownership ceremony (ADR-0131 D10), so it is not reported either:
 * there is no residue to report.
 *
 * Under a pass with no organization (`organizationId` undefined) there is
 * nothing to tell apart, and the first row is the row.
 */
export function resolveOwnOrganizationRow(rows: any[], organizationId?: string): { own: any | null } {
  const list = Array.isArray(rows) ? rows : [];
  if (!organizationId) return { own: list[0] ?? null };
  return { own: list.find((r) => rowOrganizationId(r) === organizationId) ?? null };
}
