// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The managed install door's answer to a data-only package, as the test
 * doubles give it: the shape measured on a blank 18.5.0 host with the
 * travel_expense build installed (`data.seeded`, `mode: 'inline'`, and one
 * `errorList` entry per row the loader could not write: `sourceObject`,
 * `field: '(write)'`, `targetField: 'id'`, `attemptedValue`, `recordIndex` and
 * the loader's sentence; no error code). Each row is written through `write`,
 * so a double that refuses a row in its insert refuses it here too.
 *
 * `drops` names the references the loader drops from a row, each field with
 * the object it points at: the field is removed and the row written without
 * it, and the answer carries one entry with `field` set to that lookup, as the
 * real loader reports a reference it could not resolve (`referencesDropped`).
 * A row whose write then fails carries both entries.
 */

import type { HttpAnswer } from '../../src/runner/app.js';

export async function seedDoorAnswer(
  write: (object: string, row: Record<string, unknown>) => Promise<HttpAnswer>,
  manifest: Record<string, unknown>,
  drops: (object: string, row: Record<string, unknown>) => Record<string, string> = () => ({}),
): Promise<HttpAnswer> {
  const datasets = manifest.data as Array<{ object: string; records: Array<Record<string, unknown>> }>;
  let inserted = 0;
  const errorList: Array<Record<string, unknown>> = [];
  for (const { object, records } of datasets) {
    for (const [recordIndex, sent] of records.entries()) {
      const row = { ...sent };
      for (const [field, targetObject] of Object.entries(drops(object, sent))) {
        errorList.push({
          sourceObject: object,
          field,
          targetObject,
          targetField: 'id',
          attemptedValue: sent[field],
          recordIndex,
          message: `Deferred reference unresolved after pass 2: ${object}.${field} = '${String(sent[field])}' → ${targetObject}.id not found`,
        });
        delete row[field];
      }
      const r = await write(object, row);
      if (r.ok) inserted++;
      else
        errorList.push({
          sourceObject: object,
          field: '(write)',
          targetObject: object,
          targetField: 'id',
          attemptedValue: row.id,
          recordIndex,
          message: `Failed to write ${object} record #${recordIndex} (id=${String(row.id)}): ${r.message ?? ''}`,
        });
    }
  }
  const seeded = { mode: 'inline', inserted, updated: 0, skipped: 0, errors: errorList.length, errorList, droppedRefs: 0 };
  return { ok: true, status: 200, body: { success: true, data: { manifestId: manifest.id, seeded } } };
}
