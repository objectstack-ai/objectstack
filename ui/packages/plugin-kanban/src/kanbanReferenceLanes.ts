/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Lanes on a reference field (objectstack#36430).
 *
 * A board grouped by a lookup, user, master-detail or tree field reads the
 * field's value off records the board fetched with `$expand`, so the value is
 * the referenced RECORD (`{ id, name, … }`), not its key. Stringified, every
 * such value is `"[object Object]"`: the board drew one lane per card, all
 * titled that, and each held every card. A lane on a reference is keyed by
 * the foreign key, the value a drag writes back and the value a lane's query
 * filters on, and titled by the referenced record's name.
 */

import { referencedRecordTitle } from '@object-ui/core';

/** The referenced record when `value` is an expanded reference, else `undefined`. */
function expandedRecordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * The lane a stored group value belongs to: the foreign key of an expanded
 * reference, else the value itself as a string. An expanded record with no
 * key belongs to no lane (`''`, the "Uncategorized" lane), never to a lane
 * keyed `"[object Object]"`.
 */
export function laneKeyOf(value: unknown): string {
  const record = expandedRecordOf(value);
  if (record) {
    const id = record.id ?? record._id;
    return id === undefined || id === null ? '' : String(id);
  }
  return String(value ?? '');
}

/**
 * The lanes the loaded records name, in the order the records name them: one
 * per distinct lane key, titled by the referenced record's name when a record
 * carries it expanded (the field's `displayField`, then the target object's
 * declared name field, then the shared ladder), else by the key. A record with
 * no value names no lane; it is drawn in "Uncategorized".
 */
export function lanesFromRecords(
  records: ReadonlyArray<Record<string, unknown>>,
  groupBy: string,
  targetDef?: unknown,
  displayField?: string,
): Array<{ id: string; title: string }> {
  const titles = new Map<string, string | undefined>();
  for (const record of records) {
    const value = record?.[groupBy];
    const key = laneKeyOf(value);
    if (key === '') continue;
    if (titles.get(key) !== undefined) continue;
    const expanded = expandedRecordOf(value);
    titles.set(key, expanded ? referencedRecordTitle(targetDef, expanded, displayField) : undefined);
  }
  return Array.from(titles, ([id, title]) => ({ id, title: title ?? id }));
}

/**
 * The value to hold locally for a record moved into lane `laneId`: the
 * referenced record as another loaded record carries it expanded, so the card
 * keeps naming it until the board refetches, else the key itself.
 */
export function laneValueOf(
  records: ReadonlyArray<Record<string, unknown>>,
  groupBy: string,
  laneId: string,
): unknown {
  for (const record of records) {
    const value = record?.[groupBy];
    if (expandedRecordOf(value) && laneKeyOf(value) === laneId) return value;
  }
  return laneId;
}
