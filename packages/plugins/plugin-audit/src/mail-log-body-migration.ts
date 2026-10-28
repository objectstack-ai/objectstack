// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24693] One-off rewrite of the mail-log bodies this plugin's writer copied
 * in clear before it masked them.
 *
 * `writeAudit` COPIES the audited row into `sys_audit_log.new_value` /
 * `old_value` and into both halves of `sys_activity.metadata`. For a
 * `sys_email` / `sys_identity_email` row that copy carried the mail BODY —
 * reset, verification, magic-link and invitation links included — into a
 * second, at-rest store. The writer masks those columns now (#24625,
 * `ledgerView`), but only on NEW writes: rows copied before keep the body in
 * clear. This module masks them, with the writer's own helper
 * ({@link maskMailLogBodyCopy}), so a repaired copy and a new one read the same.
 *
 * ## Every mail-log copy, never a selector
 *
 * Both logs are masked on every row, as the writer does: `sys_identity_email`
 * holds identity mail only, and the 18.0 identity rows still in `sys_email`
 * cannot be told apart from tenant mail by any column. So the rewrite needs no
 * identity selector and does not depend on the organization-ownership
 * ceremony: run before it, it masks the `sys_email` copies; run after it, the
 * activity copies the ceremony re-pointed name `sys_identity_email`, which is
 * masked the same. The `sys_audit_log` copies keep the object name they were
 * written under either way.
 *
 * ## Pure planner, driven runner
 *
 * The decision is pure ({@link planMailLogBodyAuditRowPatch} /
 * {@link planMailLogBodyActivityRowPatch}); {@link migrateMailLogBodyCopies}
 * pages the two tables through the engine and rewrites only the rows a planner
 * changed — and in a row, only the column holding the copy, under
 * `preserveAudit` with the row's stored `updated_at`, so no other column of the
 * row moves. Nothing else in the copy moves either: the other keys of the
 * snapshot and of the activity pair are re-serialized as they were read.
 *
 * ## Idempotent, its own verification
 *
 * A masked body is the mask, so a second run finds nothing to rewrite, and
 * re-running and reading a clean report is the check (the posture
 * `os migrate audit-metadata-bodies` takes). No `sys_migration` flag is
 * recorded: nothing gates irreversible behaviour on it. The report holds counts
 * only; no log line names a value.
 *
 * ## The archive, through the same runner
 *
 * `sys_audit_log` declares `lifecycle.archive`: the `LifecycleService`
 * Archiver copies its rows past the hot window to the archive datasource
 * VERBATIM (a driver `find` → `upsert`, no writer and no mask in between),
 * then deletes them hot. So a copy archived before the writer masked keeps the
 * body in clear for as long as the archive keeps it, and the engine never
 * routes `sys_audit_log` there: an engine-driven run cannot reach it.
 * {@link migrateArchivedMailLogBodyCopies} drives the very same pages and
 * planners through the archive datasource's DRIVER instead. A hot copy masked
 * before the Archiver moves it is archived masked, so the hot run and the
 * archive run together cover the copies already archived and the ones still
 * to be.
 */

import type { IDataDriver, IDataEngine } from '@objectstack/spec/contracts';
import { isMissingTableError } from '@objectstack/types';
import { MAIL_LOG_OBJECTS } from '@objectstack/platform-objects/audit';
import { maskMailLogBodyCopy } from './mail-log-body-mask.js';
import type { MigrationLogger } from './stored-metadata-body-migration.js';

/** The two audit-family tables the writer copies a mail-log row into. */
export const MAIL_LOG_BODY_COPY_OBJECTS = ['sys_audit_log', 'sys_activity'] as const;

/** One of {@link MAIL_LOG_BODY_COPY_OBJECTS}. */
export type MailLogBodyCopyObject = (typeof MAIL_LOG_BODY_COPY_OBJECTS)[number];

/** Rows read per page. */
export const MAIL_LOG_BODY_MIGRATION_PAGE_SIZE = 500;

/** The rewrite reads as the platform, and writes as the platform keeping each row's audit stamp. */
const SYSTEM_CTX = { isSystem: true } as const;
const SYSTEM_PRESERVING_CTX = { isSystem: true, preserveAudit: true } as const;

/**
 * Mask the body columns of one parsed snapshot of an `objectName` row. A
 * non-object, or a snapshot with no clear body, comes back unchanged.
 */
function maskedSnapshot(objectName: unknown, snapshot: unknown): { changed: boolean; value: unknown } {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return { changed: false, value: snapshot };
  const copy = { ...(snapshot as Record<string, unknown>) };
  return maskMailLogBodyCopy(objectName, copy) ? { changed: true, value: copy } : { changed: false, value: snapshot };
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
 * The patch for one `sys_audit_log` row about a mail log — its `new_value`
 * (create, and the after half of an update diff) and `old_value` (delete, and
 * the before half) with each clear body masked — or `null` when the row is
 * about another object or holds no clear body.
 */
export function planMailLogBodyAuditRowPatch(
  row: Record<string, unknown>,
): { new_value?: unknown; old_value?: unknown } | null {
  const patch: { new_value?: unknown; old_value?: unknown } = {};
  for (const column of ['new_value', 'old_value'] as const) {
    const out = rewriteSerialized(row[column], (parsed) => maskedSnapshot(row.object_name, parsed));
    if (out.changed) patch[column] = out.value;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * The patch for one `sys_activity` row about a mail log — the serialized pair
 * `{ old, new }` with each half's clear body masked, every other key of the
 * pair kept — or `null` when the row is about another object or holds no clear
 * body.
 */
export function planMailLogBodyActivityRowPatch(row: Record<string, unknown>): { metadata: unknown } | null {
  const out = rewriteSerialized(row.metadata, (parsed) => {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { changed: false, value: parsed };
    const pair = parsed as Record<string, unknown>;
    const next: Record<string, unknown> = { ...pair };
    let changed = false;
    for (const half of ['old', 'new'] as const) {
      if (!(half in pair)) continue;
      const masked = maskedSnapshot(row.object_name, pair[half]);
      if (!masked.changed) continue;
      next[half] = masked.value;
      changed = true;
    }
    return { changed, value: changed ? next : parsed };
  });
  return out.changed ? { metadata: out.value } : null;
}

/** The engine surface the runner needs — the real data-engine contract's members. */
export type MailLogBodyMigrationEngine = Pick<IDataEngine, 'find' | 'update'>;

/** The driver surface the archive run needs — the real data-driver contract's members. */
export type MailLogBodyArchiveDriver = Pick<IDataDriver, 'find' | 'update'>;

/** What the runner options accept, for either store. */
export interface MailLogBodyMigrationOptions {
  apply?: boolean;
  pageSize?: number;
  /** The copy tables to walk — both by default. */
  objects?: readonly MailLogBodyCopyObject[];
}

/**
 * The two operations a run performs, whatever store it runs on: read one page
 * of `object`, and write one row's patch keeping its stored `updated_at`.
 *
 * Exported, with the two stores and the runner below, because this is the ONE
 * ledger-copy rewrite: the key-material rewrite (`key-material-copy-migration.ts`)
 * drives the same pages, stores and runner with its own list and planners, so
 * the two never disagree about paging, the write's context or what counts as
 * a failure.
 */
export interface LedgerCopyStore {
  readPage(object: string, query: { where: Record<string, unknown>; fields: string[]; orderBy: Array<{ field: string; order: 'asc' }>; limit: number }): Promise<unknown>;
  write(object: string, id: string, patch: Record<string, unknown>, updatedAt: unknown): Promise<void>;
}

/** What one migration run did (or would do in dry-run). Counts only. */
export interface MailLogBodyMigrationReport {
  apply: boolean;
  /** Per copy table: mail-log copy rows read, and rows rewritten (or that would be). */
  readonly byObject: Record<string, { scanned: number; rewritten: number }>;
  /** Mail-log copy rows read, total. */
  scanned: number;
  /** Rows holding a clear body, total — rewritten under `apply`. */
  rewritten: number;
  /** A failed read, or a row an `update` threw on (apply mode) — re-run to finish. */
  failures: number;
}

/** What a ledger-copy rewrite decides and says: the objects whose copies it reads, its two planners, and its log lines. */
export interface LedgerCopyRewriteSpec {
  /** The `object_name` values whose copies a run reads. */
  objectNames: readonly string[];
  planAudit: (row: Record<string, unknown>) => Record<string, unknown> | null;
  planActivity: (row: Record<string, unknown>) => Record<string, unknown> | null;
  /** The bracketed prefix of every log line. */
  tag: string;
  /** The run's one closing line. */
  summary: (report: MailLogBodyMigrationReport, label: string) => string;
}

function asArray(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === 'object' && Array.isArray((result as { records?: unknown }).records)) {
    return (result as { records: Record<string, unknown>[] }).records;
  }
  return [];
}

/** The hot store: the two copy tables through the engine. */
export function ledgerCopyStoreOverEngine(engine: MailLogBodyMigrationEngine): LedgerCopyStore {
  return {
    readPage: (object, query) => engine.find(object, query, { context: SYSTEM_CTX }),
    // A single-id write, as the platform: a system caller is exempt from the
    // static-readonly strip every audit/activity field carries.
    // `preserveAudit` with the stored `updated_at` keeps the row's own
    // timestamp (the shape `comment-parent-pair-backfill.ts` takes): masking
    // a copy is not an edit of the ledger row.
    write: async (object, id, patch, updatedAt) => {
      await engine.update(
        object,
        { ...patch, id, ...(updatedAt !== undefined && updatedAt !== null ? { updated_at: updatedAt } : {}) },
        { context: SYSTEM_PRESERVING_CTX },
      );
    },
  };
}

/**
 * The archive store: `driver` is the archive datasource's registered driver
 * (`engine.datasource(name)`); reads and writes go through it directly, as the
 * Archiver itself does: no hook, no audit write, and the row's stored
 * `updated_at` kept (`preserveAudit`). An archive table that was never created
 * (nothing archived yet) holds no copy and reads as no rows; any other refused
 * read is a failure, as on the hot run.
 */
export function ledgerCopyStoreOverArchiveDriver(driver: MailLogBodyArchiveDriver): LedgerCopyStore {
  return {
    readPage: async (object, query) => {
      try {
        return await driver.find(object, query as Parameters<MailLogBodyArchiveDriver['find']>[1]);
      } catch (e) {
        if (isMissingTableError(e, object)) return [];
        throw e;
      }
    },
    write: async (object, id, patch, updatedAt) => {
      const keep = updatedAt !== undefined && updatedAt !== null;
      await driver.update(object, id, { ...patch, ...(keep ? { updated_at: updatedAt } : {}) }, keep ? { preserveAudit: true } : undefined);
    },
  };
}

/** The mail-log rewrite's list, planners and words. */
const MAIL_LOG_BODY_REWRITE: LedgerCopyRewriteSpec = {
  objectNames: MAIL_LOG_OBJECTS,
  planAudit: planMailLogBodyAuditRowPatch,
  planActivity: planMailLogBodyActivityRowPatch,
  tag: '[mail-log-body-migration]',
  summary: (report, label) =>
    `[mail-log-body-migration] ${report.apply ? 'masked' : 'would mask'} the mail body in ${report.rewritten} of ` +
    `${report.scanned} ${label} cop(ies) of a mail-log row` +
    (report.failures > 0 ? ` (${report.failures} failed — re-run to finish)` : ''),
};

/**
 * Mask the mail-log body in every `sys_audit_log` / `sys_activity` copy of a
 * `sys_email` or `sys_identity_email` row that still holds it in clear.
 * Dry-run by default; `apply` writes. Idempotent.
 */
export async function migrateMailLogBodyCopies(
  engine: MailLogBodyMigrationEngine,
  logger: MigrationLogger,
  options: MailLogBodyMigrationOptions = {},
): Promise<MailLogBodyMigrationReport> {
  return runLedgerCopyRewrite(ledgerCopyStoreOverEngine(engine), logger, options, 'audit/activity', MAIL_LOG_BODY_REWRITE);
}

/**
 * The same mask over an ARCHIVE datasource — the store `sys_audit_log`'s
 * `lifecycle.archive.to` names, which the Archiver fills with verbatim copies
 * and the engine never routes the object to ({@link ledgerCopyStoreOverArchiveDriver}).
 */
export async function migrateArchivedMailLogBodyCopies(
  driver: MailLogBodyArchiveDriver,
  logger: MigrationLogger,
  options: MailLogBodyMigrationOptions = {},
): Promise<MailLogBodyMigrationReport> {
  return runLedgerCopyRewrite(ledgerCopyStoreOverArchiveDriver(driver), logger, options, 'archived audit', MAIL_LOG_BODY_REWRITE);
}

/**
 * Page the two copy tables of `store` for the copies of `spec.objectNames`, and
 * rewrite every row a planner changed (only under `apply`). Keyset paging on
 * `id`; a table it could not read, a row with no id and a write that threw are
 * each counted as a failure, never read as clean.
 */
export async function runLedgerCopyRewrite(
  store: LedgerCopyStore,
  logger: MigrationLogger,
  options: { apply?: boolean; pageSize?: number; objects?: readonly MailLogBodyCopyObject[] },
  label: string,
  spec: LedgerCopyRewriteSpec,
): Promise<MailLogBodyMigrationReport> {
  const apply = options.apply === true;
  const pageSize = options.pageSize && options.pageSize > 0 ? options.pageSize : MAIL_LOG_BODY_MIGRATION_PAGE_SIZE;
  const only = options.objects ? new Set<string>(options.objects) : undefined;
  const report: MailLogBodyMigrationReport = { apply, byObject: {}, scanned: 0, rewritten: 0, failures: 0 };

  const tables: ReadonlyArray<{
    object: MailLogBodyCopyObject;
    fields: readonly string[];
    plan: (row: Record<string, unknown>) => Record<string, unknown> | null;
  }> = [
    { object: 'sys_audit_log' as const, fields: ['id', 'object_name', 'new_value', 'old_value', 'updated_at'], plan: spec.planAudit },
    { object: 'sys_activity' as const, fields: ['id', 'object_name', 'metadata', 'updated_at'], plan: spec.planActivity },
  ].filter((t) => !only || only.has(t.object));

  for (const { object, fields, plan } of tables) {
    const stats = (report.byObject[object] = { scanned: 0, rewritten: 0 });
    // Keyset paging on `id`: a rewritten row keeps its id and is never read
    // twice in one run.
    let after: string | undefined;
    for (;;) {
      const copies: Record<string, unknown> = { object_name: { $in: [...spec.objectNames] } };
      const where = after === undefined ? copies : { $and: [copies, { id: { $gt: after } }] };
      let rows: Record<string, unknown>[];
      try {
        rows = asArray(
          await store.readPage(object, { where, fields: [...fields], orderBy: [{ field: 'id', order: 'asc' }], limit: pageSize }),
        );
      } catch (e) {
        // A table this run could not read is NOT a clean table: counted, so the
        // run says so (and the door exits non-zero).
        report.failures += 1;
        logger.warn(
          `${spec.tag} could not read ${object} — its remaining rows were NOT examined: ` +
            `${(e as Error)?.message ?? String(e)}`,
        );
        break;
      }
      if (rows.length === 0) break;

      for (const row of rows) {
        report.scanned += 1;
        stats.scanned += 1;
        const patch = plan(row);
        if (!patch) continue;
        report.rewritten += 1;
        stats.rewritten += 1;
        if (!apply) continue;
        const id = row.id;
        if (typeof id !== 'string' || id === '') {
          report.failures += 1;
          logger.warn(`${spec.tag} ${object} row has no id — cannot rewrite it`);
          continue;
        }
        try {
          await store.write(object, id, patch, row.updated_at);
        } catch (e) {
          report.failures += 1;
          logger.warn(
            `${spec.tag} failed to rewrite ${object}/${id}: ${(e as Error)?.message ?? String(e)}`,
          );
        }
      }

      const last = rows[rows.length - 1]?.id;
      if (rows.length < pageSize || typeof last !== 'string' || last === '') break;
      after = last;
    }
  }

  logger.info?.(spec.summary(report, label));
  return report;
}
