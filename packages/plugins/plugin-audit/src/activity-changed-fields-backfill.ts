// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D4, E6] The stored-row backfill of `sys_activity`'s two
 * writer-stamped columns, `changed_fields` and `milestone_key`.
 *
 * ADR-0139's Consequences: "`changed_fields` is a schema change on an
 * append-only engine-owned object, with a backfill a deployment must run".
 * Rows written before the columns existed carry no stamp, and the withheld-row
 * rule (`activity-field-redaction.ts`) withholds an unstamped row from every
 * non-system reader — so until this runs, a feed shows only the rows written
 * since the upgrade. `os migrate activity-changed-fields` is its door.
 *
 * ## One derivation
 *
 * Each row is stamped by {@link planActivityStamp}, the planner the CRUD
 * mirror and the before-insert hook stamp new rows with
 * (`activity-changed-fields.ts`), so a stored row and a new row with the same
 * metadata carry the same stamp. Both columns are written in one update.
 *
 * ## Through the migration door, never the CRUD write path
 *
 * The object is `managedBy: 'append-only'`; the rows are read and updated as
 * the platform (a SYSTEM context), the shape of
 * `stored-metadata-body-migration.ts`. A row the planner cannot judge keeps
 * no stamp, and so keeps the fail-closed answer it has today; the report
 * counts it.
 *
 * ## Idempotent, its own verification
 *
 * Only unstamped rows (`changed_fields` NULL) are read, so a second run finds
 * nothing to stamp but the rows it cannot judge, and re-running and reading a
 * clean report is the check. No `sys_migration` flag is recorded: nothing
 * gates irreversible behaviour on it. The walk pages by `id`, so a table of any
 * size is read a page at a time.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import {
  ACTIVITY_CHANGED_FIELDS_COLUMN,
  ACTIVITY_MILESTONE_KEY_COLUMN,
  planActivityStamp,
} from './activity-changed-fields.js';
import type { MigrationLogger } from './stored-metadata-body-migration.js';

const ACTIVITY_OBJECT = 'sys_activity';

/** The backfill reads and writes as the platform, never as a user. */
const SYSTEM_CTX = { isSystem: true } as const;

/** Rows read per page. */
export const ACTIVITY_BACKFILL_PAGE_SIZE = 500;

/** The engine surface the runner needs — the real data-engine contract's members. */
export type ActivityChangedFieldsBackfillEngine = Pick<IDataEngine, 'find' | 'update'>;

/** What one backfill run did (or would do in dry-run). */
export interface ActivityChangedFieldsBackfillReport {
  apply: boolean;
  /** Unstamped rows read. */
  scanned: number;
  /** Rows the planner stamped (or would stamp). */
  stamped: number;
  /** Of those, rows that carry a milestone key. */
  milestones: number;
  /** Unstamped rows the planner cannot judge: they stay unstamped (withheld). */
  unjudged: number;
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
 * Stamp `changed_fields` and `milestone_key` on every unstamped `sys_activity`
 * row. Dry-run by default; `apply` writes. Idempotent.
 */
export async function backfillActivityChangedFields(
  engine: ActivityChangedFieldsBackfillEngine,
  logger: MigrationLogger,
  options: { apply?: boolean; pageSize?: number } = {},
): Promise<ActivityChangedFieldsBackfillReport> {
  const apply = options.apply === true;
  const pageSize = options.pageSize && options.pageSize > 0 ? options.pageSize : ACTIVITY_BACKFILL_PAGE_SIZE;
  const report: ActivityChangedFieldsBackfillReport = {
    apply,
    scanned: 0,
    stamped: 0,
    milestones: 0,
    unjudged: 0,
    failures: 0,
  };

  // Keyset paging on `id`: a stamped row leaves the unstamped set, an unjudged
  // one stays in it, and neither is read twice in one run.
  let after: string | undefined;
  for (;;) {
    const unstamped: Record<string, unknown> = { [ACTIVITY_CHANGED_FIELDS_COLUMN]: { $null: true } };
    const where = after === undefined ? unstamped : { $and: [unstamped, { id: { $gt: after } }] };
    let rows: Record<string, unknown>[];
    try {
      rows = asArray(
        await engine.find(
          ACTIVITY_OBJECT,
          {
            where,
            fields: ['id', 'metadata'],
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
        `[activity-changed-fields-backfill] could not read ${ACTIVITY_OBJECT} — its remaining rows were NOT ` +
          `examined: ${(e as Error)?.message ?? String(e)}`,
      );
      break;
    }
    if (rows.length === 0) break;

    for (const row of rows) {
      report.scanned += 1;
      const stamp = planActivityStamp(row.metadata);
      if (!stamp) {
        report.unjudged += 1;
        continue;
      }
      report.stamped += 1;
      if (stamp.milestone_key !== null) report.milestones += 1;
      if (!apply) continue;
      const id = row.id;
      if (typeof id !== 'string' || id === '') {
        report.failures += 1;
        logger.warn(`[activity-changed-fields-backfill] ${ACTIVITY_OBJECT} row has no id — cannot stamp it`);
        continue;
      }
      try {
        // A single-id write, as the platform: a system caller is exempt from
        // the static-readonly strip every activity field carries.
        await engine.update(
          ACTIVITY_OBJECT,
          {
            id,
            [ACTIVITY_CHANGED_FIELDS_COLUMN]: stamp.changed_fields,
            [ACTIVITY_MILESTONE_KEY_COLUMN]: stamp.milestone_key,
          },
          { context: SYSTEM_CTX },
        );
      } catch (e) {
        report.failures += 1;
        logger.warn(
          `[activity-changed-fields-backfill] failed to stamp ${ACTIVITY_OBJECT}/${id}: ` +
            `${(e as Error)?.message ?? String(e)}`,
        );
      }
    }

    const last = rows[rows.length - 1]?.id;
    if (rows.length < pageSize || typeof last !== 'string' || last === '') break;
    after = last;
  }

  logger.info?.(
    `[activity-changed-fields-backfill] ${apply ? 'stamped' : 'would stamp'} ${report.stamped} of ${report.scanned} ` +
      `unstamped ${ACTIVITY_OBJECT} row(s)` +
      (report.unjudged > 0 ? `; ${report.unjudged} cannot be judged and stay unstamped (withheld)` : '') +
      (report.failures > 0 ? ` (${report.failures} failed — re-run to finish)` : ''),
  );
  return report;
}
