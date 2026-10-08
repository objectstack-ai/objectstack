// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D4] How this package's grant readers read which permission set a
 * `sys_user_permission_set` grant holds: BY NAME, from its `permission_set`
 * column — the reference the grant keeps once ADR-0131 C8 drops
 * `permission_set_id`.
 *
 * `plugin-security` writes the column (its engine hooks derive it from the id
 * on every grant write, and a one-time backfill names the grants written before
 * the column existed); this package only reads it. Internal: not re-exported
 * from the package entry.
 *
 * A grant whose name is `NULL` or blank names no set. That is a grant written
 * before the column existed on an upgraded deployment's first boot, before the
 * backfill (`kernel:bootstrapped`) names it, or one the backfill could not name
 * (an id with no set row, or a set row of another organization). Such a grant
 * confers nothing through a by-name reader here; each reader states what it
 * does with one in the direction that fails closed.
 */

/** The grant's NAME reference to its permission set (ADR-0131 D4). */
export const GRANT_SET_NAME_FIELD = 'permission_set';

/** The grant's id reference to the catalog row (dropped by ADR-0131 C8). */
export const GRANT_SET_ID_FIELD = 'permission_set_id';

/**
 * The permission set a stored grant names, or `undefined` for a grant that
 * names none (`NULL` or blank).
 */
export function grantSetNameOf(row: unknown): string | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const value = (row as Record<string, unknown>)[GRANT_SET_NAME_FIELD];
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  return name === '' ? undefined : name;
}
