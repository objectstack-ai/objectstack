// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21571] The columns a read may serve: the object's DECLARED fields plus the
 * platform-provisioned columns — one set, answered from the registry's field
 * map, and the same set an explicit projection is judged against.
 *
 * ## The defect this closes
 *
 * A read that names no `fields` reached the driver with no projection, and
 * every driver answers that with the whole row (`SELECT *` on SQL). A column
 * that no metadata declares — a field retired in an upgrade, whose column
 * additive schema sync leaves in the table until an operator runs a
 * destructive apply — therefore rode back in every record body, on every door
 * that reads through the engine (`POST /data/:object/query`, the list route,
 * `GET /data/:object/:id`, export, search, the RPC dispatcher, a hook's or a
 * flow's in-process read). Naming the same column in `fields` answered
 * `400 INVALID_FIELD`: the platform knew it was not a field and served it
 * anyway, outside any field-level rule, because there is no field to attach a
 * rule to.
 *
 * ## Where it is decided, and why there
 *
 * Triage's ruling on #21571: the default projection of an unprojected read is
 * decided ONCE, in the engine, so every driver and every door gets the same
 * answer — not per driver, not per door. The declared field set is that
 * projection; no allow-list of column names and no flag re-opens undeclared
 * columns on a runtime door.
 *
 * The engine SHAPES THE ROWS the driver hands back, rather than pushing a
 * projection down to the driver. Measured on driver-sql: its recovery ladder
 * retries `select('*')` whenever a projected statement fails on an
 * unresolvable column, so a pushed-down projection naming a declared field
 * whose column does not exist yet (not migrated, or the read races a schema
 * sync) would be answered by the whole row — orphaned columns included. An
 * EXPLICIT projection reaches that rung today too. Shaping the returned rows
 * holds whichever rung answered, and needs no driver edit.
 *
 * It runs on the rows as they arrive from the driver — before formula
 * evaluation, `expand`, file-reference resolution and the `afterFind` hooks —
 * so everything downstream of storage sees the declared record, the same scope
 * `materializeDeclaredFields` gives every CEL surface. Keys added AFTER that
 * (a formula's value, an expanded record, a hook's derived key) are the
 * engine's or the hook's, not storage's, and are untouched. Declared fields
 * keep their existing treatment: `internal: true` omission, credential
 * masking and the `__search` companion strip all still run after the hooks.
 *
 * ## Where it deliberately has no opinion
 *
 * The rule the read and write doors already share: a door that cannot see the
 * field map must not invent a verdict about it. A schema with no field map, an
 * ARRAY field map (not checkable — `Object.keys` yields indices), or an EMPTY
 * one (indistinguishable from an unpopulated map: a registered object always
 * carries at least the injected system columns) leaves the rows exactly as the
 * driver returned them.
 *
 * ## In-process readers of undeclared columns — measured before this landed
 *
 * The objectql, rest, runtime, plugin-auth, plugin-sharing, plugin-audit and
 * service-automation suites ran with every undeclared key removed at this
 * seam; no production reader needed one (the fallout was test fixtures). The
 * operator reads that legitimately need a retired column's values go through
 * the driver, never through this path: `os migrate plan`'s `unmapped_column`
 * detection introspects the table, and `os migrate account-issuer` reads
 * `sys_account` through the driver the engine routes it to.
 */

/**
 * The columns the platform provisions on every physical table without an
 * author declaring them. `id` is the driver's primary key; the two audit
 * timestamps are engine/driver-stamped. The registry injects the rest of the
 * system columns (tenant, owner, the audit actors) INTO the field map, so they
 * need no entry here.
 *
 * ONE list: the read verbs' explicit-projection filter, this module's row
 * shaping and the write path's undeclared-key door all read it, so a key a read
 * accepts is never refused by a write and never trimmed from a row.
 */
export const PLATFORM_PROVISIONED_COLUMNS = ['id', 'created_at', 'updated_at'] as const;

/**
 * The declared column set of an object — its field-map keys plus
 * {@link PLATFORM_PROVISIONED_COLUMNS} — or `undefined` when there is no
 * checkable field map (absent, an array, or empty). `undefined` means "no
 * opinion", never "nothing is declared".
 */
export function declaredColumnSet(
  schema: { fields?: unknown } | null | undefined,
): ReadonlySet<string> | undefined {
  const fields = schema?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return undefined;
  const names = Object.keys(fields as Record<string, unknown>);
  if (names.length === 0) return undefined;
  const declared = new Set(names);
  for (const provisioned of PLATFORM_PROVISIONED_COLUMNS) declared.add(provisioned);
  return declared;
}

/**
 * The row with every key outside `declared` removed — a NEW object when there
 * was anything to remove, the same reference otherwise. Never mutates the row
 * it is given: a driver that hands back a live reference into its own store
 * (a contract violation, but one a test double commits) must not lose data
 * because a read happened.
 */
export function withDeclaredColumnsOnly<T>(row: T, declared: ReadonlySet<string> | undefined): T {
  if (!declared || !row || typeof row !== 'object' || Array.isArray(row)) return row;
  const source = row as unknown as Record<string, unknown>;
  let undeclared = false;
  for (const key of Object.keys(source)) {
    if (!declared.has(key)) { undeclared = true; break; }
  }
  if (!undeclared) return row;
  const shaped: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (declared.has(key)) shaped[key] = source[key];
  }
  return shaped as unknown as T;
}

/** {@link withDeclaredColumnsOnly} over a driver's result page. */
export function rowsWithDeclaredColumnsOnly<T>(rows: T[], declared: ReadonlySet<string> | undefined): T[] {
  if (!declared) return rows;
  let changed = false;
  const shaped = rows.map((row) => {
    const next = withDeclaredColumnsOnly(row, declared);
    if (next !== row) changed = true;
    return next;
  });
  return changed ? shaped : rows;
}
