// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Organization scoping for the RBAC catalog's per-organization passes: the
 * system context one pass runs under and the one read that tells an
 * organization's own row apart from organization-less residue (the sweep and
 * the reap guard retired with their one caller, the seeder; #15204 stage 6b-2).
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
 * An organization-less row is INVALID STATE under a walled posture — refuse or
 * warn loudly, never treat it as a platform-wide default. The older reading, in
 * which a NULL organization marked a platform row visible to every tenant,
 * survives only as DRIVER-LEVEL COMPATIBILITY BEHAVIOUR: `applyTenantScope`
 * still emits the `OR organization_id IS NULL` arm, and this module depends on
 * that arm being there — it is precisely how a per-organization pass can still
 * SEE a pre-fix organization-less row and therefore say something about it.
 *
 * ## What replaces a reap
 *
 * #8617 reaped its pre-fix organization-less rows. This catalog does not, and
 * the difference is deliberate rather than an omission:
 *
 * - a fresh walled deployment never mints an organization-less catalog row
 *   FROM THESE FOUR SEEDERS once they run per organization, so there is nothing
 *   of theirs to migrate. It does NOT follow that a fresh walled deployment
 *   holds none, and this file used to claim it did (#11532).
 *   `bootstrapPlatformAdmin` is a FIFTH seeder, outside the four converted
 *   here, and it writes one organization-less `sys_permission_set` row per
 *   `defaultPermissionSets` entry on EVERY boot — before any organization
 *   exists (measured on a fresh walled rig: 8 rows, 1.3 s ahead of the first
 *   `sys_organization`). That is the RULED outcome rather than a leak: the
 *   2026-08-20 maintainer ruling on #10103 keeps that platform bucket
 *   "unreaped and loudly warned about under walled posture", and PLATFORM_ADMIN
 *   is derived from an unscoped grant pointing at its `admin_full_access` row
 *   BY ROW ID, so a reap would silently demote every platform admin. The guard
 *   below therefore has to tell the two classes apart;
 * - a `single`-posture deployment is where organization-less rows are the
 *   CORRECT shape, and the carve-out below leaves it byte-for-byte unchanged;
 * - the rows a reap would delete are grant TARGETS — `sys_user_position`,
 *   `sys_position_permission_set` and `sys_user_permission_set` all point at
 *   them by row id — so deleting them revokes standing access with no signal at
 *   the moment of loss. #8617's reap could promise "NO grant changes" precisely
 *   because it never touched a junction table; here the junctions ARE the
 *   grants.
 *
 * So the pass said so instead. Its guard (retired with the seeder) named the
 * rows and named the remedy, and — this is the load-bearing half — the pass
 * still CREATES the organization's own copy. The failure shape it exists to
 * prevent is the silent no-op: a tenant-threaded pass sees the pre-fix
 * organization-less row through the driver's compatibility arm, reads the name
 * as already represented, takes the update branch and creates nothing, leaving
 * the deployment exactly as broken as before while reporting success.
 * {@link resolveOwnOrganizationRow} is the one read that distinguishes "this
 * organization has its row" from "somebody's organization-less row is visible
 * here", and every seeder in this catalog routes through it.
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
 * read returned.
 *
 * A scoped read passes through `applyTenantScope`, whose compatibility arm
 * returns the caller's rows AND any organization-less ones. Those two are not
 * interchangeable and the seeders must never treat them as such:
 *
 * - a row stamped with `organizationId` is this organization's — update it;
 * - an organization-less row is a PRE-FIX residue that merely happens to be
 *   visible here. Reading it as "already seeded" is the silent no-op this
 *   catalog exists to prevent, so it is reported separately and never returned
 *   as the organization's own row.
 *
 * Under a `single`-posture pass (`organizationId` undefined) the
 * organization-less row IS the row, which is the carve-out, so it is returned
 * as `own` and nothing is flagged.
 */
export function resolveOwnOrganizationRow(
  rows: any[],
  organizationId?: string,
): { own: any | null; organizationLessResidue: any | null } {
  const list = Array.isArray(rows) ? rows : [];
  if (!organizationId) {
    return { own: list[0] ?? null, organizationLessResidue: null };
  }
  const own = list.find((r) => rowOrganizationId(r) === organizationId) ?? null;
  const residue = list.find((r) => rowOrganizationId(r) === null) ?? null;
  return { own, organizationLessResidue: residue };
}
