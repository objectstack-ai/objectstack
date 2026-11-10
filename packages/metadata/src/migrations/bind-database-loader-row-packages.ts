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
 * reads are right without this migration; what this adds is the column, for
 * the overlay unique index and for any other reader of `package_id`.
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
 * Safe to run any number of times: a bound row is no longer a candidate.
 * `DatabaseLoader` runs it once per loader, best-effort, before its first
 * operation on one of these types, and binds every row it saves.
 *
 * Usage:
 *   import { migrateDatabaseLoaderRowPackages } from '@objectstack/metadata/migrations';
 *   const result = await migrateDatabaseLoaderRowPackages(driver);
 */

import type { DriverQuery } from '@objectstack/spec/contracts';
import { PACKAGE_SLOTTED_STORE_TYPES, storedItemPackageId } from '../package-slotted-store.js';

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

  // Every package already holding a row of each name, so a binding never
  // makes a second row of one slot.
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
      await store.update(table, at.id, { package_id: packageId });
    } catch {
      result.left.push({ ...at, reason: 'update-failed' });
      continue;
    }
    taken.add(slotOf(row, packageId));
    result.bound.push({ ...at, packageId });
  }
  return result;
}

/** The row's `package_id` when it names a package (not empty, not the `sys_metadata` sentinel). */
function boundColumn(row: Record<string, unknown>): string | undefined {
  const column = row.package_id;
  return typeof column === 'string' && column !== '' && column !== 'sys_metadata' ? column : undefined;
}

function slotOf(row: Record<string, unknown>, packageId: string): string {
  return JSON.stringify([row.type, row.name, packageId]);
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
