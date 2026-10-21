// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24948] Organization delete: refused while the organization still owns
 * records, and otherwise one unit of work that removes the organization's own
 * auth structure with it.
 *
 * ## What better-auth does, and what it leaves
 *
 * `POST /organization/delete` (better-auth 1.7.12, re-read 2026-10-21 for #25096,
 * `plugins/organization/routes/crud-org.mjs`) authorizes the caller, clears the
 * caller's active organization, calls `organizationHooks.beforeDeleteOrganization`,
 * and then `adapter.deleteOrganization`, which deletes `member`, then
 * `invitation`, then the organization row. It deletes no team, no team member
 * and nothing it does not own. The engine's referential cascade then ran on
 * the organization row and applied the tenant column's `set_null` default to
 * every row the organization still owned: a 500 halfway through on a store
 * whose tenant column is NOT NULL (members and invitations already gone, the
 * organization left with no owner), or a 200 that orphaned the rows to NULL on
 * a store born nullable. Every organization created through the door owns a
 * default team, so on a NOT NULL store even an empty one could not be deleted.
 *
 * ## The contract (maintainer ruling on #24948, letter B)
 *
 * 1. **Refused while the organization owns records.** {@link
 *    organizationDeleteRefusal} counts, per table, the rows that name the
 *    organization in their tenant column, leaving out the organization's own
 *    auth structure and every object declared `managedBy: 'append-only'`
 *    (ledgers: `sys_activity`, `sys_email` and their siblings) or
 *    `managedBy: 'engine-owned'` (rows the platform writes: approval state,
 *    runs, deliveries, shares), whose rows are kept and go on naming the
 *    deleted organization (seat decisions 6305179819 and 6307135388; the
 *    engine reads the same set). Any count above zero refuses with 409
 *    `DELETE_RESTRICTED` and `dependents: [{ object, count }]`: counts, never a
 *    row value. It runs in `hooks.before`, ahead of the vendor's handler, and
 *    only for a caller the vendor itself would admit (a member holding the
 *    `organization: ['delete']` permission), so a refused delete writes
 *    nothing at all — not even the caller's active organization — and a caller
 *    the vendor would refuse learns no count.
 * 2. **The organization's own auth structure goes with it.** That is
 *    {@link ORGANIZATION_AUTH_STRUCTURE}: members and invitations (better-auth
 *    deletes them), and teams, team members and the organization-admin grants
 *    its owners and admins hold ({@link removeOrganizationAuthStructure}, from
 *    `beforeDeleteOrganization`). Any other grant the organization holds is
 *    counted as a record.
 * 3. **One unit of work.** `AuthManager.handleRequest` runs the whole request
 *    inside one engine transaction and rolls it back on any 4xx/5xx answer, the
 *    subject-erasure wrapper's posture. On a driver without transactions the
 *    refusals are the guarantee, since every one runs before the first write:
 *    the count above, and the Default Organization's guard question and count
 *    below.
 * 4. **The engine never clears the tenant column.** Under all of this,
 *    `ObjectQL.cascadeDeleteRelations` refuses a `sys_organization` delete
 *    while any row still names it, whatever path reaches it.
 *
 * The Default Organization ({@link isDefaultOrganizationTarget}) is asked two
 * questions instead, both from the same `hooks.before`, so both land before
 * better-auth deletes any member: first the last-administrator guard's
 * (`LastAdminGuardHandle`, a 403), then, once the guard admits, its own record
 * count ({@link defaultOrganizationDeleteRefusal}, the same 409). Its auth
 * structure beyond members and invitations is not removed, so its teams and
 * grants count.
 */

import { ORGANIZATION_ADMIN, ORGANIZATION_ADMIN_NO_BYPASS } from '@objectstack/spec';
import type { StandardErrorCode } from '@objectstack/spec/api';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { GRANT_SET_NAME_FIELD } from './grant-set-name.js';

/** The better-auth endpoint this module guards. */
export const ORGANIZATION_DELETE_PATH = '/organization/delete';

/**
 * The refusal's wire code: the standard catalog's member for "a delete refused
 * while dependents exist" (ADR-0112). Not a registered synonym of it: the
 * ledger refuses one that merely re-spells a standard member.
 */
export const ORGANIZATION_DELETE_REFUSAL_CODE: StandardErrorCode = 'DELETE_RESTRICTED';

/** The grant table; partly the organization's own structure (see {@link ORGANIZATION_AUTH_STRUCTURE}). */
const GRANT_OBJECT = 'sys_user_permission_set';

/**
 * The objects an organization delete removes as the organization's OWN auth
 * structure, and which therefore are not records it "still owns". Each is
 * removed by the delete itself:
 *
 * - `sys_member`, `sys_invitation`: better-auth's `adapter.deleteOrganization`;
 * - `sys_team`, `sys_team_member`, and in `sys_user_permission_set` ONLY the
 *   grants of the organization-admin sets ({@link ORGANIZATION_ADMIN_SET_NAMES}),
 *   the ones a membership grade confers: {@link removeOrganizationAuthStructure}.
 *   Every other grant scoped to the organization is counted.
 */
export const ORGANIZATION_AUTH_STRUCTURE: readonly string[] = [
  'sys_member',
  'sys_invitation',
  'sys_team',
  'sys_team_member',
  GRANT_OBJECT,
];

/** The permission sets a membership grade grants, by name (ADR-0131 D4). */
export const ORGANIZATION_ADMIN_SET_NAMES: readonly string[] = [ORGANIZATION_ADMIN, ORGANIZATION_ADMIN_NO_BYPASS];

/** One table the organization still owns rows in, and how many. */
export interface OrganizationOwnedRows {
  object: string;
  count: number;
}

/** The engine reads this module needs; `organizationOwnedRowCounts` is ObjectQL's. */
type CountingEngine = IDataEngine & {
  organizationOwnedRowCounts?: (
    organizationId: string,
    options?: { exclude?: Iterable<string> },
  ) => Promise<OrganizationOwnedRows[]>;
};

const SYSTEM_CTX = { isSystem: true } as const;

function rowsOf(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  const records = (result as { records?: unknown } | null | undefined)?.records;
  return Array.isArray(records) ? records : [];
}

/**
 * The tables in which `organizationId` still owns records, each with its row
 * count; empty when the organization holds nothing but its own auth
 * structure. `undefined` when the engine cannot answer the question (an engine
 * that is not ObjectQL): the caller then leaves the decision to the engine's
 * own cascade, which refuses on its own.
 */
export async function organizationDeleteRefusal(
  engine: IDataEngine,
  organizationId: string,
): Promise<OrganizationOwnedRows[] | undefined> {
  const counting = engine as CountingEngine;
  if (typeof counting.organizationOwnedRowCounts !== 'function') return undefined;
  const owned = await counting.organizationOwnedRowCounts(organizationId, { exclude: ORGANIZATION_AUTH_STRUCTURE });

  // The grants: every grant scoped to the organization, less those of the
  // organization-admin sets. Two counts rather than one `$nin`, so a grant
  // whose set name is NULL (written before the column existed) is counted
  // too: a NULL never matches `NOT IN`.
  const tenantGrants = await engine.count(GRANT_OBJECT, {
    where: { organization_id: organizationId },
    context: SYSTEM_CTX,
  });
  if (tenantGrants > 0) {
    const adminGrants = await engine.count(GRANT_OBJECT, {
      where: { organization_id: organizationId, [GRANT_SET_NAME_FIELD]: { $in: [...ORGANIZATION_ADMIN_SET_NAMES] } },
      context: SYSTEM_CTX,
    });
    const others = tenantGrants - adminGrants;
    if (others > 0) owned.push({ object: GRANT_OBJECT, count: others });
  }
  return owned;
}

/**
 * The tables better-auth itself removes when it deletes an organization: its
 * members and its invitations. For the Default Organization they are all
 * that is removed (plugin-auth removes none of its structure), so every other
 * row that names it counts, its teams and grants included.
 */
export const VENDOR_REMOVED_ON_DELETE: readonly string[] = ['sys_member', 'sys_invitation'];

/**
 * The Default Organization's record count, asked after the last-administrator
 * guard admits its delete and before better-auth's first write: every table
 * holding rows that name it, but for its members and invitations
 * ({@link VENDOR_REMOVED_ON_DELETE}). Its teams and grants are not removed, so
 * they count: without this, an admitted delete would remove the members and
 * invitations and only then meet the engine's refusal, a partial delete on a
 * driver without transactions. `undefined` when the engine cannot answer.
 */
export async function defaultOrganizationDeleteRefusal(
  engine: IDataEngine,
  organizationId: string,
): Promise<OrganizationOwnedRows[] | undefined> {
  const counting = engine as CountingEngine;
  if (typeof counting.organizationOwnedRowCounts !== 'function') return undefined;
  return counting.organizationOwnedRowCounts(organizationId, { exclude: VENDOR_REMOVED_ON_DELETE });
}

/**
 * The 409 body for a refused delete, beside its code
 * ({@link ORGANIZATION_DELETE_REFUSAL_CODE}, spelled at the throw site): every
 * table with its count, and the remedy.
 */
export function organizationNotEmptyBody(owned: readonly OrganizationOwnedRows[]): {
  message: string;
  dependents: OrganizationOwnedRows[];
} {
  const named = owned.map((o) => `${o.object} (${o.count})`).join(', ');
  return {
    message:
      `This organization still owns records in ${named}. ` +
      'Delete or move those records first, then delete the organization.',
    dependents: owned.map((o) => ({ object: o.object, count: o.count })),
  };
}

/**
 * Is `organization` the Default Organization: on a posture with no
 * organization wall, the one with `slug = 'default'`, else the deployment's
 * only organization? The last-administrator guard's own reading of the anchor
 * (`last-admin-guard.ts`, `defaultOrganizationId`): under a walled posture no
 * organization anchors platform standing, so none is the Default one here
 * either. Its delete is that guard's to answer first, and then
 * {@link defaultOrganizationDeleteRefusal}'s rather than
 * {@link organizationDeleteRefusal}'s. `walled` is the guard's own expression,
 * `postureEnforcesWall(resolveTenancyPosture())`.
 */
export async function isDefaultOrganizationTarget(
  engine: IDataEngine,
  organization: { id?: unknown; slug?: unknown } | undefined,
  walled: boolean,
): Promise<boolean> {
  if (!organization || walled) return false;
  if (organization.slug === 'default') return true;
  const total = await engine.count('sys_organization', { context: SYSTEM_CTX });
  return total <= 1;
}

/**
 * Delete the part of the organization's auth structure better-auth leaves
 * behind: its teams with their members, and the organization-admin grants its
 * owners and admins hold. Called from `beforeDeleteOrganization`, inside the
 * request's transaction, so a later failure rolls it back.
 *
 * Team members first, by their team: `sys_team_member` reaches the
 * organization only through `team_id`, and a multi-row delete runs no cascade.
 * Then each team by id, so the engine's cascade clears what still points at it
 * (a session's active team). The grants go explicitly, here, rather than
 * waiting on plugin-security's member-delete reconcile: measured on a booted
 * showcase, they were still present when the organization row was deleted.
 */
export async function removeOrganizationAuthStructure(engine: IDataEngine, organizationId: string): Promise<void> {
  const teams = rowsOf(
    await engine.find('sys_team', { where: { organization_id: organizationId }, fields: ['id'], context: SYSTEM_CTX }),
  );
  const teamIds = teams.map((t) => t?.id).filter((id): id is string | number => id != null);
  if (teamIds.length > 0) {
    await engine.delete('sys_team_member', {
      where: { team_id: { $in: teamIds } },
      multi: true,
      context: SYSTEM_CTX,
    });
    for (const id of teamIds) {
      await engine.delete('sys_team', { where: { id }, context: SYSTEM_CTX });
    }
  }
  await engine.delete(GRANT_OBJECT, {
    where: { organization_id: organizationId, [GRANT_SET_NAME_FIELD]: { $in: [...ORGANIZATION_ADMIN_SET_NAMES] } },
    multi: true,
    context: SYSTEM_CTX,
  });
}
