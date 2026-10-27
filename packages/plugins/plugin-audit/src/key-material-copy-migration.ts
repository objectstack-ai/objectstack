// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One-off rewrite of the key material this plugin's writer copied into the
 * ledger before it omitted it.
 *
 * `writeAudit` COPIES the audited row into `sys_audit_log.new_value` /
 * `old_value` and into both halves of `sys_activity.metadata`. For the objects
 * `key-material-copy.ts` lists, that copy carried an encrypted-key-material
 * column into a second, at-rest store, and kept it after the source row was
 * rotated or deleted. The writer omits those columns now (`ledgerView`), but
 * only on NEW writes: rows copied before keep them. This module removes them,
 * with the writer's own helper ({@link omitKeyMaterialFromCopy}), so a repaired
 * copy and a new one read the same. It is the mail-log body rewrite's runner
 * and stores (`mail-log-body-migration.ts`, {@link runLedgerCopyRewrite}),
 * driven with a different list and planners: one ledger-copy rewrite, so the
 * two never disagree about paging, the write's context or what is a failure.
 *
 * ## Pure planner, driven runner
 *
 * The decision is pure ({@link planKeyMaterialAuditRowPatch} /
 * {@link planKeyMaterialActivityRowPatch}); {@link migrateKeyMaterialCopies}
 * pages the two tables through the engine (the shared runner) and rewrites only
 * the rows a planner changed — and in a row, only the column holding the copy, under
 * `preserveAudit` with the row's stored `updated_at`, so no other column of the
 * row moves. Nothing else in the copy moves either: the other keys of the
 * snapshot and of the activity pair are re-serialized as they were read.
 *
 * ## Idempotent, its own verification
 *
 * A copy without the columns has nothing to remove, so a second run finds
 * nothing to rewrite, and re-running and reading a clean report is the check.
 * No `sys_migration` flag is recorded: nothing gates irreversible behaviour on
 * it. The report holds counts only; no log line names a value.
 *
 * ## The archive, through the same runner
 *
 * `sys_audit_log` declares `lifecycle.archive`: the Archiver copies its rows
 * past the hot window to the archive datasource VERBATIM, and the engine never
 * routes `sys_audit_log` there. {@link migrateArchivedKeyMaterialCopies} drives
 * the very same pages and planners through the archive datasource's DRIVER, as
 * the mail-log rewrite does.
 */

import type { IDataDriver, IDataEngine } from '@objectstack/spec/contracts';
import { KEY_MATERIAL_COPY_OBJECTS, omitKeyMaterialFromCopy } from './key-material-copy.js';
import {
  ledgerCopyStoreOverArchiveDriver,
  ledgerCopyStoreOverEngine,
  runLedgerCopyRewrite,
  type LedgerCopyRewriteSpec,
} from './mail-log-body-migration.js';
import type { MigrationLogger } from './stored-metadata-body-migration.js';

/** The two audit-family tables the writer copies a row into. */
export const KEY_MATERIAL_COPY_TABLES = ['sys_audit_log', 'sys_activity'] as const;

/** One of {@link KEY_MATERIAL_COPY_TABLES}. */
export type KeyMaterialCopyTable = (typeof KEY_MATERIAL_COPY_TABLES)[number];


/** Omit the key-material columns from one parsed snapshot. A non-object, or a snapshot without them, comes back unchanged. */
function omittedSnapshot(objectName: unknown, snapshot: unknown): { changed: boolean; value: unknown } {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return { changed: false, value: snapshot };
  const copy = { ...(snapshot as Record<string, unknown>) };
  return omitKeyMaterialFromCopy(objectName, copy) ? { changed: true, value: copy } : { changed: false, value: snapshot };
}

/** Parse → apply `step` → re-serialize one stored JSON string column. A non-string / unparseable value is left as-is. */
function rewriteSerialized(
  serialized: unknown,
  step: (parsed: unknown) => { changed: boolean; value: unknown },
): { changed: boolean; value: unknown } {
  if (typeof serialized !== 'string' || serialized === '') return { changed: false, value: serialized };
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return { changed: false, value: serialized };
  }
  const { changed, value } = step(parsed);
  return changed ? { changed: true, value: JSON.stringify(value) } : { changed: false, value: serialized };
}

/**
 * The patch for one `sys_audit_log` row — its `new_value` and `old_value` with
 * the key-material columns removed — or `null` when the row is about an object
 * the list does not name or holds none of them.
 */
export function planKeyMaterialAuditRowPatch(
  row: Record<string, unknown>,
): { new_value?: unknown; old_value?: unknown } | null {
  const patch: { new_value?: unknown; old_value?: unknown } = {};
  for (const column of ['new_value', 'old_value'] as const) {
    const out = rewriteSerialized(row[column], (parsed) => omittedSnapshot(row.object_name, parsed));
    if (out.changed) patch[column] = out.value;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * The patch for one `sys_activity` row — the serialized pair `{ old, new }`
 * with each half's key-material columns removed, every other key of the pair
 * kept — or `null` when the row needs none.
 */
export function planKeyMaterialActivityRowPatch(row: Record<string, unknown>): { metadata: unknown } | null {
  const out = rewriteSerialized(row.metadata, (parsed) => {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { changed: false, value: parsed };
    const pair = parsed as Record<string, unknown>;
    const next: Record<string, unknown> = { ...pair };
    let changed = false;
    for (const half of ['old', 'new'] as const) {
      if (!(half in pair)) continue;
      const omitted = omittedSnapshot(row.object_name, pair[half]);
      if (!omitted.changed) continue;
      next[half] = omitted.value;
      changed = true;
    }
    return { changed, value: changed ? next : parsed };
  });
  return out.changed ? { metadata: out.value } : null;
}

/** The engine surface the runner needs — the real data-engine contract's members. */
export type KeyMaterialMigrationEngine = Pick<IDataEngine, 'find' | 'update'>;

/** The driver surface the archive run needs — the real data-driver contract's members. */
export type KeyMaterialArchiveDriver = Pick<IDataDriver, 'find' | 'update'>;

/** What the runner options accept, for either store. */
export interface KeyMaterialMigrationOptions {
  apply?: boolean;
  pageSize?: number;
  /** The copy tables to walk — both by default. */
  objects?: readonly KeyMaterialCopyTable[];
}

/** What one migration run did (or would do in dry-run). Counts only. */
export interface KeyMaterialMigrationReport {
  apply: boolean;
  /** Per copy table: copy rows read, and rows rewritten (or that would be). */
  readonly byObject: Record<string, { scanned: number; rewritten: number }>;
  /** Copy rows read, total. */
  scanned: number;
  /** Rows holding key material, total — rewritten under `apply`. */
  rewritten: number;
  /** A failed read, or a row an `update` threw on (apply mode) — re-run to finish. */
  failures: number;
}

/** The key-material rewrite's list, planners and words. */
const KEY_MATERIAL_REWRITE: LedgerCopyRewriteSpec = {
  objectNames: KEY_MATERIAL_COPY_OBJECTS,
  planAudit: planKeyMaterialAuditRowPatch,
  planActivity: planKeyMaterialActivityRowPatch,
  tag: '[key-material-copy-migration]',
  summary: (report, label) =>
    `[key-material-copy-migration] ${report.apply ? 'removed' : 'would remove'} key material from ${report.rewritten} of ` +
    `${report.scanned} ${label} cop(ies)` +
    (report.failures > 0 ? ` (${report.failures} failed — re-run to finish)` : ''),
};

/**
 * Remove the key-material columns from every `sys_audit_log` / `sys_activity`
 * copy of a listed object's row that still holds them. Dry-run by default;
 * `apply` writes, as the platform, keeping each row's stored `updated_at`.
 * Idempotent.
 */
export async function migrateKeyMaterialCopies(
  engine: KeyMaterialMigrationEngine,
  logger: MigrationLogger,
  options: KeyMaterialMigrationOptions = {},
): Promise<KeyMaterialMigrationReport> {
  return runLedgerCopyRewrite(ledgerCopyStoreOverEngine(engine), logger, options, 'audit/activity', KEY_MATERIAL_REWRITE);
}

/**
 * The same rewrite over an ARCHIVE datasource — the store `sys_audit_log`'s
 * `lifecycle.archive.to` names — through that datasource's registered driver,
 * as the Archiver reads and writes it. An archive table that was never created
 * reads as no rows; any other refused read is a failure, as on the hot run.
 */
export async function migrateArchivedKeyMaterialCopies(
  driver: KeyMaterialArchiveDriver,
  logger: MigrationLogger,
  options: KeyMaterialMigrationOptions = {},
): Promise<KeyMaterialMigrationReport> {
  return runLedgerCopyRewrite(ledgerCopyStoreOverArchiveDriver(driver), logger, options, 'archived audit', KEY_MATERIAL_REWRITE);
}
