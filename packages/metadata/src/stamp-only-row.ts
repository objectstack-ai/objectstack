// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32985; maintainer decision 2026-11-14 on #32985] A stored row that names
 * its package by the registry's `_packageId` stamp ALONE.
 *
 * `@objectstack/metadata` 17.0.0 through 18.3.0, on a host whose
 * `MetadataPlugin` declares its `packageId`, primed eagerly with no
 * `artifactSource`, with a `DatabaseLoader`, saved every package-less row the
 * boot pass read back into that loader stamped with the host's package
 * (`_packageId`, `_provenance`). From the row alone such an environment row is
 * indistinguishable from a row of the host's own item, which also carries the
 * stamp and nothing else; only the row's history can tell them apart
 * (`detectStampOnlyRows`). So the doors that would take such a row from the
 * environment for good treat every row of this shape as possibly the
 * environment's, fail-closed: `MetadataManager.unregisterPackage` keeps it
 * unless the caller forces the removal, `DatabaseLoader.bindReadRowPackage`
 * binds no `package_id` column from it, and
 * `migrateDatabaseLoaderRowPackages` leaves it (`stamp-only`). A row of the
 * host's own item may be kept or left unbound with them; an environment row
 * is never removed or bound to the host by its stamp.
 *
 * A row is of this shape when its stored body — flat, or the publish
 * envelope `{ packageId, metadata: {...} }` at either level — carries a
 * `_packageId` naming one package, and neither `packageId` (the envelope's, or
 * what a caller registering an item for a package writes) nor the legacy
 * `package` key names any: those are the item's own claim. Whether its
 * `package_id` column is empty is the caller's half; the body is this one's.
 */

import { STORED_BODY_KEY } from './stored-envelope.js';
import { isPackageCaller } from './package-slotted-store.js';

/**
 * The package `body` names by the `_packageId` stamp alone (see the module
 * doc); `undefined` for a body that names none, names one by its own
 * `packageId` / `package` key, or carries two different stamps.
 */
export function stampOnlyPackageOf(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const levels = [body, body[STORED_BODY_KEY]].filter(isRecord);
  if (levels.some((level) => isPackageCaller(asString(level.packageId)) || isPackageCaller(asString(level.package)))) return undefined;
  const stamps = new Set(levels.map((level) => asString(level._packageId)).filter(isPackageCaller));
  return stamps.size === 1 ? [...stamps][0] : undefined;
}

/** The stored `metadata` column as an object, or `undefined` when it does not parse. */
export function parsedStoredBody(stored: unknown): unknown {
  if (typeof stored !== 'string') return stored;
  try {
    return JSON.parse(stored);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
