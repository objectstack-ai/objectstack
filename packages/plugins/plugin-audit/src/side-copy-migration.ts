// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32442, GHSA-2985-5f64-8wgh] One-off rewrite of the columns
 * `side-copy-columns.ts` lists out of the ledger copies written before the
 * writer omitted them (`ledgerView`), so a repaired copy and a new one read
 * the same. It is the key-material rewrite with a different list
 * (`key-material-copy-migration.ts`): the same shared runner and stores
 * (`mail-log-body-migration.ts`, {@link runLedgerCopyRewrite}), so the
 * rewrites never disagree about paging, the write's context, a sealed row
 * (amended first, or refused) or what is a failure. Dry-run by default,
 * idempotent, counts only.
 *
 * Until it has run, the serve-time redactions drop the columns and the query
 * guards refuse a query that names a carrying column (`side-copy-columns.ts`).
 */

import type { IDataDriver, IDataEngine } from '@objectstack/spec/contracts';
import type { AuditRedactionSeal } from './audit-seal/amendment-writer.js';
import { SIDE_COPY_OBJECTS, omitSideCopyFromCopy } from './side-copy-columns.js';
import {
  ledgerCopyStoreOverArchiveDriver,
  ledgerCopyStoreOverEngine,
  runLedgerCopyRewrite,
  type LedgerCopyRewriteSpec,
} from './mail-log-body-migration.js';
import type { MigrationLogger } from './stored-metadata-body-migration.js';

/** The two audit-family tables the writer copies a row into. */
export const SIDE_COPY_TABLES = ['sys_audit_log', 'sys_activity'] as const;

/** One of {@link SIDE_COPY_TABLES}. */
export type SideCopyTable = (typeof SIDE_COPY_TABLES)[number];

/** Omit the listed columns from one parsed snapshot. A non-object, or a snapshot without them, comes back unchanged. */
function omittedSnapshot(objectName: unknown, snapshot: unknown): { changed: boolean; value: unknown } {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return { changed: false, value: snapshot };
  const copy = { ...(snapshot as Record<string, unknown>) };
  return omitSideCopyFromCopy(objectName, copy) ? { changed: true, value: copy } : { changed: false, value: snapshot };
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
 * the listed columns removed — or `null` when the row is about an object
 * the list does not name or holds none of them.
 */
export function planSideCopyAuditRowPatch(
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
 * with each half's listed columns removed, every other key of the pair
 * kept — or `null` when the row needs none.
 */
export function planSideCopyActivityRowPatch(row: Record<string, unknown>): { metadata: unknown } | null {
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
export type SideCopyMigrationEngine = Pick<IDataEngine, 'find' | 'update'>;

/** The driver surface the archive run needs — the real data-driver contract's members. */
export type SideCopyArchiveDriver = Pick<IDataDriver, 'find' | 'update'>;

/** What the runner options accept, for either store. */
export interface SideCopyMigrationOptions {
  apply?: boolean;
  pageSize?: number;
  /** The copy tables to walk — both by default. */
  objects?: readonly SideCopyTable[];
  /**
   * [ADR-0154 D7] What amending a sealed row takes. Every shipped caller
   * passes it; without it a row is rewritten with no amendment, and a sealed
   * one then reads `modified` in `os audit verify`.
   */
  seal?: AuditRedactionSeal;
}

/** What one migration run did (or would do in dry-run). Counts only. */
export interface SideCopyMigrationReport {
  apply: boolean;
  /** Per copy table: copy rows read, rows rewritten (or that would be), and sealed rows refused. */
  readonly byObject: Record<string, { scanned: number; rewritten: number; refused: number }>;
  /** Copy rows read, total. */
  scanned: number;
  /** Rows holding a listed column, total — rewritten under `apply`. */
  rewritten: number;
  /**
   * [ADR-0154 D7] Sealed rows left as they are because their redaction
   * amendment cannot be written — not counted in `rewritten`.
   */
  refused: number;
  /** A failed read, or a row an `update` threw on (apply mode) — re-run to finish. */
  failures: number;
}

/** The side-copy rewrite's list, planners and words; its CLI door is owed (`os migrate audit-side-copies`). */
const SIDE_COPY_REWRITE: LedgerCopyRewriteSpec = {
  objectNames: SIDE_COPY_OBJECTS,
  planAudit: planSideCopyAuditRowPatch,
  planActivity: planSideCopyActivityRowPatch,
  migration: 'os migrate audit-side-copies',
  tag: '[side-copy-migration]',
  summary: (report, label) =>
    `[side-copy-migration] ${report.apply ? 'removed' : 'would remove'} listed columns from ${report.rewritten} of ` +
    `${report.scanned} ${label} cop(ies)` +
    (report.refused > 0 ? ` (${report.refused} sealed row(s) refused: no amendment could be written)` : '') +
    (report.failures > 0 ? ` (${report.failures} failed — re-run to finish)` : ''),
};

/**
 * Remove the listed columns from every `sys_audit_log` / `sys_activity`
 * copy of a listed object's row that still holds them. Dry-run by default;
 * `apply` writes, as the platform, keeping each row's stored `updated_at`.
 * Idempotent.
 */
export async function migrateSideCopies(
  engine: SideCopyMigrationEngine,
  logger: MigrationLogger,
  options: SideCopyMigrationOptions = {},
): Promise<SideCopyMigrationReport> {
  return runLedgerCopyRewrite(ledgerCopyStoreOverEngine(engine), logger, options, 'audit/activity', SIDE_COPY_REWRITE);
}

/**
 * The same rewrite over an ARCHIVE datasource — the store `sys_audit_log`'s
 * `lifecycle.archive.to` names — through that datasource's registered driver,
 * as the Archiver reads and writes it. An archive table that was never created
 * reads as no rows; any other refused read is a failure, as on the hot run.
 */
export async function migrateArchivedSideCopies(
  driver: SideCopyArchiveDriver,
  logger: MigrationLogger,
  options: SideCopyMigrationOptions = {},
): Promise<SideCopyMigrationReport> {
  return runLedgerCopyRewrite(ledgerCopyStoreOverArchiveDriver(driver), logger, options, 'archived audit', SIDE_COPY_REWRITE);
}
