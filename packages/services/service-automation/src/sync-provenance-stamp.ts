// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0153 D4] The provenance a sync-in pull stamps on every row it writes,
 * onto the `_sync_` columns the injected-columns plan gives a
 * `managedBy: 'synced'` object (`SYNC_PROVENANCE_COLUMNS`,
 * `@objectstack/spec/data`):
 *
 * | Column | Written |
 * |:--|:--|
 * | `_sync_source` | the mapping's name |
 * | `_sync_external_id` | the row's key in the source, as text ({@link encodeSyncExternalId}) |
 * | `_sync_pulled_at` | when this write was made |
 * | `_sync_run_id` | the `sys_sync_run` row of this pull, or empty when no ledger keeps the run |
 * | `_sync_deleted_at` | nothing yet: D3's mark, stamped by the delete marking when it lands |
 *
 * Both pulls (the connector source and the datasource source) stamp through
 * {@link stampSyncProvenance}, after the mapping has projected the rows and
 * before the import runner writes them, and write with the pull's mark
 * (`markSyncPullWrite`, `@objectstack/objectql`): the engine refuses a
 * `_sync_` column in any other write, whatever its context.
 */

import { SYNC_PROVENANCE_COLUMNS, SYNC_PROVENANCE_PREFIX } from '@objectstack/spec/data';

type Rec = Record<string, unknown>;

const [SYNC_SOURCE, SYNC_EXTERNAL_ID, SYNC_PULLED_AT, SYNC_RUN_ID] = SYNC_PROVENANCE_COLUMNS;

const isPlainObject = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Does the target object carry the provenance columns a pull stamps? */
export function carriesSyncProvenanceColumns(target: unknown): boolean {
  const fields = isPlainObject(target) && isPlainObject(target.fields) ? target.fields : undefined;
  return fields !== undefined && [SYNC_SOURCE, SYNC_EXTERNAL_ID, SYNC_PULLED_AT, SYNC_RUN_ID].every((f) => fields[f] !== undefined);
}

/**
 * The first `fieldMapping` target that names a `_sync_` column, or `undefined`.
 * A mapping may not write a provenance column: the pull stamps them, and the
 * injected columns now exist on the target, so the import door's own
 * unknown-target check no longer refuses one.
 */
export function mappedSyncProvenanceTarget(fieldMapping: ReadonlyArray<{ target?: unknown } | undefined>): string | undefined {
  for (const entry of fieldMapping) {
    const targets = Array.isArray(entry?.target) ? entry.target : [entry?.target];
    for (const t of targets) {
      if (typeof t === 'string' && t.startsWith(SYNC_PROVENANCE_PREFIX)) return t;
    }
  }
  return undefined;
}

/** One key value, spelled as text; `undefined` for a blank value. */
function spellKeyValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    // The pulls write with `trimWhitespace: true`, so the runner matches on the
    // trimmed value; the key is spelled as it is matched.
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  return JSON.stringify(value);
}

/**
 * [ADR-0153 D4, open question "a composite `upsertKey` written as
 * `_sync_external_id` text: the encoding, and an order that stays stable"]
 * The row's key in the source, as text.
 *
 * - `values` are the values the mapping copies onto the `upsertKey` fields, in
 *   the order `upsertKey` declares them. For a `none` or `lookup` copy (the
 *   lookup resolves after this point) that is the value the source sent.
 * - One field: its value spelled as text (a string trimmed, a number, bigint
 *   or boolean by `String`, a date as ISO 8601, anything else as JSON).
 * - Several fields: a JSON array of those spellings, in `upsertKey` order. The
 *   order is the author's declaration, so it is stable for as long as the
 *   mapping is; it is never sorted, since two fields' values are not
 *   interchangeable.
 * - Any blank key value: `undefined`. Such a row is not written (the pulls
 *   skip a blank match key and count it refused), so no key is stamped.
 *
 * Within one mapping the arity is fixed, so the one-field spelling and the
 * array spelling never meet on rows of the same `_sync_source`.
 */
export function encodeSyncExternalId(values: readonly unknown[]): string | undefined {
  if (values.length === 0) return undefined;
  const spelled: string[] = [];
  for (const value of values) {
    const s = spellKeyValue(value);
    if (s === undefined) return undefined;
    spelled.push(s);
  }
  return spelled.length === 1 ? spelled[0] : JSON.stringify(spelled);
}

/** What a pull stamps: the mapping, the run, and the write's time. */
export interface SyncProvenanceStamp {
  mapping: string;
  /** The `sys_sync_run` id, when a ledger keeps the run. */
  runId: string | undefined;
  /** ISO 8601; one value per batch the pull writes. */
  pulledAt: string;
}

/**
 * The mapped rows, each with its provenance columns set. Returns new row
 * objects; the stamp wins over anything the mapping produced under those
 * names (none can, since {@link mappedSyncProvenanceTarget} refuses one).
 */
export function stampSyncProvenance(
  rows: ReadonlyArray<Rec>,
  matchFields: readonly string[],
  stamp: SyncProvenanceStamp,
): Rec[] {
  return rows.map((row) => {
    const externalId = encodeSyncExternalId(matchFields.map((f) => row[f]));
    return {
      ...row,
      [SYNC_SOURCE]: stamp.mapping,
      ...(externalId !== undefined ? { [SYNC_EXTERNAL_ID]: externalId } : {}),
      [SYNC_PULLED_AT]: stamp.pulledAt,
      [SYNC_RUN_ID]: stamp.runId ?? null,
    };
  });
}
