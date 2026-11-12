// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Migration: bind `DatabaseLoader` rows of a by-package type to their package
 * (ADR-0150 D4, #32246).
 *
 * Before #32246 `DatabaseLoader.save` kept one `sys_metadata` row per
 * `(type, name)` and wrote no `package_id`, so a row of a type stored per
 * `(package, name)` (`PACKAGE_SLOTTED_STORE_TYPES`) named its package only in
 * its stored body. The loader now keeps one row per `(package, name)` with
 * `package_id` filled. It still reads an old row's package off its body, so
 * reads are right without this migration, and its next save binds the row;
 * what this adds is the column for every row now, for the overlay unique
 * index and for any other reader of `package_id`.
 *
 * A row is bound when all four hold — and ⛔ nothing is ever guessed:
 *
 *  - its `type` is in `PACKAGE_SLOTTED_STORE_TYPES`;
 *  - `package_id` is empty;
 *  - `source = 'database'` (the loader's own rows; `SysMetadataRepository`
 *    never writes the column);
 *  - its stored body names a package (`storedItemPackageId`: the envelope's
 *    `packageId`, else the registry's `_packageId` stamp).
 *
 * A row whose body names no package is the environment's own item, or a
 * customization whose holder the row cannot name, and is left as it is. So is
 * a row whose package already has a row of the same name (binding it would
 * make two rows of one slot), and a row whose update fails.
 *
 * A bundled type (`email_template`, keyed by `locale`) holds a row per member
 * in one slot, as `DatabaseLoader.save` writes it (#32489): its slot is
 * `(package, name, member)`, the member read off the row's `bundle_member`
 * column else its body (`storedRowMemberOf`), the store's unique key. So a
 * `fr-FR` row binds beside the package's bound `en-US` row of the name, and a
 * second `fr-FR` row is still left.
 *
 * [#32540] An action holds a row per object a package binds its name to: its
 * slot is `(package, name, object)`, the object as the unique key holds it once
 * named (`namedRowColumnOf`; object-less, or an object longer than the column
 * stores, is the empty place). Binding an action row also names its object in
 * `bundle_member`, after the package's own rows of the name written before
 * their object was named (the column only), so two bindings never share the
 * empty place.
 *
 * Safe to run any number of times: a bound row is no longer a candidate. An
 * operator runs it; ⛔ `DatabaseLoader` does not run it on its own, so a
 * loader's reads cost what they cost.
 *
 * Usage:
 *   import { migrateDatabaseLoaderRowPackages } from '@objectstack/metadata/migrations';
 *   const result = await migrateDatabaseLoaderRowPackages(driver);
 */

import type { DriverQuery } from '@objectstack/spec/contracts';
import {
  PACKAGE_SLOTTED_STORE_TYPES,
  namedRowColumnOf,
  storedItemPackageId,
  storedRowMemberOf,
} from '../package-slotted-store.js';

/** The two reads/writes this migration needs; an `IDataDriver` is one. */
export interface DatabaseLoaderRowStore {
  find(table: string, query: DriverQuery): Promise<Record<string, unknown>[]>;
  update(table: string, id: string, data: Record<string, unknown>): Promise<unknown>;
}

/** Why a candidate row was left unbound. */
export type DatabaseLoaderRowLeftReason = 'package-less' | 'slot-taken' | 'update-failed';

/** What {@link migrateDatabaseLoaderRowPackages} did. */
export interface DatabaseLoaderRowPackagesResult {
  /** The rows it bound, with the package each now carries. */
  bound: Array<{ id: string; type: string; name: string; packageId: string }>;
  /** The candidate rows (empty `package_id`, `source = 'database'`) it left, and why. */
  left: Array<{ id: string; type: string; name: string; reason: DatabaseLoaderRowLeftReason }>;
}

/**
 * Bind each `source = 'database'` row of a by-package type whose body names a
 * package to that package. See the module doc.
 */
export async function migrateDatabaseLoaderRowPackages(
  store: DatabaseLoaderRowStore,
  options?: { tableName?: string },
): Promise<DatabaseLoaderRowPackagesResult> {
  const table = options?.tableName ?? 'sys_metadata';
  const rows = await store.find(table, { where: { type: { $in: [...PACKAGE_SLOTTED_STORE_TYPES] } } });
  const result: DatabaseLoaderRowPackagesResult = { bound: [], left: [] };

  // Every slot already held — `(package, name)`, plus the member for a bundled
  // type — so a binding never makes a second row of one slot.
  const taken = new Set<string>();
  for (const row of rows) {
    const column = boundColumn(row);
    if (column !== undefined) taken.add(slotOf(row, column));
  }

  for (const row of rows) {
    if (boundColumn(row) !== undefined || row.source !== 'database') continue;
    const at = { id: String(row.id), type: String(row.type), name: String(row.name) };
    const packageId = bodyPackageId(row.metadata);
    if (packageId === undefined) {
      result.left.push({ ...at, reason: 'package-less' });
      continue;
    }
    if (taken.has(slotOf(row, packageId))) {
      result.left.push({ ...at, reason: 'slot-taken' });
      continue;
    }
    try {
      // [#32540 C3] An action row is bound with its object named in the same
      // update, after the package's own rows written before their object was
      // named: otherwise two of the package's bindings share the object-less
      // place of the store's unique key.
      await nameUnnamedRows(store, table, rows.filter((other) => other !== row && boundColumn(other) === packageId && other.type === row.type && other.name === row.name));
      await store.update(table, at.id, { package_id: packageId, ...namingOf(row) });
    } catch {
      result.left.push({ ...at, reason: 'update-failed' });
      continue;
    }
    taken.add(slotOf(row, packageId));
    result.bound.push({ ...at, packageId });
  }
  return result;
}

/**
 * [#32540 C3] The `bundle_member` update that names an action row's object, when
 * the column is empty and can store it (`namedRowColumnOf`); `{}` otherwise.
 */
function namingOf(row: Record<string, unknown>): { bundle_member?: string } {
  if (typeof row.bundle_member === 'string' && row.bundle_member !== '') return {};
  const column = namedRowColumnOf(String(row.type), parsedBody(row.metadata), row.bundle_member);
  return typeof column === 'string' ? { bundle_member: column } : {};
}

/** [#32540 C3] Name the object of each of `rows` that {@link namingOf} names (the column only). */
async function nameUnnamedRows(store: DatabaseLoaderRowStore, table: string, rows: ReadonlyArray<Record<string, unknown>>): Promise<void> {
  for (const row of rows) {
    const naming = namingOf(row);
    if (naming.bundle_member === undefined) continue;
    await store.update(table, String(row.id), naming);
    row.bundle_member = naming.bundle_member;
  }
}

/** The row's `package_id` when it names a package (not empty, not the `sys_metadata` sentinel). */
function boundColumn(row: Record<string, unknown>): string | undefined {
  const column = row.package_id;
  return typeof column === 'string' && column !== '' && column !== 'sys_metadata' ? column : undefined;
}

/**
 * The slot `row` holds once bound to `packageId`; a bundled type's names the
 * member too (#32489), and [#32540] an action's the object it is bound to
 * (`storedRowMemberOf`), so a package's legacy row on one object binds beside
 * its bound row on another.
 */
function slotOf(row: Record<string, unknown>, packageId: string): string {
  const type = String(row.type);
  const body = parsedBody(row.metadata);
  const column = namedRowColumnOf(type, body, row.bundle_member);
  const member = column !== undefined ? column : storedRowMemberOf(type, body, row.bundle_member);
  if (member === undefined) return JSON.stringify([type, row.name, packageId]);
  return JSON.stringify([type, row.name, packageId, member]);
}

/** The stored body as an object, or `undefined` when it does not parse (the member is then the column's, else canonical). */
function parsedBody(stored: unknown): unknown {
  if (typeof stored !== 'string') return stored;
  try {
    return JSON.parse(stored);
  } catch {
    return undefined;
  }
}

/** The package a stored body names, or `undefined` when it names none or does not parse. */
function bodyPackageId(stored: unknown): string | undefined {
  if (stored === null || stored === undefined) return undefined;
  try {
    return storedItemPackageId(typeof stored === 'string' ? JSON.parse(stored) : stored);
  } catch {
    return undefined;
  }
}
