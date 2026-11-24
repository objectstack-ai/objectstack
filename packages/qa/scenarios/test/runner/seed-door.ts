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
 *
 * A dataset whose `mode` `SeedMode` does not accept (a retired `insert` or
 * `replace`, #34613) is refused whole, as the real door refuses it
 * (`loadStored`): one entry for the dataset, `field: 'mode'`,
 * `targetField: '(dataset)'`, `recordIndex: 0`, with `SeedMode`'s own message,
 * and no row written.
 *
 * `record` is the organization's record of landed seed rows
 * (`sys_seed_landed_key`), as the real door keeps it: keyed on the object and
 * the row's `id` (every runner dataset is keyed on `id`), with no package in
 * the key, so every package the door loads shares it. With it, each row of an
 * (`ignore`) dataset is read first (`record.holds`): a row the object holds is
 * left as it is (`skipped`); a row it does not hold whose key is recorded is
 * withheld under the install's `honour` posture (`skipped`, not written, no
 * error, as `isWithdrawnRow` in the real loader) and written under the
 * reseed's `reseed` posture; every row written is recorded. Without `record`
 * the door keeps no record and writes every row, the shape before the record
 * was modelled.
 */

import { SeedMode } from '@objectstack/spec/data';
import type { HttpAnswer } from '../../src/runner/app.js';

/** The landed-seed-row record a double's door keeps ({@link seedDoorAnswer}), and the read it judges a row by. */
export interface SeedDoorRecord {
  /** `object/id` of every seed row the door has landed, across every package it loaded. */
  landed: Set<string>;
  /** Whether the object holds a row with this `id` now. */
  holds(object: string, id: string): boolean | Promise<boolean>;
  /** `honour` for an install (the default), `reseed` for the package's sample-data reseed. */
  posture?: 'honour' | 'reseed';
}

export async function seedDoorAnswer(
  write: (object: string, row: Record<string, unknown>) => Promise<HttpAnswer>,
  manifest: Record<string, unknown>,
  drops: (object: string, row: Record<string, unknown>) => Record<string, string> = () => ({}),
  record?: SeedDoorRecord,
): Promise<HttpAnswer> {
  const datasets = manifest.data as Array<{ object: string; mode?: unknown; records: Array<Record<string, unknown>> }>;
  let inserted = 0;
  let skipped = 0;
  const errorList: Array<Record<string, unknown>> = [];
  for (const { object, mode, records } of datasets) {
    const judged = mode === undefined ? undefined : SeedMode.safeParse(mode);
    if (judged && !judged.success) {
      const said = judged.error.issues[0]?.message ?? `seed mode ${String(mode)} refused`;
      errorList.push({ sourceObject: object, field: 'mode', targetObject: object, targetField: '(dataset)', attemptedValue: mode, recordIndex: 0, message: `Seed dataset for '${object}' was not loaded: ${said}` });
      continue;
    }
    for (const [recordIndex, sent] of records.entries()) {
      const key = `${object}/${String(sent.id)}`;
      if (record) {
        if (await record.holds(object, String(sent.id))) {
          skipped++;
          continue;
        }
        if ((record.posture ?? 'honour') === 'honour' && record.landed.has(key)) {
          skipped++;
          continue;
        }
      }
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
      if (r.ok) {
        inserted++;
        record?.landed.add(key);
      } else
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
  const seeded = { mode: 'inline', inserted, updated: 0, skipped, errors: errorList.length, errorList, droppedRefs: 0 };
  return { ok: true, status: 200, body: { success: true, data: { manifestId: manifest.id, seeded } } };
}

/**
 * The sample-data reseed door's answer for an installed data-only package
 * (`POST …/install-local/:manifestId/reseed-sample-data`), as the real door
 * gives it: the package's datasets loaded again under the `reseed` posture
 * ({@link seedDoorAnswer}), answered with the loader's four counts and no
 * error list; a run that wrote nothing and found nothing already there is
 * `422 RESEED_NO_ROWS`, and a package the door never installed is `404`.
 */
export async function reseedDoorAnswer(
  write: (object: string, row: Record<string, unknown>) => Promise<HttpAnswer>,
  manifest: Record<string, unknown> | undefined,
  manifestId: string,
  record: SeedDoorRecord,
  drops?: (object: string, row: Record<string, unknown>) => Record<string, string>,
): Promise<HttpAnswer> {
  if (!manifest) return { ok: false, status: 404, body: {}, code: 'RESOURCE_NOT_FOUND', message: `No marketplace install for ${manifestId}.` };
  const answer = await seedDoorAnswer(write, manifest, drops, { ...record, posture: 'reseed' });
  const { inserted, updated, skipped, errors, errorList } = (answer.body as { data: { seeded: { inserted: number; updated: number; skipped: number; errors: number; errorList: Array<{ message?: string }> } } }).data.seeded;
  if (inserted + updated === 0 && !(errors === 0 && skipped > 0)) {
    const message = errors > 0 ? `Reseed wrote no rows (${errors} error${errors === 1 ? '' : 's'}).${errorList[0]?.message ? ` First error: ${errorList[0].message}` : ''}` : 'Reseed wrote no rows. The package declares no seedable records for this runtime.';
    return { ok: false, status: 422, body: {}, code: 'RESEED_NO_ROWS', message };
  }
  return { ok: true, status: 200, body: { success: true, data: { manifestId, inserted, updated, skipped, errors, withSampleData: true } } };
}
