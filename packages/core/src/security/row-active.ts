// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `active` flag on the RBAC grant catalogues — `sys_permission_set` and
 * `sys_position` (ADR-0049 enforce-or-remove).
 *
 * Both objects ship a Deactivate action whose confirmation dialog promises, in
 * four locales, that access stops:
 *
 * > Deactivate this permission set? Existing assignments stay in place but stop
 * > granting access until re-activated.
 * > Deactivate this position? Users keep their assignment but the position stops
 * > granting permissions until re-activated.
 *
 * ⚠️ The catalogue row's `active` column DECIDES NO GRANT any more (ADR-0131
 * D3, ADR-0126 §4). `resolveUserAuthzGrants` reads deactivation for both types
 * from the deployment-level activation ledger, `sys_metadata_activation`
 * (`metadata_type` `position` / `permission`), written through
 * `POST /api/v1/security/_activation/:type/:name`; it never calls this
 * predicate. The Deactivate dialog's promise is kept by that ledger row, not by
 * this column.
 *
 * What still reads the column through this predicate, on `main`: the
 * last-administrator guard's enumeration (`plugin-auth` `last-admin-guard.ts`),
 * the explain engine's "deactivated" label (`plugin-security`
 * `explain-engine.ts`), the security plugin's set loader (`plugin-security`
 * `security-plugin.ts`) and the sharing-rule position check (`plugin-sharing`
 * `sharing-rule-service.ts`). The reasoning below is about reading the column
 * at all, and holds for each of them.
 *
 * ## Why the predicate is "explicitly deactivated", not "explicitly active"
 *
 * Absent means ACTIVE. Only a stored value that really reads false takes the
 * grant away. Two measured reasons, and they point the same way:
 *
 *  1. **Deployed data.** `active` carries `defaultValue: true`, but a row that
 *     predates the column, arrived through a migration, or was projected with a
 *     `fields` list that omitted it carries no value at all. Requiring `true`
 *     would revoke every such row's grants the moment this lands — a silent
 *     mass revocation nobody asked for, which is the opposite of the one thing
 *     the Deactivate dialog promises. `isGrantActive` reads absent bounds as
 *     unbounded for exactly this reason (ADR-0091 D2).
 *  2. **Storage shapes.** SQLite stores booleans as 1/0 and presents them back
 *     as numbers unless the driver knows the column is boolean; the memory
 *     driver round-trips real booleans; a JSON/text column can hand back
 *     `'false'`. `row.active === false` alone therefore misses the deactivated
 *     row on the primary driver — an enforcement hole shaped exactly like the
 *     bug this predicate closes. Pushing `active: true` into a driver `where`
 *     has the same problem from the other side AND drops the NULL rows of (1),
 *     so the filter runs in memory over rows the resolver already fetched:
 *     zero new queries, identical answer on every driver.
 *
 * The false-set below is closed on purpose. An unrecognised value (a stray
 * string, an object) is NOT a deactivation — nothing writes one, and inventing
 * a revocation out of junk data is the failing-open-into-a-lockout direction.
 */

/** The stored spellings of a deactivated row, across every driver in the tree. */
const DEACTIVATED_VALUES: readonly unknown[] = [false, 0, '0', 'false'];

/** A catalogue row that may carry the `active` flag (`sys_permission_set`, `sys_position`). */
export interface ActivatableRow {
  active?: unknown;
}

/**
 * True unless the row carries an `active` column that is explicitly OFF.
 *
 * The ONE predicate every reader of `sys_permission_set.active` /
 * `sys_position.active` uses (the readers are listed in the module doc), so
 * they can never disagree about what a deactivated ROW means. It is not the
 * grant switch: the resolver reads the activation ledger instead.
 */
export function isRowActive(row: ActivatableRow | null | undefined): boolean {
  if (!row) return false;
  const value = (row as { active?: unknown }).active;
  if (value === undefined || value === null) return true;
  return !DEACTIVATED_VALUES.includes(value);
}
