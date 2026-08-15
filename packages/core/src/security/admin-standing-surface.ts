// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADMIN_STANDING_SURFACE — what `resolveAuthzContext` READS when it decides
 * who is an administrator, declared beside the resolver that reads it.
 *
 * ## Why this file exists (#8734)
 *
 * `plugin-auth`'s break-glass guard (`last-admin-guard.ts`, ADR-0024 D5.2)
 * decides whether a pending write can empty the administrator population by
 * testing the payload against three standing-key lists — `MEMBER_STANDING_KEYS`,
 * `GRANT_STANDING_KEYS`, `PERMISSION_SET_STANDING_KEYS`. Those lists are not an
 * independent design artifact: they are a CACHE of the columns this resolver
 * consumes. A payload touching none of them is skipped without any reads, so a
 * column this resolver starts reading and the guard's list omits is a write
 * class the guard silently stops judging — the one write class that can lock an
 * installation out of its own administration, with no in-product recovery.
 *
 * Nothing bound the two together. The correspondence was carried by a comment,
 * and it had already gone false once: #6084 wrote, beside the list, that
 * everything a permission-set write touches other than `name` — naming `active`
 * explicitly — is invisible to "who is an administrator". That was true when
 * written. #8613 made `active` a resolution-time predicate (a DEACTIVATED
 * `admin_full_access` set confers nothing, §6b below), and the sentence became
 * false. It was caught by one agent reading the comment closely enough to
 * notice it contradicted the code being written. Nothing mechanical would have
 * caught it: the guard's own tests stay green, because the guard is simply never
 * consulted for that write.
 *
 * ## What this file is, and what it is NOT
 *
 * It is a MEASUREMENT, not a wish. Its column lists are asserted equal to what
 * the resolver actually reads at runtime, by
 * `admin-standing-surface.test.ts`, which drives the real
 * `resolveAuthzContext` over a recording engine and collects every property
 * access and every `where` key per table. That is deliberate: a hand-written
 * list of "columns the derivation reads" is the same artifact as the comment
 * that went stale, one indirection along. Observation is also the only reading
 * that survives the derivation moving INTO a helper — `active` is read by
 * `isRowActive(ps)` and the window bounds by `isGrantActive(row, now)`, neither
 * of which names a column at the resolver's own call site.
 *
 * It is NOT a projection the resolver consumes. `ql.find` here returns whole
 * rows and the reads are ordinary property accesses on untyped rows, so nothing
 * in this file can FORCE the resolver to read only what it declares. The force
 * comes from the observation test: add a read, and this declaration is red
 * until it is updated; update this declaration, and `plugin-auth`'s
 * correspondence test is red until every new column is either in a standing-key
 * list or explicitly excluded with a reason.
 *
 * ## Reading the entries
 *
 * Every table this resolution path reads is listed — including the ones that
 * CANNOT confer administrator standing, each with the reason it cannot. That is
 * the table-level half of the same guarantee: a resolver that starts deriving
 * administrator standing from a new table would otherwise be invisible to a
 * column-set comparison, because the new table appears in neither side's list.
 */

/** How a table this resolver reads relates to "who is an administrator". */
export interface AdminStandingTable {
  /**
   * `derives` — a write to this table can change the administrator population,
   * so `last-admin-guard.ts` must carry a standing-key list for it.
   * `reads-only` — this resolver reads the table for something else entirely.
   */
  readonly role: 'derives' | 'reads-only';
  /** Why the row above is the right classification. Prose, but pinned to a measured table. */
  readonly reason: string;
  /**
   * Every column this resolver reads on the table — property accesses and
   * `where` keys alike, in every spelling it actually touches. Declared for
   * `derives` tables only; asserted equal to the observed set.
   */
  readonly columns?: readonly string[];
}

/**
 * The measured read surface of the administrator derivation.
 *
 * Scope, stated so the gate cannot be read as claiming more than it measures:
 * this is the SESSION/user-id resolution path — `resolveAuthzContext` with a
 * principal, and therefore all of `resolveUserAuthzGrants`. The API-key
 * ADMISSION path (`resolveApiKeyAdmission`) is outside it on purpose: it
 * authenticates a principal and seeds `permissions` with the key's scopes, and
 * confers no administrator standing of its own — `hasPlatformAdminGrant` (§6b)
 * is set only from a `sys_permission_set` row reached through an UNSCOPED
 * `sys_user_permission_set` grant, never from a scope string.
 */
export const ADMIN_STANDING_SURFACE: Readonly<Record<string, AdminStandingTable>> = {
  sys_permission_set: {
    role: 'derives',
    reason:
      'The row `platform_admin` is resolved BY NAME from (§6b). Renaming it, deleting it or '
      + 'switching it off (ADR-0049 `active`, read here since #8613) un-makes every platform '
      + 'admin at once, with no identity table touched.',
    columns: [
      'id',
      'name',
      'active',
      'system_permissions',
      'systemPermissions',
      'tab_permissions',
      'tabPermissions',
    ],
  },

  sys_user_permission_set: {
    role: 'derives',
    reason:
      'The grant that makes a user a platform admin: an UNSCOPED, in-window (ADR-0091) grant of '
      + '`admin_full_access` (§6). Re-pointing it, scoping it to an organization or moving it out '
      + 'of its window revokes the standing while leaving the row in place.',
    columns: [
      'user_id',
      'permission_set_id',
      'permissionSetId',
      'organization_id',
      'organizationId',
      'valid_from',
      'validFrom',
      'valid_until',
      'validUntil',
    ],
  },

  sys_member: {
    role: 'derives',
    reason:
      'Organization owner/admin standing (§3). The graded `role` is projected into `positions` '
      + 'here and separately drives the `organization_admin` capability grant, which is what the '
      + 'posture ladder reads; the break-glass guard counts the same rows one step earlier, by '
      + 'grade (ADR-0108). Either way a downgrade of the last graded membership is a write that '
      + 'can empty the administrator population.',
    columns: [
      'user_id',
      'userId',
      'organization_id',
      'organizationId',
      'role',
      'valid_from',
      'validFrom',
      'valid_until',
      'validUntil',
    ],
  },

  sys_user: {
    role: 'reads-only',
    reason:
      'Read for the `current_user.email` RLS fallback and the ADR-0024 `ai_seat` synthesis (§7). '
      + 'Neither confers administrator standing. The guard does watch this table, but for the '
      + 'ban/delete WRITE SHAPES — `banned` is never read here, so it is not a derivation column '
      + 'and carries no standing-key list.',
  },

  sys_user_position: {
    role: 'reads-only',
    reason:
      'ADR-0057 D4 platform-RBAC position assignments (§4). A position can carry permission sets '
      + '(see `sys_position_permission_set`) but never platform-admin standing — §6b requires the '
      + 'set to be reached through an unscoped USER grant (`unscopedUserPsIds`), so a '
      + 'position-bound `admin_full_access` resolves the set name into `permissions` and leaves '
      + '`hasPlatformAdminGrant` false.',
  },

  sys_position: {
    role: 'reads-only',
    reason:
      'Read to drop DEACTIVATED positions (ADR-0049, §6a). Same reason as `sys_user_position`: '
      + 'the position path cannot reach `hasPlatformAdminGrant`.',
  },

  sys_position_permission_set: {
    role: 'reads-only',
    reason:
      'Position-bound permission sets (§6a). Contributes ids to `psIds` — and therefore names to '
      + '`permissions` — but not to `unscopedUserPsIds`, which is the set §6b tests for '
      + 'platform-admin standing.',
  },
};

/** The tables a write to which can change who is an administrator. */
export function adminStandingTables(): string[] {
  return Object.entries(ADMIN_STANDING_SURFACE)
    .filter(([, t]) => t.role === 'derives')
    .map(([name]) => name)
    .sort();
}

/**
 * The columns this resolver reads on `table`, or `undefined` when the table is
 * not part of the administrator derivation.
 */
export function adminStandingColumns(table: string): readonly string[] | undefined {
  const entry = ADMIN_STANDING_SURFACE[table];
  return entry?.role === 'derives' ? entry.columns : undefined;
}
