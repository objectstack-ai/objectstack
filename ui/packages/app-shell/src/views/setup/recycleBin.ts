// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Configuration → Recycle bin (ADR-0148, objectstack#30239).
 *
 * The recycle bin's doors are per object (`GET` / `DELETE
 * {data}/:object/recycle-bin`, `POST …/:entryId/restore`), and so is the
 * grant that opens them (`manageRecycleBin`, an object permission key). So
 * the page is an object picker: the objects whose bin the caller manages,
 * from metadata the console already holds (no bin read), then one read of the
 * picked object's bin, paged as the door pages.
 *
 * The entry that opens the page is a Setup navigation contribution
 * (`@objectstack/platform-objects`, `group_configuration`); this ref is what
 * that entry names.
 */

import { objectPermissionGrants, type EffectiveObjectPermission } from '@objectstack/spec/security';
import { hasPlatformObjectPrefix } from '@objectstack/spec/system';
import { componentRefToUrlSegments } from '../../services/componentRegistry.js';
import type { CatalogEntry } from './peopleAssignments.js';

/** The component ref of the Recycle bin page. */
export const RECYCLE_BIN_REF = 'data:recycle-bin';

/** The page-scoped query parameter that names the picked object (AGENTS.md #8). */
export const RECYCLE_BIN_OBJECT_PARAM = 'object';

/** One page of entries: the door's own default page size. */
export const RECYCLE_BIN_PAGE_SIZE = 50;

/** Where the page opens inside the Setup app, optionally on one object. */
export function recycleBinPagePath(object?: string): string {
  const base = `/apps/setup/component/${componentRefToUrlSegments(RECYCLE_BIN_REF).join('/')}`;
  return object ? `${base}?${RECYCLE_BIN_OBJECT_PARAM}=${encodeURIComponent(object)}` : base;
}

type EffectiveObjects = Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined;

/**
 * Whether the caller manages `objectName`'s recycle bin: the effective map
 * read as `MePermissionsProvider` reads it (the lowercase key, the key as
 * given, then `'*'`), folded by the spec (`modifyAllRecords` implies it).
 * A platform object never enters the bin, so it never has one to manage.
 */
export function managesRecycleBin(effectiveObjects: EffectiveObjects, objectName: string): boolean {
  if (!effectiveObjects || !objectName || hasPlatformObjectPrefix(objectName)) return false;
  const perm =
    effectiveObjects[objectName.toLowerCase()] ?? effectiveObjects[objectName] ?? effectiveObjects['*'];
  return objectPermissionGrants(perm as EffectiveObjectPermission | undefined, 'manageRecycleBin');
}

/** The catalog entries whose recycle bin the caller manages. */
export function managedRecycleBinObjects(entries: readonly CatalogEntry[], effectiveObjects: EffectiveObjects): CatalogEntry[] {
  return entries.filter((e) => managesRecycleBin(effectiveObjects, e.name));
}

/** One entry as the list door serves it; rows are masked to what the caller may read. */
export interface RecycleBinEntry {
  id: string;
  object: string;
  recordId: string;
  recordCount: number;
  deletedBy: string | null;
  deletedAt: string | null;
  purgeAfter: string | null;
  rows: Array<{ object: string; id: string; values: Record<string, unknown> }>;
}

export interface RecycleBinPage {
  entries: RecycleBinEntry[];
  hasMore: boolean;
}

/** The SDK's `recycleBin` doors the page uses. */
export interface RecycleBinDoors {
  list(object: string, opts?: { limit?: number; offset?: number }): Promise<RecycleBinPage>;
  empty(object: string): Promise<{ object: string; removed: number }>;
}

/** The recycle-bin doors of the adapter's client, or `undefined` when it has none. */
export function recycleBinDoorsOf(adapter: unknown): RecycleBinDoors | undefined {
  const getClient = (adapter as { getClient?: () => unknown } | null | undefined)?.getClient;
  if (typeof getClient !== 'function') return undefined;
  const doors = (getClient.call(adapter) as { recycleBin?: Partial<RecycleBinDoors> } | null | undefined)?.recycleBin;
  return typeof doors?.list === 'function' && typeof doors.empty === 'function' ? (doors as RecycleBinDoors) : undefined;
}

/** The values of the deleted record itself: its own row, else the first row served. */
export function entryRecord(entry: RecycleBinEntry): Record<string, unknown> {
  const own = entry.rows.find((r) => r.object === entry.object && r.id === entry.recordId) ?? entry.rows[0];
  return { id: entry.recordId, ...(own?.values ?? {}) };
}
