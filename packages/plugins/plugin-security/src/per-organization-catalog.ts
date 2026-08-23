// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Per-organization materialization of the RBAC catalog — the shared vocabulary
 * the four declared/built-in seeders compile against.
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
 * - a fresh walled deployment never mints an organization-less catalog row once
 *   these seeders run per organization, so there is nothing to migrate;
 * - a `single`-posture deployment is where organization-less rows are the
 *   CORRECT shape, and the carve-out below leaves it byte-for-byte unchanged;
 * - the rows a reap would delete are grant TARGETS — `sys_user_position`,
 *   `sys_position_permission_set` and `sys_user_permission_set` all point at
 *   them by row id — so deleting them revokes standing access with no signal at
 *   the moment of loss. #8617's reap could promise "NO grant changes" precisely
 *   because it never touched a junction table; here the junctions ARE the
 *   grants.
 *
 * So the pass says so instead. {@link warnPreFixOrganizationLessRows} names the
 * rows and names the remedy, and — this is the load-bearing half — the pass
 * still CREATES the organization's own copy. The failure shape it exists to
 * prevent is the silent no-op: a tenant-threaded pass sees the pre-fix
 * organization-less row through the driver's compatibility arm, reads the name
 * as already represented, takes the update branch and creates nothing, leaving
 * the deployment exactly as broken as before while reporting success.
 * {@link resolveOwnOrganizationRow} is the one read that distinguishes "this
 * organization has its row" from "somebody's organization-less row is visible
 * here", and every seeder in this catalog routes through it.
 */

import { postureEnforcesWall, type TenancyPosture } from '@objectstack/spec/security';

export type SeedLogger = {
  info?: (m: string, meta?: Record<string, any>) => void;
  warn?: (m: string, meta?: Record<string, any>) => void;
};

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

const ORGANIZATION_OBJECT = 'sys_organization';

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

/** Does this posture want per-organization catalog rows? */
export function catalogIsPerOrganization(posture: TenancyPosture): boolean {
  return postureEnforcesWall(posture);
}

/**
 * Enumerate the organizations whose catalog needs seeding.
 *
 * Returns `null` — not `[]` — when the read FAILS, because the two mean
 * opposite things: zero organizations is "nothing to seed", an unreadable
 * `sys_organization` is "we do not know". Conflating them turns an outage into
 * a silent empty sweep, so a failure is warned and the caller must not proceed
 * as though the installation had no tenants.
 */
export async function listSeedOrganizationIds(
  ql: any,
  logger?: SeedLogger,
): Promise<string[] | null> {
  let rows: any;
  try {
    rows = await ql.find(ORGANIZATION_OBJECT, {
      fields: ['id'],
      limit: SEED_ORGANIZATION_SCAN_LIMIT,
      context: seedCtx(),
    });
  } catch (e) {
    logger?.warn?.(
      '[security] could not enumerate organizations — the RBAC catalog was NOT seeded per ' +
        'organization at this call; seeding retries on the next boot and on organization creation',
      { object: ORGANIZATION_OBJECT, error: (e as Error)?.message },
    );
    return null;
  }
  const ids = (Array.isArray(rows) ? rows : [])
    .map((r: any) => r?.id)
    .filter((id: unknown): id is string => typeof id === 'string' && id !== '');
  if (ids.length >= SEED_ORGANIZATION_SCAN_LIMIT) {
    logger?.warn?.(
      '[security] organization scan hit its bound — organizations past it are seeded when they are ' +
        'created and on the next boot sweep',
      { scanned: ids.length, limit: SEED_ORGANIZATION_SCAN_LIMIT },
    );
  }
  return ids;
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

/**
 * The loud guard that stands in place of a reap.
 *
 * Called once per pass with everything the pass found, so an operator gets ONE
 * actionable line naming the affected rows rather than a warning per name. The
 * remedy is named because "invalid state" with no next step is not a diagnosis:
 * either re-initialize the deployment (correct while it is pre-launch, which is
 * the premise this whole repair was ruled on), or adopt each row by hand by
 * stamping it with the organization that should own it.
 *
 * The pass that emits this has ALREADY created the organization's own copies —
 * the warning describes leftovers, never a refusal to seed.
 */
export function warnPreFixOrganizationLessRows(
  logger: SeedLogger | undefined,
  object: string,
  names: string[],
  organizationId: string,
): void {
  if (names.length === 0) return;
  logger?.warn?.(
    `[security] pre-fix organization-less ${object} rows are still present for names this ` +
      `organization seeds — under a walled posture a row that belongs to no organization is ` +
      `invalid state, not a platform-wide default. This organization's own rows WERE created, so ` +
      `its catalog is complete; the leftovers below are readable through the driver's ` +
      `compatibility arm and belong to nobody. Remedy: re-initialize the deployment, or adopt each ` +
      `row by hand by stamping it with the organization that should own it. They are NOT deleted ` +
      `automatically — grants (sys_user_position, sys_position_permission_set, ` +
      `sys_user_permission_set) point at these row ids, so reaping them would revoke standing ` +
      `access with no signal at the moment of loss.`,
    { object, organization: organizationId, names: [...names].sort(), count: names.length },
  );
}

/**
 * Does a stored row already carry every field a pass would write?
 *
 * The boot sweep is O(CHANGED DECLARATIONS), not O(organizations x rows) of
 * blind writes: a pass reads what the organization already has (one bounded
 * read), compares it against the declaration, and issues an update only where
 * something actually differs. On the overwhelmingly common boot — nothing
 * declared changed since the last one — every organization costs its reads and
 * ZERO writes. Steady state does not ride this sweep at all; it rides the
 * organization-creation hook, which seeds exactly the one new organization.
 *
 * Compared loosely on purpose: a column absent from a legacy row and a
 * declaration that names it as `null`/`undefined` are the same state, and
 * treating them as different would make every boot re-write every row, which is
 * the cost this predicate exists to avoid.
 */
export function rowMatchesDeclaration(row: any, fields: Record<string, unknown>): boolean {
  if (!row) return false;
  for (const [key, want] of Object.entries(fields)) {
    const has = row[key];
    if ((has ?? null) === (want ?? null)) continue;
    if (typeof want === 'boolean' && Boolean(has) === want) continue;
    return false;
  }
  return true;
}
