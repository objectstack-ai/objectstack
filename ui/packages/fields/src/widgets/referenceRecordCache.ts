/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The one module-wide cache of referenced records a cell draws a stored id
 * from, so many renderers naming the same record make one read. It holds the
 * RECORD and the referenced object's schema, not a resolved name: the name is
 * a display value, resolved per render from the row the viewer may read
 * (objectui#10501), so it follows the permission policy of the render that
 * shows it rather than the one in force when the record arrived.
 *
 * Two writers fill it: `useLookupName` (the lookup cell's read of one id) and
 * a pick (objectstack#36046) — the record a picker handed back is the record
 * the id names, so the cell that stores the id draws its name and face from
 * it at once, before any read of the list or of the record.
 *
 * Kept in its own module, free of React, so the picker (`LookupField`) and the
 * cell renderers (the package barrel) share it without an import cycle.
 */

export type ReferenceRecordCacheEntry =
  | { state: 'pending'; promise: Promise<void> }
  | { state: 'ok'; record: Record<string, unknown> | null | undefined; schema: unknown }
  // The reader's own read was REFUSED (objectstack#29641): settled, not failed.
  | { state: 'refused' }
  | { state: 'err' };

export const referenceRecordCache: Map<string, ReferenceRecordCacheEntry> = new Map();

/**
 * The cache key of record `id` of `referenceTo`. The preferred display field
 * is part of the cache identity (objectstack-ai/objectstack#2926 ⑧); the
 * entry holds the record, so the field only decides which entry a read
 * shares, and a pick writes the entry read with no display field.
 */
export function referenceRecordKey(referenceTo: string, id: string | number, displayField?: string): string {
  return `${referenceTo}:${String(id)}:${displayField ?? ''}`;
}

/** The id a record carries: `idField`, then `id`, then `_id`. */
function recordIdOf(record: Record<string, unknown>, idField: string): string | number | undefined {
  const id = record[idField] ?? record.id ?? record._id;
  return typeof id === 'string' || typeof id === 'number' ? id : undefined;
}

/**
 * objectstack#36046 — keep the records a pick of `referenceTo` handed back,
 * as what their ids name. A record already kept with the referenced object's
 * schema keeps that schema when the pick carries none.
 */
export function rememberPickedRecords(
  referenceTo: string | undefined,
  records: ReadonlyArray<Record<string, unknown> | null | undefined>,
  idField = 'id',
  schema?: unknown,
): void {
  if (!referenceTo) return;
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const id = recordIdOf(record, idField);
    if (id === undefined || id === '') continue;
    const key = referenceRecordKey(referenceTo, id);
    const held = referenceRecordCache.get(key);
    const heldSchema = held?.state === 'ok' ? held.schema : undefined;
    referenceRecordCache.set(key, { state: 'ok', record, schema: schema ?? heldSchema });
  }
}

/**
 * The record of `referenceTo` that `id` names, when this page already holds
 * it (a pick, or an earlier read); `undefined` otherwise. Reads nothing.
 */
export function heldReferenceRecord(
  referenceTo: string,
  id: unknown,
): Record<string, unknown> | undefined {
  if ((typeof id !== 'string' && typeof id !== 'number') || id === '') return undefined;
  const entry = referenceRecordCache.get(referenceRecordKey(referenceTo, id));
  return entry?.state === 'ok' && entry.record && typeof entry.record === 'object' ? entry.record : undefined;
}
