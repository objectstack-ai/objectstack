// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21120] One-off rewrite of the at-rest cleartext copies this plugin's writer
 * left behind.
 *
 * `writeAudit` COPIES the whole audited row into `sys_audit_log.new_value` /
 * `old_value` and `sys_activity.metadata` at write time. For a
 * `sys_metadata` / `sys_metadata_history` row that copy carried the stored
 * metadata BODY — a datasource body's credential material included — into a
 * second, admin-readable, at-rest store. The writer now projects that body
 * through the shared redactor before it records it (`audit-writers.ts`), but
 * the writer only reaches NEW writes: rows copied before the fix keep their
 * cleartext. This module rewrites them.
 *
 * ## Pure planner, driven runner
 *
 * The decision — "does this stored audit/activity value carry a metadata body,
 * and what does the redacted copy look like?" — is pure and I/O-free
 * ({@link planAuditRowPatch} / {@link planActivityRowPatch}), so every verdict
 * is unit-testable against a stored row and the runner cannot decide policy in
 * the middle of a write sequence. {@link migrateStoredMetadataBodyCopies}
 * drives them over the two tables through the engine, rewriting only the rows a
 * planner changed.
 *
 * ## One redactor, fail-closed
 *
 * The body is projected through the SAME {@link redactStoredMetadataBody} every
 * read exit uses — never a second rule set. The `type` that selects the
 * redactor is read from the stored snapshot itself (a create/delete snapshot is
 * the whole row, so it carries the `type` column); an update diff keeps only the
 * changed keys, so a snapshot that changed the body but not the type has no
 * `type` to read — the runner supplies it from the live `sys_metadata` row when
 * that row still exists, and the planner FAILS CLOSED when neither answers,
 * dropping the body from the recorded copy rather than leaving it cleartext.
 *
 * ## Idempotent, its own verification
 *
 * A second run finds nothing to rewrite — a redacted snapshot has no credential
 * left to withhold — so re-running and reading a clean report is the check, the
 * same posture `os migrate summary-nulls` takes. No `sys_migration` flag is
 * recorded: nothing gates irreversible behaviour on this rewrite.
 */

import {
  redactStoredMetadataBody,
  STORED_METADATA_BODY_COLUMN,
  STORED_METADATA_BODY_OBJECTS,
  STORED_METADATA_TYPE_COLUMN,
} from '@objectstack/spec/kernel';
import type { IDataEngine } from '@objectstack/spec/contracts';

/** The two audit-family tables this writer copies stored metadata bodies into. */
export const STORED_METADATA_BODY_AUDIT_OBJECTS = ['sys_audit_log', 'sys_activity'] as const;

/** The rewrite reads and writes as the platform, never as a user. */
const SYSTEM_CTX = { isSystem: true } as const;

/**
 * Redact the metadata body nested inside one parsed ledger snapshot — a
 * `sys_audit_log.new_value`/`old_value` object, or one half (`old` / `new`) of
 * a `sys_activity.metadata` pair. Returns the snapshot unchanged when it
 * carries no body, a copy with the body projected when it does, and a copy with
 * the body column DROPPED when the body cannot be judged (fail-closed).
 *
 * `typeHint` is consulted only when the snapshot subset carries no `type`
 * column of its own.
 */
export function redactLedgerSnapshotBody(
  snapshot: unknown,
  typeHint?: string,
): { changed: boolean; value: unknown } {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { changed: false, value: snapshot };
  }
  const record = snapshot as Record<string, unknown>;
  if (!(STORED_METADATA_BODY_COLUMN in record)) return { changed: false, value: snapshot };

  const ownType = record[STORED_METADATA_TYPE_COLUMN];
  const type = typeof ownType === 'string' && ownType !== '' ? ownType : typeHint;
  const outcome = redactStoredMetadataBody(type, record[STORED_METADATA_BODY_COLUMN]);
  if (outcome.ok) {
    if (outcome.body === record[STORED_METADATA_BODY_COLUMN]) return { changed: false, value: snapshot };
    return { changed: true, value: { ...record, [STORED_METADATA_BODY_COLUMN]: outcome.body } };
  }
  const { [STORED_METADATA_BODY_COLUMN]: _withheld, ...rest } = record;
  return { changed: true, value: rest };
}

/** Parse → redact → re-serialize one stored JSON string column. A non-string / unparseable value is left as-is. */
function redactSerializedSnapshot(
  serialized: unknown,
  typeHint?: string,
): { changed: boolean; value: unknown } {
  if (typeof serialized !== 'string' || serialized === '') return { changed: false, value: serialized };
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return { changed: false, value: serialized };
  }
  const { changed, value } = redactLedgerSnapshotBody(parsed, typeHint);
  if (!changed) return { changed: false, value: serialized };
  return { changed: true, value: JSON.stringify(value) };
}

/**
 * The patch for one `sys_audit_log` row about a stored-metadata-body object, or
 * `null` when the row holds no credential body to rewrite.
 */
export function planAuditRowPatch(
  row: Record<string, unknown>,
  typeHint?: string,
): { new_value?: unknown; old_value?: unknown } | null {
  const patch: { new_value?: unknown; old_value?: unknown } = {};
  const nv = redactSerializedSnapshot(row.new_value, typeHint);
  if (nv.changed) patch.new_value = nv.value;
  const ov = redactSerializedSnapshot(row.old_value, typeHint);
  if (ov.changed) patch.old_value = ov.value;
  return nv.changed || ov.changed ? patch : null;
}

/**
 * The patch for one `sys_activity` row about a stored-metadata-body object, or
 * `null` when it holds no credential body. `sys_activity.metadata` is the
 * serialized pair `{ old, new }`, each half a ledger snapshot.
 */
export function planActivityRowPatch(
  row: Record<string, unknown>,
  typeHint?: string,
): { metadata: string } | null {
  const serialized = row.metadata;
  if (typeof serialized !== 'string' || serialized === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const pair = parsed as Record<string, unknown>;
  const oldR = redactLedgerSnapshotBody(pair.old, typeHint);
  const newR = redactLedgerSnapshotBody(pair.new, typeHint);
  if (!oldR.changed && !newR.changed) return null;
  return { metadata: JSON.stringify({ ...pair, old: oldR.value, new: newR.value }) };
}

/**
 * The engine surface the runner needs — the REAL data-engine contract's three
 * members, picked rather than re-declared, so every call below is checked
 * against the signatures the engine actually serves (`update` takes the row's
 * `id` INSIDE `data`, and the execution context rides the trailing options).
 */
export type StoredMetadataBodyMigrationEngine = Pick<IDataEngine, 'find' | 'findOne' | 'update'>;

/** Log sink — the guaranteed `warn` fallback plus optional `info` (#9754 shape). */
export interface MigrationLogger {
  info?(message: string): void;
  warn(message: string): void;
}

/** What one migration run did (or would do in dry-run). */
export interface StoredMetadataBodyMigrationReport {
  apply: boolean;
  /** Per audit-family object: rows scanned and rows rewritten (or that would be). */
  readonly byObject: Record<string, { scanned: number; rewritten: number }>;
  /** Rows a planner changed, total across the two tables. */
  rewritten: number;
  /** Rows read, total. */
  scanned: number;
  /** Rows an `update` threw on (apply mode) — re-run to finish them. */
  failures: number;
}

function asArray(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === 'object' && Array.isArray((result as { records?: unknown }).records)) {
    return (result as { records: Record<string, unknown>[] }).records;
  }
  return [];
}

/**
 * Rewrite every `sys_audit_log` / `sys_activity` row that copied a stored
 * metadata body in cleartext, projecting the body through the shared redactor.
 * Dry-run by default; `apply` writes. Idempotent.
 */
export async function migrateStoredMetadataBodyCopies(
  engine: StoredMetadataBodyMigrationEngine,
  logger: MigrationLogger,
  options: { apply?: boolean } = {},
): Promise<StoredMetadataBodyMigrationReport> {
  const apply = options.apply === true;
  const report: StoredMetadataBodyMigrationReport = {
    apply,
    byObject: {},
    rewritten: 0,
    scanned: 0,
    failures: 0,
  };

  // Best-effort `record_id` → metadata `type` resolver: an update diff snapshot
  // may carry no `type` column, so the live `sys_metadata` row answers it when
  // it still exists. A miss leaves the planner to fail closed.
  const typeCache = new Map<string, string | undefined>();
  const resolveType = async (recordId: unknown): Promise<string | undefined> => {
    if (typeof recordId !== 'string' || recordId === '') return undefined;
    if (typeCache.has(recordId)) return typeCache.get(recordId);
    let type: string | undefined;
    try {
      const row = await engine.findOne('sys_metadata', { where: { id: recordId } }, { context: SYSTEM_CTX });
      const t = row?.[STORED_METADATA_TYPE_COLUMN];
      type = typeof t === 'string' && t !== '' ? t : undefined;
    } catch {
      type = undefined;
    }
    typeCache.set(recordId, type);
    return type;
  };

  for (const object of STORED_METADATA_BODY_AUDIT_OBJECTS) {
    report.byObject[object] = { scanned: 0, rewritten: 0 };
    let rows: Record<string, unknown>[];
    try {
      const result = await engine.find(
        object,
        { where: { object_name: { $in: [...STORED_METADATA_BODY_OBJECTS] } } },
        { context: SYSTEM_CTX },
      );
      rows = asArray(result);
    } catch (e) {
      // A table this run could not read is NOT a clean table: counted as a
      // failure so the run says so (and the command exits non-zero) instead of
      // reporting "nothing to rewrite" for rows it never looked at.
      report.failures += 1;
      logger.warn(
        `[stored-metadata-body-migration] could not read ${object} — its rows were NOT examined: ` +
          `${(e as Error)?.message ?? String(e)}`,
      );
      continue;
    }

    for (const row of rows) {
      report.scanned += 1;
      report.byObject[object].scanned += 1;
      const typeHint = await resolveType(row.record_id);
      const patch =
        object === 'sys_audit_log' ? planAuditRowPatch(row, typeHint) : planActivityRowPatch(row, typeHint);
      if (!patch) continue;
      report.rewritten += 1;
      report.byObject[object].rewritten += 1;
      if (!apply) continue;
      const id = row.id;
      if (typeof id !== 'string' || id === '') {
        report.failures += 1;
        logger.warn(`[stored-metadata-body-migration] ${object} row has no id — cannot rewrite`);
        continue;
      }
      try {
        // A single-id write: the engine reads the target from `data.id`. Run as
        // the platform — a system caller is exempt from the static-readonly
        // strip every audit/activity field carries, so the rewrite is stored.
        await engine.update(object, { ...patch, id }, { context: SYSTEM_CTX });
      } catch (e) {
        report.failures += 1;
        logger.warn(
          `[stored-metadata-body-migration] failed to rewrite ${object}/${id}: ${(e as Error)?.message ?? String(e)}`,
        );
      }
    }
  }

  logger.info?.(
    `[stored-metadata-body-migration] ${apply ? 'rewrote' : 'would rewrite'} ${report.rewritten} of ${report.scanned} ` +
      `audit/activity row(s) carrying a stored metadata body` +
      (report.failures > 0 ? ` (${report.failures} failed — re-run to finish)` : ''),
  );
  return report;
}
