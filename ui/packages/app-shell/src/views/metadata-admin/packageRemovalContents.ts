// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What the Delete package dialog states will go (objectstack#31025): each
 * object the package holds with its row count, every other item counted by
 * type, and the pending drafts.
 *
 * Read from two doors that already exist, never a route of its own:
 *  - `GET /api/v1/packages/:id/export` — the package's published items, one
 *    collection key per metadata type (`PackageExportManifestSchema`). It does
 *    not carry a package's datasources or email templates.
 *  - the data list with `$top: 0` — `total` is the number of rows the caller
 *    can read, the same count the object list's footer shows.
 *
 * A count the data list did not answer is drawn as unknown, never as `0`.
 */

import { canonicalMetaUrlType } from '@objectstack/spec/shared';
import { ASSEMBLED_VIEW_ITEMS_KEY } from '@objectstack/spec/ui';

export interface PackageRemovalContents {
  /** The objects the package holds, in the export's order. */
  objects: Array<{ name: string; label: string }>;
  /** Every other published item, counted by its singular metadata type. */
  others: Array<{ type: string; count: number }>;
}

/**
 * The export's one declared member that is a list but not a metadata
 * collection: the positions of maps it withheld from connectors.
 */
const NOT_A_COLLECTION = 'withheldMaps';

/** Reads the export door's answer into what the dialog lists. */
export function readPackageRemovalContents(manifest: unknown): PackageRemovalContents {
  const objects: PackageRemovalContents['objects'] = [];
  const byType = new Map<string, number>();
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { objects, others: [] };
  for (const [key, value] of Object.entries(manifest as Record<string, unknown>)) {
    if (!Array.isArray(value) || value.length === 0 || key === NOT_A_COLLECTION) continue;
    // `viewItems` carries the views the `views` containers do not re-derive:
    // both are views of the package.
    const type = key === ASSEMBLED_VIEW_ITEMS_KEY ? 'view' : canonicalMetaUrlType(key);
    if (type === 'object') {
      for (const item of value) {
        const name = typeof item?.name === 'string' ? item.name : '';
        if (!name) continue;
        objects.push({ name, label: typeof item.label === 'string' && item.label ? item.label : name });
      }
      continue;
    }
    byType.set(type, (byType.get(type) ?? 0) + value.length);
  }
  return { objects, others: [...byType].map(([type, count]) => ({ type, count })) };
}

/**
 * The dialog's state for the list: still reading, the read failed, or the
 * contents with each object's count (`undefined` while it is read, `null`
 * when the data list gave none).
 */
export type PackageRemovalState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; contents: PackageRemovalContents; counts: Record<string, number | null | undefined> };
