// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Undo on a delete toast (ADR-0148 D2): whether the console may offer it,
 * and the restore it runs.
 *
 * A restore of one's own delete needs `allowRestoreOwnDeleted` on the object,
 * read through the spec's own fold (`objectPermissionGrants`, which
 * `manageRecycleBin` and `modifyAllRecords` imply); the restore door refuses
 * anyone else. So the Undo is offered only when the caller's effective map
 * (`/auth/me/permissions`, `usePermissions().effectiveObjects`) grants it and
 * the data source can restore at all. Never offering an Undo the door would
 * refuse keeps the toast from declaring a capability the runtime does not
 * honour.
 */

import { objectPermissionGrants, type EffectiveObjectPermission } from '@objectstack/spec/security';
import type { RecycleBinRefusalLabels } from '@object-ui/core';

type EffectiveObjects = Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined;

/** A data source that may be able to restore a recycle-bin entry. */
interface RestoringDataSource {
  restoreRecycleBinEntry?: (resource: string, entryId: string) => Promise<unknown>;
}

/**
 * Whether the caller may restore the entries it deleted on `objectName`.
 * The map is read as `MePermissionsProvider` reads it: the lowercase key, the
 * key as given, then the `'*'` row. No map (permissions not loaded) is no.
 */
export function canRestoreOwnDeletes(effectiveObjects: EffectiveObjects, objectName: string): boolean {
  if (!effectiveObjects || !objectName) return false;
  const perm =
    effectiveObjects[objectName.toLowerCase()] ?? effectiveObjects[objectName] ?? effectiveObjects['*'];
  return objectPermissionGrants(perm as EffectiveObjectPermission | undefined, 'allowRestoreOwnDeleted');
}

/**
 * The `restore` a delete host hands `recordDelete`: the data source's
 * restore bound to the object, or `undefined` when the caller may not
 * restore its deletes there or the data source has no recycle bin.
 */
export function recycleBinRestoreOf(
  dataSource: RestoringDataSource | null | undefined,
  objectName: string,
  effectiveObjects: EffectiveObjects,
): ((entryId: string) => Promise<unknown>) | undefined {
  const restoreEntry = dataSource?.restoreRecycleBinEntry;
  if (typeof restoreEntry !== 'function' || !canRestoreOwnDeletes(effectiveObjects, objectName)) return undefined;
  return (entryId: string) => restoreEntry.call(dataSource, objectName, entryId);
}

/**
 * The labels a refused restore's sentence names: an object by the host's
 * resolver, a field of the deleted object by its definition's label. Each
 * falls back to the machine name in `recycleBinRestoreRefusalText`.
 */
export function recycleBinRefusalLabelsOf(
  objectName: string,
  objectDef: unknown,
  objectLabelOf?: (objectName: string) => string,
): RecycleBinRefusalLabels {
  const fields = (objectDef as { fields?: Record<string, { label?: unknown }> } | null | undefined)?.fields;
  return {
    objectLabel: objectLabelOf,
    fieldLabel: (object, field) => {
      if (object !== objectName) return undefined;
      const label = fields?.[field]?.label;
      return typeof label === 'string' && label !== '' ? label : undefined;
    },
  };
}
