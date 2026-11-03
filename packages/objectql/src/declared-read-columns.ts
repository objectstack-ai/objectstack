// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { unprovisionedInjectedColumns } from '@objectstack/spec/data';
import { isFederatedObject } from './federated-object.js';

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

/**
 * [#29408] The STORED declared columns a read selected — the set a row is
 * answered on, key for key, whatever the driver happened to return for it.
 *
 * ## The defect this closes
 *
 * A driver that stores only the columns a write touched (driver-mongodb drops
 * a field given no value at its insert doors; driver-memory keeps stored
 * `null` and a never-written key apart) answered such a field with NO key,
 * while driver-sql, whose table has the column, answered `null`. One record,
 * two shapes, by driver: a client predicate such as an action's `visible`
 * reading `record.x` faulted on the missing key on one and evaluated on the
 * other (follow-up D.1 of the #29094 ruling, record 6579342813).
 *
 * The read's persisted state is IN HAND here — the driver just answered for
 * the row — so `null` is the honest value of a selected declared column the
 * driver did not return, exactly the rule `materializeDeclaredFields`
 * (`declared-fields.ts`) applies to every CEL binding.
 *
 * ## What is selected
 *
 * - an explicit projection selects the declared columns it names — the
 *   projection the DRIVER was handed, so a `beforeFind` hook's rewrite and the
 *   engine's own widening (formula inputs, a file field's owner key, each cut
 *   back off the answer before the verb returns) are what count;
 * - no projection (a whole-record GET, a list read) selects every declared
 *   column.
 *
 * ## What stays absent, and why
 *
 * - a column the read did not select — a projection is the caller's own
 *   choice of keys, and filling the rest would answer what was not asked;
 * - a `formula` field — virtual, no column on any driver (`fieldHasColumn` in
 *   driver-sql); `applyFormulaPlan` answers it after this, unchanged;
 * - a name outside the declared set — the intersection below, so nothing this
 *   adds can widen what {@link withDeclaredColumnsOnly} serves;
 * - an injected column a federated (ADR-0015 `external`) object does not
 *   provision (`unprovisionedInjectedColumns`) — there is no storage behind
 *   it, so there is no persisted state to answer for;
 * - on a federated object, a {@link PLATFORM_PROVISIONED_COLUMNS} timestamp
 *   its field map does not declare (`systemFields: false` or
 *   `systemFields.audit: false`, so nothing injected it either). The three are
 *   "provisioned" because driver-sql creates them on every table IT builds,
 *   and the platform builds no table for a federated object
 *   (`isFederatedObject`): the remote holds such a timestamp only where the
 *   author mapped one, which is a declared field. `id` stays — the remote's
 *   own primary key backs it through the binding;
 * - a column field-level security refuses — this runs inside the verb's
 *   middleware chain, on the rows as the driver returned them, and the
 *   security middleware's field mask deletes a refused key from the result
 *   AFTER the verb's body; a `null` added here is removed with it.
 *
 * Same "no opinion" cases as {@link declaredColumnSet}: no checkable field map
 * ⇒ `undefined`, and the rows are left exactly as the driver returned them.
 */
export function selectedStoredColumns(
  schema: { fields?: unknown } | null | undefined,
  projection: readonly unknown[] | null | undefined,
): ReadonlySet<string> | undefined {
  const declared = declaredColumnSet(schema);
  if (!declared) return undefined;
  const fields = schema!.fields as Record<string, { type?: unknown } | null | undefined>;
  const unprovisioned = new Set(unprovisionedInjectedColumns(schema));
  const federated = isFederatedObject(schema);
  const stored = new Set<string>();
  for (const name of declared) {
    if (fields[name]?.type === 'formula' || unprovisioned.has(name)) continue;
    // A platform-provisioned column the object does not declare has storage
    // only on a table the platform built.
    if (federated && name !== 'id' && !Object.prototype.hasOwnProperty.call(fields, name)) continue;
    stored.add(name);
  }
  if (!Array.isArray(projection) || projection.length === 0) return stored;
  const selected = new Set<string>();
  for (const entry of projection) {
    if (typeof entry === 'string' && stored.has(entry)) selected.add(entry);
  }
  return selected;
}

/**
 * The row with every {@link selectedStoredColumns} column it does not carry
 * answered as `null` — a NEW object when there was anything to answer, the
 * same reference otherwise. `undefined` counts as not carried (an own key
 * holding `undefined` is what CEL and JSON both read as absent). Never
 * mutates the row it is given, for the reason {@link withDeclaredColumnsOnly}
 * gives.
 */
export function withSelectedColumnsAnswered<T>(row: T, selected: ReadonlySet<string> | undefined): T {
  if (!selected || selected.size === 0 || !row || typeof row !== 'object' || Array.isArray(row)) return row;
  const source = row as unknown as Record<string, unknown>;
  let shaped: Record<string, unknown> | undefined;
  for (const name of selected) {
    if (source[name] !== undefined) continue;
    shaped ??= { ...source };
    shaped[name] = null;
  }
  return (shaped ?? row) as unknown as T;
}

/** {@link withSelectedColumnsAnswered} over a driver's result page. */
export function rowsWithSelectedColumnsAnswered<T>(rows: T[], selected: ReadonlySet<string> | undefined): T[] {
  if (!selected || selected.size === 0) return rows;
  let changed = false;
  const shaped = rows.map((row) => {
    const next = withSelectedColumnsAnswered(row, selected);
    if (next !== row) changed = true;
    return next;
  });
  return changed ? shaped : rows;
}
