// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D4] How this package's grant readers read which permission set a
 * `sys_user_permission_set` grant holds: BY NAME, from its `permission_set`
 * column — the grant's one reference since ADR-0131 C7b retired
 * `permission_set_id`.
 *
 * Every grant writer stores the name and nothing else (this package's
 * self-registration grant among them); `plugin-security` refuses a non-system
 * grant naming a set the security catalog does not hold. No boot names a
 * grant. Internal: not re-exported from the package entry.
 *
 * A grant whose name is `NULL` or blank names no set. That is a grant written
 * before the column existed, on a database upgraded from such a release, until
 * the v18 ceremony's verified rewrite (`os migrate organization-ownership
 * --apply`, ADR-0131 D10) names it from the retired id, or one the rewrite does
 * not name (it lists each, with the reason). Such a grant confers nothing
 * through a by-name reader here; each reader states what it does with one in
 * the direction that fails closed.
 */

/** The grant's NAME reference to its permission set (ADR-0131 D4). */
export const GRANT_SET_NAME_FIELD = 'permission_set';

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
