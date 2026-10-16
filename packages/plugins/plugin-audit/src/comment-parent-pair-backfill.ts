// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 E7] The stored-row backfill of `sys_comment`'s writer-stamped
 * parent pair, `object_name` + `record_id`.
 *
 * Rows written before the pair existed carry none, and the comment-thread read
 * gate (`comment-access-hooks.ts`, `installCommentReadVisibility`) answers
 * such a row with the bounded thread probe — at most 2,000 candidate rows per
 * read, fail closed — never a `ReadableIds` leaf. So until this runs, a broad
 * comment read past that window omits comments the caller may read, and its
 * `total` agrees with the short answer. `os migrate comment-parent-pair` is
 * its door.
 *
 * ## One derivation
 *
 * Each row is stamped by {@link planCommentParentPair}, the planner the create
 * and re-point stamps use, so a stored row and a new row with the same
 * `thread_id` carry the same pair.
 *
 * ## As the platform, through the migration door
 *
 * Rows are read and updated as the platform (a SYSTEM context), the shape of
 * `stored-metadata-body-migration.ts` and E6's activity backfill. The update
 * names the pair and the row's stored `updated_at` under `preserveAudit`, so
 * the backfill changes no comment's `updated_at` and names no `thread_id` or
 * `body` (no re-point, no edit stamp). A row whose thread names no record is
 * not stamped (its pair stays `null`, and it stays hidden from every
 * non-system reader); the report counts it.
 *
 * ## Idempotent, its own verification
 *
 * Only unstamped rows (`object_name` NULL) are read, so a second run finds
 * nothing to stamp but the threads that name no record, and re-running and
 * reading a clean report is the check. No `sys_migration` flag is recorded:
 * nothing gates irreversible behaviour on it. The walk pages by `id`.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import {
  COMMENT_PARENT_OBJECT_COLUMN,
  COMMENT_PARENT_RECORD_COLUMN,
  planCommentParentPair,
} from './comment-access-hooks.js';
import type { MigrationLogger } from './stored-metadata-body-migration.js';

const COMMENT_OBJECT = 'sys_comment';

/** The backfill reads as the platform, and writes as the platform keeping each row's audit stamp. */
const SYSTEM_CTX = { isSystem: true } as const;
const SYSTEM_PRESERVING_CTX = { isSystem: true, preserveAudit: true } as const;

/** Rows read per page. */
export const COMMENT_PARENT_PAIR_BACKFILL_PAGE_SIZE = 500;

/** The engine surface the runner needs — the real data-engine contract's members. */
export type CommentParentPairBackfillEngine = Pick<IDataEngine, 'find' | 'update'>;

/** What one backfill run did (or would do in dry-run). */
export interface CommentParentPairBackfillReport {
  apply: boolean;
  /** Unstamped rows read. */
  scanned: number;
  /** Rows the planner stamped (or would stamp). */
  stamped: number;
  /** Unstamped rows whose thread names no record: they stay unstamped (hidden). */
  unparented: number;
  /** A failed read, or a row an `update` threw on (apply mode) — re-run to finish. */
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
 * Stamp `object_name` and `record_id` on every unstamped `sys_comment` row.
 * Dry-run by default; `apply` writes. Idempotent.
 */
export async function backfillCommentParentPair(
  engine: CommentParentPairBackfillEngine,
  logger: MigrationLogger,
  options: { apply?: boolean; pageSize?: number } = {},
): Promise<CommentParentPairBackfillReport> {
  const apply = options.apply === true;
  const pageSize = options.pageSize && options.pageSize > 0 ? options.pageSize : COMMENT_PARENT_PAIR_BACKFILL_PAGE_SIZE;
  const report: CommentParentPairBackfillReport = { apply, scanned: 0, stamped: 0, unparented: 0, failures: 0 };

  // Keyset paging on `id`: a stamped row leaves the unstamped set, an
  // unparented one stays in it, and neither is read twice in one run.
  let after: string | undefined;
  for (;;) {
    const unstamped: Record<string, unknown> = { [COMMENT_PARENT_OBJECT_COLUMN]: { $null: true } };
    const where = after === undefined ? unstamped : { $and: [unstamped, { id: { $gt: after } }] };
    let rows: Record<string, unknown>[];
    try {
      rows = asArray(
        await engine.find(
          COMMENT_OBJECT,
          {
            where,
            fields: ['id', 'thread_id', 'updated_at'],
            orderBy: [{ field: 'id', order: 'asc' }],
            limit: pageSize,
          },
          { context: SYSTEM_CTX },
        ),
      );
    } catch (e) {
      // A table this run could not read is NOT a clean table: counted, so the
      // run says so (and the door exits non-zero).
      report.failures += 1;
      logger.warn(
        `[comment-parent-pair-backfill] could not read ${COMMENT_OBJECT} — its remaining rows were NOT ` +
          `examined: ${(e as Error)?.message ?? String(e)}`,
      );
      break;
    }
    if (rows.length === 0) break;

    for (const row of rows) {
      report.scanned += 1;
      const pair = planCommentParentPair(row.thread_id);
      if (pair.object_name === null) {
        report.unparented += 1;
        continue;
      }
      report.stamped += 1;
      if (!apply) continue;
      const id = row.id;
      if (typeof id !== 'string' || id === '') {
        report.failures += 1;
        logger.warn(`[comment-parent-pair-backfill] ${COMMENT_OBJECT} row has no id — cannot stamp it`);
        continue;
      }
      try {
        // A single-id write, as the platform. `preserveAudit` with the stored
        // `updated_at` keeps the row's own timestamp: stamping a derived
        // pointer is not an edit of the comment.
        await engine.update(
          COMMENT_OBJECT,
          {
            id,
            [COMMENT_PARENT_OBJECT_COLUMN]: pair.object_name,
            [COMMENT_PARENT_RECORD_COLUMN]: pair.record_id,
            ...(row.updated_at !== undefined && row.updated_at !== null ? { updated_at: row.updated_at } : {}),
          },
          { context: SYSTEM_PRESERVING_CTX },
        );
      } catch (e) {
        report.failures += 1;
        logger.warn(
          `[comment-parent-pair-backfill] failed to stamp ${COMMENT_OBJECT}/${id}: ${(e as Error)?.message ?? String(e)}`,
        );
      }
    }

    const last = rows[rows.length - 1]?.id;
    if (rows.length < pageSize || typeof last !== 'string' || last === '') break;
    after = last;
  }

  logger.info?.(
    `[comment-parent-pair-backfill] ${apply ? 'stamped' : 'would stamp'} ${report.stamped} of ${report.scanned} ` +
      `unstamped ${COMMENT_OBJECT} row(s)` +
      (report.unparented > 0 ? `; ${report.unparented} name no record and stay unstamped (hidden)` : '') +
      (report.failures > 0 ? ` (${report.failures} failed — re-run to finish)` : ''),
  );
  return report;
}
